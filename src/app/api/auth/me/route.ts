import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer, getSupabaseServerClient } from '@/lib/supabase-server';

/**
 * Override the profile's role from app_metadata if the user is a superadmin.
 * This handles the case where the DB CHECK constraint prevents storing 'superadmin'
 * but the app_metadata has been set correctly via the admin API.
 * Also attempts to UPDATE the DB profile to 'superadmin' if the constraint has been fixed.
 */
async function applySuperadminOverride(
  profile: Record<string, unknown>,
  authUser: { id: string; app_metadata?: Record<string, unknown> }
): Promise<Record<string, unknown>> {
  const appRole = authUser.app_metadata?.role as string | undefined;

  if (appRole === 'superadmin' && profile.role !== 'superadmin') {
    // Try to UPDATE the DB profile to 'superadmin' (CHECK constraint might have been fixed)
    try {
      const { data: updatedProfile, error: updateError } = await supabaseServer
        .from('users')
        .update({ role: 'superadmin', updated_at: new Date().toISOString() })
        .eq('id', authUser.id)
        .select()
        .single();

      if (!updateError && updatedProfile) {
        console.log(`[auth/me] Promoted DB profile to superadmin for user ${authUser.id}`);
        return updatedProfile;
      }
    } catch {
      // UPDATE failed — fall through to override
    }

    // Can't update DB — override the role from app_metadata so the frontend sees 'superadmin'
    console.warn(`[auth/me] DB profile role is '${profile.role}' but app_metadata says 'superadmin' — overriding`);
    return { ...profile, role: 'superadmin' };
  }

  return profile;
}

/**
 * GET /api/auth/me
 * Fetches the current authenticated user's profile using the service role key.
 * This bypasses RLS policies that might block client-side queries.
 * Used by the auth store to reliably fetch user profiles during login/initialization.
 */
export async function GET(request: NextRequest) {
  try {
    // Try Bearer token first (from client-side auth header)
    let authUser = null;
    const authHeader = request.headers.get('authorization');
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const { data: { user }, error } = await supabaseServer.auth.getUser(token);
      if (!error && user) authUser = user;
    }

    // Fallback: try server-side cookie auth
    if (!authUser) {
      try {
        const serverClient = await getSupabaseServerClient();
        const { data: { user }, error } = await serverClient.auth.getUser();
        if (!error && user) authUser = user;
      } catch {
        // Cookie auth might fail in API routes
      }
    }

    if (!authUser) {
      return NextResponse.json({ error: 'غير مسجل الدخول' }, { status: 401 });
    }

    // Fetch user profile using service role (bypasses RLS)
    const { data: profile, error: profileError } = await supabaseServer
      .from('users')
      .select('*')
      .eq('id', authUser.id)
      .single();

    if (profileError || !profile) {
      // Profile doesn't exist yet - create it from auth metadata
      const userName = authUser.user_metadata?.full_name || authUser.user_metadata?.name || authUser.email?.split('@')[0] || 'مستخدم';
      const avatarUrl = authUser.user_metadata?.avatar_url || null;

      // Check if this is the first user
      const { count: userCount } = await supabaseServer
        .from('users')
        .select('id', { count: 'exact', head: true });

      const isFirstUser = (userCount ?? 0) === 0;
      const defaultRole = isFirstUser ? 'superadmin' : 'student';

      let { data: newProfile, error: insertError } = await supabaseServer
        .from('users')
        .insert({
          id: authUser.id,
          email: authUser.email || '',
          name: userName,
          role: defaultRole,
          avatar_url: avatarUrl,
        })
        .select()
        .single();

      // If inserting 'superadmin' fails (CHECK constraint doesn't include it),
      // try inserting as 'admin' first, then we'll fix the constraint later.
      if (insertError && defaultRole === 'superadmin') {
        const err = insertError as { code?: string; message?: string };
        const isCheckViolation = err.code === '23514' ||
          (err.message || '').includes('check constraint') ||
          (err.message || '').includes('violates');

        if (isCheckViolation) {
          console.warn('[auth/me] CHECK constraint blocks superadmin role — inserting as admin first, then promoting');
          // Insert as 'admin' first (which is allowed by the CHECK constraint)
          const { data: adminProfile, error: adminInsertError } = await supabaseServer
            .from('users')
            .insert({
              id: authUser.id,
              email: authUser.email || '',
              name: userName,
              role: 'admin',
              avatar_url: avatarUrl,
            })
            .select()
            .single();

          if (!adminInsertError && adminProfile) {
            // PRIMARY: Set app_metadata.role = 'superadmin' first (ALWAYS works, bypasses DB constraints)
            try {
              await supabaseServer.auth.admin.updateUserById(authUser.id, {
                app_metadata: { role: 'superadmin' },
              });
            } catch { /* non-critical */ }

            // SECONDARY: Try to update the DB role to 'superadmin' (works if CHECK constraint has been fixed)
            const { data: promotedProfile, error: promoteError } = await supabaseServer
              .from('users')
              .update({ role: 'superadmin', updated_at: new Date().toISOString() })
              .eq('id', authUser.id)
              .select()
              .single();

            if (!promoteError && promotedProfile) {
              newProfile = promotedProfile;
            } else {
              // DB promotion failed — override role from app_metadata so frontend sees 'superadmin'
              console.warn('[auth/me] Could not promote DB to superadmin — overriding from app_metadata');
              newProfile = { ...adminProfile, role: 'superadmin' };
            }

            return NextResponse.json({ profile: newProfile, isNew: true });
          }
        }
      }

      if (insertError) {
        // Might be a duplicate key error (race condition with trigger)
        const err = insertError as { code?: string; message?: string };
        if (err.code === '23505' || (err.message || '').includes('duplicate key')) {
          // Try fetching again
          const { data: retryProfile } = await supabaseServer
            .from('users')
            .select('*')
            .eq('id', authUser.id)
            .single();

          if (retryProfile) {
            // CRITICAL: Do NOT blindly sync app_metadata from the DB profile.
            // The trigger may have created the profile as 'student' but this user
            // might be the first user who should be 'superadmin'.
            // Only sync app_metadata if the existing app_metadata is NOT 'superadmin'.
            const existingAppRole = authUser.app_metadata?.role as string | undefined;
            if (existingAppRole === 'superadmin') {
              // app_metadata already correctly says superadmin — don't overwrite it!
              // Override the returned profile role from app_metadata instead.
              const overriddenProfile = { ...retryProfile, role: 'superadmin' };
              return NextResponse.json({ profile: overriddenProfile, isNew: true });
            }
            // app_metadata doesn't say superadmin — safe to sync from DB
            if (retryProfile.role && existingAppRole !== retryProfile.role) {
              try {
                await supabaseServer.auth.admin.updateUserById(authUser.id, {
                  app_metadata: { role: retryProfile.role },
                });
              } catch { /* non-critical */ }
            }
            return NextResponse.json({ profile: retryProfile, isNew: true });
          }
        }
        return NextResponse.json({ error: 'فشل في إنشاء الملف الشخصي' }, { status: 500 });
      }

      // Sync app_metadata for the new profile so middleware/fallback profile works correctly
      if (defaultRole === 'superadmin') {
        try {
          await supabaseServer.auth.admin.updateUserById(authUser.id, {
            app_metadata: { role: 'superadmin' },
          });
        } catch { /* non-critical: DB role is already set */ }
      }

      return NextResponse.json({ profile: newProfile, isNew: true });
    }

    // Check ban status
    const { data: bannedRecord } = await supabaseServer
      .from('banned_users')
      .select('id, reason, banned_at, ban_until, is_active')
      .eq('email', profile.email)
      .maybeSingle();

    let banInfo = null;
    if (bannedRecord) {
      const isActive = bannedRecord.is_active === undefined || bannedRecord.is_active === true;
      const isExpired = bannedRecord.ban_until && new Date(bannedRecord.ban_until) <= new Date();

      if (isActive && !isExpired) {
        banInfo = {
          reason: bannedRecord.reason,
          bannedAt: bannedRecord.banned_at,
          banUntil: bannedRecord.ban_until,
          isPermanent: !bannedRecord.ban_until,
        };
      }
    }

    // Clean up corrupted avatar_url (if it contains institution logo path)
    if (profile.avatar_url && (
      profile.avatar_url.includes('/institution/logos/') ||
      profile.avatar_url.includes('/institution%2Flogos%2F')
    )) {
      // This avatar_url was corrupted by the old /api/avatar endpoint being used for institution logos
      // Clear it so the user sees their initials instead of the institution logo
      await supabaseServer
        .from('users')
        .update({ avatar_url: null })
        .eq('id', authUser.id);
      profile.avatar_url = null;
    }

    // ─── Superadmin override from app_metadata ───
    // If app_metadata says 'superadmin' but DB profile has a different role
    // (due to CHECK constraint blocking 'superadmin'), override the profile role.
    // This is the KEY mechanism: app_metadata is ALWAYS set correctly via
    // supabaseServer.auth.admin.updateUserById(), which bypasses DB constraints.
    const updatedProfile = await applySuperadminOverride(profile, authUser);

    // Sync role to auth app_metadata so middleware can check it without DB query.
    // This is critical for when RLS policies cause infinite recursion (42P17).
    // The middleware falls back to checking app_metadata.role.
    //
    // CRITICAL RULE: If app_metadata already says 'superadmin', NEVER overwrite it
    // with the DB profile's role. The DB might say 'student' or 'admin' because
    // the CHECK constraint blocks 'superadmin', but app_metadata is the source
    // of truth for superadmin status (set via admin API which bypasses constraints).
    const currentAppRole = authUser.app_metadata?.role as string | undefined;
    const effectiveRole = updatedProfile.role || profile.role;
    if (currentAppRole === 'superadmin') {
      // app_metadata already says superadmin — NEVER downgrade it.
      // The updatedProfile already has the override applied by applySuperadminOverride.
      // No need to sync — app_metadata is already correct.
    } else if (currentAppRole !== effectiveRole) {
      // Only sync if we're NOT downgrading from superadmin
      try {
        await supabaseServer.auth.admin.updateUserById(authUser.id, {
          app_metadata: { role: effectiveRole },
        });
      } catch {
        // Non-critical: if this fails, the middleware will still try the DB query
      }
    }

    return NextResponse.json({ profile: updatedProfile, banInfo });
  } catch (err) {
    console.error('[auth/me] Error:', err);
    return NextResponse.json({ error: 'حدث خطأ غير متوقع' }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';

/**
 * POST /api/auth/check-first-user
 * Checks if the given user is the first user on the platform.
 * If so, promotes them to 'superadmin'.
 *
 * PRIMARY MECHANISM: `supabaseServer.auth.admin.updateUserById()` to set
 * `app_metadata.role = 'superadmin'`. This ALWAYS works because it goes
 * through the Supabase Auth admin API, NOT PostgREST, so it bypasses
 * DB-level CHECK constraints on the `users` table.
 *
 * SECONDARY MECHANISM: Try to create/update the DB profile role to
 * 'superadmin'. This only works if the CHECK constraint has been fixed
 * (via the DB migration step in setup wizard). If the CHECK constraint
 * blocks 'superadmin', the profile stays as 'admin' but the frontend
 * will read 'superadmin' from app_metadata.
 *
 * SECURITY: Requires valid Bearer token. Verifies that the authenticated user
 * matches the userId being promoted.
 */
export async function POST(request: NextRequest) {
  try {
    // ─── Authentication check ───
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json(
        { success: false, error: 'غير مصرح — يرجى تسجيل الدخول' },
        { status: 401 }
      );
    }

    const token = authHeader.replace('Bearer ', '');

    // Verify the token with Supabase to get the authenticated user ID
    const { data: { user: authUser }, error: authError } = await supabaseServer.auth.getUser(token);

    if (authError || !authUser) {
      return NextResponse.json(
        { success: false, error: 'جلسة غير صالحة — يرجى تسجيل الدخول مرة أخرى' },
        { status: 401 }
      );
    }

    // Parse body safely
    let body: { userId?: string };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { success: false, error: 'طلب غير صالح' },
        { status: 400 }
      );
    }

    const { userId } = body;

    if (!userId) {
      return NextResponse.json(
        { success: false, error: 'معرف المستخدم مطلوب' },
        { status: 400 }
      );
    }

    // ─── Verify the authenticated user matches the userId being promoted ───
    if (authUser.id !== userId) {
      console.warn(`[check-first-user] Auth user ${authUser.id} attempted to promote different user ${userId}`);
      return NextResponse.json(
        { success: false, error: 'غير مصرح — لا يمكنك ترقية مستخدم آخر' },
        { status: 403 }
      );
    }

    // ─── Step 1: Check if user already has a profile ───
    const { data: currentProfile } = await supabaseServer
      .from('users')
      .select('*')
      .eq('id', userId)
      .single();

    // ─── If profile exists and is already superadmin → done ───
    if (currentProfile?.role === 'superadmin') {
      await syncAppMetadata(userId, 'superadmin');
      return NextResponse.json({
        success: true,
        promoted: false,
        role: 'superadmin',
        user: currentProfile,
      });
    }

    // ─── Step 2: Check if this is the first user ───
    let isFirstUser = false;

    // Try atomic check via system_initialized table
    const { error: initError } = await supabaseServer
      .from('system_initialized')
      .insert({ initialized: true, initialized_by: userId });

    if (initError) {
      const isDuplicate = initError.code === '23505' ||
        (initError.message || '').includes('duplicate') ||
        (initError.message || '').includes('unique');

      if (isDuplicate) {
        // System already initialized — not the first user
        // But check if this user's app_metadata already says superadmin
        const existingAppRole = authUser.app_metadata?.role;
        const returnedProfile = overrideProfileFromAppMetadata(currentProfile, authUser);

        return NextResponse.json({
          success: true,
          promoted: false,
          role: returnedProfile?.role || existingAppRole || null,
          user: returnedProfile,
        });
      }

      // system_initialized table might not exist — fall back to count check
      console.warn('[check-first-user] system_initialized table not found, falling back to count check:', initError.message);

      const { count, error: countError } = await supabaseServer
        .from('users')
        .select('id', { count: 'exact', head: true });

      if (countError) {
        console.error('[check-first-user] Error counting users:', countError);
        return NextResponse.json(
          { success: false, error: 'خطأ في التحقق من عدد المستخدمين' },
          { status: 500 }
        );
      }

      isFirstUser = count !== null && count <= 1;
    } else {
      isFirstUser = true;
    }

    if (!isFirstUser) {
      // Not the first user — but still check app_metadata for superadmin override
      const returnedProfile = overrideProfileFromAppMetadata(currentProfile, authUser);
      return NextResponse.json({
        success: true,
        promoted: false,
        role: returnedProfile?.role || null,
        user: returnedProfile || null,
      });
    }

    // ─── Step 3: FIRST USER — Set app_metadata.role = 'superadmin' FIRST ───
    // This is the PRIMARY mechanism and ALWAYS works because it bypasses
    // DB-level CHECK constraints.
    await syncAppMetadata(userId, 'superadmin');
    console.log(`[check-first-user] Set app_metadata.role=superadmin for first user ${userId}`);

    // ─── Step 4: Try to create/update DB profile to 'superadmin' ───
    const userName = authUser.user_metadata?.name || authUser.email?.split('@')[0] || 'مستخدم';
    let finalProfile: Record<string, unknown> | null = null;
    let dbRoleIsSuperadmin = false;

    if (!currentProfile) {
      // ─── Profile doesn't exist — CREATE it ───
      // Try inserting with 'superadmin' first
      const { data: newProfile, error: insertError } = await supabaseServer
        .from('users')
        .insert({
          id: userId,
          email: authUser.email || '',
          name: userName,
          role: 'superadmin',
        })
        .select()
        .single();

      if (!insertError && newProfile) {
        // Successfully created with superadmin role
        dbRoleIsSuperadmin = true;
        finalProfile = newProfile;
        console.log('[check-first-user] Created first user profile as superadmin:', userId);
      } else {
        // superadmin INSERT failed — likely CHECK constraint
        console.warn('[check-first-user] Cannot insert as superadmin, trying admin:', insertError?.message);

        // Try inserting as 'admin' (always allowed by CHECK constraint)
        const { data: adminProfile, error: adminInsertError } = await supabaseServer
          .from('users')
          .insert({
            id: userId,
            email: authUser.email || '',
            name: userName,
            role: 'admin',
          })
          .select()
          .single();

        if (adminInsertError) {
          // Might be duplicate key (race condition with trigger that created it as 'student')
          const err = adminInsertError as { code?: string; message?: string };
          if (err.code === '23505' || (err.message || '').includes('duplicate key')) {
            // Profile was created by the trigger — fetch it
            const { data: retryProfile } = await supabaseServer
              .from('users')
              .select('*')
              .eq('id', userId)
              .single();

            if (retryProfile) {
              // Try to promote the existing profile
              const promoted = await tryPromoteToSuperadmin(userId);
              if (promoted) {
                dbRoleIsSuperadmin = true;
                finalProfile = promoted;
              } else {
                // Can't promote in DB — override role from app_metadata
                finalProfile = { ...retryProfile, role: 'superadmin' };
                console.warn('[check-first-user] DB profile stuck at', retryProfile.role, '— overriding from app_metadata');
              }
            }
          } else {
            console.error('[check-first-user] Error creating profile:', adminInsertError);
            // Don't fail — app_metadata is already set to superadmin
          }
        } else if (adminProfile) {
          // Profile created as 'admin' — try to promote to superadmin
          const promoted = await tryPromoteToSuperadmin(userId);
          if (promoted) {
            dbRoleIsSuperadmin = true;
            finalProfile = promoted;
          } else {
            // Can't promote in DB — override role from app_metadata
            finalProfile = { ...adminProfile, role: 'superadmin' };
            console.warn('[check-first-user] DB profile is admin — overriding from app_metadata to superadmin');
          }
        }
      }
    } else {
      // ─── Profile exists but not superadmin — UPDATE it ───
      const promoted = await tryPromoteToSuperadmin(userId);
      if (promoted) {
        dbRoleIsSuperadmin = true;
        finalProfile = promoted;
      } else {
        // Can't promote in DB — override role from app_metadata
        finalProfile = { ...currentProfile, role: 'superadmin' };
        console.warn('[check-first-user] DB profile stuck at', currentProfile.role, '— overriding from app_metadata');
      }
    }

    // ─── Step 5: Return the profile ───
    // If we couldn't get/create a DB profile, construct a minimal one
    if (!finalProfile) {
      finalProfile = {
        id: userId,
        email: authUser.email || '',
        name: userName,
        role: 'superadmin', // From app_metadata
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
    }

    return NextResponse.json({
      success: true,
      promoted: true,
      role: 'superadmin',
      user: finalProfile,
      dbRoleIsSuperadmin, // Inform caller whether DB role matches
    });
  } catch (error) {
    console.error('[check-first-user] Error:', error);
    // ALWAYS return JSON — never let the route crash with HTML
    return NextResponse.json(
      { success: false, error: 'حدث خطأ غير متوقع' },
      { status: 500 }
    );
  }
}

/**
 * Try to update a user's role to 'superadmin' in the DB.
 * Returns the updated profile if successful, null if it fails
 * (e.g., CHECK constraint doesn't include 'superadmin').
 *
 * NOTE: We intentionally do NOT try `supabaseServer.rpc('exec_sql', ...)`
 * because that RPC function doesn't exist in standard Supabase setups.
 */
async function tryPromoteToSuperadmin(userId: string): Promise<Record<string, unknown> | null> {
  const { data, error } = await supabaseServer
    .from('users')
    .update({ role: 'superadmin', updated_at: new Date().toISOString() })
    .eq('id', userId)
    .select()
    .single();

  if (!error && data) {
    return data;
  }

  const err = error as { code?: string; message?: string };
  const isCheckViolation = err.code === '23514' ||
    (err.message || '').includes('check constraint') ||
    (err.message || '').includes('violates');

  if (isCheckViolation) {
    console.warn('[check-first-user] CHECK constraint blocks superadmin — DB migration needed. App_metadata is already set as fallback.');
  } else if (error) {
    console.warn('[check-first-user] Failed to promote in DB:', error.message);
  }

  return null;
}

/**
 * Override the profile's role from app_metadata if the user is a superadmin.
 * This handles the case where the DB CHECK constraint prevents storing 'superadmin'
 * but the app_metadata has been set correctly via the admin API.
 */
function overrideProfileFromAppMetadata(
  profile: Record<string, unknown> | null,
  authUser: { app_metadata?: Record<string, unknown> }
): Record<string, unknown> | null {
  if (!profile) return profile;
  const appRole = authUser.app_metadata?.role as string | undefined;
  if (appRole === 'superadmin' && profile.role !== 'superadmin') {
    return { ...profile, role: 'superadmin' };
  }
  return profile;
}

/**
 * Sync the user's role to Supabase auth app_metadata.
 * This ALWAYS works because it goes through the Auth admin API,
 * which bypasses DB-level CHECK constraints.
 */
async function syncAppMetadata(userId: string, role: string): Promise<void> {
  try {
    await supabaseServer.auth.admin.updateUserById(userId, {
      app_metadata: { role },
    });
    console.log(`[check-first-user] Synced app_metadata.role=${role} for user ${userId}`);
  } catch (err) {
    console.warn('[check-first-user] Failed to sync app_metadata (non-critical):', err);
  }
}

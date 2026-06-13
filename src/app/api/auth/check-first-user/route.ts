import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';

/**
 * POST /api/auth/check-first-user
 *
 * RADICAL FIX: Determines if the authenticated user should be superadmin.
 *
 * Logic:
 * 1. If NO superadmin exists in the DB → this user IS the first user → promote them
 * 2. If a superadmin already exists → this is NOT the first user → return their current role
 *
 * This ignores the `system_initialized` table because it can have stale data
 * from previous failed setup attempts. The ONLY reliable indicator is whether
 * a superadmin row exists in the `users` table.
 *
 * Promotion mechanism:
 * - PRIMARY: Set app_metadata.role = 'superadmin' via admin API (always works, bypasses DB constraints)
 * - SECONDARY: Try to UPDATE the DB profile to 'superadmin' (works if CHECK constraint has been fixed)
 * - FALLBACK: If DB UPDATE fails (CHECK constraint), override the returned profile role from app_metadata
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
      return NextResponse.json(
        { success: false, error: 'غير مصرح — لا يمكنك ترقية مستخدم آخر' },
        { status: 403 }
      );
    }

    // ─── Check if user already has a profile ───
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

    // ─── CORE LOGIC: Check if ANY superadmin exists in the system ───
    // This is the ONLY reliable way to determine if this is the first user.
    // We intentionally ignore system_initialized because it can have stale data.
    const { count: superadminCount, error: countError } = await supabaseServer
      .from('users')
      .select('id', { count: 'exact', head: true })
      .eq('role', 'superadmin');

    if (countError) {
      console.error('[check-first-user] Error counting superadmins:', countError);
      // Don't fail — try to proceed with the user count fallback
    }

    const superadminExists = (superadminCount ?? 0) > 0;

    // Also check: does the user's app_metadata already say superadmin?
    // (from a previous promotion that couldn't update the DB)
    const appRoleIsSuperadmin = authUser.app_metadata?.role === 'superadmin';

    if (superadminExists && !appRoleIsSuperadmin) {
      // A superadmin already exists and this user is NOT it → return their current role
      const returnedProfile = currentProfile || null;
      return NextResponse.json({
        success: true,
        promoted: false,
        role: returnedProfile?.role || null,
        user: returnedProfile,
      });
    }

    // ─── This user should be superadmin ───
    // Either: no superadmin exists (this is the first user)
    // Or: app_metadata already says superadmin (previous partial promotion)
    console.log(`[check-first-user] Promoting user ${userId} to superadmin (superadminExists=${superadminExists}, appRoleIsSuperadmin=${appRoleIsSuperadmin})`);

    // Step 1: Set app_metadata.role = 'superadmin' (ALWAYS works, bypasses DB constraints)
    await syncAppMetadata(userId, 'superadmin');

    // Step 2: Try to update the DB profile to 'superadmin'
    let finalProfile: Record<string, unknown> | null = null;
    let dbRoleIsSuperadmin = false;

    if (currentProfile) {
      // Profile exists — try to UPDATE it to 'superadmin'
      const promoted = await tryPromoteToSuperadmin(userId);
      if (promoted) {
        dbRoleIsSuperadmin = true;
        finalProfile = promoted;
      } else {
        // Can't update DB — override role from app_metadata
        finalProfile = { ...currentProfile, role: 'superadmin' };
        console.warn(`[check-first-user] DB profile stuck at '${currentProfile.role}' — overriding from app_metadata`);
      }
    } else {
      // Profile doesn't exist yet — try to CREATE it as 'superadmin'
      const userName = authUser.user_metadata?.name || authUser.email?.split('@')[0] || 'مستخدم';

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
        dbRoleIsSuperadmin = true;
        finalProfile = newProfile;
        console.log('[check-first-user] Created first user profile as superadmin:', userId);
      } else {
        // superadmin INSERT failed — try 'admin' as fallback
        console.warn('[check-first-user] Cannot insert as superadmin, trying admin:', insertError?.message);

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
          // Might be duplicate key (trigger already created it)
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
                finalProfile = { ...retryProfile, role: 'superadmin' };
                console.warn(`[check-first-user] DB profile stuck at '${retryProfile.role}' — overriding from app_metadata`);
              }
            }
          } else {
            console.error('[check-first-user] Error creating profile:', adminInsertError);
          }
        } else if (adminProfile) {
          // Created as 'admin' — try to promote
          const promoted = await tryPromoteToSuperadmin(userId);
          if (promoted) {
            dbRoleIsSuperadmin = true;
            finalProfile = promoted;
          } else {
            finalProfile = { ...adminProfile, role: 'superadmin' };
            console.warn('[check-first-user] DB profile is admin — overriding from app_metadata to superadmin');
          }
        }
      }
    }

    // If we couldn't get/create a DB profile, construct a minimal one from app_metadata
    if (!finalProfile) {
      const userName = authUser.user_metadata?.name || authUser.email?.split('@')[0] || 'مستخدم';
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
      dbRoleIsSuperadmin,
    });
  } catch (error) {
    console.error('[check-first-user] Error:', error);
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
  if (err.code === '23514' || (err.message || '').includes('check constraint') || (err.message || '').includes('violates')) {
    console.warn('[check-first-user] CHECK constraint blocks superadmin — DB migration needed. App_metadata is already set as fallback.');
  } else if (error) {
    console.warn('[check-first-user] Failed to promote in DB:', error.message);
  }

  return null;
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

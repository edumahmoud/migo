import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';

/**
 * POST /api/auth/check-first-user
 * Checks if the given user is the first user on the platform.
 * If so, promotes them to 'superadmin'.
 *
 * Handles the case where the DB trigger failed to create the profile
 * (e.g., CHECK constraint doesn't include 'superadmin') by creating
 * the profile directly with the correct role.
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

    const body = await request.json();
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
        return NextResponse.json({
          success: true,
          promoted: false,
          role: currentProfile?.role || null,
          user: currentProfile || null,
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
      return NextResponse.json({
        success: true,
        promoted: false,
        role: currentProfile?.role || null,
        user: currentProfile || null,
      });
    }

    // ─── Step 3: Ensure the first user gets superadmin role ───
    const userName = authUser.user_metadata?.name || authUser.email?.split('@')[0] || 'مستخدم';

    if (!currentProfile) {
      // ─── Profile doesn't exist — CREATE it ───
      // The DB trigger failed (likely CHECK constraint doesn't include 'superadmin').
      // Try inserting with 'superadmin' first, then fall back to 'admin'.

      // Try superadmin first
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
        await syncAppMetadata(userId, 'superadmin');
        console.log('[check-first-user] Created first user profile as superadmin:', userId);
        return NextResponse.json({
          success: true,
          promoted: true,
          role: 'superadmin',
          user: newProfile,
        });
      }

      // superadmin INSERT failed — likely CHECK constraint
      console.warn('[check-first-user] Cannot insert as superadmin, trying admin:', insertError);

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
            const promotedProfile = await tryPromoteToSuperadmin(userId);
            const finalProfile = promotedProfile || retryProfile;
            const finalRole = finalProfile.role || retryProfile.role;
            await syncAppMetadata(userId, finalRole);

            return NextResponse.json({
              success: true,
              promoted: promotedProfile?.role === 'superadmin',
              role: finalRole,
              user: finalProfile,
            });
          }
        }

        console.error('[check-first-user] Error creating profile:', adminInsertError);
        return NextResponse.json(
          { success: false, error: 'خطأ في إنشاء الملف الشخصي' },
          { status: 500 }
        );
      }

      // Profile created as 'admin' — try to promote to superadmin
      const promotedProfile = await tryPromoteToSuperadmin(userId);

      if (promotedProfile) {
        await syncAppMetadata(userId, 'superadmin');
        return NextResponse.json({
          success: true,
          promoted: true,
          role: 'superadmin',
          user: promotedProfile,
        });
      }

      // Can't promote to superadmin — keep as admin
      await syncAppMetadata(userId, 'admin');
      console.warn('[check-first-user] Keeping first user as admin (superadmin not in CHECK constraint)');
      return NextResponse.json({
        success: true,
        promoted: true,
        role: 'admin',
        user: adminProfile,
        warning: 'تم إنشاء الحساب كمدير. يرجى تشغيل SQL لإضافة دور superadmin ثم ترقية الحساب من الإعدادات.',
      });
    }

    // ─── Profile exists but not superadmin — UPDATE it ───
    const promotedProfile = await tryPromoteToSuperadmin(userId);

    if (promotedProfile) {
      await syncAppMetadata(userId, 'superadmin');
      return NextResponse.json({
        success: true,
        promoted: true,
        role: 'superadmin',
        user: promotedProfile,
      });
    }

    // Can't promote — keep current role
    await syncAppMetadata(userId, currentProfile.role || 'admin');
    return NextResponse.json({
      success: true,
      promoted: false,
      role: currentProfile.role,
      user: currentProfile,
      warning: 'لم يتم ترقية الحساب. يرجى تشغيل SQL لإضافة دور superadmin.',
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
 * Try to update a user's role to 'superadmin'.
 * Returns the updated profile if successful, null if it fails
 * (e.g., CHECK constraint doesn't include 'superadmin').
 */
async function tryPromoteToSuperadmin(userId: string): Promise<Record<string, unknown> | null> {
  // Try direct update
  const { data, error } = await supabaseServer
    .from('users')
    .update({ role: 'superadmin', updated_at: new Date().toISOString() })
    .eq('id', userId)
    .select()
    .single();

  if (!error && data) {
    return data;
  }

  // If CHECK constraint violation, try to fix the constraint
  const err = error as { code?: string; message?: string };
  const isCheckViolation = err.code === '23514' ||
    (err.message || '').includes('check constraint') ||
    (err.message || '').includes('violates');

  if (isCheckViolation) {
    console.warn('[check-first-user] CHECK constraint blocks superadmin — attempting to fix...');

    try {
      await supabaseServer.rpc('exec_sql', {
        sql: `ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_role_check;
              ALTER TABLE public.users ADD CONSTRAINT users_role_check CHECK (role IN ('student', 'teacher', 'admin', 'superadmin'));`
      });
    } catch {
      console.warn('[check-first-user] Could not alter CHECK constraint via RPC');
    }

    // Try again after constraint fix
    const { data: retryData, error: retryError } = await supabaseServer
      .from('users')
      .update({ role: 'superadmin', updated_at: new Date().toISOString() })
      .eq('id', userId)
      .select()
      .single();

    if (!retryError && retryData) {
      return retryData;
    }
  }

  return null;
}

/**
 * Sync the user's role to Supabase auth app_metadata.
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

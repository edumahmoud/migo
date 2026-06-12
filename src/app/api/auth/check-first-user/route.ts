import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';

/**
 * POST /api/auth/check-first-user
 * Checks if the given user is the first user on the platform.
 * If so, promotes them to 'superadmin'.
 * This is called after successful registration (email+password or Google OAuth).
 *
 * SECURITY: Requires valid Bearer token. Verifies that the authenticated user
 * matches the userId being promoted. Uses atomic DB-level check via the
 * `system_initialized` table to prevent race conditions.
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
    // This prevents one user from promoting a different user to superadmin.
    if (authUser.id !== userId) {
      console.warn(`[check-first-user] Auth user ${authUser.id} attempted to promote different user ${userId}`);
      return NextResponse.json(
        { success: false, error: 'غير مصرح — لا يمكنك ترقية مستخدم آخر' },
        { status: 403 }
      );
    }

    // ─── Check if user is already a superadmin ───
    // If the user already has the superadmin role, no promotion is needed.
    // This avoids unnecessary DB operations and prevents errors when the
    // system_initialized table doesn't exist but the user was already promoted
    // by the DB trigger or a previous call.
    const { data: currentProfile } = await supabaseServer
      .from('users')
      .select('role')
      .eq('id', userId)
      .single();

    if (currentProfile?.role === 'superadmin') {
      // Already superadmin — sync app_metadata just in case and return
      await syncAppMetadata(userId, 'superadmin');
      return NextResponse.json({
        success: true,
        promoted: false,
        role: 'superadmin',
        user: currentProfile,
      });
    }

    // ─── Atomic first-user check using system_initialized table ───
    // Try to insert a row into `system_initialized`. If it already exists (unique constraint),
    // someone else was first. This prevents race conditions where two users register
    // simultaneously and both get superadmin.
    let isFirstUser = false;
    const { error: initError } = await supabaseServer
      .from('system_initialized')
      .insert({ initialized: true, initialized_by: userId });

    if (initError) {
      // If the insert failed (likely unique constraint violation), the system
      // was already initialized — this user is NOT the first user.
      const isDuplicate = initError.code === '23505' || (initError.message || '').includes('duplicate') || (initError.message || '').includes('unique');
      if (isDuplicate) {
        // System already initialized — no promotion needed
        return NextResponse.json({
          success: true,
          promoted: false,
          role: null,
        });
      }

      // The `system_initialized` table might not exist yet.
      // Fall back to the count-based check, but still use the authenticated userId.
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

      // If this is the first (and only) user, promote to superadmin
      isFirstUser = count !== null && count <= 1;
    } else {
      // Successfully inserted into system_initialized — we are the first user!
      isFirstUser = true;
    }

    if (!isFirstUser) {
      // Not the first user - no promotion needed
      return NextResponse.json({
        success: true,
        promoted: false,
        role: null,
      });
    }

    // ─── Promote the first user to superadmin ───
    const { data, error: updateError } = await supabaseServer
      .from('users')
      .update({ role: 'superadmin', updated_at: new Date().toISOString() })
      .eq('id', userId)
      .select()
      .single();

    if (updateError) {
      console.error('[check-first-user] Error promoting first user to superadmin:', updateError);
      return NextResponse.json(
        { success: false, error: 'خطأ في ترقية الحساب' },
        { status: 500 }
      );
    }

    // ─── Sync app_metadata so middleware recognizes the superadmin role ───
    // Without this, the middleware and createFallbackProfile() won't see
    // the user as superadmin, causing auth failures when saving institution
    // settings or accessing admin pages.
    await syncAppMetadata(userId, 'superadmin');

    console.log('[check-first-user] Successfully promoted first user to superadmin:', userId);

    return NextResponse.json({
      success: true,
      promoted: true,
      role: 'superadmin',
      user: data,
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
 * Sync the user's role to Supabase auth app_metadata.
 * This is critical for:
 * - Middleware role checks (avoids extra DB queries)
 * - createFallbackProfile() which reads app_metadata.role
 * - RLS policies that check app_metadata
 */
async function syncAppMetadata(userId: string, role: string): Promise<void> {
  try {
    await supabaseServer.auth.admin.updateUserById(userId, {
      app_metadata: { role },
    });
    console.log(`[check-first-user] Synced app_metadata.role=${role} for user ${userId}`);
  } catch (err) {
    // Non-critical: the DB role is already updated, this is just a sync optimization
    console.warn('[check-first-user] Failed to sync app_metadata (non-critical):', err);
  }
}

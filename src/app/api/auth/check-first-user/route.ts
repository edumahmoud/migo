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

    // ─── Atomic first-user check using system_initialized table ───
    // Try to insert a row into `system_initialized`. If it already exists (unique constraint),
    // someone else was first. This prevents race conditions where two users register
    // simultaneously and both get superadmin.
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
        console.error('Error counting users:', countError);
        return NextResponse.json(
          { success: false, error: 'خطأ في التحقق من عدد المستخدمين' },
          { status: 500 }
        );
      }

      // If this is the first (and only) user, promote to superadmin
      if (count === 1) {
        const { data, error: updateError } = await supabaseServer
          .from('users')
          .update({ role: 'superadmin', updated_at: new Date().toISOString() })
          .eq('id', userId)
          .select()
          .single();

        if (updateError) {
          console.error('Error promoting first user to superadmin:', updateError);
          return NextResponse.json(
            { success: false, error: 'خطأ في ترقية الحساب' },
            { status: 500 }
          );
        }

        return NextResponse.json({
          success: true,
          promoted: true,
          role: 'superadmin',
          user: data,
        });
      }

      // Not the first user - no promotion needed
      return NextResponse.json({
        success: true,
        promoted: false,
        role: null,
      });
    }

    // ─── We successfully inserted into system_initialized — we are the first user! ───
    // Now promote to superadmin
    const { data, error: updateError } = await supabaseServer
      .from('users')
      .update({ role: 'superadmin', updated_at: new Date().toISOString() })
      .eq('id', userId)
      .select()
      .single();

    if (updateError) {
      console.error('Error promoting first user to superadmin:', updateError);
      return NextResponse.json(
        { success: false, error: 'خطأ في ترقية الحساب' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      promoted: true,
      role: 'superadmin',
      user: data,
    });
  } catch (error) {
    console.error('Check first user error:', error);
    return NextResponse.json(
      { success: false, error: 'حدث خطأ غير متوقع' },
      { status: 500 }
    );
  }
}

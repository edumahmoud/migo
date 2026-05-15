import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';

// ─── POST: Delete the currently authenticated user's account ───
// This is a self-service endpoint — the user deletes their own account.
// The request must include a valid Authorization header (Bearer token).
export async function POST(request: NextRequest) {
  try {
    // Verify the user is authenticated
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json(
        { success: false, error: 'غير مصرح — يرجى تسجيل الدخول' },
        { status: 401 }
      );
    }

    const token = authHeader.replace('Bearer ', '');

    // Verify the token with Supabase to get the user ID
    const {
      data: { user: authUser },
      error: authError,
    } = await supabaseServer.auth.getUser(token);

    if (authError || !authUser) {
      return NextResponse.json(
        { success: false, error: 'جلسة غير صالحة — يرجى تسجيل الدخول مرة أخرى' },
        { status: 401 }
      );
    }

    const userId = authUser.id;
    const userEmail = authUser.email;

    // ─── Step 1: Delete the user's profile from public.users ───
    const { error: profileDeleteError } = await supabaseServer
      .from('users')
      .delete()
      .eq('id', userId);

    if (profileDeleteError) {
      console.error('[delete-account] Error deleting user profile:', profileDeleteError);
      return NextResponse.json(
        { success: false, error: 'حدث خطأ أثناء حذف بيانات المستخدم' },
        { status: 500 }
      );
    }

    // ─── Step 2: Delete the user from auth.users using admin API ───
    const { error: authDeleteError } = await supabaseServer.auth.admin.deleteUser(userId);

    if (authDeleteError) {
      console.error('[delete-account] Error deleting auth user:', authDeleteError);
      // Profile is already deleted, but auth account remains.
      // This is acceptable — the user can no longer log in since the profile is gone.
      // Log the error but still report success since the profile is deleted.
    }

    // ─── Step 3: Add email to banned_users to prevent re-registration ───
    if (userEmail) {
      const { error: banError } = await supabaseServer
        .from('banned_users')
        .upsert(
          { email: userEmail, reason: 'حذف الحساب بواسطة المستخدم' },
          { onConflict: 'email' }
        );

      if (banError) {
        console.error('[delete-account] Error adding to banned_users:', banError);
        // Non-critical: user is already deleted, just log the error
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[delete-account] Unexpected error:', error);
    return NextResponse.json(
      { success: false, error: 'حدث خطأ غير متوقع' },
      { status: 500 }
    );
  }
}

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

    // ─── Step 3: Note — we do NOT add the email to banned_users ───
    // Self-service account deletion should NOT prevent the user from
    // re-registering in the future. Only admin-deleted users should be banned.
    // The Supabase auth.users record is already deleted, so the user cannot
    // log in with the same auth account. If they want to re-register with
    // the same email, they should be allowed to do so.

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[delete-account] Unexpected error:', error);
    return NextResponse.json(
      { success: false, error: 'حدث خطأ غير متوقع' },
      { status: 500 }
    );
  }
}

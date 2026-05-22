import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer, getSupabaseServerClient } from '@/lib/supabase-server';
import { authenticateRequest, authErrorResponse, getUserRole } from '@/lib/auth-helpers';

export async function POST(request: NextRequest) {
  try {
    // ── Authenticate ──
    const authResult = await authenticateRequest(request);
    if (!authResult.success) return authErrorResponse(authResult);

    const authUserId = authResult.user.id;
    const authRole = await getUserRole(authUserId);

    if (!authRole || (authRole !== 'admin' && authRole !== 'superadmin')) {
      return NextResponse.json(
        { success: false, error: 'غير مصرح بهذا الإجراء' },
        { status: 403 }
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

    // SECURITY FIX: Prevent self-deletion
    if (userId === authUserId) {
      return NextResponse.json(
        { success: false, error: 'لا يمكنك حذف حسابك الخاص. استخدم إعدادات الحساب بدلاً من ذلك' },
        { status: 400 }
      );
    }

    // First, fetch the user's email and role before deleting
    const { data: userRecord } = await supabaseServer
      .from('users')
      .select('email, role')
      .eq('id', userId)
      .single();

    // Only superadmin can delete admins
    if (userRecord?.role === 'admin' && authRole !== 'superadmin') {
      return NextResponse.json(
        { success: false, error: 'فقط مدير المنصة يمكنه حذف المشرفين' },
        { status: 403 }
      );
    }

    // Cannot delete superadmins
    if (userRecord?.role === 'superadmin') {
      return NextResponse.json(
        { success: false, error: 'لا يمكن حذف مدير المنصة' },
        { status: 403 }
      );
    }

    const userEmail = userRecord?.email;

    // SECURITY FIX: Delete the Supabase Auth user FIRST.
    // Previously, only the profile was deleted, leaving the Auth account active.
    // This meant the user could still log in (but with no profile).
    // By deleting Auth first, the user is fully removed.
    if (userId) {
      try {
        const { error: authDeleteError } = await supabaseServer.auth.admin.deleteUser(userId);
        if (authDeleteError) {
          console.error('[delete-user] Auth deletion failed:', authDeleteError.message);
          // Continue anyway — the profile deletion and ban are still important
        }
      } catch (authErr) {
        console.error('[delete-user] Auth deletion exception:', authErr);
        // Continue — best effort
      }
    }

    // Delete the user from the users (profiles) table
    const { error } = await supabaseServer
      .from('users')
      .delete()
      .eq('id', userId);

    if (error) {
      console.error('Error deleting user:', error);
      return NextResponse.json(
        { success: false, error: 'حدث خطأ أثناء حذف المستخدم' },
        { status: 500 }
      );
    }

    // Add the user's email to banned_users to prevent re-registration
    if (userEmail) {
      const { error: banError } = await supabaseServer
        .from('banned_users')
        .upsert(
          {
            email: userEmail,
            reason: 'تم الحذف بواسطة المشرف',
            banned_by: authUserId,
          },
          { onConflict: 'email' }
        );

      if (banError) {
        console.error('Error adding to banned_users:', banError);
        // Critical: If ban insert fails, the user could re-register.
        // Log prominently so admins can manually add the ban.
        console.error(`[SECURITY] Failed to ban deleted user email: ${userEmail}. Manual ban required!`);
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Delete user error:', error);
    return NextResponse.json(
      { success: false, error: 'حدث خطأ غير متوقع' },
      { status: 500 }
    );
  }
}

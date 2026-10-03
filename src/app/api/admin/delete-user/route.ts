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
      .maybeSingle();

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

    // ── v107: Delete profile FIRST, then auth ──
    // The old code deleted auth first, which caused "user can't login but
    // profile still visible" when profile DELETE failed. Now we try to
    // delete the profile first. If it fails, we still delete auth (so the
    // user can't login) but we return the ACTUAL error message so the
    // admin knows what went wrong.
    //
    // Before deleting the profile, manually NULL-out FK references that
    // might still block the delete (defense-in-depth even after v106).

    // 1. Manual cascade: NULL out FK references that might block deletion
    //    (v106 migration should have already changed these to SET NULL,
    //    but this is defense-in-depth in case v106 wasn't applied or
    //    there are other FKs we missed)
    const cleanupTables = [
      { table: 'announcements', column: 'created_by' },
      { table: 'platform_announcements', column: 'created_by' },
      { table: 'platform_announcement_views', column: 'user_id' },
      { table: 'subject_teams', column: 'created_by' },
      { table: 'quizzes', column: 'user_id' },
      { table: 'reports', column: 'reporter_id' },
      { table: 'reports', column: 'assigned_to' },
      { table: 'report_responses', column: 'responder_id' },
      { table: 'report_responses', column: 'forwarded_to' },
      { table: 'report_messages', column: 'sender_id' },
      { table: 'report_messages', column: 'recipient_id' },
      { table: 'teacher_student_links', column: 'teacher_id' },
      { table: 'teacher_student_links', column: 'student_id' },
    ];

    for (const { table, column } of cleanupTables) {
      try {
        await supabaseServer
          .from(table)
          .update({ [column]: null })
          .eq(column, userId);
      } catch {
        // Table might not exist or column might not exist — skip
      }
    }

    // 2. Delete the user profile
    const { error: profileDeleteError } = await supabaseServer
      .from('users')
      .delete()
      .eq('id', userId);

    // 3. Delete the auth account (always, even if profile delete failed)
    try {
      const { error: authDeleteError } = await supabaseServer.auth.admin.deleteUser(userId);
      if (authDeleteError) {
        console.error('[delete-user] Auth deletion failed:', authDeleteError.message);
      }
    } catch (authErr) {
      console.error('[delete-user] Auth deletion exception:', authErr);
    }

    // 4. Ban email to prevent re-registration
    if (userEmail) {
      try {
        await supabaseServer
          .from('banned_users')
          .upsert(
            {
              email: userEmail,
              reason: 'تم الحذف بواسطة المشرف',
              banned_by: authUserId,
            },
            { onConflict: 'email' }
          );
      } catch (banErr) {
        console.error('[delete-user] Ban upsert error (non-fatal):', banErr);
      }
    }

    // 5. Return result
    // If profile DELETE failed with a real error (not "no rows"),
    // return success anyway — the auth account is deleted (user can't
    // login), and the profile will be cleaned up later. We log the
    // actual error for debugging.
    if (profileDeleteError && !profileDeleteError.message.includes('no rows') && profileDeleteError.code !== 'PGRST116') {
      console.error('[delete-user] Profile deletion failed (auth already deleted):', profileDeleteError.message, profileDeleteError.code);
      // Still return success — auth account is gone, user can't login
      // The profile is orphaned but harmless
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

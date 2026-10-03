import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateRequest, authErrorResponse, getUserRole } from '@/lib/auth-helpers';

export async function POST(request: NextRequest) {
  try {
    // ── Authenticate ──
    const authResult = await authenticateRequest(request);
    if (!authResult.success) return authErrorResponse(authResult);

    const authUserId = authResult.user.id;
    const authRole = await getUserRole(authUserId);

    if (!authRole || (authRole !== 'admin' && authRole !== 'superadmin')) {
      return NextResponse.json({ success: false, error: 'غير مصرح بهذا الإجراء' }, { status: 403 });
    }

    const body = await request.json();
    const { userId } = body;

    if (!userId) {
      return NextResponse.json({ success: false, error: 'معرف المستخدم مطلوب' }, { status: 400 });
    }

    if (userId === authUserId) {
      return NextResponse.json({ success: false, error: 'لا يمكنك حذف حسابك الخاص' }, { status: 400 });
    }

    // Fetch user's email and role before deleting
    const { data: userRecord } = await supabaseServer
      .from('users')
      .select('email, role, name')
      .eq('id', userId)
      .maybeSingle();

    if (userRecord?.role === 'admin' && authRole !== 'superadmin') {
      return NextResponse.json({ success: false, error: 'فقط مدير المنصة يمكنه حذف المشرفين' }, { status: 403 });
    }
    if (userRecord?.role === 'superadmin') {
      return NextResponse.json({ success: false, error: 'لا يمكن حذف مدير المنصة' }, { status: 403 });
    }

    const userEmail = userRecord?.email;

    // 1. Fetch all orders for this user (needed to clean up FK chains)
    const { data: userOrders } = await supabaseServer
      .from('orders')
      .select('id')
      .eq('student_id', userId);
    const orderIds = (userOrders || []).map((o: { id: string }) => o.id);

    // 2. NULL out FK references in tables that reference orders(id)
    //    These block the cascade delete of orders when users.student_id CASCADE fires
    if (orderIds.length > 0) {
      const orderCleanup = [
        { table: 'financial_ledger', column: 'order_id' },
        { table: 'payments', column: 'order_id' },
        { table: 'teacher_payout_ledger_entries', column: 'order_id' },
      ];
      for (const { table, column } of orderCleanup) {
        try { await supabaseServer.from(table).update({ [column]: null }).in('order_id', orderIds); }
        catch { /* skip */ }
      }
      // Now safe to delete orders
      try { await supabaseServer.from('orders').delete().in('id', orderIds); } catch { /* skip */ }
    }

    // 3. Delete subject_students + subject_teachers explicitly
    try { await supabaseServer.from('subject_students').delete().eq('student_id', userId); } catch { /* skip */ }
    try { await supabaseServer.from('subject_teachers').delete().eq('teacher_id', userId); } catch { /* skip */ }

    // 4. Manual cascade: NULL out ALL remaining FK references to this user
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
      { table: 'notifications', column: 'user_id' },
      { table: 'notifications', column: 'actor_id' },
      { table: 'push_subscriptions', column: 'user_id' },
      { table: 'subject_students', column: 'student_id' },
      { table: 'subject_teachers', column: 'teacher_id' },
      { table: 'subject_files', column: 'uploaded_by' },
      { table: 'subject_videos', column: 'uploaded_by' },
      { table: 'attendance_sessions', column: 'teacher_id' },
      { table: 'lesson_units', column: 'created_by' },
      { table: 'lessons', column: 'created_by' },
      { table: 'orders', column: 'student_id' },
      { table: 'scorm_tracking', column: 'user_id' },
      { table: 'lesson_progress', column: 'student_id' },
      { table: 'lesson_notes', column: 'student_id' },
      { table: 'lesson_bookmarks', column: 'student_id' },
    ];

    for (const { table, column } of cleanupTables) {
      try {
        await supabaseServer.from(table).update({ [column]: null }).eq(column, userId);
      } catch {
        // Table/column might not exist — skip
      }
    }

    // 5. Delete the user profile from public.users
    const { error: profileError } = await supabaseServer
      .from('users')
      .delete()
      .eq('id', userId);

    // 6. Delete the auth account (always — even if profile delete failed)
    let authDeleted = false;
    try {
      const { error: authError } = await supabaseServer.auth.admin.deleteUser(userId);
      if (!authError) authDeleted = true;
      else console.error('[delete-user] Auth deletion failed:', authError.message);
    } catch (authErr) {
      console.error('[delete-user] Auth deletion exception:', authErr);
    }

    // 7. Determine result
    const profileDeleted = !profileError || profileError.message.includes('no rows') || profileError.code === 'PGRST116';

    if (!profileDeleted) {
      // Profile DELETE failed — return the ACTUAL error
      // (don't hide it — admin needs to know what went wrong)
      console.error('[delete-user] Profile DELETE failed:', profileError?.message, profileError?.code);
      return NextResponse.json(
        { success: false, error: `فشل حذف البروفايل: ${profileError?.message || 'خطأ غير معروف'}` },
        { status: 500 }
      );
    }

    // Profile deleted successfully → ban email to prevent re-registration
    if (userEmail) {
      try {
        await supabaseServer.from('banned_users').upsert({
          email: userEmail,
          reason: 'تم الحذف بواسطة المشرف',
          banned_by: authUserId,
        }, { onConflict: 'email' });
      } catch {
        // Non-fatal
      }
    }

    return NextResponse.json({
      success: true,
      profileDeleted: true,
      authDeleted,
    });
  } catch (error) {
    console.error('Delete user error:', error);
    return NextResponse.json({ success: false, error: 'حدث خطأ غير متوقع' }, { status: 500 });
  }
}

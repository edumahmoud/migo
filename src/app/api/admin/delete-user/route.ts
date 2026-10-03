import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateRequest, authErrorResponse, getUserRole } from '@/lib/auth-helpers';

export async function POST(request: NextRequest) {
  try {
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

    // ═══════════════════════════════════════════════════════
    // STEP 1: DELETE rows that reference the user (bottom-up order)
    //         We DELETE (not NULL) because many columns are NOT NULL.
    // ═══════════════════════════════════════════════════════

    // 1a. Delete teacher_payout_audit_log (references teacher_payouts)
    try { await supabaseServer.from('teacher_payout_audit_log').delete().eq('actor_id', userId); } catch { /* skip */ }
    // Get payout IDs for this teacher to delete child rows
    const { data: teacherPayouts } = await supabaseServer
      .from('teacher_payouts').select('id').eq('teacher_id', userId);
    const payoutIds = (teacherPayouts || []).map((p: { id: string }) => p.id);
    if (payoutIds.length > 0) {
      try { await supabaseServer.from('teacher_payout_audit_log').delete().in('payout_id', payoutIds); } catch { /* skip */ }
      try { await supabaseServer.from('teacher_payout_ledger_entries').delete().in('payout_id', payoutIds); } catch { /* skip */ }
    }

    // 1b. Delete teacher_payout_ledger_entries (references financial_ledger)
    //     Get financial_ledger IDs for this user's orders first
    const { data: userOrders } = await supabaseServer
      .from('orders').select('id').eq('student_id', userId);
    const orderIds = (userOrders || []).map((o: { id: string }) => o.id);

    if (orderIds.length > 0) {
      // Get financial_ledger IDs for these orders
      const { data: ledgerRows } = await supabaseServer
        .from('financial_ledger').select('id').in('order_id', orderIds);
      const ledgerIds = (ledgerRows || []).map((l: { id: string }) => l.id);

      // Delete teacher_payout_ledger_entries by ledger_id
      if (ledgerIds.length > 0) {
        try { await supabaseServer.from('teacher_payout_ledger_entries').delete().in('ledger_id', ledgerIds); } catch { /* skip */ }
      }

      // Delete financial_ledger rows (now safe — child rows gone)
      try { await supabaseServer.from('financial_ledger').delete().in('order_id', orderIds); } catch { /* skip */ }

      // Delete payments rows
      try { await supabaseServer.from('payments').delete().in('order_id', orderIds); } catch { /* skip */ }

      // Delete orders
      try { await supabaseServer.from('orders').delete().in('id', orderIds); } catch { /* skip */ }
    }

    // 1c. Delete teacher_payouts (references teacher_id — NOT NULL in payout_methods)
    try { await supabaseServer.from('teacher_payouts').delete().eq('teacher_id', userId); } catch { /* skip */ }

    // 1d. Delete teacher_payout_methods (teacher_id is NOT NULL — can't NULL, must DELETE)
    try { await supabaseServer.from('teacher_payout_methods').delete().eq('teacher_id', userId); } catch { /* skip */ }

    // 1e. Delete teacher_student_links
    try { await supabaseServer.from('teacher_student_links').delete().eq('teacher_id', userId); } catch { /* skip */ }
    try { await supabaseServer.from('teacher_student_links').delete().eq('student_id', userId); } catch { /* skip */ }

    // 1f. Delete subject_students + subject_teachers
    try { await supabaseServer.from('subject_students').delete().eq('student_id', userId); } catch { /* skip */ }
    try { await supabaseServer.from('subject_teachers').delete().eq('teacher_id', userId); } catch { /* skip */ }

    // 1g. Delete lesson_units + lessons + lesson_progress (created_by is NOT NULL)
    try { await supabaseServer.from('lesson_progress').delete().eq('student_id', userId); } catch { /* skip */ }
    try { await supabaseServer.from('lesson_notes').delete().eq('student_id', userId); } catch { /* skip */ }
    try { await supabaseServer.from('lesson_bookmarks').delete().eq('student_id', userId); } catch { /* skip */ }
    try { await supabaseServer.from('lessons').delete().eq('created_by', userId); } catch { /* skip */ }
    try { await supabaseServer.from('lesson_units').delete().eq('created_by', userId); } catch { /* skip */ }

    // 1g2. Delete quizzes (user_id NOT NULL)
    try { await supabaseServer.from("quizzes").delete().eq("user_id", userId); } catch { /* skip */ }
    // 1g3. Delete summaries (user_id NOT NULL)
    try { await supabaseServer.from("summaries").delete().eq("user_id", userId); } catch { /* skip */ }
    // 1g4. Delete file_shares (shared_by + shared_with NOT NULL)
    try { await supabaseServer.from("file_shares").delete().eq("shared_by", userId); } catch { /* skip */ }
    try { await supabaseServer.from("file_shares").delete().eq("shared_with", userId); } catch { /* skip */ }
    // 1g5. Delete user_files (user_id NOT NULL)
    try { await supabaseServer.from("user_files").delete().eq("user_id", userId); } catch { /* skip */ }
    // 1g6. Delete subject_files (uploaded_by NOT NULL)
    try { await supabaseServer.from("subject_files").delete().eq("uploaded_by", userId); } catch { /* skip */ }
    // 1g7. Delete subject_videos (uploaded_by NOT NULL)
    try { await supabaseServer.from("subject_videos").delete().eq("uploaded_by", userId); } catch { /* skip */ }
    // 1h. Delete other rows with NOT NULL FK to users
    try { await supabaseServer.from('attendance_sessions').delete().eq('teacher_id', userId); } catch { /* skip */ }
    try { await supabaseServer.from('scorm_tracking').delete().eq('user_id', userId); } catch { /* skip */ }
    try { await supabaseServer.from('push_subscriptions').delete().eq('user_id', userId); } catch { /* skip */ }

    // ═══════════════════════════════════════════════════════
    // STEP 2: NULL out FK references (nullable columns only)
    // ═══════════════════════════════════════════════════════

    const nullCleanup = [
      { table: 'announcements', column: 'created_by' },
      { table: 'platform_announcements', column: 'created_by' },
      { table: 'platform_announcement_views', column: 'user_id' },
      { table: 'subject_teams', column: 'created_by' },
      { table: 'reports', column: 'reporter_id' },
      { table: 'reports', column: 'assigned_to' },
      { table: 'report_responses', column: 'responder_id' },
      { table: 'report_responses', column: 'forwarded_to' },
      { table: 'report_messages', column: 'sender_id' },
      { table: 'report_messages', column: 'recipient_id' },
      { table: 'notifications', column: 'user_id' },
      { table: 'notifications', column: 'actor_id' },
    ];

    for (const { table, column } of nullCleanup) {
      try { await supabaseServer.from(table).update({ [column]: null }).eq(column, userId); }
      catch { /* column might not exist or NOT NULL — skip */ }
    }

    // ═══════════════════════════════════════════════════════
    // STEP 3: Delete the user profile
    // ═══════════════════════════════════════════════════════

    const { error: profileError } = await supabaseServer
      .from('users')
      .delete()
      .eq('id', userId);

    const profileDeleted = !profileError || profileError.message.includes('no rows') || profileError.code === 'PGRST116';

    // ═══════════════════════════════════════════════════════
    // STEP 4: Delete auth account
    // ═══════════════════════════════════════════════════════

    let authDeleted = false;
    try {
      const { error: authError } = await supabaseServer.auth.admin.deleteUser(userId);
      if (!authError) authDeleted = true;
      else console.error('[delete-user] Auth deletion failed:', authError.message);
    } catch (authErr) {
      console.error('[delete-user] Auth deletion exception:', authErr);
    }

    // ═══════════════════════════════════════════════════════
    // STEP 5: Ban email + return result
    // ═══════════════════════════════════════════════════════

    if (!profileDeleted) {
      console.error('[delete-user] Profile DELETE failed:', profileError?.message, profileError?.code);
      return NextResponse.json(
        { success: false, error: `فشل حذف البروفايل: ${profileError?.message || 'خطأ غير معروف'}` },
        { status: 500 }
      );
    }

    if (userEmail) {
      try {
        await supabaseServer.from('banned_users').upsert({
          email: userEmail,
          reason: 'تم الحذف بواسطة المشرف',
          banned_by: authUserId,
        }, { onConflict: 'email' });
      } catch { /* non-fatal */ }
    }

    return NextResponse.json({ success: true, profileDeleted: true, authDeleted });
  } catch (error) {
    console.error('Delete user error:', error);
    return NextResponse.json({ success: false, error: 'حدث خطأ غير متوقع' }, { status: 500 });
  }
}

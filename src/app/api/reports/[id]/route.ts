// =====================================================
// Reports API — Get, Respond, Forward, Resolve, Dismiss
// =====================================================
import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateRequest, getUserRole } from '@/lib/auth-helpers';
import { notifyUser } from '@/lib/notifications-service';


// Resolve the user a report is about (the reported person), for any target type.
async function resolveReportedUserId(report: any): Promise<string | null> {
  if (!report.target_id) return null;
  try {
    if (report.target_type === 'user') return report.target_id;
    if (report.target_type === 'comment') {
      const { data } = await supabaseServer.from('video_comments').select('user_id').eq('id', report.target_id).single();
      return data?.user_id || null;
    }
    if (report.target_type === 'message') {
      const { data } = await supabaseServer.from('chat_messages').select('sender_id').eq('id', report.target_id).single();
      return data?.sender_id || null;
    }
  } catch {}
  return null;
}

// Timeline actions each audience may see. Staff (admin / assigned) see everything.
const REPORTER_HIDDEN_ACTIONS = ['message_reported'];
const ACCUSED_VISIBLE_ACTIONS = ['reply', 'resolve', 'dismiss', 'reopen', 'warn', 'block', 'message_reported', 'objection'];

// GET /api/reports/[id] — Get report detail with responses and messages
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await authenticateRequest(request);
    if (!authResult.success) {
      return NextResponse.json({ success: false, error: authResult.error }, { status: authResult.status });
    }

    const { id } = await params;
    const userId = authResult.user.id;
    const role = await getUserRole(userId);

    // Fetch the report
    const { data: report, error } = await supabaseServer
      .from('reports')
      .select(`
        *,
        reporter:users!reports_reporter_id_fkey(id, name, email, avatar_url, role, gender, title_id),
        assigned_user:users!reports_assigned_to_fkey(id, name, email, avatar_url, role, gender, title_id)
      `)
      .eq('id', id)
      .single();

    if (error || !report) {
      return NextResponse.json(
        { success: false, error: 'الإبلاغ غير موجود' },
        { status: 404 }
      );
    }

    // Check access: reporter, assigned user, target (reported person), or admin/superadmin
    const isAdmin = role === 'admin' || role === 'superadmin';
    const reportedUserId = await resolveReportedUserId(report);
    const isTargetUser = reportedUserId === userId;

    // Nobody handles a complaint about themselves: a reported admin or teacher is treated as the accused.
    // Admins see complaints assigned to them or unassigned; the platform owner sees all.
    const isStaffRole = (role === 'superadmin' || (role === 'admin' && (!report.assigned_to || report.assigned_to === userId))) && !isTargetUser;
    // Archived complaints are hidden from everyone except a supervisor in scope or the superadmin (archive view).
    const teacherOwnsArchive = role === 'teacher' && report.assigned_to === userId && (report as any).archived_by === userId && !isTargetUser;
    if ((report as any).archived_at && !(isStaffRole && (role === 'admin' || role === 'superadmin')) && !teacherOwnsArchive) {
      return NextResponse.json(
        { success: false, error: 'الإبلاغ غير موجود' },
        { status: 404 }
      );
    }
    if (report.reporter_id !== userId && report.assigned_to !== userId && !isStaffRole && !isTargetUser) {
      return NextResponse.json(
        { success: false, error: 'غير مصرح بالوصول' },
        { status: 403 }
      );
    }

    // ─── Run responses, messages, and target enrichment queries IN PARALLEL ───
    const [responsesResult, messagesResult, targetEnrichmentResult] = await Promise.all([
      // Fetch responses
      Promise.resolve(
        supabaseServer
          .from('report_responses')
          .select(`
            *,
            responder:users!report_responses_responder_id_fkey(id, name, email, avatar_url, role, gender, title_id),
            forwarded_to_user:users!report_responses_forwarded_to_fkey(id, name, email, avatar_url, role, gender, title_id)
          `)
          .eq('report_id', id)
          .order('created_at', { ascending: true })
      ),
      // Fetch messages
      Promise.resolve(
        supabaseServer
          .from('report_messages')
          .select(`
            *,
            sender:users!report_messages_sender_id_fkey(id, name, email, avatar_url, role, gender, title_id)
          `)
          .eq('report_id', id)
          .order('created_at', { ascending: true })
      ),
      // Target enrichment (comment/message/user content + owner)
      (async () => {
        let resolvedUserId: string | null = null;
        let targetContent: string | null = report.target_content || null;

        if (report.target_type === 'user' && report.target_id) {
          resolvedUserId = report.target_id;
        } else if (report.target_type === 'comment' && report.target_id) {
          try {
            const { data: comment } = await supabaseServer
              .from('video_comments')
              .select('user_id, content')
              .eq('id', report.target_id)
              .single();
            if (comment?.user_id) resolvedUserId = comment.user_id;
            if (comment?.content && !targetContent) targetContent = comment.content;
          } catch {}
        } else if (report.target_type === 'message' && report.target_id) {
          try {
            const { data: message } = await supabaseServer
              .from('chat_messages')
              .select('sender_id, content')
              .eq('id', report.target_id)
              .single();
            if ((message as any)?.sender_id) resolvedUserId = (message as any).sender_id;
            if ((message as any)?.content && !targetContent) targetContent = (message as any).content;
          } catch {}
        }

        // Fetch target user + counts in parallel
        if (resolvedUserId) {
          const [targetUserResult, countResult, reportersResult] = await Promise.all([
            Promise.resolve(
              supabaseServer
                .from('users')
                .select('id, name, email, avatar_url, role, gender, title_id')
                .eq('id', resolvedUserId)
                .single()
            ),
            Promise.resolve(
              supabaseServer
                .from('reports')
                .select('id', { count: 'exact', head: true })
                .eq('target_type', 'user')
                .eq('target_id', resolvedUserId)
                .in('status', ['pending', 'in_progress'])
            ),
            Promise.resolve(
              supabaseServer
                .from('reports')
                .select('reporter_id')
                .eq('target_type', report.target_type)
                .eq('target_id', report.target_id)
                .in('status', ['pending', 'in_progress'])
            ),
          ]);

          const targetUser = targetUserResult?.data;
          const reportCount = countResult?.count || 0;
          const reporterCount = new Set((reportersResult?.data || []).map((r: any) => r.reporter_id)).size;

          return { resolvedUserId, targetContent, targetUser: targetUser ? { ...targetUser, report_count: reportCount } : null, reporterCount };
        }

        return { resolvedUserId, targetContent, targetUser: null, reporterCount: report.reporter_count || 1 };
      })(),
    ]);

    const responses = responsesResult?.data || [];
    const messages = messagesResult?.data || [];

    // Apply enrichment
    if (targetEnrichmentResult.targetContent && !report.target_content) {
      (report as any).target_content = targetEnrichmentResult.targetContent;
    }
    if (targetEnrichmentResult.targetUser) {
      (report as any).target_user = targetEnrichmentResult.targetUser;
    }
    if (targetEnrichmentResult.reporterCount) {
      (report as any).reporter_count = targetEnrichmentResult.reporterCount;
    }

    // The accused only sees what concerns them: no internal staff thread,
    // no internal assignee, and device alerts are shown as a plain notice
    // (the description names other accounts and devices).
    const accusedOnly = isTargetUser && report.reporter_id !== userId;
    const isStaff = isStaffRole || (report.assigned_to === userId && !isTargetUser);
    const hasObjection = responses.some((r: any) => r.action === 'objection');
    // Private messages: only the sender and the recipient (admins see all)
    const visibleMessages = isStaff
      ? messages
      : messages.filter((m: any) => m.recipient_id === userId || m.sender_id === userId);

    if (accusedOnly) {
      // The reported person sees the action timeline (notes, status changes, warnings,
      // their own objection) but never the reporter's identity or internal staff names of
      // forwarding. Entries written by the reporter show as "reporter" only.
      const timeline = responses
        .filter((r: any) => ACCUSED_VISIBLE_ACTIONS.includes(r.action))
        .map((r: any) => r.responder_id === report.reporter_id
          ? { ...r, responder_id: null, responder: { id: '', name: 'الشاكي', email: '', role: 'reporter' }, actor_role: 'reporter' }
          : r);
      const safe: any = { ...report, reporter: null, reporter_id: null, assigned_user: null, assigned_to: null, responses: timeline, messages: visibleMessages.map((m: any) => m.sender_id === report.reporter_id ? { ...m, sender: null, sender_id: null } : m), accused_view: true, can_object: !hasObjection, has_objection: hasObjection };
      if (report.reason === 'تنبيه جهاز مشتبه') {
        safe.description = 'تم رصد نشاط غير معتاد على جهاز أو حساب مرتبط بك أثناء استخدام المنصة، وتم رفعه للمراجعة.';
        safe.target_content = null;
      }
      return NextResponse.json({ success: true, data: safe });
    }

    const timelineForViewer = isStaff
      ? responses
      : responses.filter((r: any) => !REPORTER_HIDDEN_ACTIONS.includes(r.action));

    // The reported person never sees the reporter's identity, even when they are also the
    // assigned handler (complaints against a teacher are assigned to that teacher).
    if (isTargetUser && report.reporter_id !== userId) {
      const anon = (r: any) => r.responder_id === report.reporter_id
        ? { ...r, responder_id: null, responder: { id: '', name: 'الشاكي', email: '', role: 'reporter' }, actor_role: 'reporter' }
        : r;
      return NextResponse.json({
        success: true,
        data: {
          ...report,
          reporter: null,
          reporter_id: null,
          responses: timelineForViewer.map(anon),
          messages: visibleMessages.map((m: any) => m.sender_id === report.reporter_id ? { ...m, sender: null, sender_id: null } : m),
        },
      });
    }

    return NextResponse.json({
      success: true,
      data: { ...report, responses: timelineForViewer, messages: visibleMessages },
    });
  } catch (error) {
    console.error('[Reports] GET detail error:', error);
    return NextResponse.json(
      { success: false, error: 'حدث خطأ غير متوقع' },
      { status: 500 }
    );
  }
}

// PATCH /api/reports/[id] — Respond to a report (reply, forward, resolve, dismiss, reopen, block, warn, message_reporter, message_reported)
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await authenticateRequest(request);
    if (!authResult.success) {
      return NextResponse.json({ success: false, error: authResult.error }, { status: authResult.status });
    }

    const { id } = await params;
    const userId = authResult.user.id;
    const role = await getUserRole(userId);

    // Fetch the report
    const { data: report, error: reportError } = await supabaseServer
      .from('reports')
      .select('*')
      .eq('id', id)
      .single();

    if (reportError || !report) {
      return NextResponse.json(
        { success: false, error: 'الإبلاغ غير موجود' },
        { status: 404 }
      );
    }

    const body = await request.json();
    const { action, content, forwarded_to, message_to, message_content } = body;

    const validActions = ['reply', 'forward', 'resolve', 'dismiss', 'reopen', 'block', 'warn', 'message_reporter', 'message_reported', 'return', 'objection', 'archive', 'restore'];
    if (!action || !validActions.includes(action)) {
      return NextResponse.json(
        { success: false, error: 'إجراء غير صالح' },
        { status: 400 }
      );
    }

    // Access check
    // The reported person can never handle the complaint, even as assignee or admin.
    const reportedUserIdAll = await resolveReportedUserId(report);
    const isReportedSelf = !!reportedUserIdAll && reportedUserIdAll === userId;
    const isAdmin = (role === 'superadmin' || (role === 'admin' && (!report.assigned_to || report.assigned_to === userId))) && !isReportedSelf;
    const isAssigned = report.assigned_to === userId && !isReportedSelf;
    const isReporter = report.reporter_id === userId;

    // ─── Manual archive / restore (supervisor in scope or superadmin) ───
    const isArchived = !!(report as any).archived_at;
    if (isArchived && action !== 'restore') {
      return (isAdmin || (role === 'teacher' && isAssigned && (report as any).archived_by === userId))
        ? NextResponse.json({ success: false, error: 'الإبلاغ مؤرشف' }, { status: 409 })
        : NextResponse.json({ success: false, error: 'الإبلاغ غير موجود' }, { status: 404 });
    }
    if (action === 'archive' || action === 'restore') {
      const staffAdmin = isAdmin && (role === 'admin' || role === 'superadmin');
      let teacherOk = false;
      if (role === 'teacher' && isAssigned && !isReportedSelf) {
        if (action === 'restore') {
          teacherOk = (report as any).archived_by === userId;
        } else {
          // A teacher can archive a closed complaint that is assigned to him (not forwarded away) and where he took the closing action himself.
          const { data: mine } = await supabaseServer
            .from('report_responses')
            .select('id')
            .eq('report_id', id)
            .eq('responder_id', userId)
            .in('action', ['resolve', 'dismiss'])
            .limit(1);
          teacherOk = !!(mine && mine.length > 0);
        }
      }
      if (!staffAdmin && !teacherOk) {
        return NextResponse.json({ success: false, error: 'غير مصرح' }, { status: 403 });
      }
      if (action === 'archive' && !['resolved', 'dismissed'].includes(report.status)) {
        return NextResponse.json({ success: false, error: 'يمكن أرشفة الشكاوى المقفولة فقط' }, { status: 400 });
      }
      if (action === 'restore' && !isArchived) {
        return NextResponse.json({ success: false, error: 'الإبلاغ غير مؤرشف' }, { status: 409 });
      }
      const patch = action === 'archive'
        ? { archived_at: new Date().toISOString(), archived_by: userId }
        : { archived_at: null, archived_by: null };
      const { error: archErr } = await supabaseServer.from('reports').update(patch).eq('id', id);
      if (archErr) {
        return NextResponse.json({ success: false, error: 'تعذر تنفيذ العملية' }, { status: 500 });
      }
      await supabaseServer.from('report_audit_log').insert({
        report_id: id,
        report_number: (report as any).report_number,
        action,
        actor_id: userId,
        actor_role: role,
        details: { status: report.status },
      });
      return NextResponse.json({ success: true, data: { archived: action === 'archive' } });
    }

    // Objection: only the reported person (not the reporter / assignee / admin), once per report
    if (action === 'objection') {
      const reportedUserId = await resolveReportedUserId(report);
      if (!reportedUserId || reportedUserId !== userId || isReporter) {
        return NextResponse.json(
          { success: false, error: 'فقط المشكو منه يمكنه تقديم اعتراض' },
          { status: 403 }
        );
      }
      const objectionText = typeof content === 'string' ? content.trim() : '';
      if (objectionText.length < 5) {
        return NextResponse.json(
          { success: false, error: 'اكتب نص الاعتراض (5 أحرف على الأقل)' },
          { status: 400 }
        );
      }
      if (objectionText.length > 2000) {
        return NextResponse.json(
          { success: false, error: 'نص الاعتراض طويل جدا' },
          { status: 400 }
        );
      }
      const { data: existing } = await supabaseServer
        .from('report_responses')
        .select('id')
        .eq('report_id', id)
        .eq('action', 'objection')
        .limit(1);
      if (existing && existing.length > 0) {
        return NextResponse.json(
          { success: false, error: 'تم تقديم اعتراض على هذه الشكوى من قبل ولا يمكن تقديم اعتراض آخر' },
          { status: 409 }
        );
      }
      // The unique index report_responses_one_objection enforces this even under a race.
      const { error: objError } = await supabaseServer
        .from('report_responses')
        .insert({ report_id: id, responder_id: userId, action: 'objection', content: objectionText, actor_role: 'reported' });
      if (objError) {
        const dup = (objError as any).code === '23505';
        return NextResponse.json(
          { success: false, error: dup ? 'تم تقديم اعتراض على هذه الشكوى من قبل ولا يمكن تقديم اعتراض آخر' : 'فشل تسجيل الاعتراض' },
          { status: dup ? 409 : 500 }
        );
      }
      await supabaseServer.from('reports').update({ updated_at: new Date().toISOString() }).eq('id', id);
      // Tell the assigned person (or the admins when nobody is assigned). Best effort.
      try {
        const recipients = new Set<string>();
        if (report.assigned_to) {
          recipients.add(report.assigned_to);
        } else {
          const { data: admins } = await supabaseServer.from('users').select('id').in('role', ['admin', 'superadmin']).limit(20);
          (admins || []).forEach((a: any) => recipients.add(a.id));
        }
        recipients.delete(userId);
        const num = report.report_number || '';
        await Promise.all(Array.from(recipients).map((rid) =>
          notifyUser(rid, 'report', 'اعتراض على بلاغ', `قدّم الطرف المعني اعتراضا على البلاغ رقم ${num}`.trim(), `/reports/${id}`)
        ));
      } catch {}
      return NextResponse.json({ success: true });
    }

    if (!isAdmin && !isAssigned && !isReporter) {
      return NextResponse.json(
        { success: false, error: 'غير مصرح بهذا الإجراء' },
        { status: 403 }
      );
    }

    // ─── Action-specific permission checks ───

    // A plain reporter (not staff) can only reply or reopen their own complaint.
    if (isReporter && !isAdmin && !isAssigned && !['reply', 'reopen'].includes(action)) {
      return NextResponse.json(
        { success: false, error: 'غير مصرح بهذا الإجراء' },
        { status: 403 }
      );
    }

    // Free text limit on every action
    if (typeof content === 'string' && content.length > 3000) {
      return NextResponse.json({ success: false, error: 'النص طويل جدا' }, { status: 400 });
    }

    // Forward: only assigned or admin
    if (action === 'forward' && !isAdmin && !isAssigned) {
      return NextResponse.json(
        { success: false, error: 'فقط المعين أو المشرف يمكنه تحويل الإبلاغ' },
        { status: 403 }
      );
    }

    // Return (send back to teacher): only admin/superadmin
    if (action === 'return' && !isAdmin) {
      return NextResponse.json(
        { success: false, error: 'فقط المشرف أو المدير يمكنه إرجاع الإبلاغ' },
        { status: 403 }
      );
    }

    // NOTE: Double-forwarding is now allowed.
    // If a report was returned (action='return'), the supervisor/teacher
    // should be able to forward it again. The previous forward-only-once
    // restriction prevented re-forwarding after a return.

    // Resolve/dismiss: only assigned or admin
    if ((action === 'resolve' || action === 'dismiss') && !isAdmin && !isAssigned) {
      return NextResponse.json(
        { success: false, error: 'فقط المعين أو المشرف يمكنه إنهاء الإبلاغ' },
        { status: 403 }
      );
    }

    // Block: only admin/superadmin
    if (action === 'block' && !isAdmin) {
      return NextResponse.json(
        { success: false, error: 'فقط المشرف أو المدير يمكنه حظر المستخدم' },
        { status: 403 }
      );
    }

    // Warn: only teacher, admin, superadmin (not students)
    if (action === 'warn' && (role === 'student' || (!isAdmin && !isAssigned))) {
      return NextResponse.json(
        { success: false, error: 'غير مصرح بتوجيه تحذير' },
        { status: 403 }
      );
    }

    // Message reporter/reported: only assigned or admin
    if ((action === 'message_reporter' || action === 'message_reported') && !isAdmin && !isAssigned) {
      return NextResponse.json(
        { success: false, error: 'فقط المعين أو المشرف يمكنه إرسال رسالة' },
        { status: 403 }
      );
    }

    if (action === 'forward' && !forwarded_to) {
      return NextResponse.json(
        { success: false, error: 'يجب تحديد المستخدم المحول إليه' },
        { status: 400 }
      );
    }
    if (action === 'forward') {
      if (forwarded_to === reportedUserIdAll) {
        return NextResponse.json(
          { success: false, error: 'لا يمكن تحويل الشكوى إلى الشخص المشكو منه' },
          { status: 400 }
        );
      }
      const fwdRole = await getUserRole(forwarded_to);
      if (!fwdRole || fwdRole === 'student') {
        return NextResponse.json(
          { success: false, error: 'يمكن التحويل إلى معلم أو مشرف فقط' },
          { status: 400 }
        );
      }
    }

    // ─── Handle block action ───
    // Block is now handled via the ban modal which calls /api/admin/ban-user directly.
    // When the ban modal confirms, it also calls handleAction('block') to record the action
    // in report_responses. We just record the action here — no direct ban creation.
    if (action === 'block') {
      // A block is a real app ban. The ban modal creates the ban first through
      // /api/admin/ban-user; here we refuse to log a "block" unless an active ban exists.
      const blockedId = reportedUserIdAll;
      const { data: blockedUser } = blockedId
        ? await supabaseServer.from('users').select('email').eq('id', blockedId).single()
        : { data: null as any };
      let activeBan = false;
      if (blockedUser?.email) {
        const { data: ban } = await supabaseServer
          .from('banned_users')
          .select('is_active, ban_until')
          .eq('email', blockedUser.email)
          .maybeSingle();
        activeBan = !!ban && ban.is_active !== false && (!ban.ban_until || new Date(ban.ban_until) > new Date());
      }
      if (!activeBan) {
        return NextResponse.json(
          { success: false, error: 'لا يوجد حظر فعلي على المشكو منه. نفّذ الحظر أولا ثم سجّله' },
          { status: 409 }
        );
      }
    }

    // ─── Handle warn action ───
    if (action === 'warn') {
      // Resolve the target user to warn
      let warnUserId: string | null = null;
      let warnSubjectName: string | null = null;
      let warnContentPreview: string | null = null;

      if (report.target_type === 'user' && report.target_id) {
        warnUserId = report.target_id;
      } else if (report.target_type === 'comment' && report.target_id) {
        try {
          const { data: comment } = await supabaseServer
            .from('video_comments')
            .select('user_id, content, video_id')
            .eq('id', report.target_id)
            .single();
          if (comment?.user_id) warnUserId = comment.user_id;
          if (comment?.content) warnContentPreview = comment.content.substring(0, 80);
          // Get subject name for comment-type reports
          if (comment?.video_id) {
            try {
              const { data: video } = await supabaseServer
                .from('subject_videos')
                .select('subject_id')
                .eq('id', comment.video_id)
                .single();
              if (video?.subject_id) {
                const { data: subject } = await supabaseServer
                  .from('subjects')
                  .select('name')
                  .eq('id', video.subject_id)
                  .single();
                if (subject?.name) warnSubjectName = subject.name;
              }
            } catch {}
          }
        } catch {}
      } else if (report.target_type === 'message' && report.target_id) {
        try {
          const { data: message } = await supabaseServer
            .from('chat_messages')
            .select('sender_id, content')
            .eq('id', report.target_id)
            .single();
          if (message?.sender_id) warnUserId = message.sender_id;
          if (message?.content) warnContentPreview = message.content.substring(0, 80);
        } catch {}
      }

      if (!warnUserId) {
        return NextResponse.json(
          { success: false, error: 'لم يتم العثور على المشكو منه' },
          { status: 400 }
        );
      }

      // Build detailed warning message with full details
      const reasonLabel: Record<string, string> = {
        inappropriate: 'محتوى غير مناسب',
        harassment: 'تحرش أو تنمر',
        spam: 'رسائل مزعجة',
        misinformation: 'معلومات مضللة',
        cheating: 'غش أكاديمي',
        inappropriateContent: 'محتوى غير لائق',
        impersonation: 'حساب مزيف / انتحال شخصية',
        other: 'سبب آخر',
      };
      const targetTypeLabel: Record<string, string> = {
        comment: 'تعليق',
        message: 'رسالة',
        user: 'مستخدم',
        other: 'أخرى',
      };
      const warnReason = reasonLabel[report.reason] || report.reason;
      const warnTargetType = targetTypeLabel[report.target_type] || report.target_type;
      const warnDate = new Date(report.created_at).toLocaleDateString('ar-SA', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
      const reportNum = report.report_number || id;

      // Build comprehensive warning message (each field on its own line)
      let warnMessage = `⚠️ تحذير\nالسبب: ${warnReason}${report.target_type === 'user' ? '' : `\nالنوع: ${warnTargetType}`}\nتاريخ الشكوى: ${warnDate}`;
      if (warnSubjectName) {
        warnMessage += `\nالمقرر: ${warnSubjectName}`;
      }
      if (warnContentPreview) {
        warnMessage += `\nالمحتوى: "${warnContentPreview}${warnContentPreview.length >= 80 ? '...' : ''}"`;
      }
      warnMessage += `\nرقم الشكوى: ${reportNum}`;

      // Insert warning as report_messages row (appears in inbox with orange styling)
      // Notification is handled by the DB trigger notify_report_message()
      await supabaseServer
        .from('report_messages')
        .insert({
          report_id: id,
          sender_id: userId,
          recipient_type: 'reported',
          recipient_id: warnUserId,
          content: content || warnMessage,
          message_type: 'warning',
        });
    }

    // ─── Handle message_reporter action ───
    if (action === 'message_reporter' && message_content) {
      const { error: msgError } = await supabaseServer
        .from('report_messages')
        .insert({
          report_id: id,
          sender_id: userId,
          recipient_type: 'reporter',
          recipient_id: report.reporter_id,
          content: message_content,
        });

      if (msgError) {
        console.error('[Reports] Message reporter error:', msgError.message);
        return NextResponse.json(
          { success: false, error: 'فشل إرسال الرسالة للشاكي' },
          { status: 500 }
        );
      }

      // Notification is handled by the DB trigger notify_report_message()
    }

    // ─── Handle message_reported action ───
    if (action === 'message_reported' && message_content) {
      // Resolve target user
      let reportedUserId: string | null = null;

      if (report.target_type === 'user' && report.target_id) {
        reportedUserId = report.target_id;
      } else if (report.target_type === 'comment' && report.target_id) {
        try {
          const { data: comment } = await supabaseServer
            .from('video_comments')
            .select('user_id')
            .eq('id', report.target_id)
            .single();
          if (comment?.user_id) reportedUserId = comment.user_id;
        } catch {}
      } else if (report.target_type === 'message' && report.target_id) {
        try {
          const { data: message } = await supabaseServer
            .from('chat_messages')
            .select('sender_id')
            .eq('id', report.target_id)
            .single();
          if (message?.sender_id) reportedUserId = message.sender_id;
        } catch {}
      }

      if (!reportedUserId) {
        return NextResponse.json(
          { success: false, error: 'لم يتم العثور على المشكو منه' },
          { status: 400 }
        );
      }

      const { error: msgError } = await supabaseServer
        .from('report_messages')
        .insert({
          report_id: id,
          sender_id: userId,
          recipient_type: 'reported',
          recipient_id: reportedUserId,
          content: message_content,
        });

      if (msgError) {
        console.error('[Reports] Message reported user error:', msgError.message);
        return NextResponse.json(
          { success: false, error: 'فشل إرسال الرسالة للمشكو منه' },
          { status: 500 }
        );
      }

      // Notification is handled by the DB trigger notify_report_message()
    }

    // ─── Determine new status ───
    let newStatus = report.status;
    if (action === 'resolve') newStatus = 'resolved';
    else if (action === 'dismiss') newStatus = 'dismissed';
    else if (action === 'reopen') newStatus = 'pending';
    else if (action === 'block' || action === 'warn') newStatus = 'resolved'; // Auto-resolve on block/warn
    else if (action === 'reply' && (report.status === 'resolved' || report.status === 'dismissed')) newStatus = report.status;
    else if (action === 'reply' || action === 'forward') newStatus = 'in_progress';
    else if (action === 'return') newStatus = 'in_progress'; // Return to teacher

    // Update report
    const updateData: Record<string, unknown> = {
      status: newStatus,
      updated_at: new Date().toISOString(),
    };

    // Increment reopen_count on reopen
    if (action === 'reopen') {
      updateData.reopen_count = (report.reopen_count || 0) + 1;
    }

    if (action === 'forward' && forwarded_to) {
      updateData.assigned_to = forwarded_to;
      updateData.status = 'pending';
    }

    // ─── Handle return action (admin returns report to original teacher) ───
    if (action === 'return') {
      // Return to the person who forwarded this report (the previous assignee)
      // Find the most recent forward response to get the original forwarder
      const { data: forwardResponse } = await supabaseServer
        .from('report_responses')
        .select('responder_id')
        .eq('report_id', id)
        .eq('action', 'forward')
        .order('created_at', { ascending: false })
        .limit(1);
      
      const backTo = forwardResponse && forwardResponse.length > 0 ? forwardResponse[0].responder_id : null;
      // Never hand it to the reported person; with no valid forwarder it goes back to the admins (unassigned).
      updateData.assigned_to = backTo && backTo !== reportedUserIdAll ? backTo : null;
      updateData.status = 'in_progress';
    }

    const { error: updateError } = await supabaseServer
      .from('reports')
      .update(updateData)
      .eq('id', id);

    if (updateError) {
      console.error('[Reports] Update error:', updateError.message);
      return NextResponse.json(
        { success: false, error: 'فشل تحديث الإبلاغ' },
        { status: 500 }
      );
    }

    // Every action is recorded in the complaint timeline (message actions record only
    // the fact, the private message text stays in report_messages).
    {
      const { error: responseError } = await supabaseServer
        .from('report_responses')
        .insert({
          report_id: id,
          responder_id: userId,
          action,
          content: ['message_reporter', 'message_reported'].includes(action) ? null : (content || null),
          forwarded_to: action === 'forward' ? forwarded_to : null,
          actor_role: isReporter && !isAdmin && !isAssigned ? 'reporter' : (role || null),
        });

      if (responseError) {
        console.error('[Reports] Response create error:', responseError.message);
        // Don't fail — report is already updated
      }
    }

    // Status-change notifications (best effort). The reporter and the reported person get
    // a generic text; the reporter's identity is never part of what the reported person sees.
    try {
      const num = report.report_number || '';
      const actionText: Record<string, string> = {
        reply: 'تم الرد على',
        resolve: 'تم حل',
        dismiss: 'تم رفض',
        reopen: 'أعيد فتح',
        warn: 'صدر قرار بشأن',
        block: 'صدر قرار بشأن',
      };
      const verb = actionText[action];
      if (verb) {
        const title = 'تحديث على شكوى';
        const msg = `${verb} الشكوى رقم ${num}`.trim();
        const targets = new Set<string>();
        const reporterOnly = isReporter && !isAdmin && !isAssigned;
        if (reporterOnly) {
          // The reporter wrote: tell the handler (or the admins when nobody is assigned).
          if (report.assigned_to) targets.add(report.assigned_to);
          else {
            const { data: admins } = await supabaseServer.from('users').select('id').in('role', ['admin', 'superadmin']).limit(20);
            (admins || []).forEach((a: any) => { if (a.id !== reportedUserIdAll) targets.add(a.id); });
          }
          targets.delete(userId);
          await Promise.all(Array.from(targets).map((rid) => notifyUser(rid, 'report', title, `${action === 'reopen' ? 'أعاد المبلّغ فتح' : 'رد المبلّغ على'} الشكوى رقم ${num}`.trim(), `/reports/${id}`)));
          targets.clear();
        }
        if (!reporterOnly && report.reporter_id) targets.add(report.reporter_id);
        if (!reporterOnly && action !== 'reopen' && reportedUserIdAll && (action === 'resolve' || action === 'dismiss' || action === 'reply')) targets.add(reportedUserIdAll);
        targets.delete(userId);
        await Promise.all(Array.from(targets).map((rid) => notifyUser(rid, 'report', title, msg, `/reports/${id}`)));
      }
    } catch {}

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Reports] PATCH error:', error);
    return NextResponse.json(
      { success: false, error: 'حدث خطأ غير متوقع' },
      { status: 500 }
    );
  }
}

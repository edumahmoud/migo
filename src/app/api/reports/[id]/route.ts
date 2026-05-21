// =====================================================
// Reports API — Get, Respond, Forward, Resolve, Dismiss
// =====================================================
import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateRequest, getUserRole } from '@/lib/auth-helpers';

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
    // Check if user is the target (reported person) of this report
    let isTargetUser = false;
    if (report.target_type === 'user' && report.target_id === userId) {
      isTargetUser = true;
    } else if (report.target_type === 'comment' && report.target_id) {
      try {
        const { data: comment } = await supabaseServer
          .from('video_comments')
          .select('user_id')
          .eq('id', report.target_id)
          .single();
        if (comment?.user_id === userId) isTargetUser = true;
      } catch {}
    } else if (report.target_type === 'message' && report.target_id) {
      try {
        const { data: message } = await supabaseServer
          .from('chat_messages')
          .select('sender_id')
          .eq('id', report.target_id)
          .single();
        if (message?.sender_id === userId) isTargetUser = true;
      } catch {}
    }

    if (report.reporter_id !== userId && report.assigned_to !== userId && !isAdmin && !isTargetUser) {
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

    return NextResponse.json({
      success: true,
      data: { ...report, responses, messages },
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

    const validActions = ['reply', 'forward', 'resolve', 'dismiss', 'reopen', 'block', 'warn', 'message_reporter', 'message_reported', 'return'];
    if (!action || !validActions.includes(action)) {
      return NextResponse.json(
        { success: false, error: 'إجراء غير صالح' },
        { status: 400 }
      );
    }

    // Access check
    const isAdmin = role === 'admin' || role === 'superadmin';
    const isAssigned = report.assigned_to === userId;
    const isReporter = report.reporter_id === userId;

    if (!isAdmin && !isAssigned && !isReporter) {
      return NextResponse.json(
        { success: false, error: 'غير مصرح بهذا الإجراء' },
        { status: 403 }
      );
    }

    // ─── Action-specific permission checks ───

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

    // Prevent double-forwarding: check if already forwarded
    if (action === 'forward') {
      const { data: existingForward } = await supabaseServer
        .from('report_responses')
        .select('id')
        .eq('report_id', id)
        .eq('action', 'forward')
        .limit(1);
      if (existingForward && existingForward.length > 0) {
        return NextResponse.json(
          { success: false, error: 'تم تحويل هذا الإبلاغ مسبقاً' },
          { status: 400 }
        );
      }
    }

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
    if (action === 'warn' && role === 'student') {
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

    // ─── Handle block action ───
    // Block is now handled via the ban modal which calls /api/admin/ban-user directly.
    // When the ban modal confirms, it also calls handleAction('block') to record the action
    // in report_responses. We just record the action here — no direct ban creation.
    if (action === 'block') {
      // The actual ban is handled by the ban-user API called from the modal.
      // This just records the block action in the report.
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

      // Build comprehensive warning message
      let warnMessage = `⚠️ تحذير — السبب: ${warnReason} — النوع: ${warnTargetType} — تاريخ الشكوى: ${warnDate}`;
      if (warnSubjectName) {
        warnMessage += ` — المقرر: ${warnSubjectName}`;
      }
      if (warnContentPreview) {
        warnMessage += ` — المحتوى: "${warnContentPreview}${warnContentPreview.length >= 80 ? '...' : ''}"`;
      }
      warnMessage += ` — رقم الشكوى: ${reportNum}`;

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
    else if (action === 'reply' || action === 'forward') newStatus = 'in_progress';
    else if (action === 'return') newStatus = 'in_progress'; // Return to teacher

    // Update report
    const updateData: Record<string, unknown> = {
      status: newStatus,
      updated_at: new Date().toISOString(),
    };

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
      
      if (forwardResponse && forwardResponse.length > 0) {
        updateData.assigned_to = forwardResponse[0].responder_id;
      } else {
        // Fallback: return to reporter if no forward response found
        updateData.assigned_to = report.reporter_id;
      }
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

    // Create response record (skip for message actions — they create messages instead)
    if (!['message_reporter', 'message_reported'].includes(action)) {
      const { error: responseError } = await supabaseServer
        .from('report_responses')
        .insert({
          report_id: id,
          responder_id: userId,
          action,
          content: content || null,
          forwarded_to: action === 'forward' ? forwarded_to : null,
        });

      if (responseError) {
        console.error('[Reports] Response create error:', responseError.message);
        // Don't fail — report is already updated
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Reports] PATCH error:', error);
    return NextResponse.json(
      { success: false, error: 'حدث خطأ غير متوقع' },
      { status: 500 }
    );
  }
}

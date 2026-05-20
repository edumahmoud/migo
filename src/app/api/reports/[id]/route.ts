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

    // Check access: reporter, assigned user, or admin/superadmin
    const isAdmin = role === 'admin' || role === 'superadmin';
    if (report.reporter_id !== userId && report.assigned_to !== userId && !isAdmin) {
      return NextResponse.json(
        { success: false, error: 'غير مصرح بالوصول' },
        { status: 403 }
      );
    }

    // Fetch responses
    const { data: responses } = await supabaseServer
      .from('report_responses')
      .select(`
        *,
        responder:users!report_responses_responder_id_fkey(id, name, email, avatar_url, role, gender, title_id),
        forwarded_to_user:users!report_responses_forwarded_to_fkey(id, name, email, avatar_url, role, gender, title_id)
      `)
      .eq('report_id', id)
      .order('created_at', { ascending: true });

    // Fetch messages
    const { data: messages } = await supabaseServer
      .from('report_messages')
      .select(`
        *,
        sender:users!report_messages_sender_id_fkey(id, name, email, avatar_url, role, gender, title_id)
      `)
      .eq('report_id', id)
      .order('created_at', { ascending: true });

    // ─── Enrich with target_user info ───
    let resolvedUserId: string | null = null;

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
        // Attach comment content as target_content if not already set
        if (comment?.content && !report.target_content) {
          (report as any).target_content = comment.content;
        }
      } catch { /* table may not exist */ }
    } else if (report.target_type === 'message' && report.target_id) {
      try {
        const { data: message } = await supabaseServer
          .from('chat_messages')
          .select('sender_id, content')
          .eq('id', report.target_id)
          .single();
        if (message?.sender_id) resolvedUserId = message.sender_id;
        // Attach message content as target_content if not already set
        if ((message as any)?.content && !report.target_content) {
          (report as any).target_content = (message as any).content;
        }
      } catch { /* table may not exist */ }
    }

    if (resolvedUserId) {
      const { data: targetUser } = await supabaseServer
        .from('users')
        .select('id, name, email, avatar_url, role, gender, title_id')
        .eq('id', resolvedUserId)
        .single();

      if (targetUser) {
        // Get report count for this target user
        const { count } = await supabaseServer
          .from('reports')
          .select('id', { count: 'exact', head: true })
          .eq('target_type', 'user')
          .eq('target_id', resolvedUserId);

        // Get reporter count — how many distinct users reported this target
        const { data: distinctReporters } = await supabaseServer
          .from('reports')
          .select('reporter_id')
          .eq('target_type', report.target_type)
          .eq('target_id', report.target_id);

        const reporterCount = new Set((distinctReporters || []).map((r: any) => r.reporter_id)).size;

        (report as any).target_user = { ...targetUser, report_count: count || 0 };
        (report as any).reporter_count = reporterCount;
      }
    }

    return NextResponse.json({
      success: true,
      data: { ...report, responses: responses || [], messages: messages || [] },
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

    const validActions = ['reply', 'forward', 'resolve', 'dismiss', 'reopen', 'block', 'warn', 'message_reporter', 'message_reported'];
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
    if (action === 'block') {
      // Resolve the target user to block
      let blockUserId: string | null = null;

      if (report.target_type === 'user' && report.target_id) {
        blockUserId = report.target_id;
      } else if (report.target_type === 'comment' && report.target_id) {
        try {
          const { data: comment } = await supabaseServer
            .from('video_comments')
            .select('user_id')
            .eq('id', report.target_id)
            .single();
          if (comment?.user_id) blockUserId = comment.user_id;
        } catch {}
      } else if (report.target_type === 'message' && report.target_id) {
        try {
          const { data: message } = await supabaseServer
            .from('chat_messages')
            .select('sender_id')
            .eq('id', report.target_id)
            .single();
          if (message?.sender_id) blockUserId = message.sender_id;
        } catch {}
      }

      if (!blockUserId) {
        return NextResponse.json(
          { success: false, error: 'لم يتم العثور على المستخدم المبلغ عنه' },
          { status: 400 }
        );
      }

      // Check if already banned
      const { data: existingBan } = await supabaseServer
        .from('banned_users')
        .select('id')
        .eq('user_id', blockUserId)
        .eq('is_active', true)
        .single();

      if (!existingBan) {
        // Create ban record
        const { error: banError } = await supabaseServer
          .from('banned_users')
          .insert({
            user_id: blockUserId,
            banned_by: userId,
            is_active: true,
            // No ban_until = permanent ban
          });

        if (banError) {
          console.error('[Reports] Block user error:', banError.message);
          return NextResponse.json(
            { success: false, error: 'فشل حظر المستخدم' },
            { status: 500 }
          );
        }
      }
    }

    // ─── Handle warn action ───
    if (action === 'warn') {
      // Resolve the target user to warn
      let warnUserId: string | null = null;

      if (report.target_type === 'user' && report.target_id) {
        warnUserId = report.target_id;
      } else if (report.target_type === 'comment' && report.target_id) {
        try {
          const { data: comment } = await supabaseServer
            .from('video_comments')
            .select('user_id')
            .eq('id', report.target_id)
            .single();
          if (comment?.user_id) warnUserId = comment.user_id;
        } catch {}
      } else if (report.target_type === 'message' && report.target_id) {
        try {
          const { data: message } = await supabaseServer
            .from('chat_messages')
            .select('sender_id')
            .eq('id', report.target_id)
            .single();
          if (message?.sender_id) warnUserId = message.sender_id;
        } catch {}
      }

      if (!warnUserId) {
        return NextResponse.json(
          { success: false, error: 'لم يتم العثور على المستخدم المبلغ عنه' },
          { status: 400 }
        );
      }

      // Send warning notification to the reported user
      await supabaseServer
        .from('notifications')
        .insert({
          user_id: warnUserId,
          type: 'report',
          title: 'تحذير',
          message: content || 'تم تحذيرك بخصوص محتوى مخالف. يرجى الالتزام بسياسات المنصة.',
          link: `/reports/${id}`,
          read: false,
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
          { success: false, error: 'فشل إرسال الرسالة للمُبلِغ' },
          { status: 500 }
        );
      }
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
          { success: false, error: 'لم يتم العثور على المستخدم المبلغ عنه' },
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
          { success: false, error: 'فشل إرسال الرسالة للمُبلَّغ عنه' },
          { status: 500 }
        );
      }
    }

    // ─── Determine new status ───
    let newStatus = report.status;
    if (action === 'resolve') newStatus = 'resolved';
    else if (action === 'dismiss') newStatus = 'dismissed';
    else if (action === 'reopen') newStatus = 'pending';
    else if (action === 'block' || action === 'warn') newStatus = 'resolved'; // Auto-resolve on block/warn
    else if (action === 'reply' || action === 'forward') newStatus = 'in_progress';

    // Update report
    const updateData: Record<string, unknown> = {
      status: newStatus,
      updated_at: new Date().toISOString(),
    };

    if (action === 'forward' && forwarded_to) {
      updateData.assigned_to = forwarded_to;
      updateData.status = 'pending';
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

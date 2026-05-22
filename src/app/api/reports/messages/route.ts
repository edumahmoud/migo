// =====================================================
// Report Messages API — Reply to a report message
// =====================================================
import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateRequest } from '@/lib/auth-helpers';

// POST /api/reports/messages — Send a reply message in a report conversation
export async function POST(request: NextRequest) {
  try {
    const authResult = await authenticateRequest(request);
    if (!authResult.success) {
      return NextResponse.json({ success: false, error: authResult.error }, { status: authResult.status });
    }

    const userId = authResult.user.id;
    const body = await request.json();
    const { report_id, content, attachments } = body;

    if (!report_id || !content?.trim()) {
      return NextResponse.json(
        { success: false, error: 'رقم الشكوى والمحتوى مطلوبان' },
        { status: 400 }
      );
    }

    // Fetch the report to verify access
    const { data: report, error: reportError } = await supabaseServer
      .from('reports')
      .select('id, reporter_id, target_type, target_id, status')
      .eq('id', report_id)
      .single();

    if (reportError || !report) {
      return NextResponse.json(
        { success: false, error: 'الشكوى غير موجودة' },
        { status: 404 }
      );
    }

    // SECURITY FIX: Verify the user is a party in this report.
    // Previously, any authenticated user could send messages in any report.
    const isReporter = report.reporter_id === userId;

    // Resolve the reported user
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

    // Check if the user is assigned to this report (handler)
    const { data: assignedReport } = await supabaseServer
      .from('reports')
      .select('assigned_to')
      .eq('id', report_id)
      .single();

    const isAssigned = assignedReport?.assigned_to === userId;
    const isReported = reportedUserId === userId;

    // Get user role for admin check
    const { data: userProfile } = await supabaseServer
      .from('users')
      .select('role')
      .eq('id', userId)
      .single();

    const isAdminOrSuperadmin = userProfile?.role === 'admin' || userProfile?.role === 'superadmin';

    // Only allow: reporter, reported person, assigned handler, or admin/superadmin
    if (!isReporter && !isReported && !isAssigned && !isAdminOrSuperadmin) {
      return NextResponse.json(
        { success: false, error: 'غير مصرح بإرسال رسائل في هذه الشكوى' },
        { status: 403 }
      );
    }

    // Determine the user's role in this report and the recipient
    let recipientType: 'reporter' | 'reported' = 'reporter';
    let recipientId: string | null = null;

    // Note: isReporter, reportedUserId, and assignedReport were already resolved above
    // during the authorization check — no need to re-resolve them.

    if (isReporter) {
      // الشاكي replies → message goes to the assigned reviewer
      if (assignedReport?.assigned_to) {
        recipientId = assignedReport.assigned_to;
        recipientType = 'reporter'; // The reporter is sending, so recipient_type marks the conversation context
      } else {
        return NextResponse.json(
          { success: false, error: 'لا يوجد مراجع مُعيَّن لهذه الشكوى بعد' },
          { status: 400 }
        );
      }
    } else if (isReported) {
      // المشكو ضده replies → message goes to the assigned reviewer
      if (assignedReport?.assigned_to) {
        recipientId = assignedReport.assigned_to;
        recipientType = 'reported';
      } else {
        return NextResponse.json(
          { success: false, error: 'لا يوجد مراجع مُعيَّن لهذه الشكوى بعد' },
          { status: 400 }
        );
      }
    } else {
      // Staff (assigned/admin) replying — determine which party to send to
      // Default: send to the reporter (can be overridden with recipient_type in body)
      const bodyRecipientType = body.recipient_type as 'reporter' | 'reported' | undefined;
      if (bodyRecipientType === 'reported') {
        recipientId = reportedUserId;
        recipientType = 'reported';
      } else {
        recipientId = report.reporter_id;
        recipientType = 'reporter';
      }
    }

    if (!recipientId) {
      return NextResponse.json(
        { success: false, error: 'لم يتم تحديد المستلم' },
        { status: 400 }
      );
    }

    // Insert the reply message
    const { data: message, error: msgError } = await supabaseServer
      .from('report_messages')
      .insert({
        report_id,
        sender_id: userId,
        recipient_type: recipientType,
        recipient_id: recipientId,
        content: content.trim(),
        attachments: attachments || [],
        message_type: 'info',
      })
      .select()
      .single();

    if (msgError) {
      console.error('[Reports Messages] Insert error:', msgError.message);
      return NextResponse.json(
        { success: false, error: 'فشل إرسال الرسالة' },
        { status: 500 }
      );
    }

    // Notification is handled by the DB trigger notify_report_message()

    return NextResponse.json({ success: true, data: message });
  } catch (error) {
    console.error('[Reports Messages] POST error:', error);
    return NextResponse.json(
      { success: false, error: 'حدث خطأ غير متوقع' },
      { status: 500 }
    );
  }
}

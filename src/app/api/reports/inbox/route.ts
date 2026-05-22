// =====================================================
// Reports Inbox API — Fetch messages for current user
// Uses server-side Supabase (service role) to bypass RLS
// so the recipient can always see their messages.
// Enriched with report details + target user info.
// =====================================================
import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateRequest } from '@/lib/auth-helpers';

// GET /api/reports/inbox — Get all report messages where current user is recipient
export async function GET(request: NextRequest) {
  try {
    const authResult = await authenticateRequest(request);
    if (!authResult.success) {
      return NextResponse.json({ success: false, error: authResult.error }, { status: authResult.status });
    }

    const userId = authResult.user.id;

    // First check if report_messages table exists by attempting a count
    const { count, error: countError } = await supabaseServer
      .from('report_messages')
      .select('id', { count: 'exact', head: true })
      .eq('recipient_id', userId);

    if (countError) {
      console.error('[Reports Inbox] Table check error:', countError.message);
      // Table might not exist — return empty instead of failing
      return NextResponse.json({
        success: true,
        data: [],
        warning: 'report_messages table may not exist yet. Please run v38 migration.',
      });
    }

    const { data, error } = await supabaseServer
      .from('report_messages')
      .select(`
        *,
        sender:users!report_messages_sender_id_fkey(id, name, email, avatar_url, role, gender, title_id)
      `)
      .eq('recipient_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[Reports Inbox] Fetch error:', error.message);
      return NextResponse.json(
        { success: false, error: 'فشل جلب الرسائل الواردة' },
        { status: 500 }
      );
    }

    console.log('[Reports Inbox] Found', (data || []).length, 'messages for user', userId);

    // ─── Enrich messages with report details ───
    const messages = data || [];

    // Collect unique report_ids
    const reportIds = [...new Set(messages.map((m: any) => m.report_id).filter(Boolean))];

    // Fetch all related reports in parallel
    const reportMap = new Map<string, any>();
    if (reportIds.length > 0) {
      const { data: reportsData } = await supabaseServer
        .from('reports')
        .select(`
          id, report_number, reporter_id, target_type, target_id, reason, status,
          reporter:users!reports_reporter_id_fkey(id, name, email, avatar_url, role, gender, title_id)
        `)
        .in('id', reportIds);

      (reportsData || []).forEach((r: any) => reportMap.set(r.id, r));

      // Resolve target users for each report
      for (const report of (reportsData || [])) {
        let targetUserId: string | null = null;

        if (report.target_type === 'user' && report.target_id) {
          targetUserId = report.target_id;
        } else if (report.target_type === 'comment' && report.target_id) {
          const { data: comment } = await supabaseServer
            .from('video_comments')
            .select('user_id')
            .eq('id', report.target_id)
            .single();
          if (comment?.user_id) targetUserId = comment.user_id;
        } else if (report.target_type === 'message' && report.target_id) {
          const { data: message } = await supabaseServer
            .from('chat_messages')
            .select('sender_id')
            .eq('id', report.target_id)
            .single();
          if (message?.sender_id) targetUserId = message.sender_id;
        }

        if (targetUserId) {
          const { data: targetUser } = await supabaseServer
            .from('users')
            .select('id, name, email, avatar_url, role, gender, title_id')
            .eq('id', targetUserId)
            .single();
          (report as any).target_user = targetUser || null;
        }
      }
    }

    // Attach report info + is_auto flag + recipient_role to each message
    // recipient_role is the ACTUAL role of the recipient in this report context,
    // unlike recipient_type which only stores 'reporter' or 'reported' as the message context.
    // This fixes the bug where a teacher/handler sees "بخصوص شكوى ضدك" when they're
    // not the accused party — just the handler.
    const enrichedMessages = messages.map((msg: any) => {
      const report = reportMap.get(msg.report_id);
      let recipientRole: 'reporter' | 'reported' | 'handler' = 'handler';

      if (report) {
        if (msg.recipient_id === report.reporter_id) {
          recipientRole = 'reporter';
        } else if (report.target_user && msg.recipient_id === report.target_user.id) {
          recipientRole = 'reported';
        } else {
          recipientRole = 'handler';
        }
      }

      return {
        ...msg,
        is_auto: msg.message_type === 'auto',
        recipient_role: recipientRole,
        report: report || null,
      };
    });

    return NextResponse.json({
      success: true,
      data: enrichedMessages,
    });
  } catch (error) {
    console.error('[Reports Inbox] GET error:', error);
    return NextResponse.json(
      { success: false, error: 'حدث خطأ غير متوقع' },
      { status: 500 }
    );
  }
}

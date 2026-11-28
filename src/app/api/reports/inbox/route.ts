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
        .in('id', reportIds)
        .is('archived_at', null);

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
    // Messages this user sent as replies (for threading and the replied state)
    const { data: sentRows } = await supabaseServer
      .from('report_messages')
      .select('id, report_id, sender_id, content, attachments, created_at, reply_to_id')
      .eq('sender_id', userId)
      .not('reply_to_id', 'is', null);
    const seenSent = new Set<string>();
    const sent: any[] = [];
    (sentRows || []).forEach((r: any) => {
      const k = r.reply_to_id + '|' + r.content;
      if (seenSent.has(k)) return; // one reply sent to several admins counts once
      seenSent.add(k);
      sent.push(r);
    });

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

      const hideReporter = !!report && recipientRole === 'reported' && msg.sender_id === report.reporter_id;
      return {
        ...msg,
        ...(hideReporter ? { sender: null, sender_id: null } : {}),
        is_auto: msg.message_type === 'auto',
        from_party: report && msg.sender_id === report.reporter_id ? 'reporter' : (report && report.target_user && msg.sender_id === report.target_user.id ? 'reported' : 'staff'),
        recipient_role: recipientRole,
        report: report ? (recipientRole === 'reported' ? { ...report, reporter: null, reporter_id: null, assigned_user: null, assigned_to: null } : report) : null,
      };
    });

    // Thread replies under the message they answer (only this user's own messages and messages addressed to him)
    const byId = new Map<string, any>();
    enrichedMessages.forEach((m: any) => byId.set(m.id, { ...m, mine: false }));
    sent.forEach((r: any) => byId.set(r.id, { id: r.id, report_id: r.report_id, content: r.content, attachments: r.attachments, created_at: r.created_at, reply_to_id: r.reply_to_id, mine: true }));
    const rootOf = (id: string): string => {
      let cur = byId.get(id);
      let guard = 0;
      while (cur && cur.reply_to_id && byId.has(cur.reply_to_id) && guard++ < 50) cur = byId.get(cur.reply_to_id);
      return cur ? cur.id : id;
    };
    const threads = new Map<string, any[]>();
    byId.forEach((m: any) => {
      if (!m.reply_to_id || !byId.has(m.reply_to_id)) return;
      const root = rootOf(m.id);
      if (root === m.id) return;
      if (!threads.has(root)) threads.set(root, []);
      threads.get(root)!.push({ id: m.id, content: m.content, attachments: m.attachments, created_at: m.created_at, mine: m.mine, message_type: m.message_type || 'info' });
    });
    const topLevel = enrichedMessages
      .filter((m: any) => rootOf(m.id) === m.id)
      .map((m: any) => {
        const replies = (threads.get(m.id) || []).sort((a: any, b: any) => (a.created_at < b.created_at ? -1 : 1));
        const last = replies.length ? replies[replies.length - 1] : null;
        return { ...m, replies, replied: !!last && last.mine };
      });

    return NextResponse.json({
      success: true,
      data: topLevel,
    });
  } catch (error) {
    console.error('[Reports Inbox] GET error:', error);
    return NextResponse.json(
      { success: false, error: 'حدث خطأ غير متوقع' },
      { status: 500 }
    );
  }
}

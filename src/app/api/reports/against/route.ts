// =====================================================
// Reports Against API — Fetch reports filed against the current user
// Used for the "شكاوى ضدك" tab in the reports section
// =====================================================
import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateRequest } from '@/lib/auth-helpers';

// GET /api/reports/against — Get reports filed against the current user
export async function GET(request: NextRequest) {
  try {
    const authResult = await authenticateRequest(request);
    if (!authResult.success) {
      return NextResponse.json({ success: false, error: authResult.error }, { status: authResult.status });
    }

    const userId = authResult.user.id;

    // Step 1: Find IDs of comments and messages owned by this user
    const [commentIdsResult, messageIdsResult] = await Promise.all([
      supabaseServer.from('video_comments').select('id').eq('user_id', userId),
      supabaseServer.from('chat_messages').select('id').eq('sender_id', userId),
    ]);

    const cIds = (commentIdsResult.data || []).map((c: any) => c.id);
    const mIds = (messageIdsResult.data || []).map((m: any) => m.id);

    // Step 2: Fetch all reports against this user using multiple parallel queries
    const selectFields = `id, report_number, target_type, target_id, reason, description, status, reporter_count, reopen_count, created_at, updated_at, reporter:users!reports_reporter_id_fkey(id, name, email, avatar_url, role, gender, title_id)`;

    const queries = [
      // Reports directly targeting this user
      supabaseServer
        .from('reports')
        .select(selectFields)
        .eq('target_type', 'user')
        .eq('target_id', userId),
    ];

    // Reports targeting this user's comments
    if (cIds.length > 0) {
      queries.push(
        supabaseServer
          .from('reports')
          .select(selectFields)
          .eq('target_type', 'comment')
          .in('target_id', cIds)
      );
    }

    // Reports targeting this user's messages
    if (mIds.length > 0) {
      queries.push(
        supabaseServer
          .from('reports')
          .select(selectFields)
          .eq('target_type', 'message')
          .in('target_id', mIds)
      );
    }

    const results = await Promise.all(queries);

    // Check for errors
    for (const result of results) {
      if (result.error) {
        console.error('[Reports Against] Query error:', result.error.message);
      }
    }

    // Merge and deduplicate
    const allReports = results.flatMap(r => r.data || []);
    const seen = new Set<string>();
    const uniqueReports = allReports.filter((r: any) => {
      if (seen.has(r.id)) return false;
      seen.add(r.id);
      return true;
    }).sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    console.log('[Reports Against] Found', uniqueReports.length, 'reports against user', userId);

    return NextResponse.json({
      success: true,
      data: uniqueReports,
    });
  } catch (error) {
    console.error('[Reports Against] GET error:', error);
    return NextResponse.json(
      { success: false, error: 'حدث خطأ غير متوقع' },
      { status: 500 }
    );
  }
}

// =====================================================
// Reports User Stats API — Complaint statistics for a specific user
// Used when viewing report detail to show complaint history
// even for deleted reports (via user_report_stats table)
// =====================================================
import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateRequest, getUserRole } from '@/lib/auth-helpers';

// GET /api/reports/user-stats?user_id=xxx
export async function GET(request: NextRequest) {
  try {
    const authResult = await authenticateRequest(request);
    if (!authResult.success) {
      return NextResponse.json({ success: false, error: authResult.error }, { status: authResult.status });
    }

    const userId = authResult.user.id;
    const role = await getUserRole(userId);
    const isStaff = role === 'teacher' || role === 'admin' || role === 'superadmin';

    const targetUserId = request.nextUrl.searchParams.get('user_id');
    if (!targetUserId) {
      return NextResponse.json({ success: false, error: 'user_id مطلوب' }, { status: 400 });
    }

    // Only staff can view other users' stats; users can view their own
    if (targetUserId !== userId && !isStaff) {
      return NextResponse.json({ success: false, error: 'غير مصرح' }, { status: 403 });
    }

    // Try to get from user_report_stats table first (survives report deletion)
    const { data: stats } = await supabaseServer
      .from('user_report_stats')
      .select('*')
      .eq('user_id', targetUserId)
      .single();

    // Also get live counts from reports table
    const [filedResult, againstResult, reportersResult] = await Promise.all([
      supabaseServer
        .from('reports')
        .select('id', { count: 'exact', head: true })
        .eq('reporter_id', targetUserId),
      supabaseServer
        .from('reports')
        .select('id', { count: 'exact', head: true })
        .eq('target_type', 'user')
        .eq('target_id', targetUserId),
      supabaseServer
        .from('reports')
        .select('reporter_id')
        .eq('target_type', 'user')
        .eq('target_id', targetUserId)
        .in('status', ['pending', 'in_progress']),
    ]);

    return NextResponse.json({
      success: true,
      data: {
        user_id: targetUserId,
        // From persistent stats (survives report deletion)
        total_filed: stats?.complaints_filed_count ?? filedResult.count ?? 0,
        total_against: stats?.complaints_against_count ?? againstResult.count ?? 0,
        total_reporters: stats?.total_reporters_count ?? new Set((reportersResult.data || []).map((r: any) => r.reporter_id)).size,
        // Live counts from reports table
        live_filed: filedResult.count ?? 0,
        live_against: againstResult.count ?? 0,
      },
    });
  } catch (error) {
    console.error('[Reports User Stats] GET error:', error);
    return NextResponse.json(
      { success: false, error: 'حدث خطأ غير متوقع' },
      { status: 500 }
    );
  }
}

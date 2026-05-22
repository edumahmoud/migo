// =====================================================
// Reports Count API — Badge counter for sidebar
// =====================================================
import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateRequest, getUserRole } from '@/lib/auth-helpers';

// GET /api/reports/count — Get unread/pending reports count for current user
export async function GET(request: NextRequest) {
  try {
    const authResult = await authenticateRequest(request);
    if (!authResult.success) {
      return NextResponse.json({ success: false, error: authResult.error }, { status: authResult.status });
    }

    const userId = authResult.user.id;
    const role = await getUserRole(userId);

    if (role === 'admin' || role === 'superadmin') {
      // No badge for admin/superadmin — they use the admin dashboard instead
      return NextResponse.json({
        success: true,
        data: { count: 0 },
      });
    } else if (role === 'teacher') {
      // Teachers see count of reports assigned to them + reports against them
      const [assignedResult, againstResult] = await Promise.all([
        supabaseServer
          .from('reports')
          .select('id', { count: 'exact', head: true })
          .in('status', ['pending', 'in_progress'])
          .eq('assigned_to', userId),
        supabaseServer
          .from('reports')
          .select('id', { count: 'exact', head: true })
          .eq('target_type', 'user')
          .eq('target_id', userId)
          .in('status', ['pending', 'in_progress']),
      ]);
      
      const assignedCount = assignedResult.count || 0;
      const againstCount = againstResult.count || 0;
      
      return NextResponse.json({
        success: true,
        data: { count: assignedCount + againstCount },
      });
    } else {
      // Students/users see count of:
      // 1. Their submitted reports that have responses (in_progress/resolved)
      // 2. Reports against them that are active (pending/in_progress)
      // We use two queries and sum the counts
      const [submittedResult, againstResult] = await Promise.all([
        supabaseServer
          .from('reports')
          .select('id', { count: 'exact', head: true })
          .eq('reporter_id', userId)
          .in('status', ['in_progress', 'resolved']),
        supabaseServer
          .from('reports')
          .select('id', { count: 'exact', head: true })
          .eq('target_type', 'user')
          .eq('target_id', userId)
          .in('status', ['pending', 'in_progress']),
      ]);
      
      const submittedCount = submittedResult.count || 0;
      const againstCount = againstResult.count || 0;
      
      return NextResponse.json({
        success: true,
        data: { count: submittedCount + againstCount },
      });
    }
  } catch (error) {
    console.error('[Reports] Count error:', error);
    return NextResponse.json(
      { success: false, error: 'حدث خطأ غير متوقع' },
      { status: 500 }
    );
  }
}

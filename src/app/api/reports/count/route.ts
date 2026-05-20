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

    let countQuery;

    if (role === 'admin' || role === 'superadmin') {
      // Admins/superadmins see count of ALL pending/in_progress reports on the platform
      countQuery = supabaseServer
        .from('reports')
        .select('id', { count: 'exact', head: true })
        .in('status', ['pending', 'in_progress']);
    } else if (role === 'teacher') {
      // Teachers see count of reports assigned to them (from students) that are pending/in_progress
      countQuery = supabaseServer
        .from('reports')
        .select('id', { count: 'exact', head: true })
        .in('status', ['pending', 'in_progress'])
        .eq('assigned_to', userId);
    } else {
      // Students see count of their reports that have new responses (status changed from their last view)
      countQuery = supabaseServer
        .from('reports')
        .select('id', { count: 'exact', head: true })
        .eq('reporter_id', userId)
        .in('status', ['in_progress', 'resolved']);
    }

    const { count, error } = await countQuery;

    if (error) {
      console.error('[Reports] Count error:', error.message);
      return NextResponse.json(
        { success: false, error: 'فشل جلب عدد الإبلاغات' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      data: { count: count || 0 },
    });
  } catch (error) {
    console.error('[Reports] Count error:', error);
    return NextResponse.json(
      { success: false, error: 'حدث خطأ غير متوقع' },
      { status: 500 }
    );
  }
}

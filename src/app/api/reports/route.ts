// =====================================================
// Reports API — Create & List reports
// =====================================================
import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateRequest, getUserRole } from '@/lib/auth-helpers';

// POST /api/reports — Create a new report
export async function POST(request: NextRequest) {
  try {
    const authResult = await authenticateRequest(request);
    if (!authResult.success) {
      return NextResponse.json({ success: false, error: authResult.error }, { status: authResult.status });
    }

    const body = await request.json();
    const { target_type, target_id, reason, description } = body;

    if (!target_type || !reason) {
      return NextResponse.json(
        { success: false, error: 'نوع الهدف والسبب مطلوبان' },
        { status: 400 }
      );
    }

    if (!['comment', 'message', 'user', 'other'].includes(target_type)) {
      return NextResponse.json(
        { success: false, error: 'نوع هدف غير صالح' },
        { status: 400 }
      );
    }

    // Create the report — the DB trigger auto_assign_report() will set assigned_to
    const { data: report, error } = await supabaseServer
      .from('reports')
      .insert({
        reporter_id: authResult.user.id,
        target_type,
        target_id: target_id || null,
        reason,
        description: description || null,
        status: 'pending',
      })
      .select()
      .single();

    if (error) {
      console.error('[Reports] Create error:', error.message);
      return NextResponse.json(
        { success: false, error: 'فشل إنشاء الإبلاغ' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, data: report });
  } catch (error) {
    console.error('[Reports] POST error:', error);
    return NextResponse.json(
      { success: false, error: 'حدث خطأ غير متوقع' },
      { status: 500 }
    );
  }
}

// GET /api/reports — List reports for current user (assigned to them or submitted by them)
export async function GET(request: NextRequest) {
  try {
    const authResult = await authenticateRequest(request);
    if (!authResult.success) {
      return NextResponse.json({ success: false, error: authResult.error }, { status: authResult.status });
    }

    const userId = authResult.user.id;
    const role = await getUserRole(userId);

    const url = new URL(request.url);
    const status = url.searchParams.get('status');
    const page = parseInt(url.searchParams.get('page') || '1');
    const limit = parseInt(url.searchParams.get('limit') || '20');
    const offset = (page - 1) * limit;

    let query = supabaseServer
      .from('reports')
      .select(`
        *,
        reporter:users!reports_reporter_id_fkey(id, name, email, avatar_url, role, gender, title_id),
        assigned_user:users!reports_assigned_to_fkey(id, name, email, avatar_url, role, gender, title_id)
      `, { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    // Filter by status if provided
    if (status && ['pending', 'in_progress', 'resolved', 'dismissed'].includes(status)) {
      query = query.eq('status', status);
    }

    // Role-based filtering — Admin sees ALL reports by default (not just assigned)
    if (role === 'admin' || role === 'superadmin') {
      const viewMode = url.searchParams.get('view') || 'all';
      if (viewMode === 'submitted') {
        query = query.eq('reporter_id', userId);
      } else if (viewMode === 'assigned') {
        query = query.eq('assigned_to', userId);
      }
      // 'all' — no additional filter, admin sees everything
    } else if (role === 'teacher') {
      query = query.or(`assigned_to.eq.${userId},reporter_id.eq.${userId}`);
    } else {
      query = query.eq('reporter_id', userId);
    }

    const { data: reports, error, count } = await query;

    if (error) {
      console.error('[Reports] List error:', error.message);
      return NextResponse.json(
        { success: false, error: 'فشل جلب الإبلاغات' },
        { status: 500 }
      );
    }

    // ─── Enrich reports with target_user info ───
    // For reports where target_type is 'user', target_id is the reported user.
    // For 'comment'/'message', we try to resolve the user from the content.
    if (reports && reports.length > 0) {
      const targetUserIds = new Set<string>();
      for (const r of reports) {
        if (r.target_type === 'user' && r.target_id) {
          targetUserIds.add(r.target_id);
        }
      }

      // Batch-fetch target user profiles + report counts
      let targetUserMap: Record<string, { id: string; name: string; email: string; avatar_url: string | null; role: string | null; gender: string | null; title_id: string | null; report_count: number }> = {};
      if (targetUserIds.size > 0) {
        const ids = Array.from(targetUserIds);
        const { data: targetUsers } = await supabaseServer
          .from('users')
          .select('id, name, email, avatar_url, role, gender, title_id')
          .in('id', ids);

        // Batch-fetch report counts per target user
        const { data: reportCounts } = await supabaseServer
          .from('reports')
          .select('target_id')
          .eq('target_type', 'user')
          .in('target_id', ids);

        const countMap: Record<string, number> = {};
        if (reportCounts) {
          for (const rc of reportCounts) {
            if (rc.target_id) {
              countMap[rc.target_id] = (countMap[rc.target_id] || 0) + 1;
            }
          }
        }

        if (targetUsers) {
          for (const u of targetUsers) {
            targetUserMap[u.id] = { ...u, report_count: countMap[u.id] || 0 };
          }
        }
      }

      // Attach target_user to reports
      for (const r of reports) {
        if (r.target_type === 'user' && r.target_id && targetUserMap[r.target_id]) {
          (r as any).target_user = targetUserMap[r.target_id];
        }
      }
    }

    return NextResponse.json({
      success: true,
      data: reports,
      pagination: {
        page,
        limit,
        total: count || 0,
        totalPages: Math.ceil((count || 0) / limit),
      },
    });
  } catch (error) {
    console.error('[Reports] GET error:', error);
    return NextResponse.json(
      { success: false, error: 'حدث خطأ غير متوقع' },
      { status: 500 }
    );
  }
}

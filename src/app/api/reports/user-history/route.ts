// =====================================================
// Reports user history — the full list behind the "complaints against" and
// "complaints filed" counters. Each viewer only gets the data they are allowed to see:
//  - the reported person never sees who filed a complaint,
//  - a user is never shown that someone they are about to be linked to filed against the viewer,
//  - staff see full details only for complaints they may handle; other rows are summary only.
// =====================================================
import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateRequest, getUserRole } from '@/lib/auth-helpers';

export async function GET(request: NextRequest) {
  try {
    const authResult = await authenticateRequest(request);
    if (!authResult.success) {
      return NextResponse.json({ success: false, error: authResult.error }, { status: authResult.status });
    }
    const viewerId = authResult.user.id;
    const role = await getUserRole(viewerId);
    const isStaff = role === 'teacher' || role === 'admin' || role === 'superadmin';

    const sp = request.nextUrl.searchParams;
    const targetUserId = sp.get('user_id');
    const type = sp.get('type');
    if (!targetUserId || (type !== 'against' && type !== 'filed')) {
      return NextResponse.json({ success: false, error: 'طلب غير صالح' }, { status: 400 });
    }
    if (targetUserId !== viewerId && !isStaff) {
      return NextResponse.json({ success: false, error: 'غير مصرح' }, { status: 403 });
    }

    let q = supabaseServer
      .from('reports')
      .select('id, report_number, created_at, reason, status, target_type, target_id, reporter_id, assigned_to, description')
      .order('created_at', { ascending: false })
      .limit(200);
    q = type === 'filed'
      ? q.eq('reporter_id', targetUserId)
      : q.eq('target_type', 'user').eq('target_id', targetUserId);
    const { data: rows, error } = await q;
    if (error) {
      return NextResponse.json({ success: false, error: 'فشل جلب السجل' }, { status: 500 });
    }

    let hidden = 0;
    const visible: any[] = [];
    for (const r of rows || []) {
      const viewerIsAccused = r.target_type === 'user' && r.target_id === viewerId;
      const viewerIsReporter = r.reporter_id === viewerId;
      // A "filed" list would reveal who filed a complaint against the viewer: leave those rows out.
      if (type === 'filed' && viewerIsAccused && !viewerIsReporter) { hidden++; continue; }
      // Scope: the platform owner sees everything; a supervisor (admin) sees complaints assigned to
      // them or unassigned; a teacher sees complaints assigned to them or filed by them. Anything
      // outside the viewer's scope is not listed (it only counts in hidden_count).
      const inScope = viewerIsReporter
        || viewerIsAccused
        || role === 'superadmin'
        || r.assigned_to === viewerId
        || (role === 'admin' && !r.assigned_to);
      if (!inScope) { hidden++; continue; }
      const full = true;
      const base: any = {
        id: r.id,
        report_number: r.report_number,
        created_at: r.created_at,
        reason: r.reason,
        status: r.status,
        target_type: r.target_type,
        full,
      };
      if (full) {
        base.description = r.reason === 'تنبيه جهاز مشتبه' && viewerIsAccused
          ? 'تم رصد نشاط غير معتاد على جهاز أو حساب مرتبط بك، وتم رفعه للمراجعة.'
          : r.description;
        // The accused never gets the reporter; everyone else with full access does.
        if (!viewerIsAccused) base.reporter_id = r.reporter_id;
        base.target_id = r.target_id;
      }
      visible.push(base);
    }

    // Names for rows the viewer may see in full
    const ids = new Set<string>();
    visible.forEach((r) => { if (r.full) { if (r.reporter_id) ids.add(r.reporter_id); if (r.target_id) ids.add(r.target_id); } });
    const names = new Map<string, { name: string; role: string }>();
    if (ids.size > 0) {
      const { data: users } = await supabaseServer.from('users').select('id, name, role').in('id', Array.from(ids));
      (users || []).forEach((u: any) => names.set(u.id, { name: u.name, role: u.role }));
    }
    const out = visible.map((r) => {
      if (!r.full) return r;
      const reporter = r.reporter_id ? names.get(r.reporter_id) : null;
      const target = r.target_id ? names.get(r.target_id) : null;
      const { reporter_id, target_id, ...rest } = r;
      return { ...rest, reporter_name: reporter?.name || null, target_name: target?.name || null };
    });

    return NextResponse.json({ success: true, data: { rows: out, hidden_count: hidden, type } });
  } catch (error) {
    console.error('[Reports User History] GET error:', error);
    return NextResponse.json({ success: false, error: 'حدث خطأ غير متوقع' }, { status: 500 });
  }
}

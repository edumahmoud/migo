import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { requireTeacher, authErrorResponse } from '@/lib/auth-helpers';

// Device alerts for the signed-in teacher: only alerts for subjects they teach (admins see all).
// Alerts only flag. Nothing here blocks, grades or penalises a student.

async function allowedSubjectIds(userId: string, role?: string): Promise<string[] | null> {
  if (role === 'admin' || role === 'superadmin') return null; // all
  const [{ data: own }, { data: co }] = await Promise.all([
    supabaseServer.from('subjects').select('id').eq('teacher_id', userId),
    supabaseServer.from('subject_teachers').select('subject_id').eq('teacher_id', userId),
  ]);
  return Array.from(new Set([...(own || []).map((s) => s.id), ...(co || []).map((s) => s.subject_id)]));
}

export async function GET(request: NextRequest) {
  const auth = await requireTeacher(request);
  if (!auth.success) return authErrorResponse(auth);
  try {
    const ids = await allowedSubjectIds(auth.user.id, auth.role);
    if (ids && ids.length === 0) return NextResponse.json({ success: true, alerts: [] });
    const status = request.nextUrl.searchParams.get('status') === 'false_alarm' ? 'false_alarm' : request.nextUrl.searchParams.get('status') === 'all' ? 'all' : 'open';
    let q = supabaseServer.from('cheat_alerts').select('*').order('created_at', { ascending: false }).limit(200);
    if (ids) q = q.in('subject_id', ids);
    if (status !== 'all') q = q.eq('status', status);
    const { data, error } = await q;
    if (error) return NextResponse.json({ success: false, error: 'تعذر تحميل التنبيهات' }, { status: 500 });
    const alerts = data || [];

    const userIds = Array.from(new Set(alerts.flatMap((a) => [a.account_id, a.device_owner_id, a.other_account_id]).filter(Boolean))) as string[];
    const subjectIds = Array.from(new Set(alerts.map((a) => a.subject_id).filter(Boolean))) as string[];
    const users: Record<string, { name?: string; email?: string }> = {};
    const subjects: Record<string, string> = {};
    if (userIds.length) {
      const { data: us } = await supabaseServer.from('users').select('id,name,email').in('id', userIds);
      for (const u of us || []) users[u.id] = { name: u.name, email: u.email };
    }
    if (subjectIds.length) {
      const { data: ss } = await supabaseServer.from('subjects').select('id,name').in('id', subjectIds);
      for (const s of ss || []) subjects[s.id] = s.name;
    }
    const nm = (id?: string | null) => (id ? users[id] || null : null);
    return NextResponse.json({
      success: true,
      alerts: alerts.map((a) => ({
        ...a,
        subject_name: a.subject_id ? subjects[a.subject_id] ?? null : null,
        account: nm(a.account_id), device_owner: nm(a.device_owner_id), other_account: nm(a.other_account_id),
      })),
    });
  } catch (e) {
    console.error('[cheat-alerts] list error:', e);
    return NextResponse.json({ success: false, error: 'حدث خطأ غير متوقع' }, { status: 500 });
  }
}

// Teacher marks an alert as a false alarm (or reopens it). The alert is kept, never deleted.
export async function PATCH(request: NextRequest) {
  const auth = await requireTeacher(request);
  if (!auth.success) return authErrorResponse(auth);
  try {
    const body = await request.json().catch(() => ({} as Record<string, unknown>));
    const id = typeof body.id === 'string' ? body.id : '';
    const status = body.status === 'open' ? 'open' : 'false_alarm';
    if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ success: false, error: 'طلب غير صالح' }, { status: 400 });
    const ids = await allowedSubjectIds(auth.user.id, auth.role);
    const { data: alert } = await supabaseServer.from('cheat_alerts').select('id,subject_id,details').eq('id', id).maybeSingle();
    if (!alert || (ids && !(alert.subject_id && ids.includes(alert.subject_id)))) {
      return NextResponse.json({ success: false, error: 'غير مصرح' }, { status: 403 });
    }
    const esc = (alert.details as Record<string, unknown> | null)?.escalations;
    if (Array.isArray(esc) && esc.length > 0) {
      return NextResponse.json({ success: false, error: 'تم تحويل هذا التنبيه، ولم يعد القرار فيه لك' }, { status: 409 });
    }
    const { error } = await supabaseServer.from('cheat_alerts').update({
      status, reviewed_by: status === 'false_alarm' ? auth.user.id : null, reviewed_at: status === 'false_alarm' ? new Date().toISOString() : null,
    }).eq('id', id);
    if (error) return NextResponse.json({ success: false, error: 'تعذر التحديث' }, { status: 500 });
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('[cheat-alerts] update error:', e);
    return NextResponse.json({ success: false, error: 'حدث خطأ غير متوقع' }, { status: 500 });
  }
}

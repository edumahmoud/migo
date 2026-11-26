import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { requireTeacher, authErrorResponse } from '@/lib/auth-helpers';
import { notifyUser } from '@/lib/notifications-service';

// Teacher "Take action" on a device alert: escalate to the linked platform supervisor, or hand off to the
// registration agent who enrolled the student. Direct actions (suspend) use /api/teacher/students/[id]/suspend.
// Nothing here blocks or penalises a student automatically.

async function allowedSubjectIds(userId: string, role?: string): Promise<string[] | null> {
  if (role === 'admin' || role === 'superadmin') return null;
  const [{ data: own }, { data: co }] = await Promise.all([
    supabaseServer.from('subjects').select('id').eq('teacher_id', userId),
    supabaseServer.from('subject_teachers').select('subject_id').eq('teacher_id', userId),
  ]);
  return Array.from(new Set([...(own || []).map((s) => s.id), ...(co || []).map((s) => s.subject_id)]));
}

export async function POST(request: NextRequest) {
  const auth = await requireTeacher(request);
  if (!auth.success) return authErrorResponse(auth);
  try {
    const body = await request.json().catch(() => ({} as Record<string, unknown>));
    const id = typeof body.id === 'string' ? body.id : '';
    const action = body.action === 'handoff_agent' ? 'handoff_agent' : body.action === 'escalate_admin' ? 'escalate_admin' : '';
    const note = typeof body.note === 'string' ? body.note.trim().slice(0, 500) : '';
    if (!/^[0-9a-f-]{36}$/i.test(id) || !action) return NextResponse.json({ success: false, error: 'طلب غير صالح' }, { status: 400 });

    const ids = await allowedSubjectIds(auth.user.id, auth.role);
    const { data: alert } = await supabaseServer.from('cheat_alerts').select('*').eq('id', id).maybeSingle();
    if (!alert || (ids && !(alert.subject_id && ids.includes(alert.subject_id)))) {
      return NextResponse.json({ success: false, error: 'غير مصرح' }, { status: 403 });
    }

    const { data: acct } = alert.account_id
      ? await supabaseServer.from('users').select('name,email').eq('id', alert.account_id).maybeSingle()
      : { data: null };
    const { data: subj } = alert.subject_id
      ? await supabaseServer.from('subjects').select('name').eq('id', alert.subject_id).maybeSingle()
      : { data: null };
    const { data: me } = await supabaseServer.from('users').select('name').eq('id', auth.user.id).maybeSingle();
    const teacherName = me?.name || 'معلم';
    const kindLabels: Record<string, string> = {
      device_owner_mismatch: 'جهاز صاحبه مختلف عن الحساب المستخدم',
      device_shared_in_session: 'نفس الجهاز لحسابين في نفس الجلسة',
      account_on_two_devices: 'نفس الحساب على جهازين',
      unusual_device: 'جهاز غير معتاد للطالب',
      many_devices_or_ips: 'تغيّر كثير في الأجهزة أو الـ IP',
    };
    const studentLabel = acct?.name ? (acct.email ? `${acct.name} (${acct.email})` : acct.name) : (acct?.email || 'غير معروف');
    const detailLines = [
      `الطالب: ${studentLabel}`,
      subj?.name ? `المادة: ${subj.name}` : '',
      `نوع التنبيه: ${kindLabels[alert.kind as string] || alert.kind}`,
      alert.context_label ? `السياق: ${alert.context_label}` : '',
      alert.summary ? `التفاصيل: ${alert.summary}` : '',
      note ? `ملاحظة المعلم: ${note}` : '',
    ].filter(Boolean);
    const text = detailLines.join('\n');

    let recipients: string[] = [];
    let kind = '';
    if (action === 'escalate_admin') {
      kind = 'admin';
      const { data: links } = await supabaseServer.from('teacher_supervisor_links').select('supervisor_id').eq('teacher_id', auth.user.id);
      recipients = Array.from(new Set((links || []).map((l) => l.supervisor_id).filter(Boolean)));
      if (recipients.length === 0) {
        const { data: admins } = await supabaseServer.from('users').select('id').eq('role', 'superadmin');
        recipients = (admins || []).map((a) => a.id);
      }
      // Also open a report so it appears in the supervisor's reports inbox.
      const { data: createdReport } = await supabaseServer.from('reports').insert({
        reporter_id: auth.user.id, target_type: 'user', target_id: alert.account_id || null,
        reason: 'تنبيه جهاز مشتبه', description: text, status: 'pending',
      }).select('id, report_number').maybeSingle();
      reportId = createdReport?.id || null;
      reportNumber = createdReport?.report_number || null;
    } else {
      kind = 'agent';
      if (alert.account_id && alert.subject_id) {
        const { data: enr } = await supabaseServer.from('subject_students').select('enrollment_agent_id')
          .eq('student_id', alert.account_id).eq('subject_id', alert.subject_id).maybeSingle();
        if (enr?.enrollment_agent_id) {
          const { data: ag } = await supabaseServer.from('registration_agents').select('user_id,is_active').eq('id', enr.enrollment_agent_id).maybeSingle();
          if (ag?.user_id && ag.is_active) recipients = [ag.user_id];
        }
      }
    }
    if (kind === 'agent' && recipients.length === 0) {
      // Fallback: the teacher's own active registration agents (the delegates working under this teacher).
      const { data: mine } = await supabaseServer.from('registration_agents').select('user_id').eq('teacher_id', auth.user.id).eq('is_active', true);
      recipients = Array.from(new Set((mine || []).map((a) => a.user_id).filter(Boolean))) as string[];
    }
    if (recipients.length === 0) {
      return NextResponse.json({ success: false, error: kind === 'agent' ? 'لا يوجد وكيل مرتبط بتسجيل هذا الطالب' : 'لا يوجد مشرف' }, { status: 404 });
    }
    for (const r of recipients) {
      await notifyUser(r, 'system', 'تحويل تنبيه جهاز من معلم', text, undefined);
    }
    const prev = Array.isArray((alert.details as Record<string, unknown> | null)?.escalations) ? ((alert.details as Record<string, unknown>).escalations as unknown[]) : [];
    await supabaseServer.from('cheat_alerts').update({
      details: { ...(alert.details || {}), escalations: [...prev, { to: kind, by: auth.user.id, at: new Date().toISOString(), note: note || null }] },
    }).eq('id', id);
    return NextResponse.json({ success: true, notified: recipients.length, to: kind });
  } catch (e) {
    console.error('[cheat-alerts] action error:', e);
    return NextResponse.json({ success: false, error: 'حدث خطأ غير متوقع' }, { status: 500 });
  }
}

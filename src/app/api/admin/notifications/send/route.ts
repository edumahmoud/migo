import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helpers';
import { insertNotificationsAndPush } from '@/lib/notifications-service';

/**
 * Admin: send a notification to a chosen audience.
 *   GET  ?resource=subjects            -> subjects for the audience picker
 *   GET  ?resource=users&q=text        -> user search (name / email / code) for the "specific users" audience
 *   GET  ?resource=history             -> last 100 sends (log) with sender name
 *   POST { resendLogId, dryRun? }      -> resend a logged notification to its audience
 *   POST { audience, title, message, link?, subjectId?, userIds?, dryRun? }
 *        audience: all | teachers | students | admins | subject | users
 *        dryRun=true only returns the recipient count (used by the confirmation step).
 * Each recipient gets an in-app notification row (the DB trigger sends the Android push) plus web push.
 */

export const maxDuration = 60;

const AUDIENCES = ['all', 'teachers', 'students', 'admins', 'subject', 'users'] as const;
type Audience = (typeof AUDIENCES)[number];
const MAX_USER_IDS = 500;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function resolveRecipients(audience: Audience, subjectId?: string, userIds?: string[]): Promise<string[]> {
  if (audience === 'users') {
    const ids = [...new Set((userIds ?? []).filter((id) => UUID_RE.test(id)))].slice(0, MAX_USER_IDS);
    if (ids.length === 0) return [];
    const { data } = await supabaseServer.from('users').select('id').in('id', ids);
    return (data ?? []).map((u: { id: string }) => u.id);
  }

  if (audience === 'subject') {
    if (!subjectId || !UUID_RE.test(subjectId)) return [];
    const { data } = await supabaseServer
      .from('subject_students')
      .select('student_id')
      .eq('subject_id', subjectId)
      .eq('status', 'approved');
    return [...new Set((data ?? []).map((r: { student_id: string }) => r.student_id))];
  }

  const roles =
    audience === 'teachers' ? ['teacher'] :
    audience === 'students' ? ['student'] :
    audience === 'admins' ? ['admin', 'superadmin'] :
    null; // all

  const ids: string[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    let q = supabaseServer.from('users').select('id').order('id').range(from, from + PAGE - 1);
    if (roles) q = q.in('role', roles);
    const { data, error } = await q;
    if (error || !data || data.length === 0) break;
    ids.push(...data.map((u: { id: string }) => u.id));
    if (data.length < PAGE) break;
  }
  return ids;
}

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.success) return authErrorResponse(auth);

  const resource = request.nextUrl.searchParams.get('resource');
  if (resource === 'subjects') {
    const { data, error } = await supabaseServer
      .from('subjects')
      .select('id, name, level, sub_level')
      .order('name')
      .limit(500);
    if (error) return NextResponse.json({ success: false, error: 'تعذر تحميل المواد' }, { status: 500 });
    return NextResponse.json({ success: true, data });
  }

  if (resource === 'users') {
    const raw = (request.nextUrl.searchParams.get('q') ?? '').trim().slice(0, 60);
    if (raw.length < 2) return NextResponse.json({ success: true, data: [] });
    const q = raw.replace(/[%,()*]/g, ' ');
    const { data, error } = await supabaseServer
      .from('users')
      .select('id, name, email, role, student_code, teacher_code')
      .or(`name.ilike.%${q}%,email.ilike.%${q}%,student_code.ilike.%${q}%,teacher_code.ilike.%${q}%`)
      .limit(20);
    if (error) return NextResponse.json({ success: false, error: 'تعذر البحث' }, { status: 500 });
    return NextResponse.json({ success: true, data });
  }

  if (resource === 'history') {
    const { data, error } = await supabaseServer
      .from('admin_notification_log')
      .select('id, sender_id, audience, subject_id, user_ids, title, message, link, recipient_count, resent_from, created_at')
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) return NextResponse.json({ success: false, error: 'تعذر تحميل السجل' }, { status: 500 });
    const senderIds = [...new Set((data ?? []).map((r: { sender_id: string | null }) => r.sender_id).filter(Boolean))] as string[];
    const names: Record<string, string> = {};
    if (senderIds.length) {
      const { data: us } = await supabaseServer.from('users').select('id, name').in('id', senderIds);
      for (const u of us ?? []) names[(u as { id: string }).id] = (u as { name: string }).name;
    }
    return NextResponse.json({
      success: true,
      data: (data ?? []).map((r: { sender_id: string | null }) => ({ ...r, sender_name: r.sender_id ? names[r.sender_id] ?? null : null })),
    });
  }

  return NextResponse.json({ success: false, error: 'resource غير معروف' }, { status: 400 });
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.success) return authErrorResponse(auth);

  try {
    let body = await request.json();
    let resentFrom: string | null = null;
    if (body.resendLogId) {
      // Resend a past notification: same audience (re-resolved against current users), same text.
      const logId = String(body.resendLogId);
      if (!UUID_RE.test(logId)) return NextResponse.json({ success: false, error: 'معرّف غير صحيح' }, { status: 400 });
      const { data: old } = await supabaseServer.from('admin_notification_log').select('*').eq('id', logId).maybeSingle();
      if (!old) return NextResponse.json({ success: false, error: 'الإشعار غير موجود في السجل' }, { status: 404 });
      body = {
        audience: old.audience, subjectId: old.subject_id ?? undefined, userIds: old.user_ids ?? undefined,
        title: old.title, message: old.message, link: old.link ?? undefined, dryRun: body.dryRun === true,
      };
      resentFrom = logId;
    }
    const audience = body.audience as Audience;
    const title = String(body.title ?? '').trim().slice(0, 200);
    const message = String(body.message ?? '').trim().slice(0, 1000);
    const link = body.link ? String(body.link).trim().slice(0, 300) : 'notifications';
    const dryRun = body.dryRun === true;

    if (!AUDIENCES.includes(audience)) {
      return NextResponse.json({ success: false, error: 'الفئة غير صحيحة' }, { status: 400 });
    }
    if (!dryRun && (!title || !message)) {
      return NextResponse.json({ success: false, error: 'العنوان والرسالة مطلوبان' }, { status: 400 });
    }

    const recipients = await resolveRecipients(audience, body.subjectId, Array.isArray(body.userIds) ? body.userIds : undefined);

    if (dryRun) {
      return NextResponse.json({ success: true, count: recipients.length });
    }
    if (recipients.length === 0) {
      return NextResponse.json({ success: false, error: 'لا يوجد مستلمون في هذه الفئة' }, { status: 400 });
    }

    const sent = await insertNotificationsAndPush(recipients, 'system', title, message, link);
    if (sent === 0) {
      return NextResponse.json({ success: false, error: 'تعذر إرسال الإشعارات' }, { status: 500 });
    }
    const { error: logErr } = await supabaseServer.from('admin_notification_log').insert({
      sender_id: auth.user.id,
      audience,
      subject_id: audience === 'subject' ? body.subjectId : null,
      user_ids: audience === 'users' ? recipients : null,
      title, message, link,
      recipient_count: sent,
      resent_from: resentFrom,
    });
    if (logErr) console.error('[admin/notifications/send] log insert failed:', logErr.message);
    return NextResponse.json({ success: true, count: sent, requested: recipients.length });
  } catch (err) {
    console.error('[admin/notifications/send] failed:', err);
    return NextResponse.json({ success: false, error: 'حدث خطأ غير متوقع' }, { status: 500 });
  }
}

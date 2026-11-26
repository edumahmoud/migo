import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { requireSuperAdmin, authErrorResponse } from '@/lib/auth-helpers';
import { describeRequestDevice } from '@/lib/audit-context';

// Super-admin only: shared lab devices. A lab is registered by its public IP or IP range, and/or by registering
// individual lab machines (their device ID). Devices from a lab are "shared": no owner-mismatch cheating alerts.
// A MAC address cannot be read from a browser or app, so it is not used.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IPV4 = /^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$/;
const IPV6 = /^[0-9a-f:]+(\/\d{1,3})?$/i;
const str = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const validIp = (s: string) => (IPV4.test(s) && s.split('/')[0].split('.').every((n) => Number(n) <= 255)) || (s.includes(':') && IPV6.test(s));

async function logLab(request: NextRequest, actor: { id: string; email?: string }, action: string, targetId: string | null, label: string | null, after: unknown) {
  const d = describeRequestDevice(request);
  await supabaseServer.from('audit_events').insert({
    category: 'security', action, severity: 'notice', actor_id: actor.id, actor_email: actor.email ?? null,
    target_type: 'shared_lab', target_id: targetId, target_label: label, after_data: after ?? null,
    ip_address: d.ip, user_agent: d.userAgent, device_type: d.deviceType, os_name: d.os, browser_name: d.browser,
    device_id: d.deviceId, client_type: d.client, request_id: d.requestId, source: 'api',
  });
}

export async function GET(request: NextRequest) {
  const auth = await requireSuperAdmin(request);
  if (!auth.success) return authErrorResponse(auth);
  const d = describeRequestDevice(request);
  const [{ data: labs, error }, { data: devs }] = await Promise.all([
    supabaseServer.from('shared_labs').select('*').order('created_at', { ascending: false }),
    supabaseServer.from('device_registry').select('device_id,lab_id,label,last_seen,is_shared').not('lab_id', 'is', null),
  ]);
  if (error) return NextResponse.json({ success: false, error: 'تعذر تحميل المعامل' }, { status: 500 });
  let current: { deviceId: string; isShared: boolean; labId: string | null } | null = null;
  if (d.deviceId) {
    const { data: cur } = await supabaseServer.from('device_registry').select('is_shared,lab_id').eq('device_id', d.deviceId).maybeSingle();
    current = { deviceId: d.deviceId, isShared: !!cur?.is_shared, labId: cur?.lab_id ?? null };
  }
  return NextResponse.json({
    success: true,
    labs: (labs || []).map((l) => ({ ...l, devices: (devs || []).filter((x) => x.lab_id === l.id) })),
    currentDevice: current,
  });
}

export async function POST(request: NextRequest) {
  const auth = await requireSuperAdmin(request);
  if (!auth.success) return authErrorResponse(auth);
  const body = await request.json().catch(() => ({} as Record<string, unknown>));

  // "Register this device as a lab device": run once on each lab machine.
  if (body.action === 'register_device') {
    const labId = typeof body.labId === 'string' ? body.labId : '';
    const d = describeRequestDevice(request);
    if (!UUID.test(labId)) return NextResponse.json({ success: false, error: 'اختر المعمل' }, { status: 400 });
    if (!d.deviceId) return NextResponse.json({ success: false, error: 'تعذر تحديد معرّف هذا الجهاز. حدّث الصفحة وحاول مرة أخرى.' }, { status: 400 });
    const { data: lab } = await supabaseServer.from('shared_labs').select('id,name').eq('id', labId).maybeSingle();
    if (!lab) return NextResponse.json({ success: false, error: 'المعمل غير موجود' }, { status: 404 });
    const label = [d.deviceType, d.os, d.browser].filter(Boolean).join(' / ');
    const { error } = await supabaseServer.from('device_registry').upsert({
      device_id: d.deviceId, is_shared: true, lab_id: labId, shared_note: lab.name, label: `${lab.name} - ${label}`,
      device_type: d.deviceType, os_name: d.os, browser_name: d.browser, client_type: d.client, last_ip: d.ip, last_seen: new Date().toISOString(),
    }, { onConflict: 'device_id' });
    if (error) return NextResponse.json({ success: false, error: 'تعذر تسجيل الجهاز' }, { status: 500 });
    await logLab(request, auth.user, 'lab.device_registered', labId, lab.name, { device_id: d.deviceId, label });
    return NextResponse.json({ success: true });
  }

  const name = str(body.name, 120);
  const ip = str(body.ipCidr, 64);
  if (!name) return NextResponse.json({ success: false, error: 'اسم المعمل مطلوب' }, { status: 400 });
  if (ip && !validIp(ip)) return NextResponse.json({ success: false, error: 'صيغة الـ IP غير صحيحة' }, { status: 400 });
  const row = { name, location: str(body.location, 200), notes: str(body.notes, 1000), ip_cidr: ip, created_by: auth.user.id };
  const { data, error } = await supabaseServer.from('shared_labs').insert(row).select().single();
  if (error || !data) return NextResponse.json({ success: false, error: 'تعذر إضافة المعمل (تأكد من صيغة الـ IP)' }, { status: 400 });
  await logLab(request, auth.user, 'lab.created', data.id, name, row);
  return NextResponse.json({ success: true, lab: data });
}

export async function PATCH(request: NextRequest) {
  const auth = await requireSuperAdmin(request);
  if (!auth.success) return authErrorResponse(auth);
  const body = await request.json().catch(() => ({} as Record<string, unknown>));
  const id = typeof body.id === 'string' ? body.id : '';
  if (!UUID.test(id)) return NextResponse.json({ success: false, error: 'طلب غير صالح' }, { status: 400 });
  const name = str(body.name, 120);
  const ip = str(body.ipCidr, 64);
  if (!name) return NextResponse.json({ success: false, error: 'اسم المعمل مطلوب' }, { status: 400 });
  if (ip && !validIp(ip)) return NextResponse.json({ success: false, error: 'صيغة الـ IP غير صحيحة' }, { status: 400 });
  const { data: before } = await supabaseServer.from('shared_labs').select('*').eq('id', id).maybeSingle();
  const patch = { name, location: str(body.location, 200), notes: str(body.notes, 1000), ip_cidr: ip, updated_at: new Date().toISOString() };
  const { error } = await supabaseServer.from('shared_labs').update(patch).eq('id', id);
  if (error) return NextResponse.json({ success: false, error: 'تعذر التعديل' }, { status: 400 });
  await logLab(request, auth.user, 'lab.updated', id, name, { before, after: patch });
  return NextResponse.json({ success: true });
}

export async function DELETE(request: NextRequest) {
  const auth = await requireSuperAdmin(request);
  if (!auth.success) return authErrorResponse(auth);
  const id = request.nextUrl.searchParams.get('id') || '';
  const deviceId = request.nextUrl.searchParams.get('deviceId');
  if (!UUID.test(id)) return NextResponse.json({ success: false, error: 'طلب غير صالح' }, { status: 400 });
  const { data: lab } = await supabaseServer.from('shared_labs').select('*').eq('id', id).maybeSingle();
  if (!lab) return NextResponse.json({ success: false, error: 'غير موجود' }, { status: 404 });

  // Remove one registered machine from the lab, or the whole lab (its machines stop being shared).
  if (deviceId) {
    await supabaseServer.from('device_registry').update({ is_shared: false, lab_id: null, shared_note: null }).eq('device_id', deviceId).eq('lab_id', id);
    await logLab(request, auth.user, 'lab.device_removed', id, lab.name, { device_id: deviceId });
    return NextResponse.json({ success: true });
  }
  await supabaseServer.from('device_registry').update({ is_shared: false, shared_note: null }).eq('lab_id', id);
  const { error } = await supabaseServer.from('shared_labs').delete().eq('id', id);
  if (error) return NextResponse.json({ success: false, error: 'تعذر الحذف' }, { status: 500 });
  await logLab(request, auth.user, 'lab.deleted', id, lab.name, lab);
  return NextResponse.json({ success: true });
}

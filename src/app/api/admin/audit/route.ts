import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { requireSuperAdmin, authErrorResponse } from '@/lib/auth-helpers';
import { describeRequestDevice } from '@/lib/audit-context';

// Super-admin only. Lists, filters, exports and integrity-checks the audit log.
// Nothing here can change or delete an event: the table is append-only in the database.

const MAX_PAGE_SIZE = 100;
const EXPORT_LIMIT = 5000;

const clean = (s: string | null, max = 100): string => (s || '').replace(/[^\p{L}\p{N}@._+\- :]/gu, '').slice(0, max).trim();
const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

// CSV cells that start with a formula character are prefixed so spreadsheets do not run them.
function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}

async function recordAdminAction(request: NextRequest, actor: { id: string; email?: string }, action: string, metadata: Record<string, unknown>) {
  const d = describeRequestDevice(request);
  await supabaseServer.from('audit_events').insert({
    category: 'system', action, severity: 'notice', actor_id: actor.id, actor_email: actor.email ?? null,
    target_type: 'audit_events', metadata, ip_address: d.ip, user_agent: d.userAgent, device_type: d.deviceType,
    os_name: d.os, browser_name: d.browser, device_id: d.deviceId, client_type: d.client, request_id: d.requestId, source: 'api',
  });
}

export async function GET(request: NextRequest) {
  const auth = await requireSuperAdmin(request);
  if (!auth.success) return authErrorResponse(auth);
  const sp = request.nextUrl.searchParams;

  try {
    // ── integrity check ──
    if (sp.get('verify') === '1') {
      const { data, error } = await supabaseServer.rpc('audit_verify_chain');
      if (error) return NextResponse.json({ success: false, error: 'تعذر فحص السلامة' }, { status: 500 });
      const row = Array.isArray(data) ? data[0] : data;
      await recordAdminAction(request, auth.user, 'audit.integrity_checked', { ok: row?.ok, checked: row?.checked });
      return NextResponse.json({ success: true, integrity: row });
    }

    // ── summary cards ──
    if (sp.get('stats') === '1') {
      const since = new Date(Date.now() - 24 * 3600_000).toISOString();
      const c = (q: { count: number | null }) => q.count ?? 0;
      const [total, last24, crit24, failed24, newDev24] = await Promise.all([
        supabaseServer.from('audit_events').select('id', { count: 'exact', head: true }),
        supabaseServer.from('audit_events').select('id', { count: 'exact', head: true }).gte('occurred_at', since),
        supabaseServer.from('audit_events').select('id', { count: 'exact', head: true }).gte('occurred_at', since).eq('severity', 'critical'),
        supabaseServer.from('audit_events').select('id', { count: 'exact', head: true }).gte('occurred_at', since).eq('action', 'auth.login_failed'),
        supabaseServer.from('audit_events').select('id', { count: 'exact', head: true }).gte('occurred_at', since).eq('action', 'auth.login_success').eq('severity', 'notice'),
      ]);
      return NextResponse.json({
        success: true,
        stats: { total: c(total), last24h: c(last24), critical24h: c(crit24), failedLogins24h: c(failed24), newDeviceLogins24h: c(newDev24) },
      });
    }

    // ── list / export ──
    const isCsv = sp.get('format') === 'csv';
    const page = Math.max(1, parseInt(sp.get('page') || '1', 10) || 1);
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(sp.get('pageSize') || '25', 10) || 25));

    let q = supabaseServer.from('audit_events').select('*', { count: 'exact' }).order('seq', { ascending: false });
    const category = clean(sp.get('category'), 30);
    const outcome = clean(sp.get('outcome'), 20);
    const severity = clean(sp.get('severity'), 20);
    const action = clean(sp.get('action'), 60);
    const actor = clean(sp.get('actor'), 120);
    const ip = clean(sp.get('ip'), 64);
    const deviceId = clean(sp.get('deviceId'), 80);
    const text = clean(sp.get('q'), 120);
    const from = sp.get('from');
    const to = sp.get('to');
    if (category) q = q.eq('category', category);
    if (outcome) q = q.eq('outcome', outcome);
    if (severity) q = q.eq('severity', severity);
    if (action) q = q.ilike('action', `%${action}%`);
    if (actor) q = isUuid(actor) ? q.eq('actor_id', actor) : q.ilike('actor_email', `%${actor}%`);
    if (ip) q = q.ilike('ip_address', `${ip}%`);
    if (deviceId) q = q.eq('device_id', deviceId);
    if (text) q = q.or(`target_label.ilike.%${text}%,action.ilike.%${text}%,target_id.ilike.%${text}%`);
    if (from && !Number.isNaN(Date.parse(from))) q = q.gte('occurred_at', new Date(from).toISOString());
    if (to && !Number.isNaN(Date.parse(to))) q = q.lte('occurred_at', new Date(to).toISOString());

    q = isCsv ? q.range(0, EXPORT_LIMIT - 1) : q.range((page - 1) * pageSize, page * pageSize - 1);
    const { data, count, error } = await q;
    if (error) {
      console.error('[audit] list error:', error.message);
      return NextResponse.json({ success: false, error: 'تعذر تحميل السجل' }, { status: 500 });
    }
    const rows = data || [];

    // Add the actor's current name and role (the log itself keeps only id and email as they were).
    const ids = Array.from(new Set(rows.map((r) => r.actor_id).filter(Boolean))) as string[];
    const actors: Record<string, { name?: string; role?: string }> = {};
    if (ids.length) {
      const { data: us } = await supabaseServer.from('users').select('id,name,role').in('id', ids);
      for (const u of us || []) actors[u.id] = { name: u.name, role: u.role };
    }

    if (isCsv) {
      await recordAdminAction(request, auth.user, 'audit.exported', { rows: rows.length, filters: { category, outcome, severity, action, actor, ip, deviceId, text, from, to } });
      const cols = ['seq', 'occurred_at', 'severity', 'outcome', 'category', 'action', 'actor_id', 'actor_email', 'target_type', 'target_id', 'target_label', 'reason', 'ip_address', 'device_type', 'os_name', 'browser_name', 'device_id', 'client_type', 'mac_address', 'user_agent', 'changed_fields', 'before_data', 'after_data', 'metadata', 'row_hash'];
      const lines = [cols.join(',')].concat(rows.map((r) => cols.map((c) => csvCell((r as Record<string, unknown>)[c])).join(',')));
      return new NextResponse('\uFEFF' + lines.join('\r\n'), {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="audit-log-${new Date().toISOString().slice(0, 10)}.csv"`,
          'Cache-Control': 'no-store',
        },
      });
    }

    return NextResponse.json({
      success: true,
      events: rows.map((r) => ({ ...r, actor_name: r.actor_id ? actors[r.actor_id]?.name ?? null : null, actor_current_role: r.actor_id ? actors[r.actor_id]?.role ?? null : null })),
      total: count ?? 0,
      page,
      pageSize,
    });
  } catch (e) {
    console.error('[audit] admin route error:', e);
    return NextResponse.json({ success: false, error: 'حدث خطأ غير متوقع' }, { status: 500 });
  }
}

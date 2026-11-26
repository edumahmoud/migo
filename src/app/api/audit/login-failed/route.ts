import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { describeRequestDevice } from '@/lib/audit-context';

// Records a failed login attempt. There is no session yet, so this endpoint is public.
// It stores only the attempted email (never the password), the reason class, and the device details.
// Abuse guard: at most 30 failed-login events per IP per minute are stored.
const REASONS = new Set(['invalid_credentials', 'rate_limited', 'banned', 'unconfirmed', 'unknown']);

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({} as Record<string, unknown>));
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase().slice(0, 200) : '';
    const reason = typeof body.reason === 'string' && REASONS.has(body.reason) ? body.reason : 'unknown';
    const method = typeof body.method === 'string' ? body.method.slice(0, 30) : 'password';
    const d = describeRequestDevice(request);

    if (d.ip) {
      const since = new Date(Date.now() - 60_000).toISOString();
      const { count } = await supabaseServer
        .from('audit_events')
        .select('id', { count: 'exact', head: true })
        .eq('action', 'auth.login_failed')
        .eq('ip_address', d.ip)
        .gte('occurred_at', since);
      if ((count ?? 0) >= 30) return NextResponse.json({ success: true, throttled: true });
    }

    // Repeated failures for the same email raise the severity.
    let severity: 'warning' | 'critical' = 'warning';
    let recent = 0;
    if (email) {
      const since = new Date(Date.now() - 15 * 60_000).toISOString();
      const { count } = await supabaseServer
        .from('audit_events')
        .select('id', { count: 'exact', head: true })
        .eq('action', 'auth.login_failed')
        .eq('actor_email', email)
        .gte('occurred_at', since);
      recent = (count ?? 0) + 1;
      if (recent >= 5) severity = 'critical';
    }

    const { error } = await supabaseServer.from('audit_events').insert({
      category: 'auth',
      action: 'auth.login_failed',
      outcome: 'failure',
      severity,
      actor_email: email || null,
      target_type: 'user',
      target_label: email || null,
      reason,
      metadata: { method, failures_last_15min: recent },
      ip_address: d.ip,
      user_agent: d.userAgent,
      device_type: d.deviceType,
      os_name: d.os,
      browser_name: d.browser,
      device_id: d.deviceId,
      client_type: d.client,
      request_id: d.requestId,
      source: 'api',
    });
    if (error) console.error('[audit] login failed insert failed:', error.message);
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('[audit] login failed error:', e);
    return NextResponse.json({ success: true });
  }
}

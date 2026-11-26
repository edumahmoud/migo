import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateRequest, authErrorResponse } from '@/lib/auth-helpers';
import { describeRequestDevice } from '@/lib/audit-context';

// Records a successful login. Called by the login screen right after Supabase accepted the credentials.
// The caller must hold a valid session, so nobody can write a "success" event for someone else.
export async function POST(request: NextRequest) {
  const authResult = await authenticateRequest(request);
  if (!authResult.success) return authErrorResponse(authResult);

  try {
    const body = await request.json().catch(() => ({} as Record<string, unknown>));
    const method = typeof body.method === 'string' ? body.method.slice(0, 30) : 'password';
    const d = describeRequestDevice(request);
    const user = authResult.user;

    // Is this device new for this account? (useful for later device-based alerts)
    let newDevice: boolean | null = null;
    if (d.deviceId) {
      const { count } = await supabaseServer
        .from('audit_events')
        .select('id', { count: 'exact', head: true })
        .eq('action', 'auth.login_success')
        .eq('actor_id', user.id)
        .eq('device_id', d.deviceId);
      newDevice = (count ?? 0) === 0;
    }

    // Device registry: the first account to sign in on a device becomes its owner (used by the cheating alerts).
    if (d.deviceId) {
      const label = [d.deviceType, d.os, d.browser].filter(Boolean).join(' / ');
      const { error: regError } = await supabaseServer.rpc('device_register', {
        p_user: user.id, p_device: d.deviceId, p_ip: d.ip, p_label: label, p_dtype: d.deviceType, p_os: d.os, p_browser: d.browser, p_client: d.client,
      });
      if (regError) console.error('[audit] device register failed:', regError.message);
    }

    const { error } = await supabaseServer.from('audit_events').insert({
      category: 'auth',
      action: 'auth.login_success',
      outcome: 'success',
      severity: newDevice ? 'notice' : 'info',
      actor_id: user.id,
      actor_email: user.email ?? null,
      target_type: 'user',
      target_id: user.id,
      target_label: user.email ?? null,
      metadata: { method, new_device: newDevice },
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
    if (error) {
      console.error('[audit] login success insert failed:', error.message);
      return NextResponse.json({ success: false }, { status: 500 });
    }
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('[audit] login success error:', e);
    return NextResponse.json({ success: false }, { status: 500 });
  }
}

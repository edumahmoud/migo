import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateRequest, authErrorResponse } from '@/lib/auth-helpers';
import { describeRequestDevice } from '@/lib/audit-context';

// Records a logout. The caller must still hold a valid session (the client sends its token just before signing out).
export async function POST(request: NextRequest) {
  const authResult = await authenticateRequest(request);
  if (!authResult.success) return authErrorResponse(authResult);
  try {
    const d = describeRequestDevice(request);
    const user = authResult.user;
    const { error } = await supabaseServer.from('audit_events').insert({
      category: 'auth', action: 'auth.logout', outcome: 'success', severity: 'info',
      actor_id: user.id, actor_email: user.email ?? null, target_type: 'user', target_id: user.id, target_label: user.email ?? null,
      ip_address: d.ip, user_agent: d.userAgent, device_type: d.deviceType, os_name: d.os, browser_name: d.browser,
      device_id: d.deviceId, client_type: d.client, request_id: d.requestId, source: 'api',
    });
    if (error) console.error('[audit] logout insert failed:', error.message);
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('[audit] logout error:', e);
    return NextResponse.json({ success: true });
  }
}

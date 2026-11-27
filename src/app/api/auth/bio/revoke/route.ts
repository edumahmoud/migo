import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateRequest } from '@/lib/auth-helpers';

/** POST /api/auth/bio/revoke (signed in): turns off fingerprint login for this account on all devices. */
export async function POST(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if (!auth.success) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  // Only this device when the device cookie is known (logout, per-phone toggle); otherwise every device of the account.
  const deviceId = describeRequestDevice(request).deviceId;
  let q = supabaseServer
    .from('biometric_credentials')
    .update({ revoked_at: new Date().toISOString() })
    .eq('user_id', auth.user.id)
    .is('revoked_at', null);
  if (deviceId) q = q.eq('device_id', deviceId);
  await q;
  return NextResponse.json({ success: true });
}

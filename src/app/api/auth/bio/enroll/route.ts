import { NextRequest, NextResponse } from 'next/server';
import { createHash, randomBytes } from 'crypto';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateRequest } from '@/lib/auth-helpers';
import { describeRequestDevice } from '@/lib/audit-context';

/**
 * POST /api/auth/bio/enroll (signed in)
 * Creates a random device secret for fingerprint login. The secret is returned once; only its hash is stored.
 * The app keeps the secret behind the phone's fingerprint (Android Keystore). One active credential per user per device.
 */
export async function POST(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if (!auth.success) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });

  const d = describeRequestDevice(request);
  const secret = randomBytes(32).toString('hex');
  const secretHash = createHash('sha256').update(secret).digest('hex');

  if (d.deviceId) {
    await supabaseServer
      .from('biometric_credentials')
      .update({ revoked_at: new Date().toISOString() })
      .eq('user_id', auth.user.id)
      .eq('device_id', d.deviceId)
      .is('revoked_at', null);
  }
  const { error } = await supabaseServer.from('biometric_credentials').insert({
    user_id: auth.user.id,
    secret_hash: secretHash,
    device_id: d.deviceId,
    device_label: [d.os, d.browser].filter(Boolean).join(' ').slice(0, 80) || null,
  });
  if (error) return NextResponse.json({ success: false, error: 'تعذر تفعيل البصمة' }, { status: 500 });
  return NextResponse.json({ success: true, secret });
}

import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateRequest } from '@/lib/auth-helpers';

/** POST /api/auth/bio/revoke (signed in): turns off fingerprint login for this account on all devices. */
export async function POST(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if (!auth.success) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  await supabaseServer
    .from('biometric_credentials')
    .update({ revoked_at: new Date().toISOString() })
    .eq('user_id', auth.user.id)
    .is('revoked_at', null);
  return NextResponse.json({ success: true });
}

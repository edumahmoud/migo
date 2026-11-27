import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { supabaseServer } from '@/lib/supabase-server';

/**
 * POST /api/auth/bio/login  { secret }
 * Public: the secret is a 256-bit random value that the phone only releases after a fingerprint check.
 * If it matches an active credential, returns a one-time token so the client can open a normal Supabase session
 * (verifyOtp). Banned users are refused by Supabase at that step like any other login.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({} as Record<string, unknown>));
  const secret = typeof body.secret === 'string' ? body.secret : '';
  if (!/^[0-9a-f]{64}$/.test(secret)) return NextResponse.json({ success: false, error: 'invalid' }, { status: 401 });
  const secretHash = createHash('sha256').update(secret).digest('hex');

  const { data: cred } = await supabaseServer
    .from('biometric_credentials')
    .select('id, user_id')
    .eq('secret_hash', secretHash)
    .is('revoked_at', null)
    .maybeSingle();
  if (!cred) return NextResponse.json({ success: false, error: 'invalid' }, { status: 401 });

  const { data: u } = await supabaseServer.auth.admin.getUserById(cred.user_id);
  const email = u?.user?.email;
  if (!email) return NextResponse.json({ success: false, error: 'invalid' }, { status: 401 });

  const { data: link, error } = await supabaseServer.auth.admin.generateLink({ type: 'magiclink', email });
  const tokenHash = link?.properties?.hashed_token;
  if (error || !tokenHash) return NextResponse.json({ success: false, error: 'تعذر تسجيل الدخول' }, { status: 500 });

  await supabaseServer.from('biometric_credentials').update({ last_used_at: new Date().toISOString() }).eq('id', cred.id);
  return NextResponse.json({ success: true, email, tokenHash });
}

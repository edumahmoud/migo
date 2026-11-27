import { NextRequest, NextResponse } from 'next/server';
import { scryptSync, timingSafeEqual } from 'crypto';
import { supabaseServer } from '@/lib/supabase-server';
import { checkRateLimitDistributed } from '@/lib/rate-limit-server';

/**
 * POST /api/auth/tg-login/verify  { email, code }
 * Checks the Telegram login code (hashed, 5 minutes, 5 tries, one use). On success returns a one-time token the client
 * trades for a normal Supabase session, the same way fingerprint login does.
 */
export async function POST(request: NextRequest) {
  const bad = NextResponse.json({ success: false, error: 'الكود غير صحيح أو انتهت صلاحيته' }, { status: 401 });
  const ip = await checkRateLimitDistributed(request, { maxRequests: 20, windowMs: 10 * 60_000, scope: 'tg-login-verify-ip' });
  if (!ip.allowed) return NextResponse.json({ success: false, error: 'محاولات كثيرة، حاول بعد شوية' }, { status: 429 });
  const body = await request.json().catch(() => ({} as Record<string, unknown>));
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase().slice(0, 200) : '';
  const code = typeof body.code === 'string' ? body.code.trim() : '';
  if (!email.includes('@') || !/^\d{6}$/.test(code)) return bad;

  const { data: user } = await supabaseServer.from('users').select('id, email').ilike('email', email).maybeSingle();
  if (!user) return bad;
  const { data: row } = await supabaseServer.from('otp_codes').select('id, code_hash, code_salt, expires_at, attempts, max_attempts')
    .eq('user_id', user.id).eq('purpose', 'login').eq('used', false).order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (!row || !row.code_hash || !row.code_salt || new Date(row.expires_at).getTime() < Date.now() || row.attempts >= row.max_attempts) return bad;
  await supabaseServer.from('otp_codes').update({ attempts: row.attempts + 1 }).eq('id', row.id);

  const want = Buffer.from(row.code_hash, 'hex');
  const got = scryptSync(code, row.code_salt, 64);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return bad;
  await supabaseServer.from('otp_codes').update({ used: true }).eq('id', row.id);

  const { data: link, error } = await supabaseServer.auth.admin.generateLink({ type: 'magiclink', email: user.email as string });
  const tokenHash = link?.properties?.hashed_token;
  if (error || !tokenHash) return NextResponse.json({ success: false, error: 'تعذر تسجيل الدخول' }, { status: 500 });
  return NextResponse.json({ success: true, email: user.email, tokenHash });
}

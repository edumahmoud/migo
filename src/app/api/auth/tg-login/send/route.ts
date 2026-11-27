import { NextRequest, NextResponse } from 'next/server';
import { randomBytes, scryptSync } from 'crypto';
import { supabaseServer } from '@/lib/supabase-server';
import { checkRateLimitDistributed } from '@/lib/rate-limit-server';
import { isBotConfigured, sendOtpViaBot } from '@/lib/telegram-bot';

/**
 * POST /api/auth/tg-login/send  { email }
 * Sends a 6-digit login code to the Telegram chat that the user already verified with the same bot (phone verification).
 * The answer is always the same ("sent if possible") so it cannot be used to find out which emails exist.
 */
export async function POST(request: NextRequest) {
  const generic = NextResponse.json({ success: true, message: 'لو حسابك مربوط بتليجرام هيوصلك كود على البوت' });
  const ip = await checkRateLimitDistributed(request, { maxRequests: 10, windowMs: 10 * 60_000, scope: 'tg-login-send-ip' });
  if (!ip.allowed) return NextResponse.json({ success: false, error: 'محاولات كثيرة، حاول بعد شوية' }, { status: 429 });
  const body = await request.json().catch(() => ({} as Record<string, unknown>));
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase().slice(0, 200) : '';
  if (!email.includes('@') || !isBotConfigured()) return generic;

  const { data: user } = await supabaseServer.from('users').select('id, phone, phone_verified').ilike('email', email).maybeSingle();
  if (!user || !user.phone_verified) return generic;
  const per = await checkRateLimitDistributed(request, { userId: user.id, maxRequests: 5, windowMs: 60 * 60_000, scope: 'tg-login-send-user' });
  if (!per.allowed) return generic;

  // The chat the user verified their phone with
  const { data: chat } = await supabaseServer.from('otp_codes').select('telegram_chat_id')
    .eq('user_id', user.id).eq('status', 'verified').not('telegram_chat_id', 'is', null).order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (!chat?.telegram_chat_id) return generic;

  const code = (randomBytes(4).readUInt32BE(0) % 1_000_000).toString().padStart(6, '0');
  const salt = randomBytes(16).toString('hex');
  await supabaseServer.from('otp_codes').update({ used: true }).eq('user_id', user.id).eq('purpose', 'login').eq('used', false);
  const { error } = await supabaseServer.from('otp_codes').insert({
    user_id: user.id, phone: user.phone || '-', purpose: 'login', status: 'otp_only',
    code_hash: scryptSync(code, salt, 64).toString('hex'), code_salt: salt,
    expires_at: new Date(Date.now() + 5 * 60_000).toISOString(), telegram_chat_id: chat.telegram_chat_id,
  });
  if (!error) await sendOtpViaBot(Number(chat.telegram_chat_id), code);
  return generic;
}

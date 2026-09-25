import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { randomBytes, scryptSync } from 'crypto';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateRequest, authErrorResponse } from '@/lib/auth-helpers';
import { normalizePhoneToE164 } from '@/lib/phone-utils';
import { isBotConfigured, getBotUsername } from '@/lib/telegram-bot';

/**
 * POST /api/auth/initiate-telegram-verification
 *
 * Creates a new verification session. Returns a deep link the user
 * should open in Telegram. The webhook at /api/telegram/webhook will
 * receive the user's /start <VERIFY_TOKEN> message, generate the OTP,
 * and send it via the Bot API.
 *
 * Flow:
 *   1. This endpoint creates an otp_codes row with:
 *      - verify_token_hash + verify_token_salt
 *      - status='pending_start'
 *      - verify_expires_at = now + 10 minutes
 *   2. Returns the deep_link: https://t.me/BOT_USERNAME?start=VERIFY_TOKEN
 *   3. Frontend polls /api/auth/verification-status until status='otp_sent'.
 *
 * Security:
 *   - VERIFY_TOKEN is 32 random bytes (256 bits of entropy).
 *   - Stored as scrypt hash + random salt — never in plaintext.
 *   - Session expires in 10 minutes.
 *   - Max 5 sessions per user per hour (rate limit).
 *   - Any previous pending_start session is expired before creating
 *     a new one (prevents confusion).
 *
 * Body: optional { phone?: string } — if provided, updates the user's
 * stored phone (used by the "fix my phone" button on the OTP page).
 */
const VERIFY_TOKEN_BYTES = 32;
const VERIFY_SESSION_MINUTES = 10;
const MAX_SESSIONS_PER_HOUR = 5;

const BodySchema = z.object({
  phone: z.string().trim().min(8).max(20).optional(),
}).optional();

export async function POST(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if (!auth.success) return authErrorResponse(auth);

  if (!isBotConfigured()) {
    return NextResponse.json(
      {
        success: false,
        error: 'البوت غير مُعدّ. أضف TELEGRAM_BOT_TOKEN و TELEGRAM_BOT_USERNAME في متغيرات البيئة.',
      },
      { status: 500 }
    );
  }

  // Parse optional body (phone for update)
  let bodyPhone: string | undefined;
  try {
    const raw = await request.json();
    const parsed = BodySchema.safeParse(raw);
    if (parsed.success && parsed.data?.phone) {
      bodyPhone = parsed.data.phone;
    }
  } catch {
    // body is optional — ignore parse errors
  }

  // 1. Fetch user profile
  const { data: profile, error: profileErr } = await supabaseServer
    .from('users')
    .select('id, phone, account_status, phone_verified')
    .eq('id', auth.user.id)
    .maybeSingle();

  if (profileErr) {
    return NextResponse.json({ success: false, error: profileErr.message }, { status: 500 });
  }
  if (!profile) {
    return NextResponse.json({ success: false, error: 'الملف غير موجود' }, { status: 404 });
  }

  const p = profile as { id: string; phone: string | null; account_status: string; phone_verified: boolean };

  // 2. Resilient OTP gate
  const needsOtp =
    p.account_status === 'pending_verification' ||
    (p.account_status === 'pending' && !!p.phone && p.phone_verified === false);

  if (!needsOtp) {
    return NextResponse.json(
      { success: false, error: 'حسابك لا يحتاج إلى التحقق' },
      { status: 400 }
    );
  }

  // 3. Resolve phone (body > DB). If body phone provided, normalize + persist.
  let phoneToUse = p.phone;
  if (bodyPhone) {
    const normalized = normalizePhoneToE164(bodyPhone);
    if (normalized) {
      phoneToUse = normalized;
      await supabaseServer
        .from('users')
        .update({ phone: normalized, updated_at: new Date().toISOString() })
        .eq('id', p.id);
    } else {
      return NextResponse.json(
        { success: false, error: 'صيغة رقم الهاتف غير صالحة. مثال: +201555614624 أو 01555614624' },
        { status: 400 }
      );
    }
  }
  if (!phoneToUse) {
    return NextResponse.json(
      { success: false, error: 'لا يوجد رقم هاتف مرتبط بحسابك. حدّث رقمك أولاً.' },
      { status: 400 }
    );
  }

  // 4. Rate limit: max 5 sessions per user per hour
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count } = await supabaseServer
    .from('otp_codes')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', p.id)
    .gte('created_at', oneHourAgo);

  if ((count ?? 0) >= MAX_SESSIONS_PER_HOUR) {
    return NextResponse.json(
      { success: false, error: 'تجاوزت الحد الأقصى من جلسات التحقق في هذه الساعة. حاول لاحقاً.' },
      { status: 429 }
    );
  }

  // 5. Expire any previous pending_start sessions for this user
  await supabaseServer
    .from('otp_codes')
    .update({ status: 'expired', updated_at: new Date().toISOString() })
    .eq('user_id', p.id)
    .eq('status', 'pending_start');

  // 6. Generate VERIFY_TOKEN (32 random bytes, base64url)
  const verifyTokenBytes = randomBytes(VERIFY_TOKEN_BYTES);
  const verifyToken = verifyTokenBytes.toString('base64url');
  const verifyTokenSalt = randomBytes(16).toString('hex');
  const verifyTokenHash = scryptSync(verifyToken, verifyTokenSalt, 64).toString('hex');

  // 7. Insert verification session row
  const verifyExpiresAt = new Date(Date.now() + VERIFY_SESSION_MINUTES * 60 * 1000).toISOString();

  const { data: session, error: insertErr } = await supabaseServer
    .from('otp_codes')
    .insert({
      user_id: p.id,
      phone: phoneToUse,
      verify_token_hash: verifyTokenHash,
      verify_token_salt: verifyTokenSalt,
      verify_expires_at: verifyExpiresAt,
      status: 'pending_start',
      max_attempts: 5,
      used: false,
    })
    .select('id')
    .single();

  if (insertErr) {
    return NextResponse.json({ success: false, error: 'فشل إنشاء جلسة التحقق' }, { status: 500 });
  }

  // 8. Build deep link
  const botUsername = getBotUsername();
  const deepLink = `https://t.me/${botUsername}?start=${verifyToken}`;

  return NextResponse.json({
    success: true,
    session_id: (session as { id: string }).id,
    deep_link: deepLink,
    bot_username: botUsername,
    verify_expires_at: verifyExpiresAt,
    message: 'افتح Telegram واضغط Start لإرسال كود التحقق إليك.',
  });
}

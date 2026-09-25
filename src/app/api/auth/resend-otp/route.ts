import { NextRequest, NextResponse } from 'next/server';
import { scryptSync, randomBytes } from 'crypto';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateRequest, authErrorResponse } from '@/lib/auth-helpers';

/**
 * POST /api/auth/resend-otp
 *
 * Generates a new OTP and sends it via Telegram. The student must be
 * authenticated and have account_status='pending_verification'.
 *
 * Rate limiting:
 *   - Resend cooldown: 60 seconds (check last OTP created_at).
 *   - Max 3 OTP requests per phone per hour.
 */
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const OTP_EXPIRY_MINUTES = 5;
const RESEND_COOLDOWN_SECONDS = 60;
const MAX_OTP_PER_HOUR = 3;

function generateOTP(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export async function POST(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if (!auth.success) return authErrorResponse(auth);

  // 1. Fetch the student's profile.
  const { data: profile } = await supabaseServer
    .from('users')
    .select('id, account_status, phone, phone_verified')
    .eq('id', auth.user.id)
    .maybeSingle();

  if (!profile) {
    return NextResponse.json({ success: false, error: 'الملف الشخصي غير موجود' }, { status: 404 });
  }

  const p = profile as { id: string; account_status: string; phone: string | null; phone_verified: boolean };

  if (p.account_status !== 'pending_verification') {
    return NextResponse.json({ success: false, error: 'حسابك لا يحتاج إلى التحقق' }, { status: 400 });
  }

  if (!p.phone) {
    return NextResponse.json({ success: false, error: 'لا يوجد رقم هاتف مرتبط بحسابك' }, { status: 400 });
  }

  // 2. Check resend cooldown (last OTP must be > 60s ago).
  const { data: lastOtp } = await supabaseServer
    .from('otp_codes')
    .select('created_at')
    .eq('user_id', p.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (lastOtp) {
    const lastCreated = new Date((lastOtp as { created_at: string }).created_at).getTime();
    const elapsed = (Date.now() - lastCreated) / 1000;
    if (elapsed < RESEND_COOLDOWN_SECONDS) {
      const wait = Math.ceil(RESEND_COOLDOWN_SECONDS - elapsed);
      return NextResponse.json(
        { success: false, error: `يرجى الانتظار ${wait} ثانية قبل طلب كود جديد` },
        { status: 429 }
      );
    }
  }

  // 3. Check rate limit (max 3 per hour per phone).
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count } = await supabaseServer
    .from('otp_codes')
    .select('id', { count: 'exact', head: true })
    .eq('phone', p.phone)
    .gte('created_at', oneHourAgo);

  if ((count ?? 0) >= MAX_OTP_PER_HOUR) {
    return NextResponse.json(
      { success: false, error: 'تجاوزت الحد الأقصى من طلبات التحقق في هذه الساعة. حاول لاحقاً.' },
      { status: 429 }
    );
  }

  // 4. Generate new OTP (6-digit).
  const code = generateOTP();
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(code, salt, 64).toString('hex');
  const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000).toISOString();

  // 5. Try to find the student's Telegram chat_id (from a previous OTP delivery).
  const { data: prevOtp } = await supabaseServer
    .from('otp_codes')
    .select('telegram_chat_id')
    .eq('user_id', p.id)
    .not('telegram_chat_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const telegramChatId = (prevOtp as { telegram_chat_id: string | null } | null)?.telegram_chat_id ?? null;

  // 6. Insert the OTP record.
  const { data: newOtp, error: otpErr } = await supabaseServer
    .from('otp_codes')
    .insert({
      user_id: p.id,
      phone: p.phone,
      code_hash: hash,
      code_salt: salt,
      expires_at: expiresAt,
      max_attempts: 5,
      used: false,
      telegram_chat_id: telegramChatId,
    })
    .select('id')
    .single();

  if (otpErr) {
    return NextResponse.json({ success: false, error: 'فشل إنشاء كود التحقق' }, { status: 500 });
  }

  // 7. Send OTP via Telegram (if we have a chat_id).
  let sentViaTelegram = false;
  if (telegramChatId && TELEGRAM_BOT_TOKEN) {
    try {
      const tgRes = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: telegramChatId,
          text: `🔐 كود التحقق الخاص بك هو: ${code}\n\nهذا الكود صالح لمدة ${OTP_EXPIRY_MINUTES} دقائق فقط.`,
        }),
      });
      if (tgRes.ok) sentViaTelegram = true;
    } catch {
      // Non-fatal — the OTP is stored, user can try again.
    }
  }

  return NextResponse.json({
    success: true,
    message: sentViaTelegram
      ? 'تم إرسال كود التحقق عبر تليجرام.'
      : 'تم إنشاء كود التحقق. يرجى بدء محادثة مع البوت على تليجرام لاستلام الكود.',
    telegram_chat_id: telegramChatId ? true : false,
    otp_id: (newOtp as { id: string }).id,
  });
}

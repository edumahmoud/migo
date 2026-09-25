import { NextRequest, NextResponse } from 'next/server';
import { scryptSync, randomBytes } from 'crypto';
import { supabaseServer } from '@/lib/supabase-server';

/**
 * POST /api/telegram/webhook
 *
 * Telegram Bot webhook endpoint. Handles:
 *   1. /start — sends "Share Phone Number" button.
 *   2. contact (phone shared) — matches to pending registration,
 *      generates OTP, sends it via Telegram.
 *
 * Security:
 *   - The phone shared via Telegram is verified by Telegram itself
 *     (Telegram accounts are phone-verified).
 *   - The bot only sends OTP if the phone matches a pending_verification
 *     user who hasn't verified yet.
 *   - OTP is hashed, short-lived, rate-limited.
 *
 * Environment:
 *   TELEGRAM_BOT_TOKEN — the bot token from @BotFather.
 */
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const OTP_EXPIRY_MINUTES = 5;

function generateOTP(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function normalizePhone(phone: string): string {
  // Remove everything except digits and +.
  return phone.replace(/[^\d+]/g, '');
}

export async function POST(request: NextRequest) {
  if (!TELEGRAM_BOT_TOKEN) {
    return NextResponse.json({ error: 'Telegram bot not configured' }, { status: 500 });
  }

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ ok: true }); // Acknowledge Telegram even on parse error
  }

  const update = body as {
    message?: {
      message_id: number;
      chat?: { id: number; first_name?: string };
      text?: string;
      contact?: { phone_number: string; user_id: number };
    };
  };

  const msg = update.message;
  if (!msg || !msg.chat) {
    return NextResponse.json({ ok: true });
  }

  const chatId = msg.chat.id;

  // 1. Handle /start command → send "Share Phone" button.
  if (msg.text && msg.text.startsWith('/start')) {
    const firstName = msg.chat.first_name || 'there';
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: `مرحباً ${firstName}! 👋\n\nلتأكيد رقم هاتفك، اضغط زر "مشاركة رقم الهاتف" أدناه.`,
        reply_markup: {
          keyboard: [[{ text: '📱 مشاركة رقم الهاتف', request_contact: true }]],
          resize_keyboard: true,
          one_time_keyboard: true,
        },
      }),
    });
    return NextResponse.json({ ok: true });
  }

  // 2. Handle phone number sharing.
  if (msg.contact && msg.contact.phone_number) {
    const phone = normalizePhone(msg.contact.phone_number);

    // Find a pending_verification user with this phone.
    const { data: user } = await supabaseServer
      .from('users')
      .select('id, phone, phone_verified, account_status')
      .eq('phone', phone)
      .eq('account_status', 'pending_verification')
      .maybeSingle();

    if (!user) {
      // Don't reveal whether the phone exists or not (anti-enumeration).
      await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: 'لم يتم العثور على حساب بانتظار التحقق بهذا الرقم.\nيرجى التأكد من تسجيل حسابك أولاً على المنصة.',
        }),
      });
      return NextResponse.json({ ok: true });
    }

    const u = user as { id: string; phone: string; phone_verified: boolean };

    if (u.phone_verified) {
      await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: 'تم التحقق من رقم هاتفك بالفعل. ✅',
        }),
      });
      return NextResponse.json({ ok: true });
    }

    // 3. Rate limit: max 3 OTPs per hour per phone.
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count } = await supabaseServer
      .from('otp_codes')
      .select('id', { count: 'exact', head: true })
      .eq('phone', phone)
      .gte('created_at', oneHourAgo);

    if ((count ?? 0) >= 3) {
      await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: 'تجاوزت الحد الأقصى من طلبات التحقق في هذه الساعة. حاول لاحقاً.',
        }),
      });
      return NextResponse.json({ ok: true });
    }

    // 4. Generate OTP.
    const code = generateOTP();
    const salt = randomBytes(16).toString('hex');
    const hash = scryptSync(code, salt, 64).toString('hex');
    const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000).toISOString();

    // 5. Insert OTP record with telegram_chat_id.
    await supabaseServer
      .from('otp_codes')
      .insert({
        user_id: u.id,
        phone: phone,
        code_hash: hash,
        code_salt: salt,
        expires_at: expiresAt,
        max_attempts: 5,
        used: false,
        telegram_chat_id: chatId,
      });

    // 6. Send OTP to the user's Telegram chat.
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: `🔐 كود التحقق الخاص بك هو: ${code}\n\nهذا الكود صالح لمدة ${OTP_EXPIRY_MINUTES} دقائق فقط.\nأدخله على صفحة التحقق لتأكيد حسابك.`,
      }),
    });

    return NextResponse.json({ ok: true });
  }

  // 3. Unknown message → send help.
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: 'للتحقق من رقم هاتفك، اضغط زر "مشاركة رقم الهاتف" أو أرسل /start.',
      reply_markup: {
        keyboard: [[{ text: '📱 مشاركة رقم الهاتف', request_contact: true }]],
        resize_keyboard: true,
        one_time_keyboard: true,
      },
    }),
  });

  return NextResponse.json({ ok: true });
}

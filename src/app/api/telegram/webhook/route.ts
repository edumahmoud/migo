import { NextRequest, NextResponse } from 'next/server';
import { scryptSync, timingSafeEqual, randomBytes } from 'crypto';
import { supabaseServer } from '@/lib/supabase-server';
import { sendOtpViaBot, sendInvalidTokenMessage, sendBotMessage } from '@/lib/telegram-bot';

/**
 * POST /api/telegram/webhook
 *
 * Receives Telegram Updates (sent by Telegram whenever a user interacts
 * with the bot, especially when they click Start with a deep link).
 *
 * Flow:
 *   1. Telegram sends `{ message: { text: "/start VERIFY_TOKEN", chat: { id: ... } } }`
 *   2. Webhook verifies the secret_token header (set via setWebhook)
 *   3. Extracts VERIFY_TOKEN from message.text
 *   4. Looks up the verification session by hashing VERIFY_TOKEN and
 *      comparing with timingSafeEqual against stored hashes
 *   5. Atomically transitions status: 'pending_start' → 'otp_sent'
 *      (prevents VERIFY_TOKEN reuse — only one webhook call can succeed)
 *   6. Generates OTP, stores hash + chat_id, sends OTP via Bot API
 *
 * Security:
 *   - X-Telegram-Bot-Api-Secret-Token must match TELEGRAM_WEBHOOK_SECRET
 *   - VERIFY_TOKEN is hash-compared (timingSafeEqual) — never plaintext
 *   - status transition is atomic (conditional UPDATE on status='pending_start')
 *   - Expired sessions are rejected
 *   - Returns HTTP 200 to ALL inputs (so Telegram doesn't retry failed
 *     requests and expose timing info)
 *   - Never logs OTP, tokens, or secrets
 */

const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || '';
const OTP_EXPIRY_MINUTES = 5;
const OTP_CODE_DIGITS = 6;

/**
 * Generate a cryptographically secure 6-digit OTP.
 * Uses crypto.randomBytes (CSPRNG), not Math.random().
 */
function generateSecureOTP(): string {
  // 4 bytes = 32 bits, plenty for mod 1e6
  const buf = randomBytes(4);
  const num = buf.readUInt32BE(0) % 1_000_000;
  return num.toString().padStart(OTP_CODE_DIGITS, '0');
}

interface TelegramUpdate {
  message?: {
    text?: string;
    chat?: { id: number };
    from?: { id: number; first_name?: string };
  };
}

export async function POST(request: NextRequest) {
  // 1. Verify secret token header (set via Telegram setWebhook)
  //    Telegram sends this in `X-Telegram-Bot-Api-Secret-Token`.
  if (WEBHOOK_SECRET) {
    const incoming = request.headers.get('x-telegram-bot-api-secret-token');
    if (incoming !== WEBHOOK_SECRET) {
      // Return 200 to avoid Telegram retries + don't reveal the reason
      return NextResponse.json({ ok: true, ignored: 'invalid_secret' });
    }
  }

  // 2. Parse the Update body
  let update: TelegramUpdate;
  try {
    update = (await request.json()) as TelegramUpdate;
  } catch {
    return NextResponse.json({ ok: true, ignored: 'invalid_json' });
  }

  // 3. Must have a message with text + chat.id
  const message = update.message;
  if (!message?.text || typeof message.chat?.id !== 'number') {
    return NextResponse.json({ ok: true, ignored: 'no_message' });
  }

  const chatId = message.chat.id;
  const text = message.text;

  // 4. Handle plain /start (no deep link) — friendly help message
  if (text === '/start' || text === '/help') {
    await sendBotMessage(
      chatId,
      [
        '👋 مرحباً بك في بوت AttenDo للتحقق!',
        '',
        'هذا البوت يستخدم لتأكيد رقم هاتفك أثناء التسجيل في منصة AttenDo.',
        '',
        'لاستخدامه:',
        '1. سجّل في الموقع وستنتقل تلقائياً لصفحة التحقق.',
        '2. اضغط زر "فتح Telegram" — سيفتح محادثتنا هنا مع زر Start.',
        '3. اضغط Start — سيصلك كود التحقيق فوراً.',
        '4. أدخل الكود في الموقع لإكمال التسجيل.',
      ].join('\n')
    );
    return NextResponse.json({ ok: true });
  }

  // 5. Must start with "/start " (with space) for the verification flow
  if (!text.startsWith('/start ')) {
    return NextResponse.json({ ok: true, ignored: 'not_start_command' });
  }

  const verifyToken = text.slice('/start '.length).trim();
  if (!verifyToken || verifyToken.length < 16) {
    await sendInvalidTokenMessage(chatId);
    return NextResponse.json({ ok: true });
  }

  // 6. Look up all active pending_start sessions.
  //    We need to compare hashes with timingSafeEqual, so we fetch
  //    the candidates first. (Number of active sessions is small —
  //    bounded by the rate limit + 10min expiry.)
  const nowIso = new Date().toISOString();
  const { data: candidates, error: queryErr } = await supabaseServer
    .from('otp_codes')
    .select('id, user_id, phone, verify_token_hash, verify_token_salt, verify_expires_at, status')
    .eq('status', 'pending_start')
    .gt('verify_expires_at', nowIso);

  if (queryErr) {
    return NextResponse.json({ ok: true, ignored: 'db_error' });
  }

  if (!candidates || candidates.length === 0) {
    await sendInvalidTokenMessage(chatId);
    return NextResponse.json({ ok: true });
  }

  // 7. Find the session whose stored hash matches the incoming token
  //    using timingSafeEqual (constant-time comparison).
  type Candidate = { id: string; user_id: string; phone: string; verify_token_hash: string; verify_token_salt: string; verify_expires_at: string; status: string };
  let matched: Candidate | null = null;
  for (const c of candidates as Candidate[]) {
    if (!c.verify_token_hash || !c.verify_token_salt) continue;
    try {
      const expected = Buffer.from(c.verify_token_hash, 'hex');
      const actual = scryptSync(verifyToken, c.verify_token_salt, 64);
      if (expected.length === actual.length && timingSafeEqual(expected, actual)) {
        matched = c;
        break;
      }
    } catch {
      // hash compare failed — skip this candidate
    }
  }

  if (!matched) {
    await sendInvalidTokenMessage(chatId);
    return NextResponse.json({ ok: true });
  }

  // 8. Final expiry check (DB query already filtered, but double-check)
  if (new Date(matched.verify_expires_at) <= new Date()) {
    await supabaseServer
      .from('otp_codes')
      .update({ status: 'expired', updated_at: nowIso })
      .eq('id', matched.id);
    await sendInvalidTokenMessage(chatId);
    return NextResponse.json({ ok: true });
  }

  // 9. ATOMIC transition: pending_start → otp_sent
  //    This conditional UPDATE prevents reuse of VERIFY_TOKEN — if two
  //    webhooks arrive simultaneously for the same token, only one
  //    succeeds (the other finds status != 'pending_start' and gets
  //    null result).
  const { data: claimed, error: claimErr } = await supabaseServer
    .from('otp_codes')
    .update({
      status: 'otp_sent',
      telegram_chat_id: chatId,
      updated_at: nowIso,
    })
    .eq('id', matched.id)
    .eq('status', 'pending_start') // conditional — only if still pending
    .select('id, user_id, phone')
    .maybeSingle();

  if (claimErr || !claimed) {
    // Race condition or already claimed — send "already in progress"
    await sendBotMessage(
      chatId,
      '⏳ تم إرسال الكود بالفعل. تحقق من رسائلي السابقة في هذه المحادثة.'
    );
    return NextResponse.json({ ok: true });
  }

  // 10. Generate OTP + store hash in the same row
  const otp = generateSecureOTP();
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(otp, salt, 64).toString('hex');
  const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000).toISOString();

  await supabaseServer
    .from('otp_codes')
    .update({
      code_hash: hash,
      code_salt: salt,
      expires_at: expiresAt,
      updated_at: new Date().toISOString(),
    })
    .eq('id', matched.id);

  // 11. Send the OTP via the Bot API
  //     IMPORTANT: per the user's requirement, we only consider success
  //     if Telegram returned {ok: true}. If not, revert the claim so
  //     the user can retry.
  const result = await sendOtpViaBot(chatId, otp);

  if (!result.sent) {
    // Revert status so user can retry the deep link
    await supabaseServer
      .from('otp_codes')
      .update({
        status: 'pending_start',
        telegram_chat_id: null,
        code_hash: null,
        code_salt: null,
        expires_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', matched.id);

    // Send a friendly error to the user
    await sendBotMessage(
      chatId,
      '❌ تعذّر إرسال الكود الآن. حاول مرة أخرى بفتح الموقع والضغط على زر "فتح Telegram" من جديد.'
    );
    return NextResponse.json({ ok: true, send_failed: true });
  }

  // Success — Telegram accepted the message. The frontend's polling
  // will detect status='otp_sent' and reveal the OTP input.
  return NextResponse.json({ ok: true });
}

import { NextRequest, NextResponse } from 'next/server';
import { scryptSync, timingSafeEqual, randomBytes } from 'crypto';
import { supabaseServer } from '@/lib/supabase-server';
import { sendOtpViaBot, sendInvalidTokenMessage, sendBotMessage, sendContactRequestButton } from '@/lib/telegram-bot';
import { normalizePhoneToE164 } from '@/lib/phone-utils';

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
    // Fix 3: Telegram sends `message.contact` when the user clicks a
    // KeyboardButton with request_contact: true. The contact object
    // contains `phone_number` (E.164 format) + `user_id` (Telegram ID).
    contact?: {
      phone_number: string;
      first_name?: string;
      last_name?: string;
      user_id?: number;
    };
  };
}

export async function POST(request: NextRequest) {
  // Diagnostic logging (NO secrets, NO OTP, NO tokens — just status).
  // Helps the operator debug webhook issues via Vercel logs.
  console.log('[tg-webhook] received request');

  // 1. Verify secret token header (set via Telegram setWebhook)
  //    Telegram sends this in `X-Telegram-Bot-Api-Secret-Token`.
  if (WEBHOOK_SECRET) {
    const incoming = request.headers.get('x-telegram-bot-api-secret-token');
    if (incoming !== WEBHOOK_SECRET) {
      console.warn('[tg-webhook] invalid secret token — ignoring');
      // Return 200 to avoid Telegram retries + don't reveal the reason
      return NextResponse.json({ ok: true, ignored: 'invalid_secret' });
    }
  } else {
    console.warn('[tg-webhook] TELEGRAM_WEBHOOK_SECRET not set — accepting all requests (insecure!)');
  }

  // 2. Parse the Update body
  let update: TelegramUpdate;
  try {
    update = (await request.json()) as TelegramUpdate;
  } catch {
    console.warn('[tg-webhook] invalid JSON body');
    return NextResponse.json({ ok: true, ignored: 'invalid_json' });
  }

  // 3. Must have a message with either text or contact, and a chat.id
  const message = update.message;
  if (!message || typeof message.chat?.id !== 'number') {
    console.log('[tg-webhook] no message or chat.id — ignoring');
    return NextResponse.json({ ok: true, ignored: 'no_message' });
  }

  const chatId = message.chat.id;

  // ── Fix 3: Handle contact-sharing (request_contact button response) ──
  // This must be checked BEFORE the text-based /start handler, because
  // a contact message has NO `text` field — it has `contact.phone_number`.
  if (message.contact?.phone_number) {
    console.log(`[tg-webhook] contact message received from chat ${chatId}`);
    return handleContactMessage(chatId, message.contact.phone_number);
  }

  // All remaining handlers require `message.text`
  if (!message.text) {
    console.log('[tg-webhook] message has no text and no contact — ignoring');
    return NextResponse.json({ ok: true, ignored: 'no_text' });
  }

  const text = message.text;
  console.log(`[tg-webhook] chat_id=${chatId} text_len=${text.length} starts_with_start=${text.startsWith('/start')}`);

  // 4. Handle plain /start (no deep link) — friendly help message
  if (text === '/start' || text === '/help') {
    console.log('[tg-webhook] plain /start — sending help message');
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
    console.log('[tg-webhook] not a /start command — ignoring');
    return NextResponse.json({ ok: true, ignored: 'not_start_command' });
  }

  const verifyToken = text.slice('/start '.length).trim();
  if (!verifyToken || verifyToken.length < 16) {
    console.warn('[tg-webhook] verify_token too short — sending invalid message');
    await sendInvalidTokenMessage(chatId);
    return NextResponse.json({ ok: true });
  }
  console.log(`[tg-webhook] verify_token received (len=${verifyToken.length})`);

  // 6. Look up all active pending_start sessions.
  const nowIso = new Date().toISOString();
  const { data: candidates, error: queryErr } = await supabaseServer
    .from('otp_codes')
    .select('id, user_id, phone, verify_token_hash, verify_token_salt, verify_expires_at, status')
    .eq('status', 'pending_start')
    .gt('verify_expires_at', nowIso);

  if (queryErr) {
    console.error('[tg-webhook] DB query error:', queryErr.message);
    return NextResponse.json({ ok: true, ignored: 'db_error' });
  }

  if (!candidates || candidates.length === 0) {
    console.warn('[tg-webhook] no active pending_start sessions — sending invalid message');
    await sendInvalidTokenMessage(chatId);
    return NextResponse.json({ ok: true });
  }
  console.log(`[tg-webhook] found ${candidates.length} candidate session(s)`);

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
    console.warn('[tg-webhook] no matching session for the verify_token');
    await sendInvalidTokenMessage(chatId);
    return NextResponse.json({ ok: true });
  }
  console.log(`[tg-webhook] matched session ${matched.id} for user ${matched.user_id}`);

  // 8. Final expiry check
  if (new Date(matched.verify_expires_at) <= new Date()) {
    console.warn('[tg-webhook] session already expired');
    await supabaseServer
      .from('otp_codes')
      .update({ status: 'expired', updated_at: nowIso })
      .eq('id', matched.id);
    await sendInvalidTokenMessage(chatId);
    return NextResponse.json({ ok: true });
  }

  // 9. ATOMIC claim: store telegram_chat_id (so the contact handler can
  //    find the session later). Status STAYS 'pending_start' — the OTP
  //    is NOT generated yet. The frontend keeps polling and shows the
  //    "waiting for OTP" state.
  //
  //    Fix 3: We do NOT transition to 'otp_sent' here. We only set
  //    telegram_chat_id (claiming the session so the token can't be
  //    reused by a different chat). The OTP will be generated + sent
  //    ONLY when the user shares a matching phone number via the
  //    contact-request button (handleContactMessage below).
  //
  //    The atomic conditional update ensures only ONE chat can claim
  //    the session (race condition protection). If a second chat tries
  //    to claim the same token, the update returns 0 rows (because
  //    telegram_chat_id is already set + status is still 'pending_start'
  //    — we use .is('telegram_chat_id', null) to make this atomic).
  const { data: claimed, error: claimErr } = await supabaseServer
    .from('otp_codes')
    .update({
      telegram_chat_id: chatId,
      updated_at: nowIso,
    })
    .eq('id', matched.id)
    .eq('status', 'pending_start')
    .is('telegram_chat_id', null)  // atomic — only if not already claimed
    .select('id, user_id, phone')
    .maybeSingle();

  if (claimErr || !claimed) {
    console.warn('[tg-webhook] atomic claim failed (race condition or already claimed)');
    await sendBotMessage(
      chatId,
      '⏳ تم إرسال الكود بالفعل. تحقق من رسائلي السابقة في هذه المحادثة.'
    );
    return NextResponse.json({ ok: true });
  }
  console.log(`[tg-webhook] session claimed, sending contact-request button`);

  // ── Fix 3: Send contact-request button INSTEAD of immediately generating OTP ──
  //
  // SECURITY ISSUE (FIXED): The previous flow generated + sent the OTP
  // to `chatId` immediately after matching the verify_token. This meant
  // the OTP was delivered to WHICHEVER Telegram account clicked Start
  // — NOT necessarily the account that owns the registered phone number.
  // A student could register with phone X, then verify using a
  // DIFFERENT Telegram account (phone Y) that they happen to be logged
  // into.
  //
  // NEW FLOW:
  //   1. After claiming the session, send a `KeyboardButton` with
  //      `request_contact: true` asking the user to share their phone.
  //   2. The session status stays `otp_sent` (claimed — token can't be
  //      reused) BUT `code_hash` + `expires_at` are NOT set yet (the
  //      OTP is not generated until the contact is validated).
  //   3. When the user shares their contact, Telegram sends a SEPARATE
  //      webhook update with `message.contact.phone_number`.
  //   4. The webhook's contact-handler (below) looks up the session by
  //      `telegram_chat_id` + status='otp_sent' + code_hash IS NULL,
  //      validates `phone_number == otp_codes.phone` (after E.164
  //      normalization), and ONLY THEN generates + sends the OTP.
  //
  // The status stays `otp_sent` so the frontend's polling shows the
  // "OTP input" UI. But the OTP is NOT sent until the contact is
  // validated. If the user enters an OTP they never received, the
  // verification fails after 5 attempts (existing rate limit).
  //
  // If the user shares the WRONG contact (phone mismatch), the webhook
  // sends an error message + transitions status → 'expired' (forces
  // the user to restart from the website).
  const contactResult = await sendContactRequestButton(chatId);
  if (!contactResult.sent) {
    console.error('[tg-webhook] contact-request button send failed:', contactResult.error);
    // Revert status so user can retry the deep link
    await supabaseServer
      .from('otp_codes')
      .update({
        status: 'pending_start',
        telegram_chat_id: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', matched.id);

    await sendBotMessage(
      chatId,
      '❌ تعذّر إرسال زر تأكيد الرقم. حاول مرة أخرى بفتح الموقع والضغط على زر "فتح Telegram" من جديد.'
    );
    return NextResponse.json({ ok: true, send_failed: true });
  }

  console.log(`[tg-webhook] contact-request button sent to chat ${chatId}`);
  // The session is now in status='otp_sent' with telegram_chat_id set
  // but code_hash IS NULL (OTP not generated yet). The contact-handler
  // below will fill code_hash + expires_at when the user shares a
  // matching phone number.
  return NextResponse.json({ ok: true, waiting_for_contact: true });
}

// ============================================================
// Fix 3 — Contact handler
// ============================================================
// When the user clicks the "📞 مشاركة رقمي" button, Telegram sends
// a SEPARATE webhook update with `message.contact.phone_number`.
// This handler:
//   1. Extracts the phone number from the contact.
//   2. Looks up the otp_codes session by `telegram_chat_id == chatId`
//      + status='otp_sent' + code_hash IS NULL (waiting for contact).
//   3. Normalizes both phone numbers (the contact's + the session's)
//      to E.164 format and compares them.
//   4. If MATCH → generate OTP + send via Bot API + set code_hash +
//      expires_at (the OTP is now usable).
//   5. If MISMATCH → send error message + transition status → 'expired'
//      (forces the user to restart from the website).
//
// This is the CRITICAL security fix: the OTP is ONLY sent if the
// Telegram account's phone number matches the registered phone.
async function handleContactMessage(
  chatId: number,
  contactPhone: string,
): Promise<NextResponse> {
  const nowIso = new Date().toISOString();

  // 1. Normalize the contact's phone number to E.164
  const contactPhoneE164 = normalizePhoneToE164(contactPhone);
  if (!contactPhoneE164) {
    console.warn(`[tg-webhook] contact phone could not be normalized: ${contactPhone}`);
    await sendBotMessage(
      chatId,
      '❌ تعذّر قراءة رقم الهاتف المُرسل. تأكد من أنك ضغطت زر "مشاركة رقمي" وأن رقمك صالح.',
    );
    return NextResponse.json({ ok: true, contact_handled: false, reason: 'invalid_phone' });
  }
  console.log(`[tg-webhook] contact received from chat ${chatId}, phone normalized to E.164`);

  // 2. Look up the session by telegram_chat_id + status='pending_start' + code_hash IS NULL.
  //    status='pending_start' means the user clicked Start (the session
  //    was claimed with telegram_chat_id) but hasn't shared their contact yet.
  //    code_hash IS NULL means the OTP hasn't been generated yet.
  const { data: sessions, error: queryErr } = await supabaseServer
    .from('otp_codes')
    .select('id, user_id, phone, verify_expires_at, expires_at, code_hash, status')
    .eq('telegram_chat_id', chatId)
    .eq('status', 'pending_start')
    .is('code_hash', null)
    .order('created_at', { ascending: false })
    .limit(1);

  if (queryErr || !sessions || sessions.length === 0) {
    console.warn(`[tg-webhook] no pending-contact session found for chat ${chatId}`);
    await sendBotMessage(
      chatId,
      '⚠️ لا يوجد طلب تحقق نشط لهذه المحادثة. ابدأ من جديد من الموقع.',
    );
    return NextResponse.json({ ok: true, contact_handled: false, reason: 'no_session' });
  }

  const session = sessions[0] as {
    id: string;
    user_id: string;
    phone: string;
    verify_expires_at: string | null;
    expires_at: string | null;
    code_hash: string | null;
    status: string;
  };

  // 3. Check verify_expires_at (the session's overall expiry).
  //    The session was created with verify_expires_at = now + 10 min.
  //    If expired, transition to 'expired'.
  if (session.verify_expires_at && new Date(session.verify_expires_at) <= new Date()) {
    console.warn(`[tg-webhook] session ${session.id} already expired (verify_expires_at)`);
    await supabaseServer
      .from('otp_codes')
      .update({ status: 'expired', updated_at: nowIso })
      .eq('id', session.id);
    await sendBotMessage(
      chatId,
      '⏰ انتهت صلاحية جلسة التحقق. ابدأ من جديد من الموقع.',
    );
    return NextResponse.json({ ok: true, contact_handled: false, reason: 'session_expired' });
  }

  // 4. Normalize the session's registered phone + compare.
  const sessionPhoneE164 = normalizePhoneToE164(session.phone);
  if (!sessionPhoneE164) {
    console.error(`[tg-webhook] session phone could not be normalized: ${session.phone}`);
    await sendBotMessage(
      chatId,
      '❌ تعذّر قراءة رقم الهاتف المسجّل في حسابك. تواصل مع الدعم.',
    );
    return NextResponse.json({ ok: true, contact_handled: false, reason: 'invalid_session_phone' });
  }

  console.log(`[tg-webhook] comparing contact phone vs session phone for session ${session.id}`);

  // 5. Compare (case-insensitive — E.164 is digits + leading +).
  if (contactPhoneE164 !== sessionPhoneE164) {
    console.warn(`[tg-webhook] phone mismatch for session ${session.id}`);
    // Transition status → 'expired' so the user must restart from the website.
    await supabaseServer
      .from('otp_codes')
      .update({ status: 'expired', updated_at: nowIso })
      .eq('id', session.id);
    await sendBotMessage(
      chatId,
      [
        '❌ رقم الهاتف لا يطابق الرقم المُسجّل في المنصة.',
        '',
        `الرقم المُسجّل: ${sessionPhoneE164}`,
        `الرقم المُرسل: ${contactPhoneE164}`,
        '',
        'أعد فتح الموقع وابدأ التحقق من جديد باستخدام حساب تليجرام المرتبط برقمك المسجّل.',
      ].join('\n'),
    );
    return NextResponse.json({ ok: true, contact_handled: false, reason: 'phone_mismatch' });
  }

  // 6. Phone MATCH → transition to 'otp_sent' + generate OTP + send + set code_hash + expires_at.
  console.log(`[tg-webhook] phone match — generating OTP for session ${session.id}`);
  const otp = generateSecureOTP();
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(otp, salt, 64).toString('hex');
  const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000).toISOString();

  // ATOMIC transition: pending_start → otp_sent (only if still pending_start
  // — prevents race if the user shared the contact twice).
  const { data: transitioned, error: transitionErr } = await supabaseServer
    .from('otp_codes')
    .update({
      status: 'otp_sent',
      code_hash: hash,
      code_salt: salt,
      expires_at: expiresAt,
      updated_at: nowIso,
    })
    .eq('id', session.id)
    .eq('status', 'pending_start')  // atomic — only if not already transitioned
    .select('id')
    .maybeSingle();

  if (transitionErr || !transitioned) {
    console.warn(`[tg-webhook] atomic transition failed for session ${session.id} (already transitioned?)`);
    await sendBotMessage(
      chatId,
      '⏳ تم إرسال الكود بالفعل. تحقق من رسائلي السابقة في هذه المحادثة.',
    );
    return NextResponse.json({ ok: true, contact_handled: false, reason: 'already_transitioned' });
  }

  // 7. Send the OTP via the Bot API.
  const result = await sendOtpViaBot(chatId, otp);
  if (!result.sent) {
    console.error('[tg-webhook] OTP send failed:', result.error);
    // Don't revert status — the session is still claimed. The user
    // can retry by reopening the website's "فتح Telegram" button.
    await sendBotMessage(
      chatId,
      '❌ تعذّر إرسال الكود الآن. حاول مرة أخرى بفتح الموقع والضغط على زر "فتح Telegram" من جديد.',
    );
    return NextResponse.json({ ok: true, contact_handled: false, reason: 'otp_send_failed' });
  }

  console.log(`[tg-webhook] OTP sent successfully to chat ${chatId} (phone matched)`);
  return NextResponse.json({ ok: true, contact_handled: true });
}

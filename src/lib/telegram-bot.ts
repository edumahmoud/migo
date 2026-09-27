/**
 * Telegram Bot API helper.
 *
 * Uses the OFFICIAL Telegram Bot API (api.telegram.org/bot<token>/...)
 * which is FREE — no TON wallet, no Gateway subscription.
 *
 * The Bot API can only send messages to chats the bot has been started
 * in. The OTP flow therefore uses a verification deep-link:
 *   https://t.me/<BOT_USERNAME>?start=<VERIFY_TOKEN>
 *
 * When the user clicks Start in Telegram, the bot receives the
 * VERIFY_TOKEN via webhook, generates the OTP, and sends it to the
 * user's chat_id via sendMessage.
 *
 * Env vars (NEVER hardcode these):
 *   TELEGRAM_BOT_TOKEN     — bot token from @BotFather
 *   TELEGRAM_BOT_USERNAME  — bot username WITHOUT the @ prefix
 *   TELEGRAM_WEBHOOK_SECRET — secret_token for webhook verification
 */

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME || '';
const API_BASE = 'https://api.telegram.org';
const SEND_MESSAGE_TIMEOUT_MS = 10000;

export function isBotConfigured(): boolean {
  return !!BOT_TOKEN && !!BOT_USERNAME;
}

export function getBotUsername(): string {
  return BOT_USERNAME;
}

export interface BotSendResult {
  sent: boolean;
  error?: string;
  http_status?: number;
  error_code?: number;
}

/**
 * Send a text message to a Telegram chat via the Bot API.
 *
 * IMPORTANT: A 200 response from api.telegram.org does NOT mean the
 * message was delivered — we MUST check that the JSON body has
 * `ok: true`. Telegram returns 200 with `{ok:false, error_code, ...}`
 * for failures (blocked bot, chat not found, rate limit, etc.).
 *
 * @param chatId Numeric Telegram chat ID
 * @param text   Message body (Telegram Markdown or plain text)
 */
export async function sendBotMessage(
  chatId: number,
  text: string,
  replyMarkup?: Record<string, unknown>,
): Promise<BotSendResult> {
  if (!BOT_TOKEN) {
    return { sent: false, error: 'TELEGRAM_BOT_TOKEN not configured' };
  }

  try {
    const body: Record<string, unknown> = {
      chat_id: chatId,
      text: text,
    };
    if (replyMarkup) {
      body.reply_markup = replyMarkup;
    }
    const res = await fetch(`${API_BASE}/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(SEND_MESSAGE_TIMEOUT_MS),
    });

    const raw = await res.text();
    let parsed: { ok?: boolean; description?: string; error_code?: number } | null = null;
    try { parsed = JSON.parse(raw); } catch { /* not JSON — handled below */ }

    if (parsed?.ok === true) {
      return { sent: true, http_status: res.status };
    }

    // Map common Bot API failures to actionable messages.
    const description = parsed?.description || `HTTP ${res.status}`;
    return {
      sent: false,
      error: description,
      http_status: res.status,
      error_code: parsed?.error_code,
    };
  } catch (err) {
    return {
      sent: false,
      error: err instanceof Error ? err.message : 'Network error',
    };
  }
}

/**
 * Send a contact-request button to the user's Telegram chat.
 *
 * This is the CRITICAL security fix for Issue 3: the bot CANNOT see
 * the user's phone number unless the user explicitly shares it via
 * a `KeyboardButton` with `request_contact: true`. Without this,
 * the OTP would be sent to WHICHEVER Telegram account clicked Start
 * — not necessarily the account that owns the registered phone number.
 *
 * Flow:
 *   1. User clicks Start with VERIFY_TOKEN in Telegram
 *   2. Webhook matches the token (tied to user_id + registered phone)
 *   3. Webhook sends THIS contact-request button:
 *      "مشاركة رقمي" (Share my number) → KeyboardButton.request_contact
 *   4. User clicks the button → Telegram sends `message.contact.phone_number`
 *   5. Webhook validates: phone_number == otp_codes.phone (registered)
 *   6. Only if match → generate + send OTP
 *
 * @param chatId Numeric Telegram chat ID
 */
export async function sendContactRequestButton(chatId: number): Promise<BotSendResult> {
  const text = [
    '📱 تأكيد رقم الهاتف',
    '',
    'لإتمام التحقق، اضغط الزر أدناه لمشاركة رقم هاتفك المسجّل في المنصة.',
    '',
    '⚠️ يجب أن يكون رقم الهاتف المطابق للرقم المُسجّل في حسابك.',
  ].join('\n');

  // ReplyKeyboardMarkup with one button that requests the user's contact.
  // When the user clicks it, Telegram sends a `message.contact` update
  // with `phone_number` + `user_id` to the webhook.
  const replyMarkup = {
    keyboard: [
      [
        {
          text: '📞 مشاركة رقمي',
          request_contact: true,
        },
      ],
    ],
    resize_keyboard: true,
    one_time_keyboard: true,
  };

  return sendBotMessage(chatId, text, replyMarkup);
}

/**
 * Send the OTP code to the user's Telegram chat.
 * Uses a friendly formatted message with the code front and center.
 */
export async function sendOtpViaBot(chatId: number, code: string): Promise<BotSendResult> {
  const text = [
    '🔐 كود التحقق في AttenDo',
    '',
    code,
    '',
    'هذا الكود صالح لمدة 5 دقائق.',
    'لا تشاركه مع أحد — حتى موظفي الدعم.',
  ].join('\n');
  return sendBotMessage(chatId, text);
}

/**
 * Send a friendly "session invalid / expired" message to a Telegram
 * chat (used by the webhook when someone clicks Start without a valid
 * VERIFY_TOKEN).
 */
export async function sendInvalidTokenMessage(chatId: number): Promise<BotSendResult> {
  return sendBotMessage(
    chatId,
    [
      'مرحباً 👋',
      '',
      'لتفعيل التحقق، افتح موقع AttenDo واطلب كوداً جديداً من صفحة OTP.',
      'هذا البوت لا يمكنه إرسال أكواد بدون جلسة تحقق نشطة.',
    ].join('\n')
  );
}

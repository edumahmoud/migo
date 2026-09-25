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
export async function sendBotMessage(chatId: number, text: string): Promise<BotSendResult> {
  if (!BOT_TOKEN) {
    return { sent: false, error: 'TELEGRAM_BOT_TOKEN not configured' };
  }

  try {
    const res = await fetch(`${API_BASE}/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: text,
      }),
      signal: AbortSignal.timeout(SEND_MESSAGE_TIMEOUT_MS),
    });

    const body = await res.text();
    let parsed: { ok?: boolean; description?: string; error_code?: number } | null = null;
    try { parsed = JSON.parse(body); } catch { /* not JSON — handled below */ }

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

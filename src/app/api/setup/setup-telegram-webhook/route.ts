import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/setup/setup-telegram-webhook
 *
 * Diagnoses and (if needed) sets up the Telegram webhook for the bot.
 *
 * Calls Telegram's getWebhookInfo to check the current state, and
 * optionally calls setWebhook if ?setup=1 is passed.
 *
 * Env vars required:
 *   - TELEGRAM_BOT_TOKEN
 *   - TELEGRAM_BOT_USERNAME
 *   - TELEGRAM_WEBHOOK_SECRET
 *
 * Usage:
 *   GET  /api/setup/setup-telegram-webhook           → status only
 *   GET  /api/setup/setup-telegram-webhook?setup=1   → set webhook + status
 */
const API_BASE = 'https://api.telegram.org';

interface WebhookInfo {
  url: string;
  has_custom_certificate: boolean;
  pending_update_count: number;
  last_error_date?: number;
  last_error_message?: string;
  max_connections?: number;
  ip_address?: string;
}

export async function GET(request: NextRequest) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN || '';
  const botUsername = process.env.TELEGRAM_BOT_USERNAME || '';
  const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET || '';

  // 1. Verify env vars
  const envCheck = {
    bot_token_set: !!botToken,
    bot_username_set: !!botUsername,
    bot_username_value: botUsername || null,
    webhook_secret_set: !!webhookSecret,
    webhook_secret_length: webhookSecret.length,
  };

  if (!envCheck.bot_token_set || !envCheck.bot_username_set || !envCheck.webhook_secret_set) {
    return NextResponse.json({
      success: false,
      env: envCheck,
      verdict: 'مطلوب إعداد متغيرات البيئة في Vercel: TELEGRAM_BOT_TOKEN, TELEGRAM_BOT_USERNAME, TELEGRAM_WEBHOOK_SECRET',
    }, { status: 500 });
  }

  // 2. Determine the public webhook URL from the request
  //    Vercel gives us the host via headers
  const proto = request.headers.get('x-forwarded-proto') || 'https';
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host') || '';
  const publicUrl = `${proto}://${host}`;
  const webhookUrl = `${publicUrl}/api/telegram/webhook`;

  // 3. Get current webhook status
  let info: WebhookInfo | null = null;
  try {
    const res = await fetch(`${API_BASE}/bot${botToken}/getWebhookInfo`, {
      method: 'GET',
      signal: AbortSignal.timeout(10000),
    });
    const body = await res.json();
    if (body?.ok === true) {
      info = body.result as WebhookInfo;
    } else {
      return NextResponse.json({
        success: false,
        env: envCheck,
        get_webhook_info_failed: true,
        error: body?.description || `HTTP ${res.status}`,
        verdict: '❌ فشل getWebhookInfo — توكن البوت غير صالح أو من Networks. تحقق من TELEGRAM_BOT_TOKEN.',
      }, { status: 500 });
    }
  } catch (e) {
    return NextResponse.json({
      success: false,
      env: envCheck,
      error: e instanceof Error ? e.message : 'Network error',
      verdict: '❌ تعذّر الاتصال بـ api.telegram.org',
    }, { status: 500 });
  }

  // 4. Optionally set up the webhook if ?setup=1
  const shouldSetup = request.nextUrl.searchParams.get('setup') === '1';
  let setupResult: Record<string, unknown> | null = null;

  if (shouldSetup) {
    try {
      const res = await fetch(`${API_BASE}/bot${botToken}/setWebhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: webhookUrl,
          secret_token: webhookSecret,
          max_connections: 40,
          allowed_updates: JSON.stringify(['message']),
        }),
        signal: AbortSignal.timeout(10000),
      });
      const body = await res.json();
      setupResult = {
        http_status: res.status,
        ok: body?.ok === true,
        description: body?.description,
        result: body?.result,
      };
    } catch (e) {
      setupResult = {
        error: e instanceof Error ? e.message : 'Network error during setWebhook',
      };
    }
    // Re-fetch info after setup
    if (setupResult?.ok) {
      try {
        const res = await fetch(`${API_BASE}/bot${botToken}/getWebhookInfo`, {
          signal: AbortSignal.timeout(10000),
        });
        const body = await res.json();
        if (body?.ok === true) info = body.result as WebhookInfo;
      } catch { /* keep old info */ }
    }
  }

  // 5. Compose verdict
  let verdict = '';
  const expectedUrl = webhookUrl;
  const actualUrl = info?.url || '';

  if (!actualUrl) {
    verdict = `⚠️ الـ webhook غير مُعدّ. اضغط هذا الرابط لإعداده تلقائياً: ${publicUrl}/api/setup/setup-telegram-webhook?setup=1`;
  } else if (actualUrl !== expectedUrl) {
    verdict = `⚠️ الـ webhook مُعدّ لرابط مختلف:
المتوقع: ${expectedUrl}
الحالي:  ${actualUrl}
اضغط لإصلاحه: ${publicUrl}/api/setup/setup-telegram-webhook?setup=1`;
  } else if (info?.pending_update_count && info.pending_update_count > 0) {
    verdict = `⚠️ يوجد ${info.pending_update_count} تحديثات معلّقة (لم تصل الـ webhook بنجاح). آخر خطأ: ${info.last_error_message || 'غير معروف'} (${new Date((info.last_error_date || 0) * 1000).toISOString()}). تحقق من الـ logs في Vercel.`;
  } else {
    verdict = '✅ الـ webhook مُعدّ بشكل صحيح ومستعد لاستقبال تحديثات Telegram.';
  }

  return NextResponse.json({
    success: true,
    env: envCheck,
    public_url: publicUrl,
    webhook_url: expectedUrl,
    telegram_webhook_info: info,
    setup_result: setupResult,
    verdict,
  });
}

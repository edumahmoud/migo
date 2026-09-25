import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateRequest, authErrorResponse } from '@/lib/auth-helpers';

/**
 * GET /api/setup/check-telegram-gateway
 *
 * Diagnostic that reports whether the Telegram Gateway API is reachable
 * from the server, and whether the env var is correctly set.
 *
 * Key insight (discovered by curl):
 *   - When Telegram Gateway rejects a request (bad token, wrong token
 *     type), it returns HTTP 302 with `location: /` — NOT 401.
 *   - If fetch follows the redirect, it ends up at the homepage with
 *     HTTP 200 + HTML, which is misleading (looks like success).
 *   - We use `redirect: 'manual'` so we can detect the 302 = auth failed.
 *
 * Also detects whether the token looks like a Bot API token (has a
 * colon `1234567890:ABC...`) — Bot API tokens do NOT work with the
 * gateway.telegram.org endpoint. They require using
 * `api.telegram.org/bot<token>/sendMessage` instead.
 */
export async function GET(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if (!auth.success) return authErrorResponse(auth);

  // 1. Check the env var
  const token = process.env.TELEGRAM_GATEWAY_API_TOKEN || '';
  const tokenPresent = !!token;
  const tokenLength = token.length;
  const tokenHasWhitespace = token !== token.trim();
  const tokenLooksValid = tokenPresent && !tokenHasWhitespace && tokenLength > 20;

  // 1b. Detect the token TYPE — Gateway API vs Bot API.
  //     - Bot API tokens have a colon: `<bot_id>:<hash>` (e.g., "1234567890:ABC...")
  //     - Gateway API tokens are usually a single hex/alphanumeric string.
  const tokenHasColon = token.includes(':');
  const tokenType = !tokenPresent ? 'missing'
    : tokenHasColon ? 'bot_api'
    : 'gateway';

  // 2. Fetch the user's phone (so we can actually probe the gateway)
  const { data: profile } = await supabaseServer
    .from('users')
    .select('id, phone, account_status, phone_verified')
    .eq('id', auth.user.id)
    .maybeSingle();
  const p = profile as { id: string; phone: string | null; account_status: string; phone_verified: boolean } | null;
  const userPhone = p?.phone || null;

  // 3. Phone format check
  const phoneFormatOk = !!userPhone && /^\+?[\d]{6,15}$/.test(userPhone.replace(/[\s-]/g, ''));
  const phoneStartsWithPlus = !!userPhone && userPhone.trim().startsWith('+');

  // 4. Probe BOTH endpoints to determine which one the token works with.
  let gatewayProbe: Record<string, unknown> = { attempted: false };
  let botApiProbe: Record<string, unknown> = { attempted: false };

  // 4a. Gateway API probe — uses the CORRECT endpoint per the official
  //     docs at https://gateway.telegram.org/docs:
  //       URL: https://gatewayapi.telegram.org/sendVerificationMessage
  //     (NOT https://gateway.telegram.org/sendCode which is just the
  //     dashboard web page and always returns HTML).
  //     We use redirect: 'manual' to detect any 302 auth failures.
  if (tokenLooksValid && userPhone && phoneStartsWithPlus) {
    gatewayProbe.attempted = true;
    try {
      const url = 'https://gatewayapi.telegram.org/sendVerificationMessage';
      const startTime = Date.now();
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          phone_number: userPhone,
          code: '000000', // sentinel — Telegram should accept the request
                          // and the user will receive an OTP. They can
                          // ignore it. (Real OTPs come from /api/auth/resend-otp.)
        }),
        redirect: 'manual',
        signal: AbortSignal.timeout(15000),
      });
      const elapsed = Date.now() - startTime;
      const body = await res.text();
      let parsed: { ok?: boolean; error?: string } | null = null;
      try { parsed = JSON.parse(body); } catch { /* not JSON */ }

      gatewayProbe = {
        attempted: true,
        http_status: res.status,
        http_ok: res.ok,
        elapsed_ms: elapsed,
        response_preview: body.slice(0, 500),
        response_content_type: res.headers.get('content-type'),
        parsed,
        // Telegram Gateway returns {ok: true} on success, {ok: false, error: ...} on failure
        token_accepted: parsed?.ok === true,
        // Specific error codes per the official docs
        error_code: parsed?.error,
      };
    } catch (e) {
      gatewayProbe.error = e instanceof Error ? e.message : 'unknown error';
      gatewayProbe.error_type = e?.constructor?.name;
    }
  }

  // 4b. Bot API probe — only if the token has a colon (i.e., looks like
  //     a Bot API token). Calls getMe which is read-only and validates
  //     the token.
  if (tokenPresent && tokenHasColon) {
    botApiProbe.attempted = true;
    try {
      const url = `https://api.telegram.org/bot${token}/getMe`;
      const startTime = Date.now();
      const res = await fetch(url, {
        method: 'GET',
        signal: AbortSignal.timeout(10000),
      });
      const elapsed = Date.now() - startTime;
      const body = await res.text();
      let parsed: unknown = null;
      try { parsed = JSON.parse(body); } catch { /* not JSON */ }
      botApiProbe = {
        attempted: true,
        http_status: res.status,
        http_ok: res.ok,
        elapsed_ms: elapsed,
        response_preview: body.slice(0, 500),
        parsed,
        token_is_valid_bot_api:
          res.status === 200 && (parsed as { ok?: boolean } | null)?.ok === true,
      };
    } catch (e) {
      botApiProbe.error = e instanceof Error ? e.message : 'unknown error';
    }
  }

  // 5. Compose verdict
  let verdict = 'unknown';
  if (!tokenPresent) {
    verdict = 'TELEGRAM_GATEWAY_API_TOKEN env var is NOT set. Add it in Vercel Project Settings → Environment Variables, then redeploy.';
  } else if (tokenHasWhitespace) {
    verdict = 'Token has leading/trailing whitespace — re-copy the token without spaces.';
  } else if (tokenHasColon) {
    if (botApiProbe.attempted && botApiProbe.token_is_valid_bot_api) {
      verdict = '⚠️ You provided a Telegram BOT API token (has colon). Bot API tokens are for api.telegram.org/bot<token>/sendMessage, NOT for the Telegram Gateway. Get a real Gateway API token from https://gateway.telegram.org → log in → Account → API token.';
    } else if (botApiProbe.attempted) {
      verdict = `Token has a colon (Bot API format) but Bot API also rejected it (HTTP ${botApiProbe.http_status}). Token is invalid or revoked.`;
    } else {
      verdict = 'Token has a colon (Bot API format). The Gateway endpoint will reject it.';
    }
  } else if (!userPhone) {
    verdict = "User has no phone stored. The trigger or ensure-pending-verification didn't store the phone from auth metadata.";
  } else if (!phoneStartsWithPlus) {
    verdict = `Phone "${userPhone}" doesn't start with +. Telegram Gateway requires E.164 international format like +201012345678.`;
  } else if (gatewayProbe.attempted && gatewayProbe.token_accepted === true) {
    verdict = '✅ Telegram Gateway accepted the token and sent the probe OTP. The real OTP from /api/auth/resend-otp should also work. If you still don\'t receive the code, check: (a) the Telegram app on the phone is registered to the same number, (b) Telegram is installed and signed in, (c) the phone is not in DND mode.';
  } else if (gatewayProbe.attempted && typeof gatewayProbe.error_code === 'string') {
    const code = gatewayProbe.error_code;
    const arabicErrorMap: Record<string, string> = {
      'ACCESS_TOKEN_INVALID': 'توكن تليجرام غير صالح أو مُلغى. تحقق من قيمة TELEGRAM_GATEWAY_API_TOKEN في Vercel.',
      'ACCESS_TOKEN_EXPIRED': 'انتهت صلاحية التوكن. أعد توليده من لوحة تحكم Telegram Gateway.',
      'PHONE_NUMBER_INVALID': `رقم الهاتف (${userPhone}) غير صالح. يجب أن يكون بصيغة E.164 مثل +201555614624.`,
      'PHONE_NUMBER_FLOOD': 'تم إرسال العديد من الأكواد لهذا الرقم مؤخراً. حاول لاحقاً.',
      'MESSAGE_RATE_LIMIT_EXCEEDED': 'تم تجاوز حد الإرسال. حاول لاحقاً.',
      'USER_NOT_FOUND': 'لا يوجد حساب تليجرام بهذا الرقم.',
      'ACCOUNT_BLOCKED': 'تم حظر حسابك في Telegram Gateway.',
      'BALANCE_NOT_ENOUGH': '⚠️ رصيد TON غير كافٍ في حسابك. سجّل دخول على https://gateway.telegram.org → شحن المحفظة بعملة TON.',
      'INSUFFICIENT_FUNDS': '⚠️ رصيد غير كافٍ. أعد شحن المحفظة بـ TON من https://gateway.telegram.org.',
    };
    verdict = arabicErrorMap[code] || `Gateway returned error: ${code}`;
  } else if (gatewayProbe.attempted && gatewayProbe.error) {
    verdict = `Gateway probe failed with network error: ${gatewayProbe.error}. Likely a DNS/firewall issue from Vercel's region.`;
  } else if (gatewayProbe.attempted) {
    verdict = `Gateway returned HTTP ${gatewayProbe.http_status} with content-type ${gatewayProbe.response_content_type}. See response_preview for details.`;
  }

  return NextResponse.json({
    token_present: tokenPresent,
    token_length: tokenLength,
    token_has_whitespace: tokenHasWhitespace,
    token_has_colon: tokenHasColon,
    token_type: tokenType,
    token_looks_valid: tokenLooksValid,
    user_phone: userPhone,
    phone_starts_with_plus: phoneStartsWithPlus,
    phone_format_ok: phoneFormatOk,
    gateway_probe: gatewayProbe,
    bot_api_probe: botApiProbe,
    verdict,
  });
}

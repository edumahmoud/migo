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

  // 4a. Gateway API probe — DON'T follow redirects, because Telegram
  //     returns 302 → / when auth fails (and 200 with HTML when
  //     followed, which is misleading).
  if (tokenLooksValid && userPhone && phoneStartsWithPlus) {
    gatewayProbe.attempted = true;
    try {
      const url = 'https://gateway.telegram.org/sendCode';
      const startTime = Date.now();
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          phone_number: userPhone,
          code: '000000', // sentinel
          sender: 'AttenDo',
        }),
        redirect: 'manual', // ← CRITICAL: don't follow the 302
        signal: AbortSignal.timeout(15000),
      });
      const elapsed = Date.now() - startTime;
      const body = await res.text();
      const location = res.headers.get('location');
      gatewayProbe = {
        attempted: true,
        http_status: res.status,
        http_ok: res.ok,
        elapsed_ms: elapsed,
        response_preview: body.slice(0, 500),
        response_headers: {
          'content-type': res.headers.get('content-type'),
          'location': location,
        },
        // 302 with location: '/' = AUTH FAILED (token rejected)
        auth_failed: res.status === 302 && (location === '/' || location === ''),
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
      verdict = '⚠️ You provided a Telegram BOT API token (has colon). It is valid for the Bot API, but NOT for gateway.telegram.org/sendCode. Two options:\n' +
        '   (1) Get a real Gateway API token from https://my.telegram.org → API Development Tools → Telegram Gateway.\n' +
        '   (2) Switch the OTP code to use the Bot API (requires the student to send /start to your bot first — not viable for signups).';
    } else if (botApiProbe.attempted) {
      verdict = `Token has a colon (Bot API format) but Bot API also rejected it (HTTP ${botApiProbe.http_status}). Token is invalid or revoked.`;
    } else {
      verdict = 'Token has a colon (Bot API format). The Gateway endpoint will reject it.';
    }
  } else if (!userPhone) {
    verdict = "User has no phone stored. The trigger or ensure-pending-verification didn't store the phone from auth metadata.";
  } else if (!phoneStartsWithPlus) {
    verdict = `Phone "${userPhone}" doesn't start with +. Telegram Gateway requires E.164 international format like +201012345678.`;
  } else if (gatewayProbe.attempted && gatewayProbe.auth_failed) {
    verdict = 'Gateway returned 302 → / (auth failed). The Gateway API token is REJECTED by Telegram. Token is wrong, revoked, or you\'re using a Bot API token (which has a colon) instead. Get a valid Gateway API token from https://my.telegram.org → API Development Tools.';
  } else if (gatewayProbe.attempted && gatewayProbe.error) {
    verdict = `Gateway probe failed with network error: ${gatewayProbe.error}. Likely a DNS/firewall issue from Vercel's region.`;
  } else if (gatewayProbe.attempted && gatewayProbe.http_status === 200) {
    verdict = 'Gateway returned 200 OK. If you still don\'t receive the code in Telegram, check: (a) the Telegram app on your phone is registered to the same phone number, (b) Telegram is installed and signed in.';
  } else if (gatewayProbe.attempted && gatewayProbe.http_status === 302) {
    verdict = 'Gateway returned 302 redirect → auth failed. Token is rejected.';
  } else if (gatewayProbe.attempted) {
    verdict = `Gateway returned HTTP ${gatewayProbe.http_status}. See response_preview for details.`;
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

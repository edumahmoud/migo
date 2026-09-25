import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateRequest, authErrorResponse } from '@/lib/auth-helpers';

/**
 * GET /api/setup/check-telegram-gateway
 *
 * Diagnostic that reports whether the Telegram Gateway API is reachable
 * from the server, and whether the env var is correctly set.
 *
 * No body required. Auth required (so we can read the user's phone to
 * test the actual delivery path).
 */
export async function GET(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if (!auth.success) return authErrorResponse(auth);

  // 1. Check the env var
  const token = process.env.TELEGRAM_GATEWAY_API_TOKEN || '';
  const tokenPresent = !!token;
  const tokenLength = token.length;
  // Sanity-check the token format (Telegram Gateway tokens are
  // numeric strings, usually 30-50 chars)
  const tokenHasWhitespace = token !== token.trim();
  const tokenLooksValid = tokenPresent && !tokenHasWhitespace && tokenLength > 20;

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

  // 4. If we have a phone + token, try a dry-run request to the gateway
  //    (we'll send a sentinel code like "000000" — Telegram will reject
  //    it as invalid, but the HTTP response will tell us whether auth
  //    + connectivity work.)
  let gatewayProbe: Record<string, unknown> = { attempted: false };
  if (tokenLooksValid && userPhone) {
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
          code: '000000', // sentinel — Telegram should reject this
          sender: 'AttenDo',
        }),
        signal: AbortSignal.timeout(15000),
      });
      const elapsed = Date.now() - startTime;
      const body = await res.text();
      gatewayProbe = {
        attempted: true,
        http_status: res.status,
        http_ok: res.ok,
        elapsed_ms: elapsed,
        response_preview: body.slice(0, 500),
        response_headers: {
          'content-type': res.headers.get('content-type'),
          'www-authenticate': res.headers.get('www-authenticate'),
        },
      };
    } catch (e) {
      gatewayProbe.error = e instanceof Error ? e.message : 'unknown error';
      gatewayProbe.error_type = e?.constructor?.name;
    }
  }

  // 5. Compose verdict
  let verdict = 'unknown';
  if (!tokenPresent) {
    verdict = 'TELEGRAM_GATEWAY_API_TOKEN env var is NOT set. Add it in Vercel Project Settings → Environment Variables, then redeploy.';
  } else if (tokenHasWhitespace) {
    verdict = 'Token has leading/trailing whitespace — re-copy the token from Telegram Gateway dashboard and paste without spaces.';
  } else if (tokenLength <= 20) {
    verdict = `Token looks too short (${tokenLength} chars). Verify it's the full token from Telegram Gateway.`;
  } else if (!userPhone) {
    verdict = "User has no phone stored. The trigger or ensure-pending-verification didn't store the phone from auth metadata.";
  } else if (!phoneStartsWithPlus) {
    verdict = `Phone "${userPhone}" doesn't start with +. Telegram Gateway requires E.164 international format like +201012345678.`;
  } else if (!phoneFormatOk) {
    verdict = `Phone "${userPhone}" doesn't look like a valid E.164 number.`;
  } else if (gatewayProbe.attempted && gatewayProbe.error) {
    verdict = `Gateway probe failed with network error: ${gatewayProbe.error}. Likely a DNS/firewall issue from Vercel's region.`;
  } else if (gatewayProbe.attempted && gatewayProbe.http_status === 401) {
    verdict = 'Gateway returned 401 Unauthorized. Token is wrong or revoked. Re-generate it from Telegram Gateway dashboard.';
  } else if (gatewayProbe.attempted && gatewayProbe.http_status === 200) {
    verdict = 'Gateway accepted the request. If the user still doesn\'t receive the code in Telegram, check: (a) the user\'s Telegram app is registered to the same phone number, (b) the user has the official Telegram app installed and signed in.';
  } else if (gatewayProbe.attempted) {
    verdict = `Gateway returned HTTP ${gatewayProbe.http_status}. See response_preview for details.`;
  }

  return NextResponse.json({
    token_present: tokenPresent,
    token_length: tokenLength,
    token_has_whitespace: tokenHasWhitespace,
    token_looks_valid: tokenLooksValid,
    user_phone: userPhone,
    phone_starts_with_plus: phoneStartsWithPlus,
    phone_format_ok: phoneFormatOk,
    gateway_probe: gatewayProbe,
    verdict,
  });
}

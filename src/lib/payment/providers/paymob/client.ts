/**
 * Paymob HTTP Client
 *
 * Thin wrapper around fetch() for Paymob API calls.
 * Handles authentication, error mapping, and timeout.
 *
 * Uses the Intention API (not legacy token/order flow):
 *   POST https://intake.paymob.com/v1/intentions/  — Create
 *   GET  https://intake.paymob.com/v1/intentions/{id}  — Get status
 *
 * ERROR HANDLING (Phase 14 fix):
 *   The previous implementation wrapped fetch + JSON.parse in a single
 *   try/catch and labeled ALL non-PaymentError exceptions as "Failed to
 *   connect to Paymob API". This meant:
 *     - Real network errors (DNS failure, timeout) → "Failed to connect"
 *     - JSON.parse errors (Paymob returned HTML/redirect) → "Failed to connect"
 *     - Redirect responses (302 → fetch follows → HTML) → "Failed to connect"
 *   All three were categorized as PAYMOB_NETWORK_FAILURE, which showed
 *   the user "تعذّر الاتصال ببوابة الدفع" even when the actual issue was
 *   a wrong API key or a non-JSON response.
 *
 *   The fix:
 *     1. Set redirect: 'manual' to prevent following redirects. If
 *        Paymob returns a redirect (e.g., 302 to a login page), we
 *        detect it and throw a clear error instead of following it.
 *     2. Separate JSON.parse errors from network errors:
 *        - fetch() throws → "Failed to connect to Paymob API" (real network)
 *        - JSON.parse throws → "Paymob response is not valid JSON" (non-JSON)
 *     3. Check Content-Type header — if not application/json, throw
 *        a clear error (the response might be an HTML error page).
 */

import {
  PaymentCreationFailedError,
  PaymentVerificationFailedError,
} from '../../errors';
import type { PaymobIntentionResponse } from './types';

const INTAKE_BASE = 'https://intake.paymob.com';
const API_TIMEOUT_MS = 15000;

/**
 * Create a Paymob Payment Intention.
 *
 * @param secretKey  Paymob secret key for Authorization header
 * @param body       The intention request body (amount in cents!)
 * @returns          The intention response (id, client_secret, etc.)
 */
export async function createIntention(
  secretKey: string,
  body: Record<string, unknown>,
): Promise<PaymobIntentionResponse> {
  let res: Response;
  try {
    res = await fetch(`${INTAKE_BASE}/v1/intentions/`, {
      method: 'POST',
      headers: {
        'Authorization': `Token ${secretKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
      redirect: 'manual', // Don't follow redirects — detect them explicitly
    });
  } catch (err) {
    // This catch ONLY covers fetch-level failures (network error, DNS
    // failure, connection refused, timeout). It does NOT cover JSON
    // parse errors or non-JSON responses — those are handled below.
    throw new PaymentCreationFailedError(
      'paymob',
      'Failed to connect to Paymob API',
      err,
    );
  }

  // Check for redirect responses (3xx). Paymob should NOT redirect for
  // API calls — if it does, the API key may be wrong, the account may
  // lack Intention API access, or the URL may be incorrect.
  if (res.status >= 300 && res.status < 400) {
    const location = res.headers.get('location') || '(no location header)';
    throw new PaymentCreationFailedError(
      'paymob',
      `Paymob API returned a redirect (HTTP ${res.status}) — check API key and Intention API access`,
      { httpStatus: res.status, redirectLocation: location.slice(0, 200) },
    );
  }

  const text = await res.text();

  if (!res.ok) {
    // Map Paymob error to unified PaymentCreationFailedError.
    // The error MESSAGE is safe (HTTP status only) — does NOT include
    // raw response body. The full body is kept in `cause` for internal
    // debugging (stripped by PaymentError.toJSON() before reaching the client).
    throw new PaymentCreationFailedError(
      'paymob',
      `Paymob API request failed (HTTP ${res.status})`,
      { httpStatus: res.status, body: text.slice(0, 500) },
    );
  }

  // Check Content-Type — if not JSON, the response is likely an HTML
  // error page (Paymob maintenance, captcha, etc.).
  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json') && !contentType.includes('text/json')) {
    throw new PaymentCreationFailedError(
      'paymob',
      'Paymob response is not valid JSON — check API key and account configuration',
      { httpStatus: res.status, contentType, bodyPreview: text.slice(0, 200) },
    );
  }

  // Parse JSON — if this fails, the response was not valid JSON even
  // though the Content-Type said it was.
  let json: PaymobIntentionResponse;
  try {
    json = JSON.parse(text) as PaymobIntentionResponse;
  } catch (err) {
    throw new PaymentCreationFailedError(
      'paymob',
      'Paymob response is not valid JSON — check API key and account configuration',
      { httpStatus: res.status, bodyPreview: text.slice(0, 200) },
    );
  }

  // Validate the response has the required fields
  if (!json.id || !json.client_secret) {
    throw new PaymentCreationFailedError(
      'paymob',
      'Paymob response missing required fields (id or client_secret)',
      { response: text.slice(0, 500) },
    );
  }

  return json;
}

/**
 * Get a Paymob Intention's status (for verifyPayment).
 *
 * @param secretKey     Paymob secret key
 * @param intentionId   The intention ID (from createIntention response.id)
 * @returns             The intention response (with status, amount, etc.)
 */
export async function getIntention(
  secretKey: string,
  intentionId: string,
): Promise<PaymobIntentionResponse> {
  let res: Response;
  try {
    res = await fetch(`${INTAKE_BASE}/v1/intentions/${intentionId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Token ${secretKey}`,
      },
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
      redirect: 'manual',
    });
  } catch (err) {
    throw new PaymentVerificationFailedError(
      'paymob',
      'Failed to connect to Paymob API for verification',
      err,
    );
  }

  // Check for redirect responses
  if (res.status >= 300 && res.status < 400) {
    const location = res.headers.get('location') || '(no location header)';
    throw new PaymentVerificationFailedError(
      'paymob',
      `Paymob API returned a redirect (HTTP ${res.status}) — check API key`,
      { httpStatus: res.status, redirectLocation: location.slice(0, 200) },
    );
  }

  const text = await res.text();

  if (!res.ok) {
    throw new PaymentVerificationFailedError(
      'paymob',
      `Paymob API request failed (HTTP ${res.status})`,
      { httpStatus: res.status, body: text.slice(0, 500) },
    );
  }

  // Check Content-Type
  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json') && !contentType.includes('text/json')) {
    throw new PaymentVerificationFailedError(
      'paymob',
      'Paymob response is not valid JSON',
      { httpStatus: res.status, contentType, bodyPreview: text.slice(0, 200) },
    );
  }

  let json: PaymobIntentionResponse;
  try {
    json = JSON.parse(text) as PaymobIntentionResponse;
  } catch (err) {
    throw new PaymentVerificationFailedError(
      'paymob',
      'Paymob response is not valid JSON',
      { httpStatus: res.status, bodyPreview: text.slice(0, 200) },
    );
  }

  return json;
}

/**
 * Build the Paymob hosted checkout URL.
 * The student is redirected here to complete payment.
 *
 * @param intentionId   The intention ID from createIntention response
 * @param clientSecret   The client_secret from the same response
 * @returns              The hosted checkout URL
 */
export function buildCheckoutUrl(intentionId: string, clientSecret: string): string {
  return `${INTAKE_BASE}/v1/intentions/${intentionId}?clientSecret=${clientSecret}`;
}

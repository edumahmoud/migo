/**
 * Paymob HTTP Client — Accept API
 *
 * Uses the Paymob Accept API (NOT the deprecated Intention API).
 *
 * ROOT CAUSE of previous failure: the Intention API used
 * `https://intake.paymob.com` which does NOT resolve in DNS (NXDOMAIN
 * confirmed from Google DNS + Cloudflare DNS + local DNS). The Accept
 * API uses `https://accept.paymob.com` which resolves correctly and
 * is the only working Paymob API.
 *
 * Accept API flow (3 steps + redirect):
 *   1. POST /api/auth/tokens           → get auth token
 *   2. POST /api/ecommerce/orders      → create Paymob order
 *   3. POST /api/acceptance/payment_keys → get payment token
 *   4. Redirect to /api/acceptance/iframes/{id}?payment_token={token}
 *
 * The webhook callback format is the SAME for both APIs — HMAC
 * verification + the callback object structure are identical.
 * The only difference: the Accept API callback uses
 * `obj.order.merchant_order_id` (our UUID) instead of
 * `obj.special_reference`.
 *
 * DEBUG LOGGING:
 *   On non-2xx responses, the full Paymob response body (truncated to
 *   1000 chars) is logged server-side via console.error with a
 *   `[paymob:debug]` prefix. This body contains the Paymob-specific
 *   error code/message that explains WHY Paymob rejected the request
 *   (e.g., "Amount is less than minimum", "Invalid phone", etc.).
 *   The body is NEVER exposed to the client — only the safe,
 *   categorized Arabic message is returned.
 */

import {
  PaymentCreationFailedError,
  PaymentVerificationFailedError,
} from '../../errors';

const ACCEPT_BASE = 'https://accept.paymob.com';
const API_TIMEOUT_MS = 15000;

// ─── Response types ───
export interface PaymobAuthTokenResponse {
  token: string;
}

export interface PaymobOrderResponse {
  id: number;               // Paymob's internal order ID
  merchant_order_id?: string; // our internal order UUID
  amount_cents?: number;
  currency?: string;
}

export interface PaymobPaymentKeyResponse {
  token: string;            // payment token for the iframe URL
}

export interface PaymobTransactionResponse {
  id: number;
  success: boolean;
  pending: boolean;
  is_refunded: boolean;
  amount_cents?: number;
  currency?: string;
  order?: { id: number; merchant_order_id?: string };
}

// ─── Helper: fetch with error handling ───
async function paymobFetch(
  url: string,
  options: RequestInit,
  errorPrefix: string,
): Promise<Response> {
  try {
    const res = await fetch(url, {
      ...options,
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
      redirect: 'manual',
    });
    return res;
  } catch (err) {
    // Network error / timeout / DNS failure / connection refused
    console.error(`[paymob:debug] network error during ${errorPrefix}:`, {
      url,
      message: err instanceof Error ? err.message : String(err),
    });
    throw new PaymentCreationFailedError(
      'paymob',
      `Failed to connect to Paymob API (${errorPrefix})`,
      err,
    );
  }
}

// ─── Helper: parse JSON response with Content-Type check ───
//
// On non-2xx: throws PaymentCreationFailedError with a SAFE message
// (no provider data) AND logs the full Paymob body server-side.
//
async function parseJsonResponse(
  res: Response,
  errorPrefix: string,
): Promise<Record<string, unknown>> {
  // Check for redirect (3xx)
  if (res.status >= 300 && res.status < 400) {
    console.error(`[paymob:debug] ${errorPrefix} got HTTP ${res.status} redirect`);
    throw new PaymentCreationFailedError(
      'paymob',
      `Paymob API returned a redirect (HTTP ${res.status}) — check API key`,
      { httpStatus: res.status },
    );
  }

  const text = await res.text();

  if (!res.ok) {
    // ── LOG THE FULL PAYMOB RESPONSE BODY (server-side only) ──
    // This is the ONLY way to know WHY Paymob rejected the request.
    // Examples of what Paymob returns here:
    //   {"detail": "Invalid phone number"}
    //   {"detail": "amount cannot be less than 100 cents"}
    //   {"detail": "This integration is not enabled for your account"}
    //   {"detail": "Currency not supported"}
    console.error(`[paymob:debug] ${errorPrefix} failed:`, {
      httpStatus: res.status,
      statusText: res.statusText,
      body: text.slice(0, 1000),
    });

    throw new PaymentCreationFailedError(
      'paymob',
      `Paymob API request failed (HTTP ${res.status}) — ${errorPrefix}`,
      { httpStatus: res.status, body: text.slice(0, 500) },
    );
  }

  // Check Content-Type
  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json') && !contentType.includes('text/json')) {
    console.error(`[paymob:debug] ${errorPrefix} non-JSON response:`, {
      contentType,
      bodyPreview: text.slice(0, 500),
    });
    throw new PaymentCreationFailedError(
      'paymob',
      `Paymob response is not valid JSON — ${errorPrefix}`,
      { httpStatus: res.status, contentType, bodyPreview: text.slice(0, 200) },
    );
  }

  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    console.error(`[paymob:debug] ${errorPrefix} JSON parse failed:`, {
      bodyPreview: text.slice(0, 500),
    });
    throw new PaymentCreationFailedError(
      'paymob',
      `Paymob response is not valid JSON — ${errorPrefix}`,
      { httpStatus: res.status, bodyPreview: text.slice(0, 200) },
    );
  }
}

// ─── Step 1: Get Auth Token ───
export async function getAuthToken(apiKey: string): Promise<string> {
  console.info('[paymob:debug] step 1: requesting auth token');
  const res = await paymobFetch(
    `${ACCEPT_BASE}/api/auth/tokens`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: apiKey }),
    },
    'auth token',
  );

  const json = await parseJsonResponse(res, 'auth token');
  const token = json.token as string | undefined;

  if (!token) {
    console.error('[paymob:debug] auth token response missing "token":', {
      response: JSON.stringify(json).slice(0, 500),
    });
    throw new PaymentCreationFailedError(
      'paymob',
      'Paymob auth token response missing "token" field',
      { response: JSON.stringify(json).slice(0, 500) },
    );
  }

  console.info('[paymob:debug] step 1 OK: got auth token');
  return token;
}

// ─── Step 2: Create Order ───
export async function createOrder(
  authToken: string,
  body: {
    amount_cents: number;
    currency: string;
    merchant_order_id: string;
    items: Array<{ name: string; amount_cents: number; quantity: number }>;
    delivery_needed?: boolean;
  },
): Promise<PaymobOrderResponse> {
  console.info('[paymob:debug] step 2: creating order', {
    amount_cents: body.amount_cents,
    currency: body.currency,
    merchant_order_id: body.merchant_order_id,
    itemCount: body.items.length,
  });

  const res = await paymobFetch(
    `${ACCEPT_BASE}/api/ecommerce/orders`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        auth_token: authToken,
        delivery_needed: false,
        amount_cents: body.amount_cents,
        currency: body.currency,
        merchant_order_id: body.merchant_order_id,
        items: body.items,
      }),
    },
    'create order',
  );

  const json = await parseJsonResponse(res, 'create order');
  const id = json.id as number | undefined;

  if (id === undefined || id === null) {
    console.error('[paymob:debug] order response missing "id":', {
      response: JSON.stringify(json).slice(0, 500),
    });
    throw new PaymentCreationFailedError(
      'paymob',
      'Paymob order response missing "id" field',
      { response: JSON.stringify(json).slice(0, 500) },
    );
  }

  console.info(`[paymob:debug] step 2 OK: created Paymob order id=${id}`);
  return {
    id,
    merchant_order_id: json.merchant_order_id as string | undefined,
    amount_cents: json.amount_cents as number | undefined,
    currency: json.currency as string | undefined,
  };
}

// ─── Step 3: Get Payment Key ───
export async function getPaymentKey(
  authToken: string,
  body: {
    amount_cents: number;
    order_id: number;
    currency: string;
    integration_id: number;
    billing_data: Record<string, unknown>;
    expiration?: number;
  },
): Promise<PaymobPaymentKeyResponse> {
  console.info('[paymob:debug] step 3: requesting payment key', {
    amount_cents: body.amount_cents,
    order_id: body.order_id,
    integration_id: body.integration_id,
    billing_data: body.billing_data,
  });

  const res = await paymobFetch(
    `${ACCEPT_BASE}/api/acceptance/payment_keys`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        auth_token: authToken,
        expiration: 3600, // 1 hour
        amount_cents: body.amount_cents,
        currency: body.currency,
        integration_id: body.integration_id,
        order_id: body.order_id,
        billing_data: body.billing_data,
      }),
    },
    'payment key',
  );

  const json = await parseJsonResponse(res, 'payment key');
  const token = json.token as string | undefined;

  if (!token) {
    console.error('[paymob:debug] payment key response missing "token":', {
      response: JSON.stringify(json).slice(0, 500),
    });
    throw new PaymentCreationFailedError(
      'paymob',
      'Paymob payment key response missing "token" field',
      { response: JSON.stringify(json).slice(0, 500) },
    );
  }

  console.info('[paymob:debug] step 3 OK: got payment token');
  return { token };
}

// ─── Step 4: Build iframe URL ───
export function buildIframeUrl(integrationId: number, paymentToken: string): string {
  return `${ACCEPT_BASE}/api/acceptance/iframes/${integrationId}?payment_token=${paymentToken}`;
}

// ─── Verify: Get transaction status (for verifyPayment) ───
export async function getTransaction(
  authToken: string,
  transactionId: string,
): Promise<PaymobTransactionResponse> {
  const res = await paymobFetch(
    `${ACCEPT_BASE}/api/acceptance/transactions/${transactionId}`,
    {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${authToken}`,
      },
    },
    'get transaction',
  );

  const json = await parseJsonResponse(res, 'get transaction');

  return {
    id: json.id as number,
    success: json.success as boolean,
    pending: json.pending as boolean,
    is_refunded: json.is_refunded as boolean,
    amount_cents: json.amount_cents as number | undefined,
    currency: json.currency as string | undefined,
    order: json.order as { id: number; merchant_order_id?: string } | undefined,
  };
}

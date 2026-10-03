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
    /**
     * The URL Paymob will POST the webhook callback to AFTER the
     * payment is processed. Per-transaction configuration — Paymob
     * sends the webhook to THIS URL for THIS transaction, regardless
     * of any account-level webhook settings.
     *
     * If NOT set, Paymob uses the account-level webhook URL
     * (configured in Paymob Dashboard → Settings → Account Info →
     * Webhook). For merchant accounts where the account-level
     * webhook URL is NOT configured, the webhook will never fire
     * unless we send `notification_url` here.
     */
    notification_url?: string;
  },
): Promise<PaymobPaymentKeyResponse> {
  console.info('[paymob:debug] step 3: requesting payment key', {
    amount_cents: body.amount_cents,
    order_id: body.order_id,
    integration_id: body.integration_id,
    notification_url: body.notification_url,
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
        // CRITICAL: send notification_url so Paymob knows where to POST
        // the webhook callback for THIS transaction. Without this,
        // Paymob relies on the account-level webhook URL (which many
        // merchant accounts don't have configured) and the webhook
        // never fires → student's account is never activated.
        notification_url: body.notification_url,
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

// ─── Intention API (NEW — preferred over the 3-step Accept API) ───
//
// The Intention API is Paymob's modern API that supports per-transaction
// `notification_url` and `redirection_url`. This means:
//   - Paymob POSTs the webhook callback to OUR URL after payment
//     (no need to configure account-level webhook URL in Dashboard)
//   - Paymob redirects the student back to OUR app after payment
//     (no need to configure account-level redirect URL in Dashboard)
//
// Authentication: uses the SECRET_KEY directly in the Authorization
// header (`Authorization: Token <SECRET_KEY>`). No separate
// `/api/auth/tokens` call needed.
//
// Checkout URL: built using the returned `client_secret` + the
// merchant's `publicKey`:
//   https://accept.paymob.com/unifiedcheckout/?publicKey={pk}&clientSecret={cs}
//
// The Unified Checkout page automatically handles ALL payment methods
// (card, wallet, kiosk, BNPL) — no need for separate iframe IDs.
//
// Reference: https://github.com/PaymobAccept/Paymob-AI-Integration-Skill/blob/main/skills/paymob-integration/references/intention-api.md
//
export interface PaymobIntentionResponse {
  id: string;                       // Intention ID (use as paymentReference)
  intention_order_id?: number;      // Paymob's internal order ID
  client_secret: string;            // used to launch Unified Checkout
  status?: string;                  // e.g. "intended"
  confirmed?: boolean;
}

export interface PaymobIntentionRequest {
  amount: number;                   // in CENTS (not major units)
  currency: string;                 // ISO 4217
  payment_methods: number[];        // integration IDs as integers
  items?: Array<{
    name: string;
    amount_cents: number;           // v110: Paymob Intention API uses amount_cents (NOT amount)
    quantity?: number;
    description?: string;
  }>;
  billing_data: Record<string, unknown>;
  extras?: Record<string, unknown>;
  special_reference?: string;       // our internal order ID
  expiration?: number;              // seconds
  notification_url?: string;        // webhook URL — Paymob POSTs here after payment
  redirection_url?: string;         // browser redirect URL — student lands here after payment
}

export async function createIntention(
  secretKey: string,
  body: PaymobIntentionRequest,
): Promise<PaymobIntentionResponse> {
  console.info('[paymob:debug] intention: creating intention', {
    amount: body.amount,
    currency: body.currency,
    payment_methods: body.payment_methods,
    special_reference: body.special_reference,
    notification_url: body.notification_url,
    redirection_url: body.redirection_url,
  });

  const res = await paymobFetch(
    `${ACCEPT_BASE}/v1/intention/`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Intention API uses Token auth (NOT Bearer)
        'Authorization': `Token ${secretKey}`,
      },
      body: JSON.stringify({
        amount: body.amount,
        currency: body.currency,
        payment_methods: body.payment_methods,
        items: body.items ?? [],
        billing_data: body.billing_data,
        extras: body.extras,
        special_reference: body.special_reference,
        expiration: body.expiration ?? 3600,
        notification_url: body.notification_url,
        redirection_url: body.redirection_url,
      }),
    },
    'create intention',
  );

  const json = await parseJsonResponse(res, 'create intention');

  // Extract the client_secret (the critical value for launching checkout)
  const clientSecret = json.client_secret as string | undefined;
  if (!clientSecret) {
    console.error('[paymob:debug] intention response missing client_secret:', {
      response: JSON.stringify(json).slice(0, 500),
    });
    throw new PaymentCreationFailedError(
      'paymob',
      'Paymob intention response missing "client_secret" field',
      { response: JSON.stringify(json).slice(0, 500) },
    );
  }

  const id = json.id as string | undefined;
  if (!id) {
    console.error('[paymob:debug] intention response missing "id":', {
      response: JSON.stringify(json).slice(0, 500),
    });
    throw new PaymentCreationFailedError(
      'paymob',
      'Paymob intention response missing "id" field',
      { response: JSON.stringify(json).slice(0, 500) },
    );
  }

  console.info('[paymob:debug] intention OK:', {
    id,
    intention_order_id: json.intention_order_id,
    status: json.status,
    client_secret_length: clientSecret.length,
  });

  return {
    id,
    intention_order_id: json.intention_order_id as number | undefined,
    client_secret: clientSecret,
    status: json.status as string | undefined,
    confirmed: json.confirmed as boolean | undefined,
  };
}

// ─── Build Unified Checkout URL (Intention API flow) ───
//
// Returns: https://accept.paymob.com/unifiedcheckout/?publicKey={pk}&clientSecret={cs}
//
export function buildUnifiedCheckoutUrl(publicKey: string, clientSecret: string): string {
  return `${ACCEPT_BASE}/unifiedcheckout/?publicKey=${encodeURIComponent(publicKey)}&clientSecret=${encodeURIComponent(clientSecret)}`;
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

// ─── Query transactions by Paymob order ID ───
//
// This is the ROOT solution for detecting approved payments.
// We don't need the webhook OR the transaction ID from the redirect URL.
// We just query Paymob directly using the order ID we already have
// stored in orders.provider_order_ref.
//
// Tries multiple Paymob API endpoints (not all are documented, but
// at least one should work for most merchant accounts):
//
//   1. GET /api/ecommerce/orders/{id} — might include a `transactions` array
//   2. POST /api/acceptance/transactions/search — search with order_id filter
//   3. GET /api/acceptance/transactions/?order_id={id} — query param filter
//
// Returns ALL transactions found for the order (caller filters for
// successful ones).
//
export async function getOrderTransactions(
  authToken: string,
  paymobOrderId: string,
): Promise<PaymobTransactionResponse[]> {
  const results: PaymobTransactionResponse[] = [];
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${authToken}`,
    'Content-Type': 'application/json',
  };

  // Helper: parse a raw transaction object into our type
  const parseTx = (raw: Record<string, unknown>): PaymobTransactionResponse => ({
    id: raw.id as number,
    success: raw.success as boolean,
    pending: raw.pending as boolean,
    is_refunded: raw.is_refunded as boolean,
    amount_cents: raw.amount_cents as number | undefined,
    currency: raw.currency as string | undefined,
    order: raw.order as { id: number; merchant_order_id?: string } | undefined,
  });

  // ── Attempt 1: GET /api/ecommerce/orders/{id} ──
  // The order response might include a `transactions` array.
  try {
    const res = await fetch(
      `${ACCEPT_BASE}/api/ecommerce/orders/${paymobOrderId}`,
      { method: 'GET', headers, signal: AbortSignal.timeout(10000) },
    );
    if (res.ok) {
      const json = await res.json() as Record<string, unknown>;
      // Check for `transactions` array in the order response
      const txns = json.transactions;
      if (Array.isArray(txns) && txns.length > 0) {
        console.info('[paymob:debug] getOrderTransactions: found transactions in order response', {
          count: txns.length,
        });
        for (const t of txns) {
          results.push(parseTx(t as Record<string, unknown>));
        }
        return results;
      }
      // Some Paymob versions return a single transaction object (not array)
      if (json.id && json.success !== undefined) {
        console.info('[paymob:debug] getOrderTransactions: order response IS a transaction');
        results.push(parseTx(json));
        return results;
      }
    }
  } catch (err) {
    console.warn('[paymob:debug] getOrderTransactions attempt 1 failed:', err instanceof Error ? err.message : String(err));
  }

  // ── Attempt 2: POST /api/acceptance/transactions/search ──
  // Send order_id in the POST body to search for transactions.
  try {
    const res = await fetch(
      `${ACCEPT_BASE}/api/acceptance/transactions/search`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ order_id: Number(paymobOrderId) }),
        signal: AbortSignal.timeout(10000),
      },
    );
    if (res.ok) {
      const json = await res.json();
      // Response might be an array OR an object with `results` array
      const txns = Array.isArray(json) ? json :
        (json && typeof json === 'object' && Array.isArray((json as Record<string, unknown>).results))
          ? (json as Record<string, unknown>).results as unknown[]
          : [];
      if (txns.length > 0) {
        console.info('[paymob:debug] getOrderTransactions: found via /search endpoint', {
          count: txns.length,
        });
        for (const t of txns) {
          results.push(parseTx(t as Record<string, unknown>));
        }
        return results;
      }
    }
  } catch (err) {
    console.warn('[paymob:debug] getOrderTransactions attempt 2 failed:', err instanceof Error ? err.message : String(err));
  }

  // ── Attempt 3: GET /api/acceptance/transactions/?order_id={id} ──
  // Query param filter (undocumented but might work for some accounts).
  try {
    const res = await fetch(
      `${ACCEPT_BASE}/api/acceptance/transactions/?order_id=${paymobOrderId}`,
      { method: 'GET', headers, signal: AbortSignal.timeout(10000) },
    );
    if (res.ok) {
      const json = await res.json();
      const txns = Array.isArray(json) ? json :
        (json && typeof json === 'object' && Array.isArray((json as Record<string, unknown>).results))
          ? (json as Record<string, unknown>).results as unknown[]
          : [];
      if (txns.length > 0) {
        console.info('[paymob:debug] getOrderTransactions: found via query param', {
          count: txns.length,
        });
        for (const t of txns) {
          results.push(parseTx(t as Record<string, unknown>));
        }
        return results;
      }
    }
  } catch (err) {
    console.warn('[paymob:debug] getOrderTransactions attempt 3 failed:', err instanceof Error ? err.message : String(err));
  }

  // ── Attempt 4: POST /api/ecommerce/orders/{id}/transactions ──
  // Another undocumented but possible endpoint.
  try {
    const res = await fetch(
      `${ACCEPT_BASE}/api/ecommerce/orders/${paymobOrderId}/transactions`,
      { method: 'GET', headers, signal: AbortSignal.timeout(10000) },
    );
    if (res.ok) {
      const json = await res.json();
      const txns = Array.isArray(json) ? json :
        (json && typeof json === 'object' && Array.isArray((json as Record<string, unknown>).results))
          ? (json as Record<string, unknown>).results as unknown[]
          : [];
      if (txns.length > 0) {
        console.info('[paymob:debug] getOrderTransactions: found via /orders/{id}/transactions', {
          count: txns.length,
        });
        for (const t of txns) {
          results.push(parseTx(t as Record<string, unknown>));
        }
        return results;
      }
    }
  } catch (err) {
    console.warn('[paymob:debug] getOrderTransactions attempt 4 failed:', err instanceof Error ? err.message : String(err));
  }

  console.info('[paymob:debug] getOrderTransactions: no transactions found for order', {
    paymobOrderId,
    attempts: 4,
  });
  return results;
}

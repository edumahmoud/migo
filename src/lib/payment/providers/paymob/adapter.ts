/**
 * Paymob Adapter — Accept API
 *
 * Implements the PaymentGateway interface for Paymob's Accept API.
 *
 * ROOT CAUSE of previous failure: the adapter used the Intention API
 * (`intake.paymob.com`) which does NOT resolve in DNS (NXDOMAIN).
 * Switched to the Accept API (`accept.paymob.com`) which is the
 * only working Paymob API.
 *
 * Accept API flow (3 steps + redirect):
 *   1. POST /api/auth/tokens           → auth token
 *   2. POST /api/ecommerce/orders      → Paymob order ID
 *   3. POST /api/acceptance/payment_keys → payment token
 *   4. Redirect to /api/acceptance/iframes/{id}?payment_token={token}
 *
 * Webhook callback: SAME format as before — HMAC verification is
 * unchanged. The only difference: the Accept API callback uses
 * `obj.order.merchant_order_id` (our UUID) instead of
 * `obj.special_reference`. The adapter now checks both.
 *
 * BILLING DATA:
 *   Paymob's Accept API requires all billing_data fields to be
 *   present (non-empty). The student doesn't fill these in — we
 *   provide safe defaults:
 *     - first_name/last_name: from customerName (or 'Student'/'User')
 *     - email: from customerEmail (or 'student@attendo.local')
 *     - phone_number: from customerPhone, normalized to E.164 (+20...)
 *     - building/floor/apartment/street/shipping_method: 'NA'
 *     - city: 'Cairo', country: 'EG'
 *
 *   The phone number normalization handles the common Egyptian formats:
 *     - '01012345678'           → '+201012345678'
 *     - '201012345678'          → '+201012345678'
 *     - '+201012345678'         → '+201012345678'
 *     - '0020101234567'         → '+20101234567'
 *   If the phone can't be parsed, falls back to a valid Egyptian
 *   test number ('+201000000000').
 */

import {
  PaymentCreationFailedError,
  PaymentVerificationFailedError,
  WebhookVerificationFailedError,
  GatewayConfigurationInvalidError,
} from '../../errors';
import {
  getAuthToken,
  createOrder,
  getPaymentKey,
  buildIframeUrl,
  getTransaction,
} from './client';
import { verifyPaymobHmac } from './hmac';
import { appendGatewayIdToUrl } from '../../utils';
import type {
  PaymentGateway,
  GatewayCapabilities,
  GatewayCredentials,
  GatewayConfiguration,
  CreatePaymentInput,
  CreatePaymentResult,
  VerifyPaymentInput,
  VerifyPaymentResult,
  WebhookInput,
  WebhookResult,
  GatewayConnectionTestResult,
  PaymentStatus,
} from '../../types';
import type { PaymobCredentials, PaymobConfiguration, PaymobCallbackPayload } from './types';

// ─── Paymob capabilities ───
const PAYMOB_CAPABILITIES: GatewayCapabilities = {
  supportsRefund: false,
  supportsVerify: true,         // GET transaction endpoint
  supportsWebhook: true,        // HMAC-verified callbacks
  supportsTestConnection: true, // Validates by actually calling Paymob /api/auth/tokens
  supportsRedirectCheckout: true,  // Hosted iframe checkout
  supportsEmbeddedCheckout: false,
};

// ─── Amount conversion: major units → cents ───
function toCents(amount: number): number {
  return Math.round(amount * 100);
}

// ─── Normalize phone number to E.164 (Egyptian) ───
//
// Paymob's Accept API validates `billing_data.phone_number` strictly.
// Historically, plain Egyptian numbers like '01012345678' triggered
// HTTP 500 because Paymob expected the country-code prefix.
//
// This function accepts the common Egyptian formats and returns
// a string in E.164 form starting with '+20'. If the input can't
// be parsed, it falls back to a valid Egyptian test number.
//
function normalizeEgPhone(input: string | undefined | null): string {
  const fallback = '+201000000000';
  if (!input || typeof input !== 'string') return fallback;

  // Strip everything except digits and leading +
  let s = input.trim();

  // Already in E.164 form
  if (/^\+20\d{9,12}$/.test(s)) return s;

  // Remove spaces, dashes, parens
  s = s.replace(/[\s\-()]/g, '');

  // Strip leading '00' (international prefix)
  if (s.startsWith('00')) s = s.slice(2);

  // Now we should have either:
  //   '20xxxxxxxxxx' (already has country code)
  //   '0xxxxxxxxxx'  (Egyptian local — leading 0)
  //   'xxxxxxxxxxx'  (no leading 0)

  if (s.startsWith('20')) return `+${s}`;
  if (s.startsWith('0')) s = s.slice(1);
  // Egyptian mobile numbers: 10 digits (01x xxxxxxxx)
  // Egyptian landline: 9-10 digits without leading 0
  if (s.length >= 9 && s.length <= 12) {
    return `+20${s}`;
  }

  return fallback;
}

// ─── Cast credentials safely ───
function castCredentials(creds: GatewayCredentials): PaymobCredentials {
  const c = creds as unknown as PaymobCredentials;
  if (!c.secretKey || typeof c.secretKey !== 'string') {
    throw new GatewayConfigurationInvalidError('paymob', 'Missing or invalid API Key (secretKey)');
  }
  if (!c.hmacSecret || typeof c.hmacSecret !== 'string') {
    throw new GatewayConfigurationInvalidError('paymob', 'Missing or invalid hmacSecret');
  }
  if (!c.integrationIds || !Array.isArray(c.integrationIds) || c.integrationIds.length === 0) {
    throw new GatewayConfigurationInvalidError('paymob', 'Missing integrationIds — required for Accept API (found in Paymob Dashboard → Payment Channels → Integrations)');
  }
  return c;
}

// ─── Cast configuration safely ───
function castConfiguration(config?: GatewayConfiguration): PaymobConfiguration {
  if (!config) {
    throw new GatewayConfigurationInvalidError('paymob', 'Missing configuration (notificationUrl, redirectionUrl)');
  }
  const c = config as unknown as PaymobConfiguration;
  if (!c.notificationUrl || typeof c.notificationUrl !== 'string') {
    throw new GatewayConfigurationInvalidError('paymob', 'Missing notificationUrl');
  }
  if (!c.redirectionUrl || typeof c.redirectionUrl !== 'string') {
    throw new GatewayConfigurationInvalidError('paymob', 'Missing redirectionUrl');
  }
  return c;
}

// ─── The adapter ───
export class PaymobAdapter implements PaymentGateway {
  readonly provider = 'paymob';
  readonly capabilities = PAYMOB_CAPABILITIES;

  /**
   * Create a Paymob payment via the Accept API.
   *
   * Flow:
   *   1. Get auth token (POST /api/auth/tokens with API key)
   *   2. Create order (POST /api/ecommerce/orders with merchant_order_id = our UUID)
   *   3. Get payment key (POST /api/acceptance/payment_keys with integration_id)
   *   4. Build iframe URL (redirect student to hosted checkout)
   */
  async createPayment(
    input: CreatePaymentInput,
    credentials: GatewayCredentials,
    configuration?: GatewayConfiguration,
  ): Promise<CreatePaymentResult> {
    const creds = castCredentials(credentials);
    const config = castConfiguration(configuration);

    // Validate amount
    if (input.amount <= 0) {
      throw new PaymentCreationFailedError('paymob', 'Amount must be > 0');
    }
    if (!input.currency || input.currency.length !== 3) {
      throw new PaymentCreationFailedError('paymob', `Invalid currency: ${input.currency}`);
    }

    const amountCents = toCents(input.amount);
    // Determine the payment method (default: card).
    // Each payment method in Paymob has its OWN integration ID + iframe ID.
    // Card: uses `integrationIds[0]` + `iframeId`
    // Wallet: uses `walletIntegrationId` + `walletIframeId`
    const paymentMethod = input.paymentMethod ?? 'card';

    let integrationId: number;
    let iframeId: number;

    if (paymentMethod === 'wallet') {
      // Wallet payment — require walletIntegrationId
      if (!creds.walletIntegrationId) {
        throw new GatewayConfigurationInvalidError(
          'paymob',
          'Wallet payment is not configured — set walletIntegrationId in gateway credentials',
        );
      }
      integrationId = creds.walletIntegrationId;
      // Wallet iframe ID: use the dedicated walletIframeId if set,
      // otherwise fall back to the card iframeId (some Paymob accounts
      // share the iframe across integrations).
      iframeId = creds.walletIframeId ?? creds.iframeId ?? integrationId;
    } else {
      // Card payment (default)
      integrationId = creds.integrationIds![0]; // first card integration ID
      iframeId = creds.iframeId ?? integrationId;
    }

    // Build notification_url with gateway_id (for gateway snapshot)
    const notificationUrl = config.gatewayId
      ? appendGatewayIdToUrl(config.notificationUrl, config.gatewayId)
      : config.notificationUrl;

    // Build billing_data (required by Accept API — ALL fields must be present).
    // Paymob returns HTTP 500 if any required billing_data field is missing
    // OR if the phone number format is invalid (not E.164).
    // We provide defaults for fields the student didn't fill in.
    const billingData: Record<string, string> = {
      first_name: 'Student',
      last_name: 'User',
      email: input.customerEmail || 'student@attendo.local',
      phone_number: normalizeEgPhone(input.customerPhone),
      building: 'NA',
      floor: 'NA',
      apartment: 'NA',
      city: 'Cairo',
      country: 'EG',
      street: 'NA',
      shipping_method: 'NA',
    };
    if (input.customerName) {
      const parts = input.customerName.trim().split(/\s+/);
      billingData.first_name = parts[0] || 'Student';
      billingData.last_name = parts.slice(1).join(' ') || 'User';
    }

    // ── Step 1: Get auth token ──
    const authToken = await getAuthToken(creds.secretKey);

    // ── Step 2: Create order ──
    // CRITICAL: Paymob's Accept API expects `amount_cents` (not `amount`)
    // for each item. Using `amount` here caused HTTP 500 on some merchant
    // accounts that strictly validate the schema.
    const order = await createOrder(authToken, {
      amount_cents: amountCents,
      currency: input.currency,
      merchant_order_id: input.orderId, // our internal UUID or session_id
      items: [
        {
          name: input.description || 'Course Subscription',
          amount_cents: amountCents,
          quantity: 1,
        },
      ],
    });

    // ── Step 3: Get payment key ──
    const paymentKey = await getPaymentKey(authToken, {
      amount_cents: amountCents,
      order_id: order.id,
      currency: input.currency,
      integration_id: integrationId,
      billing_data: billingData,
    });

    // ── Step 4: Build iframe URL ──
    // Use the iframeId (NOT the integration ID) — they are different
    // values on most Paymob accounts.
    const checkoutUrl = buildIframeUrl(iframeId, paymentKey.token);

    return {
      success: true,
      provider: 'paymob',
      paymentReference: String(order.id), // Paymob order ID (numeric)
      providerOrderReference: String(order.id),
      checkoutUrl,
      clientSecret: paymentKey.token,
      expiresAt: undefined,
      metadata: {
        amountCents,
        currency: input.currency,
        merchantOrderId: input.orderId,
        paymobOrderId: order.id,
        integrationId,
        iframeId,
        paymentMethod,
        notificationUrl,
      },
    };
  }

  /**
   * Verify a Paymob transaction's status.
   *
   * Calls the Accept API's transaction endpoint to check the current
   * payment status. This is NOT the primary verification method —
   * the webhook callback (HMAC-verified) is the source of truth.
   */
  async verifyPayment(
    input: VerifyPaymentInput,
    credentials: GatewayCredentials,
    _configuration?: GatewayConfiguration,
  ): Promise<VerifyPaymentResult> {
    const creds = castCredentials(credentials);

    if (!input.paymentReference) {
      throw new PaymentVerificationFailedError('paymob', 'Missing paymentReference (transaction ID)');
    }

    // Get auth token + transaction status
    const authToken = await getAuthToken(creds.secretKey);
    const tx = await getTransaction(authToken, input.paymentReference);

    const status: PaymentStatus = tx.is_refunded ? 'refunded' : tx.success ? 'paid' : tx.pending ? 'pending' : 'failed';

    return {
      success: status === 'paid',
      status,
      amount: tx.amount_cents ? tx.amount_cents / 100 : 0,
      currency: tx.currency || 'EGP',
      providerTransactionId: String(tx.id),
      paidAt: status === 'paid' ? new Date().toISOString() : undefined,
      metadata: {
        transactionId: tx.id,
        merchantOrderId: tx.order?.merchant_order_id,
      },
    };
  }

  /**
   * Handle a Paymob webhook callback.
   *
   * HMAC verification is UNCHANGED — the callback format is the same
   * for both Intention API and Accept API.
   *
   * The only difference: the Accept API callback uses
   * `obj.order.merchant_order_id` (our UUID) instead of
   * `obj.special_reference`. The adapter now checks BOTH.
   */
  async handleWebhook(
    input: WebhookInput,
    credentials: GatewayCredentials,
    _configuration?: GatewayConfiguration,
  ): Promise<WebhookResult> {
    const creds = castCredentials(credentials);

    // Parse the callback body
    let payload: PaymobCallbackPayload;
    try {
      payload = JSON.parse(input.rawBody) as PaymobCallbackPayload;
    } catch {
      throw new WebhookVerificationFailedError('paymob', 'Invalid JSON in callback body');
    }

    // Verify HMAC — CRITICAL security check (UNCHANGED)
    verifyPaymobHmac(payload, creds.hmacSecret);

    // Extract payment details from the verified callback
    const obj = payload.obj as Record<string, unknown> | undefined;
    if (!obj) {
      throw new WebhookVerificationFailedError('paymob', 'Callback obj missing after HMAC verification');
    }

    // Extract the internal order reference.
    // Try BOTH formats:
    //   - Intention API: obj.special_reference OR obj.order.special_reference
    //   - Accept API: obj.order.merchant_order_id OR obj.merchant_order_id
    const orderRef = obj.special_reference as string | undefined
      || (obj.order && typeof obj.order === 'object'
        ? (obj.order as Record<string, unknown>)?.special_reference as string | undefined
          || (obj.order as Record<string, unknown>)?.merchant_order_id as string | undefined
        : undefined)
      || (obj.merchant_order_id as string | undefined)
      || undefined;

    // Map the payment status
    const success = obj.success === true || obj.success === 'true';
    const pending = obj.pending === true || obj.pending === 'true';
    const isRefunded = obj.is_refunded === true || obj.is_refunded === 'true';

    let status: PaymentStatus;
    if (isRefunded) {
      status = 'refunded';
    } else if (success) {
      status = 'paid';
    } else if (pending) {
      status = 'pending';
    } else {
      status = 'failed';
    }

    // Extract amount (cents → major units)
    const amountCents = typeof obj.amount_cents === 'number'
      ? obj.amount_cents
      : typeof obj.amount === 'number'
        ? obj.amount
        : undefined;
    const amount = amountCents !== undefined ? amountCents / 100 : undefined;

    const currency = obj.currency as string | undefined;

    // Extract transaction ID
    const providerTransactionId = obj.id !== undefined ? String(obj.id) : undefined;

    return {
      success: success,
      provider: 'paymob',
      orderId: orderRef,  // the internal order UUID or session_id
      paymentReference: providerTransactionId,
      providerTransactionId,
      amount,
      currency,
      status,
      paidAt: success ? new Date().toISOString() : undefined,
      metadata: {
        callbackType: payload.type,
        merchantOrderId: orderRef,
        integrationId: obj.integration_id,
      },
    };
  }

  /**
   * Test the connection to Paymob.
   *
   * ACTUAL connection test (not just format check). Calls Paymob's
   * /api/auth/tokens endpoint with the API key. If Paymob returns a
   * token, the API key is valid and the account is reachable.
   *
   * This is a stronger test than the previous version (which only
   * checked the format of the credentials). It catches:
   *   - Invalid API keys
   *   - Account suspended / disabled
   *   - Network connectivity issues
   *   - Paymob API outage
   *
   * It does NOT test integration IDs or HMAC (those are validated
   * only when a real payment is created or a webhook is received).
   */
  async testConnection(
    credentials: GatewayCredentials,
    _configuration?: GatewayConfiguration,
  ): Promise<GatewayConnectionTestResult> {
    try {
      const creds = castCredentials(credentials);

      // Try to actually get an auth token from Paymob.
      // This validates the API key against the live Paymob API.
      let token: string;
      try {
        token = await getAuthToken(creds.secretKey);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'unknown error';
        return {
          success: false,
          provider: 'paymob',
          message: `فشل الاتصال بـ Paymob: ${msg}`,
          testedAt: new Date().toISOString(),
        };
      }

      if (!token || token.length < 10) {
        return {
          success: false,
          provider: 'paymob',
          message: 'Paymob returned an invalid auth token',
          testedAt: new Date().toISOString(),
        };
      }

      // All checks passed
      return {
        success: true,
        provider: 'paymob',
        message: 'تم الاتصال بـ Paymob بنجاح. مفتاح API صالح.',
        testedAt: new Date().toISOString(),
      };
    } catch (err) {
      return {
        success: false,
        provider: 'paymob',
        message: err instanceof Error ? err.message : 'Configuration validation failed',
        testedAt: new Date().toISOString(),
      };
    }
  }
}

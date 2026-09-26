/**
 * Paymob Adapter
 *
 * Implements the PaymentGateway interface for Paymob's Intention API.
 *
 * Responsibilities (adapter only):
 *   - Create Payment Intention via Paymob API
 *   - Verify Payment Intention status
 *   - Verify webhook callback HMAC + parse the callback
 *   - Test connection (limited — see testConnection implementation)
 *
 * Does NOT:
 *   - Call activate_subscription_after_payment RPC
 *   - Modify orders/payments/subject_students tables
 *   - Branch on other providers
 *   - Trust frontend/redirect as payment truth
 */

import { createHmac, timingSafeEqual } from 'crypto';
import {
  PaymentCreationFailedError,
  PaymentVerificationFailedError,
  WebhookVerificationFailedError,
  GatewayConfigurationInvalidError,
  UnsupportedCapabilityError,
} from '../../errors';
import { createIntention, getIntention, buildCheckoutUrl } from './client';
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
  supportsRefund: false,        // Not implemented in Phase 4
  supportsVerify: true,         // GET intention endpoint
  supportsWebhook: true,        // HMAC-verified callbacks
  supportsTestConnection: true, // Minimal: validate secret key format
  supportsRedirectCheckout: true,  // Hosted checkout via Paymob
  supportsEmbeddedCheckout: false, // Not implemented
};

// ─── Amount conversion: major units → cents ───
// Paymob requires amounts in the smallest currency unit (e.g., piasters for EGP).
// 100.00 EGP → 10000 (cents/piasters)
function toCents(amount: number): number {
  return Math.round(amount * 100);
}

// ─── Cast credentials safely ───
function castCredentials(creds: GatewayCredentials): PaymobCredentials {
  const c = creds as unknown as PaymobCredentials;
  if (!c.secretKey || typeof c.secretKey !== 'string') {
    throw new GatewayConfigurationInvalidError('paymob', 'Missing or invalid secretKey');
  }
  if (!c.hmacSecret || typeof c.hmacSecret !== 'string') {
    throw new GatewayConfigurationInvalidError('paymob', 'Missing or invalid hmacSecret');
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
   * Create a Paymob Payment Intention.
   *
   * The adapter:
   *   1. Converts the amount to cents (smallest currency unit).
   *   2. Builds the Intention API request body.
   *   3. Sets special_reference = internal order ID (for callback linking).
   *   4. Sets notification_url from the gateway configuration.
   *   5. Calls Paymob's Intention API.
   *   6. Returns the checkout URL + client_secret.
   *
   * The adapter does NOT store anything in the database — the caller
   * (PaymentService + payment API) is responsible for updating the order
   * with the provider_order_ref (intention ID) + gateway_id.
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

    // Build the Intention API request body
    const amountCents = toCents(input.amount);

    // Build the notification_url with gateway_id appended — so the
    // webhook can resolve the EXACT gateway config used at payment
    // creation (gateway snapshot). This is GENERIC — any adapter
    // should do this. The helper handles URL separators (? vs &).
    const notificationUrl = config.gatewayId
      ? appendGatewayIdToUrl(config.notificationUrl, config.gatewayId)
      : config.notificationUrl;

    const body: Record<string, unknown> = {
      amount: amountCents,
      currency: input.currency,
      special_reference: input.orderId,  // internal order UUID — for callback linking
      notification_url: notificationUrl,
      redirection_url: config.redirectionUrl,
      items: [
        {
          name: input.description || 'Course Subscription',
          amount: amountCents,
          quantity: 1,
        },
      ],
    };

    // Add payment methods (from config or credentials)
    if (config.paymentMethods && config.paymentMethods.length > 0) {
      body.payment_methods = config.paymentMethods;
    } else if (creds.integrationIds && creds.integrationIds.length > 0) {
      body.payment_methods = creds.integrationIds;
    }

    // Add billing data if provided
    const billingData: Record<string, unknown> = {};
    if (input.customerEmail) billingData.email = input.customerEmail;
    if (input.customerName) {
      const parts = input.customerName.trim().split(/\s+/);
      billingData.first_name = parts[0] || '';
      billingData.last_name = parts.slice(1).join(' ') || '';
    }
    if (input.customerPhone) billingData.phone_number = input.customerPhone;
    if (Object.keys(billingData).length > 0) {
      body.billing_data = billingData;
    }

    // Add metadata if provided
    if (input.metadata) {
      body.extras = input.metadata;
    }

    // Call Paymob API
    const intention = await createIntention(creds.secretKey, body);

    // Build the checkout URL (hosted by Paymob)
    const checkoutUrl = buildCheckoutUrl(intention.id, intention.client_secret);

    return {
      success: true,
      provider: 'paymob',
      paymentReference: intention.id,               // intention ID
      providerOrderReference: intention.intention_order_id,  // Paymob's order ID
      checkoutUrl,                                     // student redirects here
      clientSecret: intention.client_secret,
      expiresAt: undefined, // Paymob doesn't always return expiry
      metadata: {
        amountCents,
        currency: intention.currency,
        specialReference: input.orderId,
      },
    };
  }

  /**
   * Verify a Paymob Payment Intention's status.
   *
   * Calls Paymob's GET intention endpoint to check the current
   * payment status. This is NOT the primary verification method —
   * the webhook callback (HMAC-verified) is the source of truth.
   * verifyPayment is a supplementary check.
   */
  async verifyPayment(
    input: VerifyPaymentInput,
    credentials: GatewayCredentials,
    _configuration?: GatewayConfiguration,
  ): Promise<VerifyPaymentResult> {
    const creds = castCredentials(credentials);

    if (!input.paymentReference) {
      throw new PaymentVerificationFailedError('paymob', 'Missing paymentReference (intention ID)');
    }

    // Call Paymob's GET intention endpoint
    const intention = await getIntention(creds.secretKey, input.paymentReference);

    // Map Paymob status to unified PaymentStatus
    const status = this.mapStatus(intention);

    return {
      success: status === 'paid',
      status,
      amount: intention.amount ? intention.amount / 100 : 0,  // cents → major
      currency: intention.currency || 'EGP',
      providerTransactionId: intention.id,
      paidAt: status === 'paid' ? new Date().toISOString() : undefined,
      metadata: {
        intentionId: intention.id,
        intentionOrderId: intention.intention_order_id,
        rawStatus: intention.status,
      },
    };
  }

  /**
   * Handle a Paymob webhook callback.
   *
   * The adapter:
   *   1. Parses the raw body as a Paymob callback.
   *   2. Verifies the HMAC signature using the gateway's hmacSecret.
   *   3. Extracts the payment details (status, amount, references).
   *   4. Returns a normalized WebhookResult.
   *
   * The adapter does NOT:
   *   - Activate subscriptions
   *   - Update orders
   *   - Call the RPC
   * Those are the webhook route's responsibility.
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

    // Verify HMAC — this is the CRITICAL security check
    // If this fails, the entire callback is rejected
    verifyPaymobHmac(payload, creds.hmacSecret);

    // Extract payment details from the verified callback
    const obj = payload.obj as Record<string, unknown> | undefined;
    if (!obj) {
      throw new WebhookVerificationFailedError('paymob', 'Callback obj missing after HMAC verification');
    }

    // Extract the internal order reference (special_reference)
    const specialReference = obj.special_reference as string | undefined
      || (obj.order && typeof obj.order === 'object' ? (obj.order as Record<string, unknown>)?.special_reference as string | undefined : undefined)
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

    // Extract amount (in cents → major units)
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
      orderId: specialReference,  // the internal order UUID
      paymentReference: providerTransactionId,  // Paymob's transaction ID
      providerTransactionId,
      amount,
      currency,
      status,
      paidAt: success ? new Date().toISOString() : undefined,
      metadata: {
        callbackType: payload.type,
        intentionOrderId: obj.intention_order_id,
        integrationId: obj.integration_id,
      },
    };
  }

  /**
   * Test the connection to Paymob.
   *
   * Since Paymob doesn't have a dedicated "test connection" endpoint,
   * we perform a minimal validation:
   *   - Check that the secretKey is non-empty and has a reasonable format
   *   - Check that the hmacSecret is non-empty
   *
   * We do NOT create a real payment to test the connection.
   */
  async testConnection(
    credentials: GatewayCredentials,
    _configuration?: GatewayConfiguration,
  ): Promise<GatewayConnectionTestResult> {
    try {
      const creds = castCredentials(credentials);
      // Basic format validation (without calling the API)
      if (creds.secretKey.length < 10) {
        return {
          success: false,
          provider: 'paymob',
          message: 'secretKey appears too short (expected a Paymob API key)',
          testedAt: new Date().toISOString(),
        };
      }
      if (creds.hmacSecret.length < 10) {
        return {
          success: false,
          provider: 'paymob',
          message: 'hmacSecret appears too short (expected a Paymob HMAC secret)',
          testedAt: new Date().toISOString(),
        };
      }
      return {
        success: true,
        provider: 'paymob',
        message: 'Credentials format is valid. To fully test, create a test payment in sandbox mode.',
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

  // refundPayment is NOT implemented — capabilities.supportsRefund = false
  // If called, the PaymentService will throw UnsupportedCapabilityError
  // before reaching this method.

  // ─── Internal: map Paymob intention status to unified PaymentStatus ───
  private mapStatus(intention: { success?: boolean; pending?: boolean; is_refunded?: boolean; status?: string }): PaymentStatus {
    if (intention.is_refunded) return 'refunded';
    if (intention.success) return 'paid';
    if (intention.pending) return 'pending';
    return 'failed';
  }
}

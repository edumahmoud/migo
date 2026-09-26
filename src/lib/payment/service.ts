/**
 * Payment Gateway Core — Payment Service
 *
 * The SINGLE entry point for all payment operations.
 *
 * Flow:
 *   Student Order → PaymentService → GatewayResolver → Adapter
 *
 * PaymentService responsibilities:
 *   - Delegate to GatewayResolver to get the right adapter
 *   - Call adapter methods with the resolved credentials
 *   - Log each operation via the safe logger
 *   - Map adapter errors to unified PaymentError
 *   - Enforce capability checks before calling optional methods
 *
 * PaymentService does NOT:
 *   - Branch on provider name (no `if (provider === 'paymob')`)
 *   - Directly modify subscriptions
 *   - Call activate_subscription_after_payment RPC
 *   - Access the orders table for writes
 *
 * The activation/subscription logic stays in the order/webhook layer.
 */

import { resolveDefaultGateway, resolveGatewayById, type ResolvedAdapter } from './resolver';
import { GatewayRegistry } from './registry';
import { UnsupportedCapabilityError, isPaymentError, PaymentError } from './errors';
import { logPaymentEvent } from './logger';
import type {
  CreatePaymentInput,
  CreatePaymentResult,
  VerifyPaymentInput,
  VerifyPaymentResult,
  WebhookInput,
  WebhookResult,
  GatewayConnectionTestResult,
  RefundInput,
  RefundResult,
  PaymentGateway,
} from './types';

class PaymentServiceImpl {
  /**
   * Create a payment via the default (or specified) gateway.
   * Returns the gateway's checkout URL / payment key for the client.
   */
  async createPayment(
    input: CreatePaymentInput,
    gatewayId?: string,
  ): Promise<CreatePaymentResult> {
    const { adapter, gateway } = await this.resolveAdapter(gatewayId);
    const startTime = Date.now();

    try {
      // Inject gatewayId into configuration so the adapter can build
      // the notification_url with the gateway snapshot reference.
      const configWithGatewayId = {
        ...gateway.configuration,
        gatewayId: gateway.id,
      };

      const result = await adapter.createPayment(
        input,
        gateway.credentials,
        configWithGatewayId,
      );

      // Inject the resolved gatewayId so the caller (pay endpoint)
      // can save it in orders.gateway_id — this is the gateway snapshot
      // that the webhook will use to resolve the correct credentials.
      result.gatewayId = gateway.id;

      logPaymentEvent({
        level: result.success ? 'info' : 'warn',
        operation: 'createPayment',
        provider: gateway.provider,
        orderId: input.orderId,
        paymentReference: result.paymentReference,
        providerOrderReference: result.providerOrderReference,
        success: result.success,
        durationMs: Date.now() - startTime,
      });

      return result;
    } catch (err) {
      logPaymentEvent({
        level: 'error',
        operation: 'createPayment',
        provider: gateway.provider,
        orderId: input.orderId,
        success: false,
        errorCode: isPaymentError(err) ? err.code : 'PAYMENT_CREATION_FAILED',
        message: err instanceof Error ? err.message : 'unknown error',
        durationMs: Date.now() - startTime,
      });
      throw this.normalizeError(err, gateway.provider);
    }
  }

  /**
   * Verify a payment's status via the gateway.
   */
  async verifyPayment(
    input: VerifyPaymentInput,
    gatewayId?: string,
  ): Promise<VerifyPaymentResult> {
    const { adapter, gateway } = await this.resolveAdapter(gatewayId);
    const startTime = Date.now();

    try {
      const result = await adapter.verifyPayment(
        input,
        gateway.credentials,
        gateway.configuration,
      );

      logPaymentEvent({
        level: result.success ? 'info' : 'warn',
        operation: 'verifyPayment',
        provider: gateway.provider,
        paymentReference: input.paymentReference,
        success: result.success,
        durationMs: Date.now() - startTime,
      });

      return result;
    } catch (err) {
      logPaymentEvent({
        level: 'error',
        operation: 'verifyPayment',
        provider: gateway.provider,
        paymentReference: input.paymentReference,
        success: false,
        errorCode: isPaymentError(err) ? err.code : 'PAYMENT_VERIFICATION_FAILED',
        message: err instanceof Error ? err.message : 'unknown error',
        durationMs: Date.now() - startTime,
      });
      throw this.normalizeError(err, gateway.provider);
    }
  }

  /**
   * Handle a webhook from a payment gateway.
   * The adapter verifies the webhook's authenticity (HMAC, signature, etc.)
   * before returning the parsed result.
   *
   * NOTE: This method does NOT activate subscriptions. The caller
   * (e.g., /api/payment/webhook) is responsible for calling the
   * activate_subscription_after_payment RPC after receiving a
   * verified WebhookResult.
   */
  async handleWebhook(
    input: WebhookInput,
    gatewayId?: string,
  ): Promise<WebhookResult> {
    const { adapter, gateway } = await this.resolveAdapter(gatewayId);
    const startTime = Date.now();

    try {
      const configWithGatewayId = {
        ...gateway.configuration,
        gatewayId: gateway.id,
      };

      const result = await adapter.handleWebhook(
        input,
        gateway.credentials,
        configWithGatewayId,
      );

      logPaymentEvent({
        level: result.success ? 'info' : 'warn',
        operation: 'handleWebhook',
        provider: gateway.provider,
        orderId: result.orderId,
        paymentReference: result.paymentReference,
        success: result.success,
        durationMs: Date.now() - startTime,
      });

      return result;
    } catch (err) {
      logPaymentEvent({
        level: 'error',
        operation: 'handleWebhook',
        provider: gateway.provider,
        success: false,
        errorCode: isPaymentError(err) ? err.code : 'WEBHOOK_VERIFICATION_FAILED',
        message: err instanceof Error ? err.message : 'unknown error',
        durationMs: Date.now() - startTime,
      });
      throw this.normalizeError(err, gateway.provider);
    }
  }

  /**
   * Test the connection to a gateway.
   */
  async testConnection(gatewayId?: string): Promise<GatewayConnectionTestResult> {
    const { adapter, gateway } = await this.resolveAdapter(gatewayId);

    // Capability check: does this gateway support test connection?
    if (!gateway.capabilities.supportsTestConnection) {
      throw new UnsupportedCapabilityError(gateway.provider, 'testConnection');
    }

    const startTime = Date.now();

    try {
      const result = await adapter.testConnection(
        gateway.credentials,
        gateway.configuration,
      );

      logPaymentEvent({
        level: result.success ? 'info' : 'warn',
        operation: 'testConnection',
        provider: gateway.provider,
        success: result.success,
        message: result.message,
        durationMs: Date.now() - startTime,
      });

      return result;
    } catch (err) {
      logPaymentEvent({
        level: 'error',
        operation: 'testConnection',
        provider: gateway.provider,
        success: false,
        errorCode: isPaymentError(err) ? err.code : 'UNKNOWN',
        message: err instanceof Error ? err.message : 'unknown error',
        durationMs: Date.now() - startTime,
      });
      throw this.normalizeError(err, gateway.provider);
    }
  }

  /**
   * Refund a payment (capability-based — not all gateways support this).
   */
  async refundPayment(
    input: RefundInput,
    gatewayId?: string,
  ): Promise<RefundResult> {
    const { adapter, gateway } = await this.resolveAdapter(gatewayId);

    // Capability check
    if (!gateway.capabilities.supportsRefund || !adapter.refundPayment) {
      throw new UnsupportedCapabilityError(gateway.provider, 'refundPayment');
    }

    const startTime = Date.now();

    try {
      const result = await adapter.refundPayment(
        input,
        gateway.credentials,
        gateway.configuration,
      );

      logPaymentEvent({
        level: result.success ? 'info' : 'warn',
        operation: 'refundPayment',
        provider: gateway.provider,
        paymentReference: input.paymentReference,
        success: result.success,
        durationMs: Date.now() - startTime,
      });

      return result;
    } catch (err) {
      logPaymentEvent({
        level: 'error',
        operation: 'refundPayment',
        provider: gateway.provider,
        paymentReference: input.paymentReference,
        success: false,
        errorCode: isPaymentError(err) ? err.code : 'UNKNOWN',
        message: err instanceof Error ? err.message : 'unknown error',
        durationMs: Date.now() - startTime,
      });
      throw this.normalizeError(err, gateway.provider);
    }
  }

  // ─── Internal helpers ───

  /**
   * Resolve the adapter to use. If gatewayId is provided, use that
   * specific gateway. Otherwise, use the default gateway.
   */
  private async resolveAdapter(gatewayId?: string): Promise<ResolvedAdapter> {
    if (gatewayId) {
      return resolveGatewayById(gatewayId);
    }
    return resolveDefaultGateway();
  }

  /**
   * Normalize any error to a PaymentError.
   * If it's already a PaymentError, return as-is.
   * Otherwise, wrap it.
   */
  private normalizeError(err: unknown, provider: string): PaymentError {
    if (isPaymentError(err)) {
      return err;
    }
    // Wrap non-PaymentError into a generic PaymentError
    return new PaymentError(
      'PAYMENT_CREATION_FAILED', // default code — caller should override
      err instanceof Error ? err.message : 'Unknown payment error',
      provider,
      err, // cause — NOT exposed in toJSON()
    );
  }
}

// ─── Singleton export ───
export const PaymentService = new PaymentServiceImpl();

// Re-export types + registry for convenience
export { GatewayRegistry } from './registry';
export type { PaymentGateway } from './types';

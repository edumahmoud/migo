/**
 * Payment Gateway Core — Abstract Adapter Interface
 *
 * This is the abstract interface that all provider-specific adapters
 * must implement. Phase 4 will add `PaymobAdapter`. Future phases
 * will add `FawryAdapter`, etc.
 *
 * The adapter is responsible ONLY for:
 *   - Provider API communication
 *   - Provider authentication
 *   - Provider-specific response mapping → unified types
 *
 * The adapter must NOT:
 *   - Directly modify subscriptions
 *   - Call activate_subscription_after_payment RPC
 *   - Access the orders table for writes
 *   - Branch on other providers
 *
 * That responsibility belongs to PaymentService + the order layer.
 */

import type {
  PaymentGateway,
  GatewayProvider,
  GatewayCapabilities,
} from './types';

/**
 * Abstract base class for payment gateway adapters.
 * Each adapter extends this and implements the PaymentGateway interface.
 *
 * The constructor takes the provider name + capabilities (declared
 * statically by each adapter subclass).
 */
export abstract class PaymentGatewayAdapter implements PaymentGateway {
  abstract readonly provider: GatewayProvider;
  abstract readonly capabilities: GatewayCapabilities;

  abstract createPayment(
    input: import('./types').CreatePaymentInput,
    credentials: import('./types').GatewayCredentials,
    configuration?: import('./types').GatewayConfiguration,
  ): Promise<import('./types').CreatePaymentResult>;

  abstract verifyPayment(
    input: import('./types').VerifyPaymentInput,
    credentials: import('./types').GatewayCredentials,
    configuration?: import('./types').GatewayConfiguration,
  ): Promise<import('./types').VerifyPaymentResult>;

  abstract handleWebhook(
    input: import('./types').WebhookInput,
    credentials: import('./types').GatewayCredentials,
    configuration?: import('./types').GatewayConfiguration,
  ): Promise<import('./types').WebhookResult>;

  abstract testConnection(
    credentials: import('./types').GatewayCredentials,
    configuration?: import('./types').GatewayConfiguration,
  ): Promise<import('./types').GatewayConnectionTestResult>;

  // refundPayment is optional — implemented only if capabilities.supportsRefund = true
  refundPayment?(
    input: import('./types').RefundInput,
    credentials: import('./types').GatewayCredentials,
    configuration?: import('./types').GatewayConfiguration,
  ): Promise<import('./types').RefundResult>;
}

/**
 * Payment Gateway Core — Type Definitions
 *
 * All types in this file are provider-agnostic. No Paymob, Fawry,
 * or any other provider-specific fields exist here.
 *
 * Provider-specific data (API keys, integration IDs, etc.) is
 * stored encrypted in the database and accessed only inside the
 * adapter via the GatewayCredentials container.
 */

// ─── Provider identifiers (extensible — new providers added in future) ───
export type GatewayProvider = string; // 'paymob' | 'fawry' | 'stripe' | ...
export type GatewayEnvironment = 'sandbox' | 'live';

// ─── Capability flags — each gateway declares what it supports ───
export interface GatewayCapabilities {
  supportsRefund: boolean;
  supportsVerify: boolean;
  supportsWebhook: boolean;
  supportsTestConnection: boolean;
  supportsRedirectCheckout: boolean;
  supportsEmbeddedCheckout: boolean;
}

// ─── Gateway metadata (non-secret — safe to log + return in API responses) ───
export interface GatewayMetadata {
  id: string;  // DB UUID — needed by admin UI to call [id] endpoints
  provider: GatewayProvider;
  displayName: string;
  environment: GatewayEnvironment;
  isEnabled: boolean;
  isDefault: boolean;
  capabilities: GatewayCapabilities;
}

// ─── Credentials container (provider-specific, encrypted at rest) ───
// The actual fields are defined by each adapter. The PaymentService
// and GatewayResolver never inspect the contents of this object.
export interface GatewayCredentials {
  [key: string]: unknown;
}

// ─── Non-credential configuration (e.g., webhook_url, allowed_updates) ───
export interface GatewayConfiguration {
  [key: string]: unknown;
}

// ─── Payment creation ───
export interface CreatePaymentInput {
  orderId: string;              // internal order UUID
  amount: number;               // in major units (e.g., EGP, not cents)
  currency: string;            // ISO 4217 (EGP, USD, etc.)
  customerEmail?: string;
  customerName?: string;
  customerPhone?: string;
  description?: string;
  redirectUrl?: string;         // post-payment redirect for redirect-checkout gateways
  metadata?: Record<string, unknown>;
}

export interface CreatePaymentResult {
  success: boolean;
  provider: GatewayProvider;
  gatewayId?: string;              // the resolved gateway's DB ID (for order linking — gateway snapshot)
  paymentReference?: string;       // gateway's payment ID
  providerOrderReference?: string; // gateway's order ID
  checkoutUrl?: string;            // for redirect-checkout gateways
  clientSecret?: string;           // for embedded-checkout gateways
  expiresAt?: string;              // ISO 8601 datetime
  metadata?: Record<string, unknown>; // provider-specific non-secret metadata
}

// ─── Payment verification ───
export interface VerifyPaymentInput {
  paymentReference: string;
  providerOrderReference?: string;
}

export interface VerifyPaymentResult {
  success: boolean;
  status: PaymentStatus;
  amount: number;
  currency: string;
  providerTransactionId?: string;
  paidAt?: string;
  metadata?: Record<string, unknown>;
}

// ─── Webhook handling ───
export interface WebhookInput {
  rawBody: string;
  headers: Record<string, string>;
  metadata?: Record<string, unknown>;
}

export interface WebhookResult {
  success: boolean;
  provider: GatewayProvider;
  orderId?: string;              // internal order ID (matched by the adapter)
  paymentReference?: string;     // gateway payment ID
  providerTransactionId?: string;
  amount?: number;
  currency?: string;
  status: PaymentStatus;
  paidAt?: string;
  metadata?: Record<string, unknown>;
}

// ─── Gateway connection test ───
export interface GatewayConnectionTestResult {
  success: boolean;
  provider: GatewayProvider;
  message: string;
  testedAt: string;              // ISO 8601
  details?: Record<string, unknown>;
}

// ─── Refund (capability-based — not all gateways support this) ───
export interface RefundInput {
  paymentReference: string;
  amount: number;                // partial or full
  reason?: string;
  metadata?: Record<string, unknown>;
}

export interface RefundResult {
  success: boolean;
  refundReference?: string;
  amount: number;
  status: 'pending' | 'completed' | 'failed';
  metadata?: Record<string, unknown>;
}

// ─── Unified payment status (maps from provider-specific statuses) ───
export type PaymentStatus = 'paid' | 'pending' | 'failed' | 'cancelled' | 'refunded';

// ─── The core PaymentGateway interface ───
// Each adapter implements this interface. The PaymentService calls
// these methods — it never branches on provider name.
export interface PaymentGateway {
  readonly provider: GatewayProvider;
  readonly capabilities: GatewayCapabilities;

  createPayment(
    input: CreatePaymentInput,
    credentials: GatewayCredentials,
    configuration?: GatewayConfiguration,
  ): Promise<CreatePaymentResult>;

  verifyPayment(
    input: VerifyPaymentInput,
    credentials: GatewayCredentials,
    configuration?: GatewayConfiguration,
  ): Promise<VerifyPaymentResult>;

  handleWebhook(
    input: WebhookInput,
    credentials: GatewayCredentials,
    configuration?: GatewayConfiguration,
  ): Promise<WebhookResult>;

  testConnection(
    credentials: GatewayCredentials,
    configuration?: GatewayConfiguration,
  ): Promise<GatewayConnectionTestResult>;

  // Optional capability — only present if capabilities.supportsRefund = true
  refundPayment?(
    input: RefundInput,
    credentials: GatewayCredentials,
    configuration?: GatewayConfiguration,
  ): Promise<RefundResult>;
}

/**
 * Payment Gateway Core — Public API
 *
 * This is the single import path for the payment abstraction layer.
 * External code should import from '@/lib/payment' — never from
 * individual submodules (to avoid coupling to internal structure).
 *
 * Phase 3: architecture only — no provider adapters implemented.
 * Phase 4: PaymobAdapter will be registered here.
 */

// ─── Public types ───
export type {
  GatewayProvider,
  GatewayEnvironment,
  GatewayCapabilities,
  GatewayMetadata,
  GatewayCredentials,
  GatewayConfiguration,
  CreatePaymentInput,
  CreatePaymentResult,
  VerifyPaymentInput,
  VerifyPaymentResult,
  WebhookInput,
  WebhookResult,
  GatewayConnectionTestResult,
  RefundInput,
  RefundResult,
  PaymentStatus,
  PaymentGateway,
} from './types';

// ─── Errors ───
export {
  PaymentError,
  PaymentErrorCode,
  GatewayNotFoundError,
  GatewayDisabledError,
  GatewayNotImplementedError,
  GatewayConfigurationInvalidError,
  PaymentCreationFailedError,
  PaymentVerificationFailedError,
  WebhookVerificationFailedError,
  UnsupportedCapabilityError,
  CredentialsMissingError,
  EncryptionKeyMissingError,
  isPaymentError,
} from './errors';

// ─── Service (entry point) ───
export { PaymentService } from './service';

// ─── Registry (for adapter registration in Phase 4) ───
export { GatewayRegistry } from './registry';

// ─── Repository (for admin API in future phases) ───
export {
  getDefaultGateway,
  getGateway,
  getGatewayById,
  listGateways,
  createGateway,
  updateGatewayConfig,
  setDefaultGateway,
  setGatewayEnabled,
  rowToMetadata,
  type ResolvedGateway,
  type CreateGatewayInput,
} from './repository';

// ─── Crypto (for testing) ───
export { encrypt, decrypt, isEncryptionKeyConfigured } from './crypto';

// ─── Audit (for admin API in future phases) ───
export {
  logGatewayAuditEvent,
  auditGatewayCreated,
  auditGatewayUpdated,
  auditGatewayEnabled,
  auditGatewayDisabled,
  auditGatewayDefaultChanged,
  auditGatewayConnectionTested,
  type GatewayAuditEvent,
  type AuditLogEntry,
} from './audit';

// ─── Abstract adapter base class (for adapter implementation) ───
export { PaymentGatewayAdapter } from './gateway-adapter';

// ─── Utility functions (for all adapters) ───
export { appendGatewayIdToUrl } from './utils';

// ─── Provider schemas (for admin UI form rendering) ───
export {
  getProviderSchema,
  listProviderSchemas,
  registerProviderSchema,
  type ProviderSchema,
  type ProviderFieldSchema,
} from './provider-schemas';

// ─── Financial Ledger (Phase 8) ───
export {
  calculateFinancialShares,
  toPublicMetadata,
  type FinancialCalculation,
  type LedgerRow,
  type LedgerMetadata,
} from './financial';

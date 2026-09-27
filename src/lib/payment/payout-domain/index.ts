export type {
  PayoutStatus, PayoutMethodSnapshot, PayoutRecord, PayoutMetadata,
  PayoutLedgerEntry, PayoutAuditEvent, PayoutAuditLogRecord,
} from './types';

export {
  PAYOUT_STATUSES, VALID_STATUS_TRANSITIONS, PAYOUT_AUDIT_EVENTS,
  PAYOUT_FORBIDDEN_FIELDS, isValidStatusTransition, isTerminalStatus,
  toPayoutMetadata, isValidPayoutAmount, currenciesMatch,
  canModifyAmount, canCancel, canRetry, canModifySnapshot,
  findForbiddenFields,
} from './types';

// Phase 13 Step 3 — Provider-agnostic contracts
export type {
  PayoutExecutionStatus,
  PayoutCapabilities,
  PayoutRequest,
  PayoutResult,
  PayoutProvider,
} from './provider';

export {
  PAYOUT_EXECUTION_STATUSES,
  providerSupportsMethod,
  providerSupportsCurrency,
  buildCompletedResult,
  buildFailedResult,
  buildAcceptedResult,
} from './provider';

export { PayoutProviderRegistry } from './provider-registry';

export {
  PayoutDomainError,
  UnsupportedMethodTypeError,
  UnsupportedCurrencyError,
  ProviderUnavailableError,
  InvalidPayoutStateError,
  IdempotencyConflictError,
  PayoutExecutionRejectedError,
  PayoutAlreadyCompletedError,
  PayoutCancelledError,
  isPayoutDomainError,
  getPayoutErrorCode,
} from './errors';

export type { PayoutErrorCode } from './errors';

// Phase 13 Step 4 — Dev stub adapter + registration
export { DevStubPayoutAdapter, devStubPayoutAdapter } from './adapters/dev-stub-adapter';
export { registerDevStubAdapter, unregisterDevStubAdapter } from './registration';

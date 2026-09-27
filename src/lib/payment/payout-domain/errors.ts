/**
 * Payout Domain Errors — Phase 13 Step 3
 *
 * Normalized, provider-independent domain errors for the payout
 * execution layer. Provider-specific error messages, SQL errors,
 * credentials, and raw provider payloads MUST NEVER leak through
 * these errors.
 *
 * Pattern mirrors src/lib/payment/errors.ts (PaymentError hierarchy).
 */

/**
 * Error codes for the payout execution domain.
 * Provider-independent — no Paymob/Fawry-specific codes.
 */
export type PayoutErrorCode =
  | 'UNSUPPORTED_METHOD_TYPE'
  | 'UNSUPPORTED_CURRENCY'
  | 'PROVIDER_UNAVAILABLE'
  | 'INVALID_PAYOUT_STATE'
  | 'IDEMPOTENCY_CONFLICT'
  | 'PAYOUT_EXECUTION_REJECTED'
  | 'PAYOUT_ALREADY_COMPLETED'
  | 'PAYOUT_CANCELLED';

/**
 * Base payout domain error. All payout execution errors extend this.
 *
 * The `cause` field may contain provider-specific details for
 * debugging, but `toJSON()` strips it — the serialized form
 * never leaks provider internals to the client.
 */
export class PayoutDomainError extends Error {
  constructor(
    public readonly code: PayoutErrorCode,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'PayoutDomainError';
  }

  /**
   * Safe serialization — strips `cause` (may contain provider
   * internals) and the stack trace.
   */
  toJSON(): { code: PayoutErrorCode; message: string } {
    return {
      code: this.code,
      message: this.message,
    };
  }
}

// ─── Specific error subclasses ───

export class UnsupportedMethodTypeError extends PayoutDomainError {
  constructor(methodType: string) {
    super('UNSUPPORTED_METHOD_TYPE', `Unsupported payout method type: ${methodType}`);
    this.name = 'UnsupportedMethodTypeError';
  }
}

export class UnsupportedCurrencyError extends PayoutDomainError {
  constructor(currency: string) {
    super('UNSUPPORTED_CURRENCY', `Unsupported currency: ${currency}`);
    this.name = 'UnsupportedCurrencyError';
  }
}

export class ProviderUnavailableError extends PayoutDomainError {
  constructor(methodType: string, currency: string) {
    super(
      'PROVIDER_UNAVAILABLE',
      `No payout provider available for method type '${methodType}' and currency '${currency}'`,
    );
    this.name = 'ProviderUnavailableError';
  }
}

export class InvalidPayoutStateError extends PayoutDomainError {
  constructor(currentStatus: string, attemptedAction: string) {
    super(
      'INVALID_PAYOUT_STATE',
      `Cannot ${attemptedAction} — payout is in state '${currentStatus}'`,
    );
    this.name = 'InvalidPayoutStateError';
  }
}

export class IdempotencyConflictError extends PayoutDomainError {
  constructor(idempotencyKey: string) {
    super(
      'IDEMPOTENCY_CONFLICT',
      `Idempotency conflict — a payout with key '${idempotencyKey}' already exists`,
    );
    this.name = 'IdempotencyConflictError';
  }
}

export class PayoutExecutionRejectedError extends PayoutDomainError {
  constructor(reason: string) {
    super('PAYOUT_EXECUTION_REJECTED', `Payout execution rejected: ${reason}`);
    this.name = 'PayoutExecutionRejectedError';
  }
}

export class PayoutAlreadyCompletedError extends PayoutDomainError {
  constructor(payoutId: string) {
    super('PAYOUT_ALREADY_COMPLETED', `Payout ${payoutId} is already completed`);
    this.name = 'PayoutAlreadyCompletedError';
  }
}

export class PayoutCancelledError extends PayoutDomainError {
  constructor(payoutId: string) {
    super('PAYOUT_CANCELLED', `Payout ${payoutId} is cancelled`);
    this.name = 'PayoutCancelledError';
  }
}

// ─── Helper: check if an error is a payout domain error ───
export function isPayoutDomainError(err: unknown): err is PayoutDomainError {
  return err instanceof PayoutDomainError;
}

// ─── Helper: get a safe error code from any error ───
export function getPayoutErrorCode(err: unknown): PayoutErrorCode | null {
  if (err instanceof PayoutDomainError) {
    return err.code;
  }
  return null;
}

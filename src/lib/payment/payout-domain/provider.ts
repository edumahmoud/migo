/**
 * Payout Provider-Agnostic Contracts — Phase 13 Step 3
 *
 * Defines ONLY interfaces/types/contracts for the payout execution
 * domain. NO real provider implementation. NO money transfer.
 *
 * Architecture principle:
 *   Payout Method ≠ Payout Provider. A method_type describes the
 *   SHAPE of recipient data. A provider is an external system that
 *   can execute transfers for one or more method types.
 *
 * Reuses existing types from types.ts:
 *   - PayoutMethodSnapshot['method_type'] (wallet | bank_account | bank_card | instapay)
 *   - PayoutStatus (pending | processing | completed | failed | cancelled)
 *
 * SECURITY:
 *   PayoutRequest MUST NOT contain: PAN, CVV, CVC, full card number,
 *   encrypted credential blobs, provider secrets, API tokens,
 *   passwords, or authentication headers.
 *   Only masked/display-safe method info is passed to the provider.
 */

import type { PayoutMethodSnapshot } from './types';

// ─── Normalized Execution Status ───
/**
 * The result of a payout execution attempt, normalized to a
 * provider-independent status.
 *
 * This is DIFFERENT from PayoutStatus (the DB payout lifecycle):
 *   PayoutStatus = pending → processing → completed | failed | cancelled
 *   PayoutExecutionStatus = accepted | completed | failed
 *
 * The execution layer maps provider-specific statuses into these
 * normalized values. Provider-specific strings (e.g., "SUCCESS",
 * "PENDING", "REVERSED") MUST NEVER leak into the domain.
 */
export type PayoutExecutionStatus =
  | 'accepted'    // provider accepted the request; processing asynchronously
  | 'completed'   // provider confirmed the transfer completed
  | 'failed';     // provider rejected or the transfer failed

export const PAYOUT_EXECUTION_STATUSES: readonly PayoutExecutionStatus[] = [
  'accepted', 'completed', 'failed',
] as const;

// ─── Payout Capabilities ───
/**
 * Describes what a payout provider supports.
 *
 * Used by the registry/resolver to select a provider that can
 * handle a given method_type + currency combination.
 */
export interface PayoutCapabilities {
  /** Which payout method types this provider can execute. */
  supportedMethodTypes: readonly PayoutMethodSnapshot['method_type'][];
  /** Which currencies this provider supports (ISO 4217, e.g., 'EGP'). */
  supportedCurrencies: readonly string[];
  /** Whether the provider supports async status lookup. */
  supportsStatusLookup: boolean;
  /** Whether the provider supports idempotent execution. */
  supportsIdempotency: boolean;
  /** Whether the provider supports cancelling an in-flight payout. */
  supportsCancellation: boolean;
}

// ─── Payout Request ───
/**
 * Contains ONLY the information required to request a payout from
 * a provider. Derived from the immutable PayoutRecord snapshot.
 *
 * CRITICAL SECURITY:
 *   This type MUST NEVER contain:
 *     - PAN (full card number)
 *     - CVV / CVC / security_code
 *     - provider_token (belongs to the provider adapter, not the domain)
 *     - encrypted credential blobs
 *     - provider secrets / API keys / passwords
 *     - authentication headers
 *
 *   Only masked/display-safe method information is included.
 *   The provider adapter (future Step 4+) is responsible for
 *   resolving the full recipient data from the payout method's
 *   encrypted blob at execution time — NOT the domain contract.
 */
export interface PayoutRequest {
  /** The payout's internal UUID. */
  payoutId: string;
  /** Human-readable reference (e.g., "PO-2026-001"). */
  internalReference: string;
  /** The teacher receiving the payout (for provider-side authorization). */
  teacherId: string;
  /** Payout amount in major units (e.g., EGP). */
  amount: number;
  /** ISO 4217 currency code (e.g., 'EGP'). */
  currency: string;
  /** The method type (wallet | bank_account | bank_card | instapay). */
  methodType: PayoutMethodSnapshot['method_type'];
  /** The teacher's display label for the method. */
  methodDisplayLabel: string;
  /** The masked summary (safe to log/display, e.g., "**** **** 5678 • M. A."). */
  methodMasked: string;
  /**
   * Idempotency key from the payout record. A retry with the same
   * key MUST NOT create a second payout — the provider must return
   * the same logical result.
   */
  idempotencyKey: string;
}

// ─── Payout Result ───
/**
 * Normalized, provider-independent result of a payout execution.
 *
 * Provider-specific response objects MUST NEVER be exposed as the
 * domain result. The provider adapter (future Step 4+) is
 * responsible for mapping provider-specific responses into this
 * normalized shape.
 */
export interface PayoutResult {
  /** Normalized execution status. */
  status: PayoutExecutionStatus;
  /** Provider's transaction reference (nullable until confirmed). */
  providerReference: string | null;
  /** Normalized failure code (nullable when status != 'failed'). */
  failureCode: string | null;
  /** Safe, non-sensitive failure message (nullable when status != 'failed'). */
  failureMessage: string | null;
  /** ISO 8601 timestamp of execution (nullable until provider confirms). */
  executedAt: string | null;
}

// ─── Payout Provider Interface ───
/**
 * Represents a generic payout provider.
 *
 * Implementations (future Step 4+) will include Paymob Disbursement,
 * wallet APIs, bank transfer APIs, etc. But this interface is
 * provider-agnostic — it contains NO Paymob/Fawry-specific fields.
 *
 * The interface MUST NOT be hardcoded to a specific provider.
 * The registry/resolver selects the appropriate provider based
 * on method_type + currency capabilities.
 */
export interface PayoutProvider {
  /** Unique provider identifier (e.g., 'paymob-disbursement'). */
  readonly providerId: string;
  /** What this provider supports. */
  readonly capabilities: PayoutCapabilities;

  /**
   * Execute a payout. Returns a normalized result.
   *
   * Idempotency: a retry with the same payoutId + idempotencyKey
   * MUST NOT create a second transfer. The provider should return
   * the same logical result.
   */
  executePayout(request: PayoutRequest): Promise<PayoutResult>;

  /**
   * Optional: query the status of a previously submitted payout.
   * Only present if capabilities.supportsStatusLookup is true.
   */
  queryPayoutStatus?(providerReference: string): Promise<PayoutResult>;

  /**
   * Optional: cancel an in-flight payout.
   * Only present if capabilities.supportsCancellation is true.
   */
  cancelPayout?(providerReference: string): Promise<PayoutResult>;
}

// ─── Helper: check if a provider supports a method type ───
export function providerSupportsMethod(
  provider: PayoutProvider,
  methodType: PayoutMethodSnapshot['method_type'],
): boolean {
  return provider.capabilities.supportedMethodTypes.includes(methodType);
}

// ─── Helper: check if a provider supports a currency ───
export function providerSupportsCurrency(
  provider: PayoutProvider,
  currency: string,
): boolean {
  return provider.capabilities.supportedCurrencies.some(
    (c) => c.toUpperCase() === currency.toUpperCase(),
  );
}

// ─── Helper: build a successful PayoutResult ───
export function buildCompletedResult(providerReference: string, executedAt: string): PayoutResult {
  return {
    status: 'completed',
    providerReference,
    failureCode: null,
    failureMessage: null,
    executedAt,
  };
}

// ─── Helper: build a failed PayoutResult ───
export function buildFailedResult(
  failureCode: string,
  failureMessage: string,
): PayoutResult {
  return {
    status: 'failed',
    providerReference: null,
    failureCode,
    failureMessage,
    executedAt: null,
  };
}

// ─── Helper: build an accepted PayoutResult ───
export function buildAcceptedResult(providerReference: string): PayoutResult {
  return {
    status: 'accepted',
    providerReference,
    failureCode: null,
    failureMessage: null,
    executedAt: null,
  };
}

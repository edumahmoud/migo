/**
 * Development Stub Payout Adapter — Phase 13 Step 4
 *
 * A DETERMINISTIC, NON-PRODUCTION adapter that implements the
 * PayoutProvider contract. It does NOT:
 *   - Contact any external payment service
 *   - Move real money
 *   - Make HTTP/network requests
 *   - Store payment credentials
 *
 * Purpose:
 *   - Validate the provider-agnostic architecture end-to-end
 *   - Enable testing of the payout execution domain without
 *     requiring a real provider integration
 *   - Demonstrate how a real adapter (future Step 5+) would
 *     normalize provider-specific responses into PayoutResult
 *     and PayoutDomainError
 *
 * Idempotency:
 *   The adapter tracks (payoutId + idempotencyKey) pairs. A
 *   retry with the same key returns the SAME deterministic result
 *   (not a second "transfer").
 *
 * Error normalization:
 *   Provider-specific errors are mapped to PayoutDomainError
 *   subclasses. Raw provider payloads are NEVER exposed.
 *
 * SECURITY:
 *   This adapter NEVER receives PAN, CVV, provider_token, or
 *   any secrets via PayoutRequest. It only receives masked
 *   display-safe method info.
 */

import type {
  PayoutProvider,
  PayoutCapabilities,
  PayoutRequest,
  PayoutResult,
} from '../provider';
import {
  buildAcceptedResult,
  buildCompletedResult,
  buildFailedResult,
} from '../provider';
import type { PayoutMethodSnapshot } from '../types';
import {
  PayoutExecutionRejectedError,
  InvalidPayoutStateError,
} from '../errors';

// ─── Capabilities ───
const DEV_STUB_CAPABILITIES: PayoutCapabilities = {
  supportedMethodTypes: ['wallet', 'bank_account', 'bank_card', 'instapay'] as const,
  supportedCurrencies: ['EGP'] as const,
  supportsStatusLookup: true,
  supportsIdempotency: true,
  supportsCancellation: true,
};

// ─── Idempotency tracking ───
interface IdempotencyEntry {
  payoutId: string;
  result: PayoutResult;
}

/**
 * Development stub payout adapter.
 *
 * Deterministic behavior:
 *   - Amount > 0: accepted → completed (synchronous)
 *   - Amount = 0 or negative: rejected (PayoutExecutionRejectedError)
 *   - Amount with fractional cents .00: accepted + completed
 *   - Same payoutId + idempotencyKey: returns the SAME cached result
 *
 * This adapter does NOT make any network calls. It is safe to use
 * in tests and development environments.
 */
export class DevStubPayoutAdapter implements PayoutProvider {
  readonly providerId = 'dev-stub';
  readonly capabilities = DEV_STUB_CAPABILITIES;

  private idempotencyCache = new Map<string, IdempotencyEntry>();

  /**
   * Execute a payout (deterministic stub).
   *
   * Returns:
   *   - 'accepted' with a deterministic provider reference
   *   - On retry with same idempotencyKey: returns the SAME result
   *   - On invalid amount: throws PayoutExecutionRejectedError
   */
  async executePayout(request: PayoutRequest): Promise<PayoutResult> {
    // Validate amount (defense in depth — mirrors domain-level checks)
    if (!Number.isFinite(request.amount) || request.amount <= 0) {
      throw new PayoutExecutionRejectedError(
        `Invalid amount: ${request.amount}`,
      );
    }

    // Idempotency: check if this payout was already processed
    const cacheKey = `${request.payoutId}:${request.idempotencyKey}`;
    const cached = this.idempotencyCache.get(cacheKey);
    if (cached) {
      // Return the SAME result — NOT a second execution
      return cached.result;
    }

    // Generate a deterministic provider reference incorporating both
    // payoutId and idempotencyKey (so different keys produce different refs)
    const providerReference = `dev-stub-${request.payoutId.slice(0, 8)}-${request.idempotencyKey.slice(0, 8)}`;
    const executedAt = new Date().toISOString();

    // Simulate synchronous completion (real providers would be async)
    const result = buildCompletedResult(providerReference, executedAt);

    // Cache for idempotency
    this.idempotencyCache.set(cacheKey, {
      payoutId: request.payoutId,
      result,
    });

    return result;
  }

  /**
   * Query the status of a previously submitted payout.
   * Returns the cached result if found, or a failed result if not.
   */
  async queryPayoutStatus(providerReference: string): Promise<PayoutResult> {
    // Find by provider reference
    for (const entry of this.idempotencyCache.values()) {
      if (entry.result.providerReference === providerReference) {
        return entry.result;
      }
    }
    return buildFailedResult('NOT_FOUND', `Provider reference ${providerReference} not found`);
  }

  /**
   * Cancel an in-flight payout.
   * In this stub, cancellation always succeeds (no real transfer to cancel).
   */
  async cancelPayout(providerReference: string): Promise<PayoutResult> {
    // Find and mark as cancelled
    for (const [key, entry] of this.idempotencyCache.entries()) {
      if (entry.result.providerReference === providerReference) {
        if (entry.result.status === 'completed') {
          throw new InvalidPayoutStateError('completed', 'cancel');
        }
        const cancelledResult = buildFailedResult('CANCELLED', 'Payout cancelled');
        this.idempotencyCache.set(key, {
          payoutId: entry.payoutId,
          result: cancelledResult,
        });
        return cancelledResult;
      }
    }
    return buildFailedResult('NOT_FOUND', `Provider reference ${providerReference} not found`);
  }

  /**
   * Clear the idempotency cache (for testing).
   */
  clearCache(): void {
    this.idempotencyCache.clear();
  }
}

/**
 * Singleton instance of the development stub adapter.
 * Can be registered with PayoutProviderRegistry for development/testing.
 */
export const devStubPayoutAdapter = new DevStubPayoutAdapter();

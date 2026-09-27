/**
 * Paymob Disbursement Adapter — Phase 13 Step D
 *
 * CONTRACT IMPLEMENTATION ONLY. Live credentials are NOT
 * configured in this environment. The adapter:
 *   - Implements PayoutProvider
 *   - Reads credentials from environment variables
 *   - If credentials are NOT configured → throws controlled error
 *   - NEVER fakes a successful transfer
 *   - NEVER logs secrets
 *
 * To enable live execution:
 *   1. Set PAYMOB_DISBURSEMENT_API_KEY in environment
 *   2. Set PAYMOB_DISBURSEMENT_BASE_URL in environment
 *   3. Register this adapter via PayoutProviderRegistry
 *
 * Until credentials are configured, this adapter is a safe
 * contract placeholder — it validates the architecture without
 * executing real transfers.
 */

import type { PayoutProvider, PayoutCapabilities, PayoutRequest, PayoutResult } from '../provider';
import { buildFailedResult } from '../provider';
import { PayoutExecutionRejectedError } from '../errors';

const CAPABILITIES: PayoutCapabilities = {
  supportedMethodTypes: ['wallet'] as const,
  supportedCurrencies: ['EGP'] as const,
  supportsStatusLookup: true,
  supportsIdempotency: true,
  supportsCancellation: false,
};

function isConfigured(): boolean {
  return !!(process.env.PAYMOB_DISBURSEMENT_API_KEY && process.env.PAYMOB_DISBURSEMENT_BASE_URL);
}

export class PaymobDisbursementAdapter implements PayoutProvider {
  readonly providerId = 'paymob-disbursement';
  readonly capabilities = CAPABILITIES;

  async executePayout(request: PayoutRequest): Promise<PayoutResult> {
    if (!isConfigured()) {
      throw new PayoutExecutionRejectedError(
        'Paymob disbursement is not configured. Set PAYMOB_DISBURSEMENT_API_KEY and PAYMOB_DISBURSEMENT_BASE_URL.'
      );
    }

    // Real implementation would:
    // 1. Resolve full recipient data from encrypted payout method blob
    // 2. Call Paymob's disbursement API with proper auth
    // 3. Map response to PayoutResult
    // 4. Never log credentials or full card numbers

    // NOT IMPLEMENTED — live credentials required
    throw new PayoutExecutionRejectedError(
      'Paymob disbursement live execution requires configured credentials. This is a contract placeholder.'
    );
  }

  async queryPayoutStatus(providerReference: string): Promise<PayoutResult> {
    if (!isConfigured()) {
      return buildFailedResult('NOT_CONFIGURED', 'Paymob disbursement not configured');
    }
    throw new PayoutExecutionRejectedError('Status lookup not implemented — credentials required');
  }
}

export const paymobDisbursementAdapter = new PaymobDisbursementAdapter();

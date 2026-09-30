/**
 * Paymob Disbursement Adapter — D1 (real implementation)
 *
 * Implements PayoutProvider for Paymob's disbursement API.
 * Calls Paymob's /v1/disbursements endpoint to transfer money to a
 * teacher's wallet/bank.
 *
 * Environment variables required:
 *   - PAYMOB_DISBURSEMENT_API_KEY   — API key for the disbursement API
 *   - PAYMOB_DISBURSEMENT_BASE_URL — e.g. https://next-egy.paymob.com
 *
 * If either is missing, executePayout throws PayoutExecutionRejectedError
 * with a clear "not configured" message — no fake success.
 *
 * SECURITY:
 *   - API key is read from env, NEVER logged
 *   - Payout method's encrypted recipient details are resolved at
 *     runtime by the caller (the payout service) and passed in
 *     `PayoutRequest.methodDetails` (decrypted just-in-time)
 *   - Full PAN / CVV / bank account numbers are NEVER logged —
 *     only the masked summary is allowed in logs
 *
 * Idempotency:
 *   - Sends the request's `idempotencyKey` as Paymob's
 *     `idempotency_key` header. A retry with the same key returns
 *     the original payout result (no double-transfer).
 */

import type { PayoutProvider, PayoutCapabilities, PayoutRequest, PayoutResult } from '../provider';
import { buildFailedResult, buildCompletedResult, buildAcceptedResult } from '../provider';
import { PayoutExecutionRejectedError } from '../errors';
import { logPaymentEvent } from '@/lib/payment/logger';

const CAPABILITIES: PayoutCapabilities = {
  supportedMethodTypes: ['wallet', 'bank_account', 'bank_card', 'instapay'] as const,
  supportedCurrencies: ['EGP'] as const,
  supportsStatusLookup: true,
  supportsIdempotency: true,
  supportsCancellation: false,
};

interface PaymobDisbursementApiRequest {
  // The amount in MINOR units (piastre for EGP). Paymob uses cents-equivalent.
  amount_cents: number;
  currency: string;
  // The recipient's wallet number / bank account / card token (resolved
  // from the encrypted payout method blob by the caller).
  recipient_identifier: string;
  // Full name of the recipient (required by Paymob for KYC).
  recipient_full_name: string;
  // The internal payout UUID — Paymob returns it as `merchant_reference`.
  merchant_reference: string;
  // Optional note that appears in the recipient's bank statement.
  note?: string;
  // Wallet provider code for wallet transfers ('vodafone-cash' | 'etisalat-cash' | 'orange-cash' | 'aman' | 'meeza' | ...).
  wallet_provider?: string;
  // Bank code for bank_account transfers.
  bank_code?: string;
}

interface PaymobDisbursementApiResponse {
  // Paymob's transaction ID — stored as provider_reference.
  id?: string;
  // Paymob's status strings — mapped to PayoutExecutionStatus below.
  status?: string;
  // Error fields (Paymob uses different shapes per error type).
  error?: string | { message?: string; code?: string };
  // For success responses, the disbursement may be async — Paymob
  // returns a status of 'pending' or 'processing' until the recipient's
  // bank confirms.
  created_at?: string;
  executed_at?: string | null;
  failure_reason?: string | null;
}

/**
 * Map a Paymob disbursement status string to our normalized
 * PayoutExecutionStatus.
 *
 * Paymob's disbursement statuses (per docs):
 *   - 'success' / 'completed' → completed
 *   - 'pending' / 'processing' → accepted (async — caller should poll)
 *   - 'failed' / 'rejected' → failed
 *
 * Unknown statuses default to 'accepted' (safe — caller will poll).
 */
function mapPaymobStatus(status: string | undefined): PayoutResult['status'] {
  if (!status) return 'accepted';
  const s = status.toLowerCase();
  if (s === 'success' || s === 'completed' || s === 'succeeded') return 'completed';
  if (s === 'failed' || s === 'rejected' || s === 'error') return 'failed';
  return 'accepted'; // pending / processing / unknown
}

function extractErrorMessage(err: PaymobDisbursementApiResponse['error']): string {
  if (!err) return 'Paymob returned an unknown error';
  if (typeof err === 'string') return err;
  return err.message || err.code || 'Paymob error';
}

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

    // Resolve the recipient details from the (decrypted) payout method.
    // The caller (payout service) is responsible for decrypting the
    // method details JUST BEFORE calling the provider, then passing
    // them in `methodDetails`. We never see the encrypted blob here.
    const methodDetails = (request as PayoutRequest & { methodDetails?: Record<string, unknown> }).methodDetails;
    if (!methodDetails) {
      throw new PayoutExecutionRejectedError(
        'Payout method details were not provided by the caller. The payout service must decrypt the method blob and pass methodDetails in the PayoutRequest.'
      );
    }

    // Build the Paymob API request — extract the recipient identifier
    // (wallet_number / account_number / iban / recipient_identifier)
    // and the recipient full name from the decrypted method details.
    const recipientIdentifier =
      String(methodDetails.wallet_number ?? methodDetails.account_number ?? methodDetails.iban ?? methodDetails.recipient_identifier ?? '');
    const recipientFullName =
      String(methodDetails.holder_name ?? methodDetails.full_name ?? '').trim();

    if (!recipientIdentifier) {
      throw new PayoutExecutionRejectedError(
        `Payout method details missing recipient identifier for method type ${request.methodType}. Check the payout method masking + encryption.`
      );
    }
    if (!recipientFullName) {
      throw new PayoutExecutionRejectedError(
        `Payout method details missing recipient full name (required by Paymob for KYC).`
      );
    }

    // Convert major currency units to minor (EGP → piastre)
    const amountCents = Math.round(request.amount * 100);

    const apiRequest: PaymobDisbursementApiRequest = {
      amount_cents: amountCents,
      currency: request.currency,
      recipient_identifier: recipientIdentifier,
      recipient_full_name: recipientFullName,
      merchant_reference: request.payoutId,
      note: `Attendo payout — ${request.internalReference}`,
    };

    // Add provider-specific fields
    if (request.methodType === 'wallet' && methodDetails.wallet_provider) {
      apiRequest.wallet_provider = String(methodDetails.wallet_provider);
    }
    if (request.methodType === 'bank_account' && methodDetails.bank_code) {
      apiRequest.bank_code = String(methodDetails.bank_code);
    }

    const baseUrl = process.env.PAYMOB_DISBURSEMENT_BASE_URL!;
    const apiKey = process.env.PAYMOB_DISBURSEMENT_API_KEY!;

    try {
      const startTime = Date.now();
      const response = await fetch(`${baseUrl}/v1/disbursements`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': request.idempotencyKey,
          'X-Source': 'attendo-lms',
        },
        body: JSON.stringify(apiRequest),
      });

      const responseJson = (await response.json().catch(() => null)) as PaymobDisbursementApiResponse | null;

      if (!response.ok) {
        const errorMsg = extractErrorMessage(responseJson?.error);
        logPaymentEvent({
          level: 'error',
          operation: 'createPayment',
          provider: 'paymob-disbursement',
          success: false,
          errorCode: 'PAYMOB_DISBURSEMENT_FAILED',
          message: `Disbursement rejected by Paymob (HTTP ${response.status}): ${errorMsg}`,
          durationMs: Date.now() - startTime,
        });
        return buildFailedResult(
          `PAYMOB_HTTP_${response.status}`,
          `Paymob rejected the disbursement: ${errorMsg}`,
        );
      }

      const providerReference = responseJson?.id != null ? String(responseJson.id) : null;
      const status = mapPaymobStatus(responseJson?.status);

      logPaymentEvent({
        level: status === 'failed' ? 'error' : 'info',
        operation: 'createPayment',
        provider: 'paymob-disbursement',
        success: status !== 'failed',
        paymentReference: providerReference ?? undefined,
        message: `Disbursement ${status} — Paymob ref=${providerReference ?? '—'}`,
        durationMs: Date.now() - startTime,
      });

      if (status === 'completed' && providerReference) {
        return buildCompletedResult(providerReference, responseJson?.executed_at ?? new Date().toISOString());
      }
      if (status === 'failed') {
        return buildFailedResult(
          'PAYMOB_DISBURSEMENT_FAILED',
          responseJson?.failure_reason ?? 'Paymob reported the disbursement as failed',
        );
      }
      // 'accepted' — async; caller should poll status
      if (providerReference) {
        return buildAcceptedResult(providerReference);
      }
      // No provider reference + accepted = unexpected — log + fail
      return buildFailedResult(
        'PAYMOB_NO_REFERENCE',
        'Paymob accepted the request but did not return a transaction reference. Manual investigation required.',
      );
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'unknown error';
      logPaymentEvent({
        level: 'error',
        operation: 'createPayment',
        provider: 'paymob-disbursement',
        success: false,
        errorCode: 'PAYMOB_DISBURSEMENT_NETWORK_ERROR',
        message: `Network error calling Paymob disbursement: ${errMsg}`,
      });
      return buildFailedResult(
        'PAYMOB_NETWORK_ERROR',
        `Could not reach Paymob disbursement API: ${errMsg}`,
      );
    }
  }

  async queryPayoutStatus(providerReference: string): Promise<PayoutResult> {
    if (!isConfigured()) {
      return buildFailedResult('NOT_CONFIGURED', 'Paymob disbursement not configured');
    }

    if (!providerReference) {
      return buildFailedResult('INVALID_REFERENCE', 'providerReference is required');
    }

    const baseUrl = process.env.PAYMOB_DISBURSEMENT_BASE_URL!;
    const apiKey = process.env.PAYMOB_DISBURSEMENT_API_KEY!;

    try {
      const startTime = Date.now();
      const response = await fetch(`${baseUrl}/v1/disbursements/${encodeURIComponent(providerReference)}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'X-Source': 'attendo-lms',
        },
      });

      const responseJson = (await response.json().catch(() => null)) as PaymobDisbursementApiResponse | null;

      if (!response.ok) {
        const errorMsg = extractErrorMessage(responseJson?.error);
        logPaymentEvent({
          level: 'error',
          operation: 'verifyPayment',
          provider: 'paymob-disbursement',
          success: false,
          errorCode: 'PAYMOB_DISBURSEMENT_LOOKUP_FAILED',
          message: `Status lookup failed (HTTP ${response.status}): ${errorMsg}`,
          durationMs: Date.now() - startTime,
        });
        return buildFailedResult(
          `PAYMOB_HTTP_${response.status}`,
          `Paymob status lookup failed: ${errorMsg}`,
        );
      }

      const status = mapPaymobStatus(responseJson?.status);
      logPaymentEvent({
        level: status === 'failed' ? 'warn' : 'info',
        operation: 'verifyPayment',
        provider: 'paymob-disbursement',
        success: status !== 'failed',
        paymentReference: providerReference,
        message: `Disbursement status: ${status}`,
        durationMs: Date.now() - startTime,
      });

      if (status === 'completed') {
        return buildCompletedResult(providerReference, responseJson?.executed_at ?? new Date().toISOString());
      }
      if (status === 'failed') {
        return buildFailedResult(
          'PAYMOB_DISBURSEMENT_FAILED',
          responseJson?.failure_reason ?? 'Paymob reported the disbursement as failed',
        );
      }
      // Still 'accepted' (pending)
      return buildAcceptedResult(providerReference);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'unknown error';
      logPaymentEvent({
        level: 'error',
        operation: 'verifyPayment',
        provider: 'paymob-disbursement',
        success: false,
        errorCode: 'PAYMOB_DISBURSEMENT_NETWORK_ERROR',
        message: `Network error looking up Paymob disbursement: ${errMsg}`,
      });
      return buildFailedResult(
        'PAYMOB_NETWORK_ERROR',
        `Could not reach Paymob disbursement API: ${errMsg}`,
      );
    }
  }
}

export const paymobDisbursementAdapter = new PaymobDisbursementAdapter();

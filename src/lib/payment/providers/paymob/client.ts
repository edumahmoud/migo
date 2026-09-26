/**
 * Paymob HTTP Client
 *
 * Thin wrapper around fetch() for Paymob API calls.
 * Handles authentication, error mapping, and timeout.
 *
 * Uses the Intention API (not legacy token/order flow):
 *   POST https://intake.paymob.com/v1/intentions/  — Create
 *   GET  https://intake.paymob.com/v1/intentions/{id}  — Get status
 */

import {
  PaymentCreationFailedError,
  PaymentVerificationFailedError,
} from '../../errors';
import type { PaymobIntentionResponse } from './types';

const INTAKE_BASE = 'https://intake.paymob.com';
const API_TIMEOUT_MS = 15000;

/**
 * Create a Paymob Payment Intention.
 *
 * @param secretKey  Paymob secret key for Authorization header
 * @param body       The intention request body (amount in cents!)
 * @returns          The intention response (id, client_secret, etc.)
 */
export async function createIntention(
  secretKey: string,
  body: Record<string, unknown>,
): Promise<PaymobIntentionResponse> {
  try {
    const res = await fetch(`${INTAKE_BASE}/v1/intentions/`, {
      method: 'POST',
      headers: {
        'Authorization': `Token ${secretKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });

    const text = await res.text();

    if (!res.ok) {
      // Map Paymob error to unified PaymentCreationFailedError
      throw new PaymentCreationFailedError(
        'paymob',
        `Paymob API returned HTTP ${res.status}: ${text.slice(0, 200)}`,
        { httpStatus: res.status, body: text.slice(0, 500) },
      );
    }

    const json = JSON.parse(text) as PaymobIntentionResponse;

    // Validate the response has the required fields
    if (!json.id || !json.client_secret) {
      throw new PaymentCreationFailedError(
        'paymob',
        'Paymob response missing required fields (id or client_secret)',
        { response: text.slice(0, 500) },
      );
    }

    return json;
  } catch (err) {
    // If it's already a PaymentError, rethrow
    if (err instanceof PaymentCreationFailedError) throw err;

    // Network error, timeout, etc.
    throw new PaymentCreationFailedError(
      'paymob',
      `Failed to call Paymob API: ${err instanceof Error ? err.message : 'unknown'}`,
      err,
    );
  }
}

/**
 * Get a Paymob Intention's status (for verifyPayment).
 *
 * @param secretKey     Paymob secret key
 * @param intentionId   The intention ID (from createIntention response.id)
 * @returns             The intention response (with status, amount, etc.)
 */
export async function getIntention(
  secretKey: string,
  intentionId: string,
): Promise<PaymobIntentionResponse> {
  try {
    const res = await fetch(`${INTAKE_BASE}/v1/intentions/${intentionId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Token ${secretKey}`,
      },
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });

    const text = await res.text();

    if (!res.ok) {
      throw new PaymentVerificationFailedError(
        'paymob',
        `Paymob API returned HTTP ${res.status}: ${text.slice(0, 200)}`,
        { httpStatus: res.status },
      );
    }

    return JSON.parse(text) as PaymobIntentionResponse;
  } catch (err) {
    if (err instanceof PaymentVerificationFailedError) throw err;

    throw new PaymentVerificationFailedError(
      'paymob',
      `Failed to verify payment: ${err instanceof Error ? err.message : 'unknown'}`,
      err,
    );
  }
}

/**
 * Build the Paymob hosted checkout URL.
 * The student is redirected here to complete payment.
 *
 * @param intentionId   The intention ID from createIntention response
 * @param clientSecret   The client_secret from the same response
 * @returns              The hosted checkout URL
 */
export function buildCheckoutUrl(intentionId: string, clientSecret: string): string {
  return `${INTAKE_BASE}/v1/intentions/${intentionId}?clientSecret=${clientSecret}`;
}

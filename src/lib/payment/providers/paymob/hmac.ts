/**
 * Paymob HMAC Verification
 *
 * Verifies the authenticity of Paymob webhook callbacks using
 * HMAC-SHA512. The HMAC secret comes from the gateway's encrypted
 * credentials (NOT from a global env var).
 *
 * Paymob callback structure:
 *   {
 *     "type": "transaction",
 *     "obj": { ...transaction fields... },
 *     "hmac": "computed_signature"
 *   }
 *
 * Verification process:
 *   1. Extract the `hmac` field from the callback.
 *   2. From the `obj`, filter to the standard HMAC fields.
 *   3. Sort the field keys alphabetically.
 *   4. Concatenate the values into a single string.
 *   5. Compute HMAC-SHA512 using the `hmacSecret`.
 *   6. Compare using timingSafeEqual (constant-time comparison).
 *
 * If the signature doesn't match → the callback is rejected.
 * No subscription activation happens until HMAC is verified.
 */

import { createHmac, timingSafeEqual } from 'crypto';
import { WebhookVerificationFailedError } from '../../errors';
import type { PaymobCallbackPayload } from './types';
import { PAYMOB_HMAC_FIELDS } from './types';

/**
 * Extract a value from the callback `obj` by field name.
 * Handles both flat fields (e.g., `amount_cents`) and nested
 * fields (e.g., `source_data_pan` → `source_data.pan`).
 */
function extractFieldValue(obj: Record<string, unknown>, fieldName: string): string {
  // Handle nested source_data_* fields → source_data.*
  if (fieldName.startsWith('source_data_')) {
    const subKey = fieldName.replace('source_data_', ''); // 'pan', 'sub_type', 'type'
    const sourceData = obj['source_data'] as Record<string, unknown> | undefined;
    const value = sourceData?.[subKey];
    return value !== undefined && value !== null ? String(value) : '';
  }

  // Handle `order` field — may be an object with `id` or a string
  if (fieldName === 'order') {
    const order = obj['order'];
    if (order && typeof order === 'object') {
      const orderId = (order as Record<string, unknown>)?.id;
      return orderId !== undefined ? String(orderId) : '';
    }
    return order !== undefined && order !== null ? String(order) : '';
  }

  // Flat field
  const value = obj[fieldName];
  return value !== undefined && value !== null ? String(value) : '';
}

/**
 * Build the HMAC input string from the callback `obj`.
 * Only the standard Paymob HMAC fields are included (not ALL fields).
 * Fields are sorted alphabetically by key name.
 */
function buildHmacInput(obj: Record<string, unknown>): string {
  // Sort the HMAC field names alphabetically
  const sortedFields = [...PAYMOB_HMAC_FIELDS].sort();

  // Extract values and concatenate
  const parts: string[] = [];
  for (const field of sortedFields) {
    const value = extractFieldValue(obj, field);
    parts.push(value);
  }

  return parts.join('');
}

/**
 * Verify a Paymob webhook callback's HMAC signature.
 *
 * @param payload    The parsed callback payload (with `obj` + `hmac`)
 * @param hmacSecret  The gateway's HMAC secret (decrypted from DB)
 * @throws            WebhookVerificationFailedError if verification fails
 */
export function verifyPaymobHmac(
  payload: PaymobCallbackPayload,
  hmacSecret: string,
): void {
  if (!hmacSecret) {
    throw new WebhookVerificationFailedError('paymob', 'No HMAC secret configured');
  }

  const receivedHmac = payload.hmac;
  if (!receivedHmac) {
    throw new WebhookVerificationFailedError('paymob', 'Callback missing `hmac` field');
  }

  const obj = payload.obj;
  if (!obj || typeof obj !== 'object') {
    throw new WebhookVerificationFailedError('paymob', 'Callback missing `obj` field');
  }

  // Build the HMAC input string from the standard fields
  const hmacInput = buildHmacInput(obj);

  // Compute HMAC-SHA512
  const computedHmac = createHmac('sha512', hmacSecret)
    .update(hmacInput, 'utf8')
    .digest('hex');

  // Constant-time comparison
  const received = Buffer.from(receivedHmac, 'hex');
  const computed = Buffer.from(computedHmac, 'hex');

  if (received.length !== computed.length) {
    throw new WebhookVerificationFailedError(
      'paymob',
      'HMAC signature length mismatch — callback rejected',
    );
  }

  if (!timingSafeEqual(received, computed)) {
    throw new WebhookVerificationFailedError(
      'paymob',
      'HMAC signature mismatch — callback rejected',
    );
  }
  // If we reach here, the callback is authentic.
}

/**
 * v110: Verify the HMAC signature on a Paymob redirect URL.
 *
 * IMPORTANT: Paymob uses a DIFFERENT algorithm for redirect URLs than for
 * webhook callbacks:
 *
 *   - Webhook callback HMAC: computed over the 17 standard PAYMOB_HMAC_FIELDS
 *     from the `obj` payload (sorted + concatenated).
 *
 *   - Redirect URL HMAC: computed over ALL query params EXCEPT `hmac`,
 *     sorted alphabetically by KEY, then concatenating the VALUES.
 *     Reference: https://docs.paymob.com/docs/paymob-integration-api/transaction-callbacks
 *
 * The previous implementation incorrectly used PAYMOB_HMAC_FIELDS for the
 * redirect URL — this caused the HMAC to NEVER match (because the redirect
 * URL has different params than the webhook obj), which is why
 * "لم يتم العثور على معاملة ناجحة" appeared even after a successful payment.
 *
 * This is the SECURE replacement for the old bypassable URL-params check.
 * A malicious student cannot forge the HMAC without knowing the gateway's
 * secret — so we can trust that a valid HMAC = Paymob actually processed
 * the payment.
 *
 * @param urlParams   The redirect URL params (Record<string, string>)
 * @param hmacSecret  The gateway's HMAC secret (decrypted from DB)
 * @returns           true if the HMAC is valid, false otherwise
 *                    (does NOT throw — caller decides what to do)
 */
export function verifyRedirectHmacFromUrlParams(
  urlParams: Record<string, string>,
  hmacSecret: string,
): boolean {
  if (!hmacSecret) {
    console.warn('[paymob:hmac] verifyRedirectHmacFromUrlParams — no HMAC secret configured');
    return false;
  }

  const receivedHmac = urlParams.hmac;
  if (!receivedHmac || typeof receivedHmac !== 'string') {
    console.warn('[paymob:hmac] verifyRedirectHmacFromUrlParams — no `hmac` param in URL');
    return false;
  }

  // ── Build the HMAC input string ──
  // Algorithm (per Paymob docs for redirect URLs):
  //   1. Collect ALL query param keys EXCEPT `hmac`
  //   2. Sort the keys alphabetically
  //   3. Concatenate the VALUES (in sorted key order) — NO separators
  //   4. Compute HMAC-SHA512 using the gateway secret
  const allKeys = Object.keys(urlParams).filter((k) => k !== 'hmac').sort();
  const parts: string[] = [];
  for (const key of allKeys) {
    const value = urlParams[key];
    parts.push(value !== undefined && value !== null ? String(value) : '');
  }
  const hmacInput = parts.join('');

  // Compute HMAC-SHA512
  const computedHmac = createHmac('sha512', hmacSecret)
    .update(hmacInput, 'utf8')
    .digest('hex');

  // Constant-time comparison
  try {
    const received = Buffer.from(receivedHmac, 'hex');
    const computed = Buffer.from(computedHmac, 'hex');
    if (received.length !== computed.length) {
      console.warn('[paymob:hmac] verifyRedirectHmacFromUrlParams — HMAC length mismatch', {
        receivedLen: received.length,
        computedLen: computed.length,
        keysUsed: allKeys,
      });
      return false;
    }
    return timingSafeEqual(received, computed);
  } catch {
    // receivedHmac is not valid hex
    return false;
  }
}

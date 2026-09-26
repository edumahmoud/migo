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

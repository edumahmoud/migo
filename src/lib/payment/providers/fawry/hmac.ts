/**
 * Fawry HMAC Signature utilities
 *
 * Fawry uses HMAC-SHA256 with the merchant's securityKey as the secret.
 * The signature is computed over a concatenation of specific fields
 * (no separator) in a defined order.
 *
 * IMPORTANT: amount is the raw decimal string (e.g., "100.00"), NOT cents.
 */

import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Compute the signature for a CHARGE request.
 * Format: merchantCode + merchantRefNum + customerProfileId + paymentMethod
 *         + amount + securityKey
 *
 * The amount must be the raw string the API will receive (e.g., "100.00").
 */
export function computeChargeSignature(
  fields: {
    merchantCode: string;
    merchantRefNum: string;
    customerProfileId: string;
    paymentMethod: string;
    amount: string;
  },
  securityKey: string,
): string {
  const payload = [
    fields.merchantCode,
    fields.merchantRefNum,
    fields.customerProfileId,
    fields.paymentMethod,
    fields.amount,
    securityKey,
  ].join('');
  return createHmac('sha256', securityKey).update(payload, 'utf8').digest('hex');
}

/**
 * Compute the signature for a STATUS request.
 * Format: merchantCode + merchantRefNum + securityKey
 *
 * (Status lookup only takes 2 fields + key — much simpler.)
 */
export function computeStatusSignature(
  merchantCode: string,
  merchantRefNum: string,
  securityKey: string,
): string {
  const payload = [merchantCode, merchantRefNum, securityKey].join('');
  return createHmac('sha256', securityKey).update(payload, 'utf8').digest('hex');
}

/**
 * Compute the signature for the WEBHOOK callback.
 * Format: merchantCode + merchantRefNum + paymentMethod + paymentAmount
 *         + orderStatus + securityKey
 *
 * The paymentAmount must be the RAW string from the callback (Fawry sends
 * it as a string like "100.00" or sometimes as a number — we coerce to
 * string here, preserving the format).
 */
export function computeWebhookSignature(
  fields: {
    merchantCode: string;
    merchantRefNum: string;
    paymentMethod: string;
    paymentAmount: string; // raw string form, as Fawry sent it
    orderStatus: string;
  },
  securityKey: string,
): string {
  const payload = [
    fields.merchantCode,
    fields.merchantRefNum,
    fields.paymentMethod,
    fields.paymentAmount,
    fields.orderStatus,
    securityKey,
  ].join('');
  return createHmac('sha256', securityKey).update(payload, 'utf8').digest('hex');
}

/**
 * Verify the webhook signature in constant time (no early-exit on mismatch).
 * Returns true if the signature matches, false otherwise.
 */
export function verifyWebhookSignature(
  payload: {
    merchantCode: string;
    merchantRefNumber: string;
    paymentMethod: string;
    paymentAmount: number | string;
    paymentStatus: string;
    signature: string;
  },
  securityKey: string,
): boolean {
  if (!securityKey || !payload.signature) return false;

  // Coerce paymentAmount to string. If it's a number, format it as Fawry
  // expects (the raw decimal form).
  const amountStr = typeof payload.paymentAmount === 'number'
    ? payload.paymentAmount.toString()
    : payload.paymentAmount;

  const expected = computeWebhookSignature(
    {
      merchantCode: payload.merchantCode,
      merchantRefNum: payload.merchantRefNumber,
      paymentMethod: payload.paymentMethod,
      paymentAmount: amountStr,
      orderStatus: payload.paymentStatus,
    },
    securityKey,
  );

  // Length-mismatch quick reject (NOT a timing attack — the length is public)
  if (expected.length !== payload.signature.length) return false;

  try {
    return timingSafeEqual(
      Buffer.from(expected, 'hex'),
      Buffer.from(payload.signature, 'hex'),
    );
  } catch {
    // signature isn't a valid hex string
    return false;
  }
}

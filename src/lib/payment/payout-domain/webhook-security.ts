/**
 * Payout Webhook Security — Phase 13 Hardening
 *
 * Reuses the established HMAC-SHA512 + timingSafeEqual pattern from
 * src/lib/payment/providers/paymob/hmac.ts to authenticate incoming
 * payout webhook callbacks.
 *
 * The webhook secret is read ONLY from the server-side environment
 * variable `PAYOUT_WEBHOOK_SECRET`. If the secret is not configured,
 * every webhook is REJECTED — fail-closed.
 *
 * Signature envelope:
 *   - Header: `X-Payout-Webhook-Signature` (lowercase hex string)
 *   - Payload: HMAC-SHA512 over the RAW request body (UTF-8)
 *
 * The signature is computed over the RAW body — NOT parsed JSON —
 * to avoid any parser-specific normalization differences (whitespace,
 * key ordering, number formatting). This matches the canonical
 * pattern used by Paymob, Stripe, and other HMAC-signed webhooks.
 *
 * SECURITY:
 *   - The secret is NEVER logged, returned, or exposed to client code.
 *   - Constant-time comparison (timingSafeEqual) prevents timing attacks.
 *   - Length-check before timingSafeEqual (the Node API requires
 *     equal-length buffers; lengths are not sensitive information
 *     because the hash function output size is fixed at 64 bytes).
 *   - The header value is sanitized to lowercase-hex before decoding.
 *
 * Provider-agnostic:
 *   This envelope is provider-agnostic. A real provider integration
 *   (future step) may add its own provider-specific signature on top
 *   of (or instead of) this envelope — but the webhook is no longer
 *   publicly callable.
 */

import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Header name carrying the payout webhook signature.
 * Exposed for tests + the route handler. Lowercase per Fetch spec.
 */
export const PAYOUT_WEBHOOK_SIGNATURE_HEADER = 'x-payout-webhook-signature';

/**
 * Minimum acceptable secret length (bytes-as-chars). 32 chars is the
 * baseline for HMAC secrets in this project — Paymob HMAC secrets in
 * practice are 32+ hex chars.
 */
const MIN_SECRET_LENGTH = 32;

/**
 * Verify a payout webhook signature.
 *
 * @param rawBody       The raw request body (UTF-8 string).
 * @param signatureHex  The signature from the request header (hex string).
 * @returns             true if the signature is valid; false otherwise.
 *                       Also returns false if no secret is configured
 *                       (fail-closed) or the secret is too short.
 */
export function verifyPayoutWebhookSignature(
  rawBody: string,
  signatureHex: string | null | undefined,
): boolean {
  const secret = process.env.PAYOUT_WEBHOOK_SECRET;
  if (!secret || typeof secret !== 'string' || secret.length < MIN_SECRET_LENGTH) {
    // Fail-closed: no properly-configured secret → reject all webhooks.
    return false;
  }

  if (!signatureHex || typeof signatureHex !== 'string') {
    return false;
  }

  // Reject non-hex characters before Buffer.from() — Buffer.from(hex)
  // silently truncates at the first invalid char, which could let an
  // attacker submit a truncated signature that decodes to a prefix of
  // the computed HMAC. Hex-strict regex prevents this.
  const hex = signatureHex.trim().toLowerCase();
  if (!/^[0-9a-f]+$/.test(hex)) {
    return false;
  }

  // Compute expected HMAC-SHA512 over the raw body
  const computedHmac = createHmac('sha512', secret)
    .update(rawBody, 'utf8')
    .digest('hex');

  const received = Buffer.from(hex, 'hex');
  const computed = Buffer.from(computedHmac, 'hex');

  if (received.length !== computed.length) {
    // Length mismatch — reject without leaking timing info about the
    // secret. The output length is fixed (64 bytes for SHA-512), so
    // the length check itself reveals nothing sensitive.
    return false;
  }

  return timingSafeEqual(received, computed);
}

/**
 * Compute the expected signature for a payload. Used by tests to
 * construct valid signatures for the happy-path.
 *
 * NEVER use this in client code. Test-only export.
 */
export function computePayoutWebhookSignatureForTesting(
  rawBody: string,
  secret: string,
): string {
  return createHmac('sha512', secret)
    .update(rawBody, 'utf8')
    .digest('hex');
}

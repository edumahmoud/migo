/**
 * Time-based fallback verification policy (Strategy 2 of
 * verify-after-redirect).
 *
 * Previously, Strategy 2 force-activated ANY pending order older than
 * 30s that had a provider_order_ref — WITHOUT proving that Paymob
 * actually captured money. A failed/declined/abandoned payment could
 * be activated for free.
 *
 * Now the fallback activates ONLY when the payment is positively
 * verified through one of two channels:
 *   1. Paymob API: a successful (non-refunded) transaction exists for
 *      the provider_order_ref.
 *   2. Redirect HMAC: the student's redirect URL params carry a valid
 *      Paymob HMAC signature AND success=true.
 *
 * Anything else is refused (evidence of failure) or inconclusive
 * (still processing / Paymob API unreachable / not indexed yet) and
 * the order stays pending — the HMAC webhook and the cron reconciler
 * remain as the other activation channels.
 */

export type TimeBasedVerdict = 'verified' | 'refused' | 'inconclusive';

export interface TimeBasedVerificationInput {
  /** true when the Paymob API query returned without a network/auth error */
  apiQuerySucceeded: boolean;
  /** transactions returned by the Paymob API for the provider_order_ref */
  transactions: Array<{ success?: boolean; pending?: boolean; is_refunded?: boolean }>;
  /** true when the redirect URL params carry a valid Paymob HMAC */
  redirectHmacValid: boolean;
  /** the success flag from the (only meaningful when HMAC-valid) redirect params */
  redirectSuccess: boolean;
}

export function evaluateTimeBasedVerification(input: TimeBasedVerificationInput): TimeBasedVerdict {
  // Channel 2: a valid Paymob signature on the redirect params is proof.
  if (input.redirectHmacValid && input.redirectSuccess) return 'verified';

  if (input.apiQuerySucceeded) {
    const captured = input.transactions.some((t) => t.success === true && t.is_refunded !== true);
    if (captured) return 'verified';
    if (input.transactions.length > 0) {
      // Transactions exist but none captured: still-pending means the
      // money flow is undecided; otherwise the payment failed/declined/
      // refunded and activation must be REFUSED.
      const stillPending = input.transactions.some((t) => t.pending === true);
      return stillPending ? 'inconclusive' : 'refused';
    }
    // No transactions indexed yet — cannot tell either way.
    return 'inconclusive';
  }

  // Paymob API unreachable + no valid signed redirect — cannot tell.
  return 'inconclusive';
}

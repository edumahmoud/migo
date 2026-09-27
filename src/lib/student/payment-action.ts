/**
 * Student Payment Action — Checkout Initiation Helper
 *
 * Pure helper that calls the EXISTING backend endpoint:
 *   POST /api/student/orders/[id]/pay
 *
 * Backend contract (from src/app/api/student/orders/[id]/pay/route.ts):
 *   Success: { success: true, checkout_url: string, payment_reference: string, message: string }
 *   Error:   { success: false, error: string } (HTTP non-2xx)
 *
 * The helper does NOT:
 *   - Trust any client-supplied price/currency/student_id/payment status
 *   - Modify the order in any way (no client-side "mark as paid")
 *   - Call the activation RPC (the Paymob webhook is the single source
 *     of truth for payment confirmation)
 *   - Fake success under any condition
 *
 * Authorization, ownership, status validation, and the actual Paymob
 * Intention API call all happen server-side. This helper just sends
 * one authenticated POST and returns the parsed response.
 *
 * Idempotency:
 *   The backend endpoint is idempotent — if the order already has a
 *   provider_order_ref (Paymob intention ID), it verifies the existing
 *   intention's status instead of creating a duplicate. The helper
 *   does NOT need to track duplicate calls itself; calling it twice
 *   with the same orderId is safe (it returns the same checkout URL).
 *
 * Error handling:
 *   - Network failure → throws PaymentActionError('NETWORK_ERROR')
 *   - Non-2xx response → throws PaymentActionError('HTTP_ERROR', status, error)
 *   - Missing checkout_url on 2xx → throws PaymentActionError('MISSING_CHECKOUT_URL')
 *   - Non-JSON response → throws PaymentActionError('INVALID_RESPONSE')
 *
 * The caller is responsible for showing the toast/UI message. The
 * helper just returns a typed result or throws.
 */

export interface PaymentActionResult {
  /** The Paymob hosted-checkout URL the browser should navigate to. */
  checkoutUrl: string;
  /** The Paymob intention ID (we keep it for diagnostics/logging). */
  paymentReference: string | null;
}

export type PaymentActionErrorCode =
  | 'NETWORK_ERROR'
  | 'HTTP_ERROR'
  | 'INVALID_RESPONSE'
  | 'MISSING_CHECKOUT_URL';

export class PaymentActionError extends Error {
  constructor(
    public readonly code: PaymentActionErrorCode,
    message: string,
    public readonly httpStatus?: number,
    public readonly serverError?: string,
  ) {
    super(message);
    this.name = 'PaymentActionError';
  }

  /** Safe serialization — never leaks secrets (none are held anyway). */
  toJSON(): { code: PaymentActionErrorCode; message: string } {
    return { code: this.code, message: this.message };
  }
}

/**
 * Initiate a Paymob payment for an existing pending order.
 *
 * @param orderId  The pending order ID (from POST /api/student/orders).
 * @param headers  Optional extra headers (auth headers injected by caller).
 * @returns        The checkout URL + payment reference.
 *
 * @throws PaymentActionError on any failure.
 */
export async function initiatePayment(
  orderId: string,
  headers: Record<string, string> = {},
): Promise<PaymentActionResult> {
  if (!orderId) {
    throw new PaymentActionError('HTTP_ERROR', 'orderId is required');
  }

  let res: Response;
  try {
    res = await fetch(`/api/student/orders/${encodeURIComponent(orderId)}/pay`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      // No body — the order ID is in the URL. The backend resolves
      // amount/currency/student_id server-side.
    });
  } catch (err) {
    // Network failure (offline, DNS, CORS, etc.)
    throw new PaymentActionError(
      'NETWORK_ERROR',
      err instanceof Error ? err.message : 'Network request failed',
    );
  }

  // Parse the response body. The backend always returns JSON (even on
  // error). If it doesn't, treat it as an invalid response.
  const rawBody = await res.text();
  let body: unknown;
  try {
    body = rawBody ? JSON.parse(rawBody) : null;
  } catch {
    throw new PaymentActionError(
      'INVALID_RESPONSE',
      `Non-JSON response (status ${res.status})`,
      res.status,
    );
  }

  if (!res.ok) {
    const errorStr =
      body && typeof body === 'object' && 'error' in body
        ? String((body as Record<string, unknown>).error)
        : `HTTP ${res.status}`;
    throw new PaymentActionError(
      'HTTP_ERROR',
      errorStr,
      res.status,
      errorStr,
    );
  }

  // 2xx — validate the response shape.
  const obj = body as Record<string, unknown> | null;
  if (!obj || obj.success !== true) {
    throw new PaymentActionError(
      'HTTP_ERROR',
      typeof obj?.error === 'string' ? obj.error : 'Backend returned success=false',
      res.status,
      typeof obj?.error === 'string' ? obj.error : undefined,
    );
  }

  const checkoutUrl =
    typeof obj.checkout_url === 'string' ? obj.checkout_url : null;
  const paymentReference =
    typeof obj.payment_reference === 'string' ? obj.payment_reference : null;

  if (!checkoutUrl) {
    // Backend returned success=true but no checkout_url. Treat as an
    // error — do NOT redirect anywhere.
    throw new PaymentActionError(
      'MISSING_CHECKOUT_URL',
      'Backend returned success but no checkout_url — cannot redirect',
      res.status,
    );
  }

  return { checkoutUrl, paymentReference };
}

/**
 * Navigate the browser to the Paymob hosted checkout URL.
 *
 * Uses window.location.href (NOT Next.js router.push) because the
 * Paymob checkout is an EXTERNAL hosted page — Next's client-side
 * router cannot navigate to a different origin.
 *
 * In test environments (no window), this is a no-op that returns false
 * so the caller can assert the URL was passed without actually navigating.
 */
export function redirectToCheckout(checkoutUrl: string): boolean {
  if (typeof window === 'undefined' || !window.location) {
    return false;
  }
  // window.location.href triggers a full browser navigation, leaving the
  // app entirely. This is the correct mechanism for external hosted
  // checkout (Paymob).
  window.location.href = checkoutUrl;
  return true;
}

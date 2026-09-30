/**
 * Student Payment Action — Checkout Initiation Helper
 *
 * Pure helper that calls the EXISTING backend endpoint:
 *   POST /api/student/orders/[id]/pay
 *
 * Backend contract (from src/app/api/student/orders/[id]/pay/route.ts):
 *   Success: { success: true, checkout_url: string, payment_reference: string, message: string }
 *   Error:   { success: false, error: string, category?: string, session_id?: string } (HTTP non-2xx)
 *
 * The backend categorizes errors into stable categories (see
 * src/lib/student/payment-error-categories.ts):
 *   GATEWAY_NOT_CONFIGURED | GATEWAY_DISABLED | GATEWAY_NOT_IMPLEMENTED |
 *   CREDENTIALS_MISSING | ENCRYPTION_KEY_MISSING | GATEWAY_CONFIG_INVALID |
 *   PAYMOB_API_REJECTED | PAYMOB_NETWORK_FAILURE | PAYMOB_RESPONSE_INVALID |
 *   STALE_ORDER | PART_OF_SESSION | UNKNOWN
 *
 * The helper does NOT:
 *   - Trust any client-supplied price/currency/student_id/payment status
 *   - Modify the order in any way (no client-side "mark as paid")
 *   - Call the activation RPC (the Paymob webhook is the single source
 *     of truth for payment confirmation)
 *   - Fake success under any condition
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
 *   - Non-2xx response → throws PaymentActionError('HTTP_ERROR', status, error, category)
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

/** Server-side error category from the /pay endpoint (mirrors server-side enum). */
export type ServerPaymentErrorCategory =
  | 'GATEWAY_NOT_CONFIGURED'
  | 'GATEWAY_DISABLED'
  | 'GATEWAY_NOT_IMPLEMENTED'
  | 'CREDENTIALS_MISSING'
  | 'ENCRYPTION_KEY_MISSING'
  | 'GATEWAY_CONFIG_INVALID'
  | 'PAYMOB_API_REJECTED'
  | 'PAYMOB_NETWORK_FAILURE'
  | 'PAYMOB_RESPONSE_INVALID'
  | 'STALE_ORDER'
  | 'PART_OF_SESSION'
  | 'ALREADY_IN_SESSION'
  | 'CONCURRENT_SESSION_RACE'
  | 'CURRENCY_MISMATCH'
  | 'ORDER_NOT_PENDING'
  | 'INVALID_AMOUNT'
  | 'PAYMENT_ALREADY_INITIATED'
  | 'UNKNOWN';

/** Single-order info for the dialog (single-order mode). */
export interface PaymentSummaryOrder {
  /** The order ID returned by POST /api/student/orders (created_orders[].id). */
  orderId: string;
  /** Subject name (server-authoritative — from the order's subject row). */
  subjectName: string;
  /** Subscription amount (server-authoritative — from the order's amount). */
  amount: number;
  /** Currency code (server-authoritative — from the order's currency). */
  currency: string;
  /** v88 — base subscription price (before fees). For pre-v88 orders, equals amount. */
  baseAmount?: number;
  /** v88 — total fees (commission + tax + other). For pre-v88 orders, 0. */
  feesTotal?: number;
  /** v88 — grand total sent to Paymob (base + fees). For pre-v88 orders, equals amount. */
  grandTotal?: number;
  /** v88 — per-fee breakdown for the invoice display. */
  feesBreakdown?: Array<{
    code: string;
    name_ar: string;
    name_en: string;
    fee_kind: string;
    value: number;
    base_amount: number;
    calculated_amount: number;
  }>;
}

export class PaymentActionError extends Error {
  constructor(
    public readonly code: PaymentActionErrorCode,
    message: string,
    public readonly httpStatus?: number,
    public readonly serverError?: string,
    public readonly category?: ServerPaymentErrorCategory,
    public readonly sessionId?: string,
  ) {
    super(message);
    this.name = 'PaymentActionError';
  }

  /** Safe serialization — never leaks secrets (none are held anyway). */
  toJSON(): { code: PaymentActionErrorCode; message: string; category?: string } {
    return {
      code: this.code,
      message: this.message,
      ...(this.category ? { category: this.category } : {}),
    };
  }
}

/**
 * Initiate a Paymob payment for an existing pending order.
 *
 * @param orderId  The pending order ID (from POST /api/student/orders).
 * @param headers  Optional extra headers (auth headers injected by caller).
 * @param paymentMethod  Optional: 'card' (default) or 'wallet'. The
 *   student picks this in the payment dialog. The backend uses it to
 *   choose the right Paymob integration ID + iframe ID.
 * @returns        The checkout URL + payment reference.
 *
 * @throws PaymentActionError on any failure.
 */
export async function initiatePayment(
  orderId: string,
  headers: Record<string, string> = {},
  paymentMethod: 'card' | 'wallet' = 'card',
): Promise<PaymentActionResult> {
  if (!orderId) {
    throw new PaymentActionError('HTTP_ERROR', 'orderId is required');
  }

  let res: Response;
  try {
    res = await fetch(`/api/student/orders/${encodeURIComponent(orderId)}/pay?method=${paymentMethod}`, {
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
    const category =
      body && typeof body === 'object' && 'category' in body && typeof (body as Record<string, unknown>).category === 'string'
        ? (body as Record<string, unknown>).category as ServerPaymentErrorCategory
        : undefined;
    const sessionId =
      body && typeof body === 'object' && 'session_id' in body && typeof (body as Record<string, unknown>).session_id === 'string'
        ? (body as Record<string, unknown>).session_id as string
        : undefined;
    throw new PaymentActionError(
      'HTTP_ERROR',
      errorStr,
      res.status,
      errorStr,
      category,
      sessionId,
    );
  }

  // 2xx — validate the response shape.
  const obj = body as Record<string, unknown> | null;
  if (!obj || obj.success !== true) {
    const errorStr =
      typeof obj?.error === 'string' ? obj.error : 'Backend returned success=false';
    const category =
      obj && typeof obj === 'object' && 'category' in obj && typeof obj.category === 'string'
        ? obj.category as ServerPaymentErrorCategory
        : undefined;
    throw new PaymentActionError(
      'HTTP_ERROR',
      errorStr,
      res.status,
      errorStr,
      category,
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

// ============================================================
// Multi-subject checkout session support
// ============================================================

export interface CheckoutSessionItem {
  order_id: string;
  subject_id: string;
  subject_name: string;
  amount: number;
  currency: string;
}

export interface CreateSessionResult {
  session_id: string;
  items: CheckoutSessionItem[];
  total_amount: number;
  currency: string;
  item_count: number;
}

/**
 * Create a multi-subject checkout session.
 *
 * Calls POST /api/student/checkout/sessions with a list of order IDs.
 * The server:
 *   - Validates all orders belong to the caller, are pending, have
 *     positive amounts, share the same currency, and are NOT already
 *     in another session.
 *   - Generates a `checkout_session_id` UUID.
 *   - Updates all selected orders with that session_id.
 *   - Returns the session_id + items + total (all server-authoritative).
 *
 * @param orderIds  Array of pending order IDs (from POST /api/student/orders).
 * @param headers   Auth headers.
 * @returns         Server-authoritative session info.
 *
 * @throws PaymentActionError on any failure.
 */
export async function createCheckoutSession(
  orderIds: string[],
  headers: Record<string, string> = {},
): Promise<CreateSessionResult> {
  if (!orderIds || orderIds.length === 0) {
    throw new PaymentActionError('HTTP_ERROR', 'orderIds must be a non-empty array');
  }

  // Deduplicate order IDs on the client (defense-in-depth — the server
  // also deduplicates). This prevents sending the same order ID twice
  // in the request body, which the server would otherwise reject as
  // "duplicate subject_id".
  const uniqueOrderIds = Array.from(new Set(orderIds));

  let res: Response;
  try {
    res = await fetch('/api/student/checkout/sessions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      body: JSON.stringify({ orderIds: uniqueOrderIds }),
    });
  } catch (err) {
    throw new PaymentActionError(
      'NETWORK_ERROR',
      err instanceof Error ? err.message : 'Network request failed',
    );
  }

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
    const category =
      body && typeof body === 'object' && 'category' in body && typeof (body as Record<string, unknown>).category === 'string'
        ? (body as Record<string, unknown>).category as ServerPaymentErrorCategory
        : undefined;
    throw new PaymentActionError('HTTP_ERROR', errorStr, res.status, errorStr, category);
  }

  const obj = body as Record<string, unknown> | null;
  if (!obj || obj.success !== true) {
    const errorStr =
      typeof obj?.error === 'string' ? obj.error : 'Backend returned success=false';
    throw new PaymentActionError('HTTP_ERROR', errorStr, res.status, errorStr);
  }

  // Validate response shape
  const sessionId =
    typeof obj.session_id === 'string' ? obj.session_id : null;
  const itemsRaw = Array.isArray(obj.items) ? obj.items : [];
  const items: CheckoutSessionItem[] = itemsRaw.map((it: unknown) => {
    const i = it as Record<string, unknown>;
    return {
      order_id: String(i.order_id),
      subject_id: String(i.subject_id),
      subject_name: String(i.subject_name),
      amount: Number(i.amount),
      currency: String(i.currency),
    };
  });
  const totalAmount =
    typeof obj.total_amount === 'number' ? Number(obj.total_amount) : 0;
  const currency = typeof obj.currency === 'string' ? String(obj.currency) : 'EGP';

  if (!sessionId || items.length === 0) {
    throw new PaymentActionError(
      'INVALID_RESPONSE',
      'Backend returned success but no session_id or empty items',
      res.status,
    );
  }

  return {
    session_id: sessionId,
    items,
    total_amount: totalAmount,
    currency,
    item_count: items.length,
  };
}

/**
 * Initiate payment for a multi-subject checkout session.
 *
 * Calls POST /api/student/checkout/sessions/[id]/pay.
 * The server:
 *   - Validates the session + its orders.
 *   - Calls PaymentService.createPayment with orderId = session_id
 *     (Paymob special_reference = session_id).
 *   - Returns the Paymob hosted-checkout URL.
 *
 * Idempotency:
 *   - Calling this twice returns the SAME checkout URL safely
 *     (Paymob's Intention API deduplicates via special_reference;
 *     the webhook uses per-order provider_payment_id for idempotency).
 *
 * @param sessionId  The session_id returned by createCheckoutSession.
 * @param headers    Auth headers.
 * @param paymentMethod  Optional: 'card' (default) or 'wallet'. The
 *   student picks this in the payment dialog.
 * @returns          The checkout URL + payment reference.
 *
 * @throws PaymentActionError on any failure.
 */
export async function initiateSessionPayment(
  sessionId: string,
  headers: Record<string, string> = {},
  paymentMethod: 'card' | 'wallet' = 'card',
): Promise<PaymentActionResult> {
  if (!sessionId) {
    throw new PaymentActionError('HTTP_ERROR', 'sessionId is required');
  }

  let res: Response;
  try {
    res = await fetch(`/api/student/checkout/sessions/${encodeURIComponent(sessionId)}/pay?method=${paymentMethod}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
    });
  } catch (err) {
    throw new PaymentActionError(
      'NETWORK_ERROR',
      err instanceof Error ? err.message : 'Network request failed',
    );
  }

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
    const category =
      body && typeof body === 'object' && 'category' in body && typeof (body as Record<string, unknown>).category === 'string'
        ? (body as Record<string, unknown>).category as ServerPaymentErrorCategory
        : undefined;
    throw new PaymentActionError('HTTP_ERROR', errorStr, res.status, errorStr, category);
  }

  const obj = body as Record<string, unknown> | null;
  if (!obj || obj.success !== true) {
    const errorStr =
      typeof obj?.error === 'string' ? obj.error : 'Backend returned success=false';
    const category =
      obj && typeof obj === 'object' && 'category' in obj && typeof obj.category === 'string'
        ? obj.category as ServerPaymentErrorCategory
        : undefined;
    throw new PaymentActionError('HTTP_ERROR', errorStr, res.status, errorStr, category);
  }

  const checkoutUrl = typeof obj.checkout_url === 'string' ? obj.checkout_url : null;
  const paymentReference = typeof obj.payment_reference === 'string' ? obj.payment_reference : null;

  if (!checkoutUrl) {
    throw new PaymentActionError(
      'MISSING_CHECKOUT_URL',
      'Backend returned success but no checkout_url — cannot redirect',
      res.status,
    );
  }

  return { checkoutUrl, paymentReference };
}

// ============================================================
// Client-side error → user-facing Arabic message mapping
// ============================================================

/**
 * Map a PaymentActionError to a safe user-facing Arabic message.
 *
 * This is a CLIENT-SIDE mapping — the error category comes from the
 * server response. The server has already stripped all sensitive
 * information (the underlying PaymentError message was the safe
 * message itself, not the raw provider error).
 *
 * The map is intentionally exhaustive — every category has a specific
 * Arabic message so the user never sees a generic "gateway error".
 */
export function getPaymentActionErrorMessage(
  err: PaymentActionError,
  fallbackAr: string,
): string {
  // Network-level errors (no server response)
  if (err.code === 'NETWORK_ERROR') {
    // The CLIENT couldn't reach the server (browser → server fetch failed).
    // This is different from PAYMOB_NETWORK_FAILURE (server → Paymob fetch failed).
    return 'تعذّر الاتصال بالخادم. تحقق من اتصال الإنترنت وحاول مرة أخرى.';
  }
  if (err.code === 'INVALID_RESPONSE') {
    return 'تعذّر فهم استجابة الخادم. حاول مرة أخرى لاحقًا.';
  }
  if (err.code === 'MISSING_CHECKOUT_URL') {
    return 'تعذّر تجهيز عملية الدفع. لم يتم خصم أي مبلغ. حاول مرة أخرى.';
  }

  // HTTP_ERROR with a category — map to specific message
  switch (err.category) {
    case 'GATEWAY_NOT_CONFIGURED':
      return 'بوابة الدفع غير مُهيّأة بعد. يرجى التواصل مع المسؤول لتفعيل بوابة الدفع.';
    case 'GATEWAY_DISABLED':
      return 'بوابة الدفع غير متاحة حاليًا. حاول مرة أخرى بعد قليل أو تواصل مع المسؤول.';
    case 'GATEWAY_NOT_IMPLEMENTED':
      return 'بوابة الدفع المطلوبة غير مُنفّذة. تواصل مع المسؤول.';
    case 'CREDENTIALS_MISSING':
      return 'بيانات اعتماد بوابة الدفع غير مُهيّأة. تواصل مع المسؤول.';
    case 'ENCRYPTION_KEY_MISSING':
      return 'إعداد تشفير بيانات الدفع غير مُهيّأ على الخادم. تواصل مع المسؤول.';
    case 'GATEWAY_CONFIG_INVALID':
      return 'تعذّر قراءة إعدادات بوابة الدفع. تواصل مع المسؤول لإعادة التهيئة.';
    case 'PAYMOB_API_REJECTED':
      // Use the server's categorized message if available (includes HTTP status)
      if (err.serverError && /[\u0600-\u06FF]/.test(err.serverError)) {
        return err.serverError;
      }
      return 'تعذّر تجهيز عملية الدفع. لم يتم خصم أي مبلغ. تحقق من إعدادات البوابة وحاول مرة أخرى.';
    case 'PAYMOB_NETWORK_FAILURE':
      return 'تعذّر الاتصال ببوابة الدفع. تحقق من اتصال الإنترنت وحاول مرة أخرى.';
    case 'PAYMOB_RESPONSE_INVALID':
      return 'تعذّر تجهيز عملية الدفع. لم يتم خصم أي مبلغ. حاول مرة أخرى لاحقًا.';
    case 'STALE_ORDER':
      return 'هذا الطلب لم يعد صالحًا للدفع. سنجهز لك طلبًا جديدًا. تواصل مع الدعم إذا استمرت المشكلة.';
    case 'PART_OF_SESSION':
      return 'هذا الطلب ضمن مجموعة دفعة موحدة. استخدم مسار الدفع الموحد للمجموعة.';
    case 'ALREADY_IN_SESSION':
      return 'أحد الطلبات المحددة ضمن جلسة دفع أخرى بالفعل.';
    case 'CONCURRENT_SESSION_RACE':
      return 'تعذّر إنشاء جلسة الدفع — قد يكون أحد الطلبات قد ضُمّ لجلسة أخرى. حاول مرة أخرى.';
    case 'CURRENCY_MISMATCH':
      return 'لا يمكن دمج طلبات بعملات مختلفة في جلسة دفع واحدة.';
    case 'ORDER_NOT_PENDING':
      return 'أحد الطلبات ليس معلّقًا — لا يمكن دفعه.';
    case 'INVALID_AMOUNT':
      return 'أحد الطلبات له مبلغ غير صالح.';
    case 'PAYMENT_ALREADY_INITIATED':
      return 'تم بدء عملية الدفع لهذه الجلسة — لا يمكن إزالة الطلبات بعد بدء الدفع.';
    case 'UNKNOWN':
    default:
      // Fall back to the server's Arabic message if it's a known
      // Arabic string; otherwise use the generic fallback.
      if (err.serverError && /[\u0600-\u06FF]/.test(err.serverError)) {
        return err.serverError;
      }
      return fallbackAr;
  }
}

// ============================================================
// Multi-subject session item removal
// ============================================================

/**
 * Remove a single order from a multi-subject checkout session.
 *
 * Calls POST /api/student/checkout/sessions/[id]/remove with
 * { orderId }. The server validates ownership, session membership,
 * pending status, and that payment hasn't been initiated yet.
 *
 * Returns the updated session info (remaining items + new total).
 *
 * @param sessionId  The session_id (from createCheckoutSession).
 * @param orderId    The order ID to remove from the session.
 * @param headers    Auth headers.
 * @returns          Updated session info (items + total + currency).
 *
 * @throws PaymentActionError on any failure.
 */
export async function removeCheckoutSessionItem(
  sessionId: string,
  orderId: string,
  headers: Record<string, string> = {},
): Promise<CreateSessionResult> {
  if (!sessionId) {
    throw new PaymentActionError('HTTP_ERROR', 'sessionId is required');
  }
  if (!orderId) {
    throw new PaymentActionError('HTTP_ERROR', 'orderId is required');
  }

  let res: Response;
  try {
    res = await fetch(`/api/student/checkout/sessions/${encodeURIComponent(sessionId)}/remove`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      body: JSON.stringify({ orderId }),
    });
  } catch (err) {
    throw new PaymentActionError(
      'NETWORK_ERROR',
      err instanceof Error ? err.message : 'Network request failed',
    );
  }

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
    const category =
      body && typeof body === 'object' && 'category' in body && typeof (body as Record<string, unknown>).category === 'string'
        ? (body as Record<string, unknown>).category as ServerPaymentErrorCategory
        : undefined;
    throw new PaymentActionError('HTTP_ERROR', errorStr, res.status, errorStr, category);
  }

  const obj = body as Record<string, unknown> | null;
  if (!obj || obj.success !== true) {
    const errorStr =
      typeof obj?.error === 'string' ? obj.error : 'Backend returned success=false';
    throw new PaymentActionError('HTTP_ERROR', errorStr, res.status, errorStr);
  }

  // Validate response shape (same as createCheckoutSession)
  const returnedSessionId =
    typeof obj.session_id === 'string' ? obj.session_id : null;
  const itemsRaw = Array.isArray(obj.items) ? obj.items : [];
  const items: CheckoutSessionItem[] = itemsRaw.map((it: unknown) => {
    const i = it as Record<string, unknown>;
    return {
      order_id: String(i.order_id),
      subject_id: String(i.subject_id),
      subject_name: String(i.subject_name),
      amount: Number(i.amount),
      currency: String(i.currency),
    };
  });
  const totalAmount =
    typeof obj.total_amount === 'number' ? Number(obj.total_amount) : 0;
  const currency = typeof obj.currency === 'string' ? String(obj.currency) : 'EGP';
  const itemCount =
    typeof obj.item_count === 'number' ? Number(obj.item_count) : items.length;

  if (!returnedSessionId) {
    throw new PaymentActionError(
      'INVALID_RESPONSE',
      'Backend returned success but no session_id',
      res.status,
    );
  }

  return {
    session_id: returnedSessionId,
    items,
    total_amount: totalAmount,
    currency,
    item_count: itemCount,
  };
}

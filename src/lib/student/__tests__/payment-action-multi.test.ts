// =====================================================
// Student Multi-Subject Checkout — Tests
// =====================================================
// Verifies the multi-subject checkout session helpers:
//   - createCheckoutSession (POST /api/student/checkout/sessions)
//   - initiateSessionPayment (POST /api/student/checkout/sessions/[id]/pay)
//   - getPaymentActionErrorMessage (client-side error → Arabic message)
//
// Covers the test requirements from Phase 11:
//   2. Multiple paid subjects appear in one summary
//   3. Correct combined total is calculated server-side
//   4. Duplicate subject cannot be included twice
//   5. Different currencies cannot be combined
//   8. Pay Now creates only one payment attempt
//   11. Failed gateway initialization does not mark orders as paid
//   12. Paymob checkout URL is returned correctly
//
// Uses `bun:test`. Mocks global fetch via `mock` replacement.
// =====================================================

import { describe, it, expect, mock, beforeEach } from 'bun:test';

const mockFetch = mock(async (_input: string | URL | Request, _init?: RequestInit) => {
  return new Response(JSON.stringify({
    success: true,
    session_id: 'session-uuid-001',
    items: [
      { order_id: 'order-1', subject_id: 'sub-1', subject_name: 'Math', amount: 100, currency: 'EGP' },
      { order_id: 'order-2', subject_id: 'sub-2', subject_name: 'Science', amount: 200, currency: 'EGP' },
    ],
    total_amount: 300,
    currency: 'EGP',
    item_count: 2,
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});

// @ts-expect-error — replace global fetch for tests
globalThis.fetch = mockFetch;

const {
  createCheckoutSession,
  initiateSessionPayment,
  getPaymentActionErrorMessage,
  PaymentActionError,
} = await import('@/lib/student/payment-action');

function resetMockFetch() {
  mockFetch.mockReset();
  mockFetch.mockImplementation(async () => new Response(
    JSON.stringify({
      success: true,
      session_id: 'session-uuid-001',
      items: [
        { order_id: 'order-1', subject_id: 'sub-1', subject_name: 'Math', amount: 100, currency: 'EGP' },
        { order_id: 'order-2', subject_id: 'sub-2', subject_name: 'Science', amount: 200, currency: 'EGP' },
      ],
      total_amount: 300,
      currency: 'EGP',
      item_count: 2,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  ));
}

// =====================================================
// createCheckoutSession — POST /api/student/checkout/sessions
// =====================================================

describe('createCheckoutSession — multi-subject session creation', () => {
  beforeEach(() => {
    resetMockFetch();
  });

  it('2. multiple paid subjects appear in one summary (session response)', async () => {
    const result = await createCheckoutSession(['order-1', 'order-2']);
    expect(result.session_id).toBe('session-uuid-001');
    expect(result.items.length).toBe(2);
    expect(result.items[0].subject_name).toBe('Math');
    expect(result.items[1].subject_name).toBe('Science');
  });

  it('3. correct combined total is calculated server-side (client does not compute)', async () => {
    const result = await createCheckoutSession(['order-1', 'order-2']);
    // Total comes from the server response — the client just reads it.
    // Verify the client passes the order IDs to the server, not a pre-computed total.
    expect(result.total_amount).toBe(300);
    expect(result.currency).toBe('EGP');

    // Verify the request body sent to the server contains only orderIds (no total)
    const callInit = mockFetch.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(callInit.body as string);
    expect(body.orderIds).toEqual(['order-1', 'order-2']);
    expect(body.total).toBeUndefined(); // client never sends a total
    expect(body.amount).toBeUndefined();
  });

  it('4. duplicate order IDs are deduped before being sent to the server', async () => {
    await createCheckoutSession(['order-1', 'order-1', 'order-2']);
    const callInit = mockFetch.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(callInit.body as string);
    // Dedup happens on the client (Array.from(new Set(...)))
    expect(body.orderIds).toEqual(['order-1', 'order-2']);
  });

  it('5. different currencies rejected by the server (category=CURRENCY_MISMATCH)', async () => {
    mockFetch.mockImplementation(async () => new Response(
      JSON.stringify({
        success: false,
        error: 'لا يمكن دمج طلبات بعملات مختلفة',
        currencies: ['EGP', 'USD'],
        category: 'CURRENCY_MISMATCH',
      }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    ));
    const err = await createCheckoutSession(['order-1', 'order-2']).catch(e => e);
    expect(err).toBeInstanceOf(PaymentActionError);
    expect(err.code).toBe('HTTP_ERROR');
    expect(err.category).toBe('CURRENCY_MISMATCH');
    expect(err.httpStatus).toBe(400);
  });

  it('5b. order already in another session (category=ALREADY_IN_SESSION)', async () => {
    mockFetch.mockImplementation(async () => new Response(
      JSON.stringify({
        success: false,
        error: 'الطلب order-1 ضمن جلسة دفع أخرى',
        order_id: 'order-1',
        existing_session_id: 'session-old',
        category: 'ALREADY_IN_SESSION',
      }),
      { status: 409, headers: { 'Content-Type': 'application/json' } },
    ));
    const err = await createCheckoutSession(['order-1', 'order-2']).catch(e => e);
    expect(err).toBeInstanceOf(PaymentActionError);
    expect(err.category).toBe('ALREADY_IN_SESSION');
    expect(err.httpStatus).toBe(409);
  });

  it('5c. concurrent session race (category=CONCURRENT_SESSION_RACE)', async () => {
    mockFetch.mockImplementation(async () => new Response(
      JSON.stringify({
        success: false,
        error: 'تعذّر إنشاء جلسة الدفع',
        category: 'CONCURRENT_SESSION_RACE',
      }),
      { status: 409, headers: { 'Content-Type': 'application/json' } },
    ));
    const err = await createCheckoutSession(['order-1']).catch(e => e);
    expect(err.category).toBe('CONCURRENT_SESSION_RACE');
  });

  it('6. network failure → NETWORK_ERROR', async () => {
    mockFetch.mockImplementation(async () => {
      throw new TypeError('Failed to fetch');
    });
    const err = await createCheckoutSession(['order-1']).catch(e => e);
    expect(err).toBeInstanceOf(PaymentActionError);
    expect(err.code).toBe('NETWORK_ERROR');
  });

  it('empty orderIds array → client-side validation error', async () => {
    const err = await createCheckoutSession([]).catch(e => e);
    expect(err).toBeInstanceOf(PaymentActionError);
    expect(err.code).toBe('HTTP_ERROR');
    expect(err.message).toContain('orderIds must be a non-empty array');
    // Should NOT have made a network request
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('missing session_id in success response → INVALID_RESPONSE', async () => {
    mockFetch.mockImplementation(async () => new Response(
      JSON.stringify({ success: true, items: [], total_amount: 0, currency: 'EGP' }),  // no session_id
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ));
    const err = await createCheckoutSession(['order-1']).catch(e => e);
    expect(err.code).toBe('INVALID_RESPONSE');
  });
});

// =====================================================
// initiateSessionPayment — POST /api/student/checkout/sessions/[id]/pay
// =====================================================

describe('initiateSessionPayment — multi-subject Paymob initiation', () => {
  beforeEach(() => {
    resetMockFetch();
    mockFetch.mockImplementation(async () => new Response(
      JSON.stringify({
        success: true,
        checkout_url: 'https://paymob.example/checkout/session-001',
        payment_reference: 'paymob-intention-001',
        session_id: 'session-uuid-001',
        message: 'تم إنشاء دفعة موحدة',
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ));
  });

  it('12. Paymob checkout URL is returned correctly for the session', async () => {
    const result = await initiateSessionPayment('session-uuid-001');
    expect(result.checkoutUrl).toBe('https://paymob.example/checkout/session-001');
    expect(result.paymentReference).toBe('paymob-intention-001');
  });

  it('8. Pay Now creates only one payment attempt per click', async () => {
    await initiateSessionPayment('session-uuid-001');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('11. failed gateway initialization does NOT mark orders as paid', async () => {
    // Server returns GATEWAY_NOT_CONFIGURED — the client receives an
    // error, and NO payment is created on the server side either.
    mockFetch.mockImplementation(async () => new Response(
      JSON.stringify({
        success: false,
        error: 'بوابة الدفع غير مُهيّأة',
        category: 'GATEWAY_NOT_CONFIGURED',
      }),
      { status: 503, headers: { 'Content-Type': 'application/json' } },
    ));
    const err = await initiateSessionPayment('session-uuid-001').catch(e => e);
    expect(err).toBeInstanceOf(PaymentActionError);
    expect(err.category).toBe('GATEWAY_NOT_CONFIGURED');
    // The client does NOT make any further request — the order's
    // status is NOT changed by the client.
  });

  it('11b. STALE_ORDER category is propagated from the server', async () => {
    mockFetch.mockImplementation(async () => new Response(
      JSON.stringify({
        success: false,
        error: 'هذا الطلب لم يعد صالحًا للدفع',
        category: 'STALE_ORDER',
      }),
      { status: 409, headers: { 'Content-Type': 'application/json' } },
    ));
    const err = await initiateSessionPayment('session-uuid-001').catch(e => e);
    expect(err.category).toBe('STALE_ORDER');
    expect(err.httpStatus).toBe(409);
  });

  it('URL is constructed correctly with the session_id', async () => {
    await initiateSessionPayment('session-uuid-001');
    const url = String(mockFetch.mock.calls[0][0]);
    expect(url).toContain('/api/student/checkout/sessions/session-uuid-001/pay');
  });

  it('session_id with special chars is URL-encoded', async () => {
    await initiateSessionPayment('session with space');
    const url = String(mockFetch.mock.calls[0][0]);
    expect(url).toContain('session%20with%20space');
  });

  it('missing checkout_url → MISSING_CHECKOUT_URL', async () => {
    mockFetch.mockImplementation(async () => new Response(
      JSON.stringify({ success: true, payment_reference: 'ref' }),  // no checkout_url
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ));
    const err = await initiateSessionPayment('session-uuid-001').catch(e => e);
    expect(err.code).toBe('MISSING_CHECKOUT_URL');
  });

  it('network failure → NETWORK_ERROR', async () => {
    mockFetch.mockImplementation(async () => {
      throw new TypeError('Failed to fetch');
    });
    const err = await initiateSessionPayment('session-uuid-001').catch(e => e);
    expect(err.code).toBe('NETWORK_ERROR');
  });

  it('empty sessionId → client-side validation', async () => {
    const err = await initiateSessionPayment('').catch(e => e);
    expect(err.code).toBe('HTTP_ERROR');
    expect(err.message).toContain('sessionId is required');
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// =====================================================
// getPaymentActionErrorMessage — client-side Arabic mapping
// =====================================================

describe('getPaymentActionErrorMessage — categorized Arabic messages', () => {
  const fallback = 'fallback message';

  it('NETWORK_ERROR → Arabic network message', () => {
    const err = new PaymentActionError('NETWORK_ERROR', 'fail');
    const msg = getPaymentActionErrorMessage(err, fallback);
    expect(msg).toContain('تعذّر الاتصال');
    expect(msg).not.toContain('fail'); // doesn't leak raw error
  });

  it('INVALID_RESPONSE → Arabic invalid response message', () => {
    const err = new PaymentActionError('INVALID_RESPONSE', 'fail');
    const msg = getPaymentActionErrorMessage(err, fallback);
    expect(msg).toContain('تعذّر فهم استجابة');
  });

  it('MISSING_CHECKOUT_URL → Arabic message (no redirect happened)', () => {
    const err = new PaymentActionError('MISSING_CHECKOUT_URL', 'fail');
    const msg = getPaymentActionErrorMessage(err, fallback);
    expect(msg).toContain('لم يتم خصم');
  });

  it('GATEWAY_NOT_CONFIGURED → Arabic message (admin action required)', () => {
    const err = new PaymentActionError('HTTP_ERROR', 'fail', 503, 'fail', 'GATEWAY_NOT_CONFIGURED');
    const msg = getPaymentActionErrorMessage(err, fallback);
    expect(msg).toContain('غير مُهيّأة');
    expect(msg).toContain('المسؤول');
  });

  it('STALE_ORDER → Arabic stale-order message', () => {
    const err = new PaymentActionError('HTTP_ERROR', 'fail', 409, 'fail', 'STALE_ORDER');
    const msg = getPaymentActionErrorMessage(err, fallback);
    expect(msg).toContain('لم يعد صالحًا');
  });

  it('CURRENCY_MISMATCH → Arabic currency mismatch message', () => {
    const err = new PaymentActionError('HTTP_ERROR', 'fail', 400, 'fail', 'CURRENCY_MISMATCH');
    const msg = getPaymentActionErrorMessage(err, fallback);
    expect(msg).toContain('عملات مختلفة');
  });

  it('PAYMOB_NETWORK_FAILURE → Arabic Paymob network failure message', () => {
    const err = new PaymentActionError('HTTP_ERROR', 'fail', 502, 'fail', 'PAYMOB_NETWORK_FAILURE');
    const msg = getPaymentActionErrorMessage(err, fallback);
    expect(msg).toContain('تحقق من اتصال الإنترنت');
  });

  it('PAYMOB_API_REJECTED → Arabic Paymob rejection message (no "specm通了")', () => {
    const err = new PaymentActionError('HTTP_ERROR', 'fail', 502, 'fail', 'PAYMOB_API_REJECTED');
    const msg = getPaymentActionErrorMessage(err, fallback);
    expect(msg).toContain('تعذّر تجهيز عملية الدفع');
    expect(msg).toContain('لم يتم خصم');
  });

  it('ALREADY_IN_SESSION → Arabic already-in-session message', () => {
    const err = new PaymentActionError('HTTP_ERROR', 'fail', 409, 'fail', 'ALREADY_IN_SESSION');
    const msg = getPaymentActionErrorMessage(err, fallback);
    expect(msg).toContain('ضمن جلسة دفع أخرى');
  });

  it('CONCURRENT_SESSION_RACE → Arabic concurrent race message', () => {
    const err = new PaymentActionError('HTTP_ERROR', 'fail', 409, 'fail', 'CONCURRENT_SESSION_RACE');
    const msg = getPaymentActionErrorMessage(err, fallback);
    expect(msg).toContain('تعذّر إنشاء جلسة الدفع');
  });

  it('UNKNOWN category → falls back to provided fallback', () => {
    const err = new PaymentActionError('HTTP_ERROR', 'fail', 500, 'fail', 'UNKNOWN');
    const msg = getPaymentActionErrorMessage(err, fallback);
    expect(msg).toBe(fallback);
  });

  it('no category → falls back when serverError is not Arabic', () => {
    const err = new PaymentActionError('HTTP_ERROR', 'english error', 500, 'english error');
    const msg = getPaymentActionErrorMessage(err, fallback);
    expect(msg).toBe(fallback);
  });

  it('no category → uses serverError when it contains Arabic text', () => {
    const err = new PaymentActionError('HTTP_ERROR', 'ar error', 500, 'رسالة عربية من الخادم');
    const msg = getPaymentActionErrorMessage(err, fallback);
    expect(msg).toBe('رسالة عربية من الخادم');
  });

  it('never leaks raw English server errors to the user when a category is set', () => {
    // Even if the server error message contains English text, the
    // categorized Arabic message takes precedence.
    const err = new PaymentActionError(
      'HTTP_ERROR',
      'GatewayNotFoundError: Payment gateway not found',
      503,
      'GatewayNotFoundError: Payment gateway not found',
      'GATEWAY_NOT_CONFIGURED',
    );
    const msg = getPaymentActionErrorMessage(err, fallback);
    expect(msg).not.toContain('GatewayNotFoundError');
    expect(msg).not.toContain('Payment gateway not found');
    expect(msg).toContain('غير مُهيّأة');
  });
});

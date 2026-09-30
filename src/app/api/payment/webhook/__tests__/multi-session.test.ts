// =====================================================
// Payment Webhook — Phase 7 Cross-Teacher Multi-Subject Test
// =====================================================
// Verifies that when a single Paymob payment covers multiple orders
// belonging to DIFFERENT subjects (and therefore different teachers),
// the webhook activates EACH order independently with that order's
// OWN amount, currency, and order_id — NOT mixed across orders.
//
// SCENARIO:
//   Student selects:
//     Subject A → Teacher A (amount 100 EGP)
//     Subject B → Teacher B (amount 200 EGP)
//   Both are placed into the same checkout session (session_id = 'sess-1').
//   One Paymob payment succeeds (transaction_id = 'paymob-tx-1', amount = 300).
//
// EXPECTED:
//   - The webhook calls activate_subscription_after_payment TWICE
//     (once per session order).
//   - Each call uses the per-order's OWN values:
//       Order A → p_order_id='order-A', p_amount=100, p_currency='EGP'
//       Order B → p_order_id='order-B', p_amount=200, p_currency='EGP'
//   - Each call uses a per-order unique provider_payment_id that
//     embeds the order_id (so the payments UNIQUE(provider_payment_id)
//     constraint is satisfied AND each order gets its own payment row).
//   - The session_id is NOT used as p_order_id (which would mix attributions).
//   - The session total (300) is NOT used as p_amount for any single order
//     (which would create wrong financial_ledger entries).
//
// WHY THIS TEST MATTERS:
//   The actual teacher_id attribution happens INSIDE the
//   activate_subscription_after_payment RPC (server-side), where it
//   resolves teacher_id via SELECT teacher_id FROM subjects WHERE id = v_order.subject_id.
//   This test verifies the WEBHOOK correctly delegates per-order
//   attribution by calling the RPC with each order's OWN values.
//   If the webhook were to mix orders (e.g., call the RPC once with
//   the session total), only one order's enrollment would be created
//   and the financial_ledger would attribute the wrong amount to the
//   wrong teacher.
//
// MOCK STRATEGY:
//   - mock.module replaces '@/lib/payment' so PaymentService.handleWebhook
//     returns a controlled WebhookResult (HMAC verification is OUT OF
//     SCOPE for this test — it's already covered by Paymob HMAC tests).
//   - mock.module replaces '@/lib/supabase-server' so the webhook's
//     DB queries return controlled data.
//   - The RPC spy tracks each call's parameters.
//
// Uses `bun:test`.
// =====================================================

import { describe, it, expect, mock, beforeEach } from 'bun:test';

// ─── Mock PaymentService.handleWebhook ───
const mockHandleWebhook = mock(async () => ({
  success: true,
  provider: 'paymob',
  orderId: 'sess-1',
  paymentReference: 'paymob-intention-1',
  providerTransactionId: 'paymob-tx-1',
  amount: 300,
  currency: 'EGP',
  status: 'paid',
  paidAt: '2025-09-27T12:00:00Z',
  metadata: { checkout_session_id: 'sess-1' },
}));

mock.module('@/lib/payment', () => ({
  PaymentService: {
    handleWebhook: mockHandleWebhook,
  },
  isPaymentError: (err: unknown) => err instanceof Error && 'code' in err,
}));

// ─── Mock supabaseServer ───
// The webhook uses a chainable pattern: .from('orders').select(...).eq(...).maybeSingle()
// We mock it with a thenable chain that returns controlled data.

// RPC spy — captures each call's parameters
const rpcCalls: Array<{
  p_order_id: string;
  p_provider_payment_id: string;
  p_amount: number;
  p_currency: string;
  p_status: string;
  p_raw_payload: unknown;
  p_confirmed_by: unknown;
}> = [];

// Default session orders: Subject A → Teacher A, Subject B → Teacher B
// (teacher attribution is resolved INSIDE the RPC from subjects.teacher_id,
//  so the webhook only sees subject_id + amount per order)
let currentSessionOrders: Array<Record<string, unknown>> = [
  {
    id: 'order-A',
    student_id: 'student-1',
    subject_id: 'subject-A', // → Teacher A (resolved by RPC)
    amount: 100,
    currency: 'EGP',
    status: 'pending',
    gateway_id: 'gateway-1',
    checkout_session_id: 'sess-1',
  },
  {
    id: 'order-B',
    student_id: 'student-1',
    subject_id: 'subject-B', // → Teacher B (resolved by RPC)
    amount: 200,
    currency: 'EGP',
    status: 'pending',
    gateway_id: 'gateway-1',
    checkout_session_id: 'sess-1',
  },
];

// Build a chainable mock that:
//   - When .maybeSingle() is called → returns Promise<{ data, error }>
//     The data depends on which table the chain was opened for:
//     - financial_ledger → returns { id: 'mock-ledger-id' } (truthy —
//       simulates that the ledger row exists, so the webhook's
//       PAID_BUT_NO_LEDGER reconciliation path is NOT triggered)
//     - otherwise → returns null (matches the original mock behavior
//       for orders lookups via .maybeSingle())
//   - When awaited directly (without .maybeSingle()) → returns
//     Promise<{ data: currentSessionOrders, error: null }>
function buildChain(table?: string) {
  let chain: Record<string, unknown>;

  // The "session lookup" result (when awaited directly)
  const sessionResult = { data: currentSessionOrders, error: null };

  // For .maybeSingle() on the financial_ledger table, return a
  // truthy mock so the webhook's PAID_BUT_NO_LEDGER check finds an
  // existing ledger row and short-circuits correctly.
  const maybeSingleResult = table === 'financial_ledger'
    ? { data: { id: 'mock-ledger-id' }, error: null }
    : { data: null, error: null };

  chain = {
    select: () => chain,
    eq: () => chain,
    is: () => chain,
    in: () => chain,
    order: () => chain,
    range: () => chain,
    limit: () => chain,
    update: () => chain,
    insert: () => chain,
    // .maybeSingle() returns a Promise (NOT thenable) → single-order lookup
    maybeSingle: async () => maybeSingleResult,
    single: async () => maybeSingleResult,
    // Make the chain itself thenable → when awaited without .maybeSingle(),
    // resolves to the session orders array
    then: (resolve: (v: unknown) => void, _reject?: (v: unknown) => void) => {
      resolve(sessionResult);
    },
  };
  return chain;
}

const mockSupabaseServer = {
  from: mock(function (table: string) {
    return buildChain(table);
  }),
  rpc: mock(async function (_fn: string, params: Record<string, unknown>) {
    rpcCalls.push({
      p_order_id: String(params.p_order_id),
      p_provider_payment_id: String(params.p_provider_payment_id),
      p_amount: Number(params.p_amount),
      p_currency: String(params.p_currency),
      p_status: String(params.p_status),
      p_raw_payload: params.p_raw_payload,
      p_confirmed_by: params.p_confirmed_by,
    });
    return { data: { success: true, order_id: params.p_order_id }, error: null };
  }),
};

mock.module('@/lib/supabase-server', () => ({
  supabaseServer: mockSupabaseServer,
}));

mock.module('@/lib/payment/logger', () => ({
  logPaymentEvent: () => {},
}));

const { POST } = await import('@/app/api/payment/webhook/route');

function makeRequest(body: string, gatewayId?: string) {
  const url = new URL(
    gatewayId
      ? `http://localhost/api/payment/webhook?provider=paymob&gateway_id=${gatewayId}`
      : 'http://localhost/api/payment/webhook?provider=paymob',
  );
  const headers = new Headers();
  headers.set('Content-Type', 'application/json');

  const req = {
    nextUrl: { searchParams: url.searchParams, origin: 'http://localhost' },
    headers,
    text: async () => body,
    json: async () => JSON.parse(body),
  };
  return req as unknown as import('next/server').NextRequest;
}

describe('Phase 7 — Cross-teacher multi-subject webhook activation', () => {
  beforeEach(() => {
    mockHandleWebhook.mockReset();
    mockHandleWebhook.mockImplementation(async () => ({
      success: true,
      provider: 'paymob',
      orderId: 'sess-1',
      paymentReference: 'paymob-intention-1',
      providerTransactionId: 'paymob-tx-1',
      amount: 300,
      currency: 'EGP',
      status: 'paid',
      paidAt: '2025-09-27T12:00:00Z',
      metadata: { checkout_session_id: 'sess-1' },
    }));
    rpcCalls.length = 0;
    // Reset session orders to default (pending)
    currentSessionOrders = [
      {
        id: 'order-A',
        student_id: 'student-1',
        subject_id: 'subject-A',
        amount: 100,
        currency: 'EGP',
        status: 'pending',
        gateway_id: 'gateway-1',
        checkout_session_id: 'sess-1',
      },
      {
        id: 'order-B',
        student_id: 'student-1',
        subject_id: 'subject-B',
        amount: 200,
        currency: 'EGP',
        status: 'pending',
        gateway_id: 'gateway-1',
        checkout_session_id: 'sess-1',
      },
    ];
  });

  it('6. Cross-teacher multi-subject: each order activated with its OWN values', async () => {
    const body = JSON.stringify({
      type: 'transaction',
      obj: { success: true, amount_cents: 30000, special_reference: 'sess-1' },
      hmac: 'verified-by-mock',
    });
    const req = makeRequest(body, 'gateway-1');

    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.success).toBe(true);
    expect(json.session_id).toBe('sess-1');

    // ─── Verify TWO RPC calls (one per session order) ───
    expect(rpcCalls.length).toBe(2);

    // ─── Verify Order A's RPC call uses Order A's OWN values ───
    const callA = rpcCalls.find((c) => c.p_order_id === 'order-A');
    expect(callA).toBeDefined();
    expect(callA!.p_amount).toBe(100); // ← Order A's amount, NOT 300 (session total)
    expect(callA!.p_currency).toBe('EGP');
    expect(callA!.p_status).toBe('paid');
    expect(callA!.p_provider_payment_id).toContain('paymob-tx-1');
    expect(callA!.p_provider_payment_id).toContain('order-A'); // per-order unique
    expect(callA!.p_provider_payment_id).not.toContain('order-B'); // no cross-contamination

    // ─── Verify Order B's RPC call uses Order B's OWN values ───
    const callB = rpcCalls.find((c) => c.p_order_id === 'order-B');
    expect(callB).toBeDefined();
    expect(callB!.p_amount).toBe(200); // ← Order B's amount, NOT 300 (session total)
    expect(callB!.p_currency).toBe('EGP');
    expect(callB!.p_status).toBe('paid');
    expect(callB!.p_provider_payment_id).toContain('paymob-tx-1');
    expect(callB!.p_provider_payment_id).toContain('order-B');
    expect(callB!.p_provider_payment_id).not.toContain('order-A');

    // ─── Verify NO RPC call used the session_id as p_order_id ───
    // (that would mix teacher attributions across orders)
    const mixedCall = rpcCalls.find((c) => c.p_order_id === 'sess-1');
    expect(mixedCall).toBeUndefined();

    // ─── Verify NO RPC call used the session total (300) as p_amount ───
    // (that would attribute the wrong amount to each teacher in financial_ledger)
    const totalCall = rpcCalls.find((c) => c.p_amount === 300);
    expect(totalCall).toBeUndefined();

    // ─── Verify the per-order provider_payment_ids are DIFFERENT ───
    // (satisfies payments UNIQUE(provider_payment_id))
    expect(callA!.p_provider_payment_id).not.toBe(callB!.p_provider_payment_id);

    // ─── Verify the per-order provider_payment_ids follow the expected pattern ───
    // Format: `${paymobTxId}:${orderId}` (see webhook route.ts)
    expect(callA!.p_provider_payment_id).toBe('paymob-tx-1:order-A');
    expect(callB!.p_provider_payment_id).toBe('paymob-tx-1:order-B');
  });

  it('7. Multi-session replay → no duplicate RPC calls (idempotency via already-paid check)', async () => {
    // On replay, both session orders have status='paid' → webhook skips
    // the RPC call entirely (returns already_paid=true per order).
    currentSessionOrders = currentSessionOrders.map((o) => ({ ...o, status: 'paid' }));

    const body = JSON.stringify({
      type: 'transaction',
      obj: { success: true, amount_cents: 30000, special_reference: 'sess-1' },
      hmac: 'verified-by-mock',
    });
    const req = makeRequest(body, 'gateway-1');
    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.activated_orders.length).toBe(2);
    // Both orders are marked already_paid=true → no RPC was called
    expect(rpcCalls.length).toBe(0);
    expect(json.activated_orders.every((r: { already_paid?: boolean }) => r.already_paid === true)).toBe(true);
  });

  it('9. Amount mismatch (session total ≠ SUM(orders.amount)) → rejected, no activation', async () => {
    // Paymob reports amount = 999 but SUM(orders.amount) = 300 → mismatch
    mockHandleWebhook.mockImplementation(async () => ({
      success: true,
      provider: 'paymob',
      orderId: 'sess-1',
      paymentReference: 'paymob-intention-1',
      providerTransactionId: 'paymob-tx-1',
      amount: 999, // ← wrong amount
      currency: 'EGP',
      status: 'paid',
      metadata: {},
    }));

    const body = JSON.stringify({
      type: 'transaction',
      obj: { success: true, amount_cents: 99900, special_reference: 'sess-1' },
      hmac: 'verified-by-mock',
    });
    const req = makeRequest(body, 'gateway-1');
    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.ignored).toBe('session_amount_mismatch');
    // No RPC was called → no orders activated
    expect(rpcCalls.length).toBe(0);
  });

  it('9b. Currency mismatch (Paymob currency ≠ session currency) → rejected', async () => {
    mockHandleWebhook.mockImplementation(async () => ({
      success: true,
      provider: 'paymob',
      orderId: 'sess-1',
      paymentReference: 'paymob-intention-1',
      providerTransactionId: 'paymob-tx-1',
      amount: 300,
      currency: 'USD', // ← different from session's EGP
      status: 'paid',
      metadata: {},
    }));

    const body = JSON.stringify({
      type: 'transaction',
      obj: { success: true, amount_cents: 30000, currency: 'USD', special_reference: 'sess-1' },
      hmac: 'verified-by-mock',
    });
    const req = makeRequest(body, 'gateway-1');
    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.ignored).toBe('session_currency_mismatch');
    expect(rpcCalls.length).toBe(0);
  });

  it('5. Failed status for multi-session → marks ALL session orders as failed, no activation', async () => {
    mockHandleWebhook.mockImplementation(async () => ({
      success: true,
      provider: 'paymob',
      orderId: 'sess-1',
      paymentReference: 'paymob-intention-1',
      providerTransactionId: 'paymob-tx-1',
      amount: 300,
      currency: 'EGP',
      status: 'failed',
      metadata: {},
    }));

    const body = JSON.stringify({
      type: 'transaction',
      obj: { success: false, amount_cents: 30000, special_reference: 'sess-1' },
      hmac: 'verified-by-mock',
    });
    const req = makeRequest(body, 'gateway-1');
    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.status).toBe('failed');
    // No RPC was called (failed status → no activation, just order status update)
    expect(rpcCalls.length).toBe(0);
  });
});

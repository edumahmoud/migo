// =====================================================
// Paymob Adapter — Accept API Integration Tests
// =====================================================
// Updated for Phase 14: switched from Intention API (intake.paymob.com,
// NXDOMAIN) to Accept API (accept.paymob.com, working).
//
// Accept API flow (3 steps + redirect):
//   1. POST /api/auth/tokens           → auth token
//   2. POST /api/ecommerce/orders      → Paymob order ID
//   3. POST /api/acceptance/payment_keys → payment token
//   4. Redirect to /api/acceptance/iframes/{id}?payment_token={token}
//
// Tests: createPayment, handleWebhook, verifyPayment, testConnection
// Uses mock fetch responses — no real Paymob API calls.

import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { createHmac } from 'crypto';
import { PaymobAdapter } from '../adapter';
import type { GatewayCredentials, GatewayConfiguration } from '../../types';

// ─── Test credentials + configuration (fake — not real Paymob keys) ───
const TEST_CREDENTIALS: GatewayCredentials = {
  secretKey: 'sk_test_fake_key_for_unit_tests_12345',
  hmacSecret: 'hmac_test_secret_for_unit_tests_67890',
  integrationIds: [123456],
};

const TEST_CONFIG: GatewayConfiguration = {
  notificationUrl: 'https://example.com/api/payment/webhook?provider=paymob&gateway_id=test-gw-id',
  redirectionUrl: 'https://example.com/?payment_callback=success',
  paymentMethods: ['card'],
  gatewayId: 'test-gw-id',
};

// ─── Mock fetch ───
const originalFetch = globalThis.fetch;

function mockFetch(responses: Record<string, { status: number; body: unknown }>) {
  const fetchMock = mock(async (url: string | URL, init?: RequestInit) => {
    const urlStr = typeof url === 'string' ? url : url.toString();
    const matchingKey = Object.keys(responses).find(k => urlStr.includes(k));

    if (matchingKey) {
      const { status, body } = responses[matchingKey];
      return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response('Not Found', { status: 404 });
  });

  globalThis.fetch = fetchMock as any;
  return fetchMock;
}

// ─── Helper: mock all 3 Accept API endpoints ───
function mockAcceptApi(overrides?: {
  authToken?: string;
  orderId?: number;
  paymentToken?: string;
}) {
  return mockFetch({
    'auth/tokens': {
      status: 200,
      body: { token: overrides?.authToken ?? 'auth_token_test_123' },
    },
    'ecommerce/orders': {
      status: 201,
      body: {
        id: overrides?.orderId ?? 987654,
        merchant_order_id: 'order-uuid-123',
        amount_cents: 10000,
        currency: 'EGP',
      },
    },
    'payment_keys': {
      status: 201,
      body: { token: overrides?.paymentToken ?? 'payment_token_test_789' },
    },
  });
}

beforeEach(() => {
  globalThis.fetch = originalFetch;
});

// ─── Tests ───

describe('PaymobAdapter', () => {
  const adapter = new PaymobAdapter();

  test('provider is "paymob"', () => {
    expect(adapter.provider).toBe('paymob');
  });

  test('capabilities are correct', () => {
    expect(adapter.capabilities.supportsRefund).toBe(false);
    expect(adapter.capabilities.supportsVerify).toBe(true);
    expect(adapter.capabilities.supportsWebhook).toBe(true);
    expect(adapter.capabilities.supportsRedirectCheckout).toBe(true);
    expect(adapter.capabilities.supportsEmbeddedCheckout).toBe(false);
  });

  test('adapter does NOT have activate_subscription_after_payment method', () => {
    expect((adapter as any).activateSubscription).toBeUndefined();
    expect((adapter as any).activate_subscription_after_payment).toBeUndefined();
  });

  test('adapter does NOT have methods to modify subject_students or orders', () => {
    expect((adapter as any).updateOrderStatus).toBeUndefined();
    expect((adapter as any).markAsPaid).toBeUndefined();
    expect((adapter as any).createEnrollment).toBeUndefined();
  });
});

describe('PaymobAdapter.createPayment', () => {
  const adapter = new PaymobAdapter();

  test('returns checkout URL (iframe) + payment token on success', async () => {
    mockAcceptApi();

    const result = await adapter.createPayment(
      {
        orderId: 'order-uuid-123',
        amount: 100.00,
        currency: 'EGP',
        customerEmail: 'student@example.com',
        customerName: 'Test Student',
        description: 'Test Course',
      },
      TEST_CREDENTIALS,
      TEST_CONFIG,
    );

    expect(result.success).toBe(true);
    expect(result.provider).toBe('paymob');
    expect(result.checkoutUrl).toContain('accept.paymob.com/api/acceptance/iframes/123456');
    expect(result.checkoutUrl).toContain('payment_token=payment_token_test_789');
    expect(result.paymentReference).toBe('987654'); // Paymob order ID
    expect(result.clientSecret).toBe('payment_token_test_789');
  });

  test('amount is converted to cents (100 EGP → 10000)', async () => {
    const fetchMock = mockAcceptApi();

    await adapter.createPayment(
      { orderId: 'test', amount: 100, currency: 'EGP' },
      TEST_CREDENTIALS,
      TEST_CONFIG,
    );

    // Check the body sent to /api/ecommerce/orders — amount should be in cents
    // The 2nd call (index 1) is the createOrder call
    const orderCall = fetchMock.mock.calls[1];
    const body = JSON.parse(orderCall[1].body);
    expect(body.amount_cents).toBe(10000);
  });

  test('credentials do NOT appear in the result', async () => {
    mockAcceptApi();

    const result = await adapter.createPayment(
      { orderId: 'test', amount: 50, currency: 'EGP' },
      TEST_CREDENTIALS,
      TEST_CONFIG,
    );

    const resultStr = JSON.stringify(result);
    expect(resultStr).not.toContain(TEST_CREDENTIALS.secretKey);
    expect(resultStr).not.toContain(TEST_CREDENTIALS.hmacSecret);
    expect(resultStr).not.toContain('sk_test_fake');
    expect(resultStr).not.toContain('hmac_test_secret');
  });

  test('invalid amount (0) throws PaymentCreationFailedError', async () => {
    await expect(
      adapter.createPayment(
        { orderId: 'test', amount: 0, currency: 'EGP' },
        TEST_CREDENTIALS,
        TEST_CONFIG,
      ),
    ).rejects.toThrow('Amount must be > 0');
  });

  test('missing secretKey throws GatewayConfigurationInvalidError', async () => {
    await expect(
      adapter.createPayment(
        { orderId: 'test', amount: 100, currency: 'EGP' },
        { hmacSecret: 'test', integrationIds: [123] }, // missing secretKey
        TEST_CONFIG,
      ),
    ).rejects.toThrow('Missing or invalid API Key');
  });

  test('missing hmacSecret throws GatewayConfigurationInvalidError', async () => {
    await expect(
      adapter.createPayment(
        { orderId: 'test', amount: 100, currency: 'EGP' },
        { secretKey: 'test', integrationIds: [123] }, // missing hmacSecret
        TEST_CONFIG,
      ),
    ).rejects.toThrow('Missing or invalid hmacSecret');
  });

  test('missing integrationIds throws GatewayConfigurationInvalidError', async () => {
    await expect(
      adapter.createPayment(
        { orderId: 'test', amount: 100, currency: 'EGP' },
        { secretKey: 'valid_key_12345', hmacSecret: 'valid_hmac_12345' }, // missing integrationIds
        TEST_CONFIG,
      ),
    ).rejects.toThrow('Missing integrationIds');
  });

  test('missing notificationUrl throws GatewayConfigurationInvalidError', async () => {
    await expect(
      adapter.createPayment(
        { orderId: 'test', amount: 100, currency: 'EGP' },
        TEST_CREDENTIALS,
        { redirectionUrl: 'https://example.com' }, // missing notificationUrl
      ),
    ).rejects.toThrow('Missing notificationUrl');
  });
});

describe('PaymobAdapter.handleWebhook', () => {
  const adapter = new PaymobAdapter();

  // Helper: compute a valid HMAC for a callback obj
  function computeHmac(obj: Record<string, unknown>): string {
    const fields = [
      'amount_cents', 'created_at', 'currency', 'error_occured',
      'has_parent_transaction', 'id', 'integration_id',
      'is_3D_secure_authentication', 'is_refunded', 'is_standalone_payment',
      'order', 'owner', 'pending', 'source_data_pan', 'source_data_sub_type',
      'source_data_type', 'success',
    ].sort();

    const parts = fields.map(f => {
      if (f.startsWith('source_data_')) {
        const sub = f.replace('source_data_', '');
        const sd = obj['source_data'] as Record<string, unknown> | undefined;
        const v = sd?.[sub];
        return v !== undefined && v !== null ? String(v) : '';
      }
      if (f === 'order') {
        const o = obj['order'];
        if (o && typeof o === 'object') return String((o as Record<string, unknown>)?.id ?? '');
        return o !== undefined && o !== null ? String(o) : '';
      }
      const v = obj[f];
      return v !== undefined && v !== null ? String(v) : '';
    });

    return createHmac('sha512', TEST_CREDENTIALS.hmacSecret)
      .update(parts.join(''), 'utf8')
      .digest('hex');
  }

  test('successful payment callback with special_reference → status=paid', async () => {
    const obj = {
      amount_cents: 10000,
      created_at: '2024-01-01T00:00:00Z',
      currency: 'EGP',
      error_occured: false,
      has_parent_transaction: false,
      id: 'txn_paymob_123',
      integration_id: 1,
      is_3D_secure_authentication: false,
      is_refunded: false,
      is_standalone_payment: true,
      order: 'order_test',
      owner: 'test',
      pending: false,
      source_data: { pan: '****', sub_type: 'CARD', type: 'card' },
      success: true,
      special_reference: 'order-uuid-123',
    };

    const hmac = computeHmac(obj);
    const rawBody = JSON.stringify({ type: 'transaction', obj, hmac });

    const result = await adapter.handleWebhook(
      { rawBody, headers: {} },
      TEST_CREDENTIALS,
      TEST_CONFIG,
    );

    expect(result.success).toBe(true);
    expect(result.status).toBe('paid');
    expect(result.orderId).toBe('order-uuid-123');
    expect(result.providerTransactionId).toBe('txn_paymob_123');
    expect(result.amount).toBe(100);
    expect(result.currency).toBe('EGP');
  });

  test('Accept API callback with order.merchant_order_id → extracts order ID', async () => {
    // The Accept API callback uses obj.order.merchant_order_id instead of
    // obj.special_reference. The adapter must extract it.
    const obj = {
      amount_cents: 10000,
      created_at: '2024-01-01T00:00:00Z',
      currency: 'EGP',
      error_occured: false,
      has_parent_transaction: false,
      id: 'txn_accept_123',
      integration_id: 123456,
      is_3D_secure_authentication: false,
      is_refunded: false,
      is_standalone_payment: true,
      order: { id: 987654, merchant_order_id: 'order-uuid-accept' },
      owner: 'test',
      pending: false,
      source_data: { pan: '****', sub_type: 'CARD', type: 'card' },
      success: true,
    };

    const hmac = computeHmac(obj);
    const rawBody = JSON.stringify({ type: 'transaction', obj, hmac });

    const result = await adapter.handleWebhook(
      { rawBody, headers: {} },
      TEST_CREDENTIALS,
      TEST_CONFIG,
    );

    expect(result.success).toBe(true);
    expect(result.status).toBe('paid');
    expect(result.orderId).toBe('order-uuid-accept'); // extracted from order.merchant_order_id
  });

  test('failed payment callback → status=failed', async () => {
    const obj = {
      success: false,
      pending: false,
      id: 'txn_fail',
      amount_cents: 10000,
      currency: 'EGP',
      special_reference: 'order-uuid-fail',
    };
    const hmac = computeHmac(obj);
    const rawBody = JSON.stringify({ obj, hmac });

    const result = await adapter.handleWebhook(
      { rawBody, headers: {} },
      TEST_CREDENTIALS,
      TEST_CONFIG,
    );

    expect(result.success).toBe(false);
    expect(result.status).toBe('failed');
  });

  test('pending payment callback → status=pending', async () => {
    const obj = {
      success: false,
      pending: true,
      id: 'txn_pending',
      special_reference: 'order-uuid-pending',
    };
    const hmac = computeHmac(obj);
    const rawBody = JSON.stringify({ obj, hmac });

    const result = await adapter.handleWebhook(
      { rawBody, headers: {} },
      TEST_CREDENTIALS,
      TEST_CONFIG,
    );

    expect(result.status).toBe('pending');
  });

  test('invalid HMAC is rejected', async () => {
    const rawBody = JSON.stringify({
      obj: { success: true, amount_cents: 10000 },
      hmac: '0000000000000000', // wrong
    });

    await expect(
      adapter.handleWebhook({ rawBody, headers: {} }, TEST_CREDENTIALS, TEST_CONFIG),
    ).rejects.toThrow();
  });

  test('modified amount is rejected (HMAC mismatch)', async () => {
    const obj = { success: true, amount_cents: 10000, id: 'txn_1' };
    const hmac = computeHmac(obj);

    const tampered = { ...obj, amount_cents: 1 };
    const rawBody = JSON.stringify({ obj: tampered, hmac });

    await expect(
      adapter.handleWebhook({ rawBody, headers: {} }, TEST_CREDENTIALS, TEST_CONFIG),
    ).rejects.toThrow();
  });

  test('credentials do NOT appear in webhook result', async () => {
    const obj = { success: true, id: 'txn_1', special_reference: 'order-1', amount_cents: 100, currency: 'EGP' };
    const hmac = computeHmac(obj);
    const rawBody = JSON.stringify({ obj, hmac });

    const result = await adapter.handleWebhook(
      { rawBody, headers: {} },
      TEST_CREDENTIALS,
      TEST_CONFIG,
    );

    const resultStr = JSON.stringify(result);
    expect(resultStr).not.toContain(TEST_CREDENTIALS.secretKey);
    expect(resultStr).not.toContain(TEST_CREDENTIALS.hmacSecret);
  });

  test('adapter does NOT call activate_subscription_after_payment', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(
      path.join(__dirname, '..', 'adapter.ts'),
      'utf8',
    );

    expect(source).not.toContain('activate_subscription_after_payment');
    expect(source).not.toContain('subject_students');
    expect(source).not.toContain('rpc(');
  });
});

describe('PaymobAdapter.testConnection', () => {
  const adapter = new PaymobAdapter();

  test('valid credentials → success', async () => {
    const result = await adapter.testConnection(TEST_CREDENTIALS);
    expect(result.success).toBe(true);
    expect(result.provider).toBe('paymob');
  });

  test('short secretKey → failure', async () => {
    const result = await adapter.testConnection({ secretKey: 'sk', hmacSecret: 'valid_hmac_secret_123', integrationIds: [123] });
    expect(result.success).toBe(false);
    expect(result.message).toContain('API Key');
  });

  test('short hmacSecret → failure', async () => {
    const result = await adapter.testConnection({ secretKey: 'valid_secret_key_12345', hmacSecret: 'hm', integrationIds: [123] });
    expect(result.success).toBe(false);
    expect(result.message).toContain('hmacSecret');
  });

  test('missing integrationIds → failure', async () => {
    const result = await adapter.testConnection({ secretKey: 'valid_secret_key_12345', hmacSecret: 'valid_hmac_secret_123' });
    expect(result.success).toBe(false);
    expect(result.message).toContain('integrationIds');
  });
});

describe('PaymobAdapter.verifyPayment', () => {
  const adapter = new PaymobAdapter();

  test('returns paid status for successful transaction', async () => {
    mockFetch({
      'auth/tokens': { status: 200, body: { token: 'auth_token' } },
      'transactions': {
        status: 200,
        body: {
          id: 12345,
          success: true,
          pending: false,
          is_refunded: false,
          amount_cents: 10000,
          currency: 'EGP',
          order: { id: 67890, merchant_order_id: 'order-uuid-123' },
        },
      },
    });

    const result = await adapter.verifyPayment(
      { paymentReference: '12345' },
      TEST_CREDENTIALS,
      TEST_CONFIG,
    );

    expect(result.success).toBe(true);
    expect(result.status).toBe('paid');
    expect(result.amount).toBe(100);
    expect(result.currency).toBe('EGP');
  });

  test('returns pending status for pending transaction', async () => {
    mockFetch({
      'auth/tokens': { status: 200, body: { token: 'auth_token' } },
      'transactions': {
        status: 200,
        body: {
          id: 12346,
          success: false,
          pending: true,
          is_refunded: false,
          amount_cents: 5000,
          currency: 'EGP',
        },
      },
    });

    const result = await adapter.verifyPayment(
      { paymentReference: '12346' },
      TEST_CREDENTIALS,
      TEST_CONFIG,
    );

    expect(result.status).toBe('pending');
    expect(result.success).toBe(false);
  });

  test('credentials do NOT appear in verify result', async () => {
    mockFetch({
      'auth/tokens': { status: 200, body: { token: 'auth_token' } },
      'transactions': {
        status: 200,
        body: { id: 12347, success: true, pending: false, is_refunded: false, amount_cents: 100, currency: 'EGP' },
      },
    });

    const result = await adapter.verifyPayment(
      { paymentReference: '12347' },
      TEST_CREDENTIALS,
      TEST_CONFIG,
    );

    const resultStr = JSON.stringify(result);
    expect(resultStr).not.toContain(TEST_CREDENTIALS.secretKey);
    expect(resultStr).not.toContain(TEST_CREDENTIALS.hmacSecret);
  });
});

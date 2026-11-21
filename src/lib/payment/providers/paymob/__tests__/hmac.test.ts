// =====================================================
// Paymob Adapter — HMAC Verification Tests
// =====================================================
// Tests: HMAC computation, verification, rejection of tampered callbacks.
// Uses no real Paymob credentials.

import { describe, test, expect } from 'bun:test';
import { createHmac } from 'crypto';
import { verifyPaymobHmac, verifyRedirectHmacFromUrlParams } from '../hmac';
import type { PaymobCallbackPayload } from '../types';
import { WebhookVerificationFailedError } from '@/lib/payment/errors';

const TEST_HMAC_SECRET = 'test_hmac_secret_for_unit_tests_only';

// Helper: compute a valid HMAC for a given callback obj
function computeValidHmac(obj: Record<string, unknown>, secret: string): string {
  // Replicate the same field extraction + concatenation as the verifier.
  // MUST match Paymob's documented 20-field callback list (hmac-verification.md).
  const fields = [
    'amount_cents', 'created_at', 'currency', 'error_occured',
    'has_parent_transaction', 'id', 'integration_id',
    'is_3d_secure', 'is_auth', 'is_capture', 'is_refunded',
    'is_standalone_payment', 'is_voided',
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
      if (o && typeof o === 'object') {
        const oid = (o as Record<string, unknown>)?.id;
        return oid !== undefined ? String(oid) : '';
      }
      return o !== undefined && o !== null ? String(o) : '';
    }
    const v = obj[f];
    return v !== undefined && v !== null ? String(v) : '';
  });

  return createHmac('sha512', secret).update(parts.join(''), 'utf8').digest('hex');
}

describe('Paymob HMAC Verification', () => {
  test('valid HMAC is accepted (no throw)', () => {
    const obj = {
      amount_cents: 10000,
      created_at: '2024-01-01T00:00:00Z',
      currency: 'EGP',
      error_occured: false,
      has_parent_transaction: false,
      id: 'txn_123',
      integration_id: 1,
      is_3d_secure: false,
      is_auth: false,
      is_capture: false,
      is_refunded: false,
      is_standalone_payment: true,
      is_voided: false,
      order: 'order_456',
      owner: 'test_owner',
      pending: false,
      source_data: { pan: '****', sub_type: 'CARD', type: 'card' },
      success: true,
    };

    const hmac = computeValidHmac(obj, TEST_HMAC_SECRET);
    const payload: PaymobCallbackPayload = { type: 'transaction', obj, hmac };

    expect(() => verifyPaymobHmac(payload, TEST_HMAC_SECRET)).not.toThrow();
  });

  test('matches Paymob\'s DOCUMENTED worked example (field list pinned to docs)', () => {
    // Values + concatenation order from Paymob's official HMAC docs.
    // Concatenated string (documented):
    //   1002020-03-25T18:39:44.719228EGPfalsefalse25567066741truefalsefalsefalsetruefalse47782394705false2346MasterCardcardtrue
    const obj = {
      amount_cents: 100,
      created_at: '2020-03-25T18:39:44.719228',
      currency: 'EGP',
      error_occured: false,
      has_parent_transaction: false,
      id: 2556706,
      integration_id: 6741,
      is_3d_secure: true,
      is_auth: false,
      is_capture: false,
      is_refunded: false,
      is_standalone_payment: true,
      is_voided: false,
      order: { id: 4778239 },
      owner: 4705,
      pending: false,
      source_data: { pan: 2346, sub_type: 'MasterCard', type: 'card' },
      success: true,
    };
    // The verifier must produce EXACTLY the documented concatenation —
    // prove it by signing the documented string directly and requiring
    // the verifier to accept that signature.
    const documentedConcatenation =
      '1002020-03-25T18:39:44.719228EGPfalsefalse25567066741truefalsefalsefalsetruefalse47782394705false2346MasterCardcardtrue';
    const hmac = createHmac('sha512', TEST_HMAC_SECRET)
      .update(documentedConcatenation, 'utf8')
      .digest('hex');
    const payload: PaymobCallbackPayload = { type: 'transaction', obj, hmac };

    expect(() => verifyPaymobHmac(payload, TEST_HMAC_SECRET)).not.toThrow();
  });

  test('invalid HMAC is rejected', () => {
    const payload: PaymobCallbackPayload = {
      type: 'transaction',
      obj: { success: true, amount_cents: 10000 },
      hmac: '00000000000000000000000000000000',
    };
    // Match by error TYPE — the verifier may throw either
    // "length mismatch" or "signature mismatch" depending on input,
    // both wrapped in WebhookVerificationFailedError.
    expect(() => verifyPaymobHmac(payload, TEST_HMAC_SECRET)).toThrow(WebhookVerificationFailedError);
  });

  test('missing hmac field is rejected', () => {
    const payload: PaymobCallbackPayload = {
      type: 'transaction',
      obj: { success: true },
      // no hmac field
    };
    expect(() => verifyPaymobHmac(payload, TEST_HMAC_SECRET)).toThrow('missing `hmac`');
  });

  test('missing obj field is rejected', () => {
    const payload: PaymobCallbackPayload = {
      type: 'transaction',
      hmac: 'some_signature',
      // no obj
    };
    expect(() => verifyPaymobHmac(payload, TEST_HMAC_SECRET)).toThrow('missing `obj`');
  });

  test('empty hmacSecret is rejected', () => {
    const payload: PaymobCallbackPayload = {
      type: 'transaction',
      obj: {},
      hmac: 'abc',
    };
    expect(() => verifyPaymobHmac(payload, '')).toThrow('No HMAC secret');
  });

  test('modified amount is rejected (HMAC mismatch)', () => {
    const obj = {
      amount_cents: 10000,
      success: true,
      id: 'txn_1',
      order: 'order_1',
    };
    const hmac = computeValidHmac(obj, TEST_HMAC_SECRET);

    // Tamper with the amount
    const tamperedObj = { ...obj, amount_cents: 1 }; // changed!
    const payload: PaymobCallbackPayload = { obj: tamperedObj, hmac };

    expect(() => verifyPaymobHmac(payload, TEST_HMAC_SECRET)).toThrow(WebhookVerificationFailedError);
  });

  test('wrong secret is rejected', () => {
    const obj = { success: true, amount_cents: 10000, id: 'txn_1' };
    const hmac = computeValidHmac(obj, TEST_HMAC_SECRET);
    const payload: PaymobCallbackPayload = { obj, hmac };

    expect(() => verifyPaymobHmac(payload, 'wrong_secret')).toThrow(WebhookVerificationFailedError);
  });
});

describe('Paymob redirect-URL HMAC Verification', () => {
  // Paymob signs ONLY the fixed 20-field list (flattened query params),
  // in the documented order, values concatenated with no separator.
  // The redirect also carries UNSIGNED params that must be ignored.
  function signRedirectParams(params: Record<string, string>, secret: string): string {
    const SIGNED_ORDER = [
      'amount_cents', 'created_at', 'currency', 'error_occured',
      'has_parent_transaction', 'id', 'integration_id', 'is_3d_secure',
      'is_auth', 'is_capture', 'is_refunded', 'is_standalone_payment',
      'is_voided', 'order', 'owner', 'pending', 'source_data.pan',
      'source_data.sub_type', 'source_data.type', 'success',
    ];
    const input = SIGNED_ORDER.filter((k) => params[k] !== undefined).map((k) => params[k]).join('');
    return createHmac('sha512', secret).update(input, 'utf8').digest('hex');
  }

  const SIGNED_PARAMS: Record<string, string> = {
    amount_cents: '25000',
    created_at: '2026-11-21T15:30:00.000000',
    currency: 'EGP',
    error_occured: 'false',
    has_parent_transaction: 'false',
    id: '999888777',
    integration_id: '123456',
    is_3d_secure: 'true',
    is_auth: 'false',
    is_capture: 'false',
    is_refunded: 'false',
    is_standalone_payment: 'true',
    is_voided: 'false',
    order: '555444333',
    owner: '777',
    pending: 'false',
    'source_data.pan': '2346',
    'source_data.sub_type': 'MasterCard',
    'source_data.type': 'card',
    success: 'true',
  };

  test('valid signature is accepted — including UNSIGNED extra params', () => {
    const params: Record<string, string> = {
      ...SIGNED_PARAMS,
      // Unsigned params Paymob appends + our own baked into redirection_url:
      merchant_order_id: 'some-uuid',
      message: 'Approved',
      'data.message': 'Approved',
      txn_response_code: '00',
      payment_callback: 'success',
    };
    params.hmac = signRedirectParams(params, TEST_HMAC_SECRET);

    expect(verifyRedirectHmacFromUrlParams(params, TEST_HMAC_SECRET)).toBe(true);
  });

  test('tampered success flag is rejected', () => {
    const params: Record<string, string> = { ...SIGNED_PARAMS };
    params.hmac = signRedirectParams(params, TEST_HMAC_SECRET);
    params.success = 'false'; // attacker flips the signed field AFTER signing

    expect(verifyRedirectHmacFromUrlParams(params, TEST_HMAC_SECRET)).toBe(false);
  });

  test('forged params without hmac are rejected', () => {
    const params: Record<string, string> = { ...SIGNED_PARAMS };
    expect(verifyRedirectHmacFromUrlParams(params, TEST_HMAC_SECRET)).toBe(false);
  });

  test('wrong secret is rejected', () => {
    const params: Record<string, string> = { ...SIGNED_PARAMS };
    params.hmac = signRedirectParams(params, TEST_HMAC_SECRET);

    expect(verifyRedirectHmacFromUrlParams(params, 'wrong_secret')).toBe(false);
  });

  test('missing optional signed fields are skipped consistently', () => {
    // Wallet redirects may omit source_data.* — Paymob signs what it sends.
    const params: Record<string, string> = { ...SIGNED_PARAMS };
    delete params['source_data.pan'];
    delete params['source_data.sub_type'];
    delete params['source_data.type'];
    params.hmac = signRedirectParams(params, TEST_HMAC_SECRET);

    expect(verifyRedirectHmacFromUrlParams(params, TEST_HMAC_SECRET)).toBe(true);
  });
});

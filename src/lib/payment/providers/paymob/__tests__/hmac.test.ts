// =====================================================
// Paymob Adapter — HMAC Verification Tests
// =====================================================
// Tests: HMAC computation, verification, rejection of tampered callbacks.
// Uses no real Paymob credentials.

import { describe, test, expect } from 'bun:test';
import { createHmac } from 'crypto';
import { verifyPaymobHmac } from '../hmac';
import type { PaymobCallbackPayload } from '../types';

const TEST_HMAC_SECRET = 'test_hmac_secret_for_unit_tests_only';

// Helper: compute a valid HMAC for a given callback obj
function computeValidHmac(obj: Record<string, unknown>, secret: string): string {
  // Replicate the same field extraction + concatenation as the verifier
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
      is_3D_secure_authentication: false,
      is_refunded: false,
      is_standalone_payment: true,
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

  test('invalid HMAC is rejected', () => {
    const payload: PaymobCallbackPayload = {
      type: 'transaction',
      obj: { success: true, amount_cents: 10000 },
      hmac: '00000000000000000000000000000000',
    };
    expect(() => verifyPaymobHmac(payload, TEST_HMAC_SECRET)).toThrow('HMAC signature mismatch');
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

    expect(() => verifyPaymobHmac(payload, TEST_HMAC_SECRET)).toThrow('HMAC signature mismatch');
  });

  test('wrong secret is rejected', () => {
    const obj = { success: true, amount_cents: 10000, id: 'txn_1' };
    const hmac = computeValidHmac(obj, TEST_HMAC_SECRET);
    const payload: PaymobCallbackPayload = { obj, hmac };

    expect(() => verifyPaymobHmac(payload, 'wrong_secret')).toThrow('HMAC signature mismatch');
  });
});

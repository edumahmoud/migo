// =====================================================
// Server-side Payment Error Categorization — Tests
// =====================================================
// Verifies categorizePaymentError() — the server-side mapping from
// PaymentError codes to safe Arabic user-facing messages.
//
// Covers:
//   - Each PaymentErrorCode → correct category + Arabic message
//   - STALE_ORDER vs GATEWAY_NOT_CONFIGURED distinction (depends on
//     whether order.gateway_id was set)
//   - Paymob API rejection vs network failure vs invalid response
//   - Safe error message (no secrets, no stack trace)
//   - Non-PaymentError → UNKNOWN category
//
// Uses `bun:test`.
// =====================================================

import { describe, it, expect } from 'bun:test';
import {
  PaymentError,
  PaymentErrorCode,
  GatewayNotFoundError,
  GatewayDisabledError,
  GatewayNotImplementedError,
  CredentialsMissingError,
  EncryptionKeyMissingError,
  GatewayConfigurationInvalidError,
  PaymentCreationFailedError,
} from '@/lib/payment/errors';
import { categorizePaymentError } from '@/lib/student/payment-error-categories';

describe('categorizePaymentError — server-side error → Arabic message mapping', () => {
  it('GatewayNotFoundError WITHOUT orderGatewayId → GATEWAY_NOT_CONFIGURED (503)', () => {
    const err = new GatewayNotFoundError();
    const result = categorizePaymentError(err, null);
    expect(result.category).toBe('GATEWAY_NOT_CONFIGURED');
    expect(result.httpStatus).toBe(503);
    expect(result.userMessageAr).toContain('غير مُهيّأة');
    expect(result.userMessageAr).toContain('المسؤول');
  });

  it('GatewayNotFoundError WITH orderGatewayId → STALE_ORDER (409)', () => {
    // The order has a gateway_id set, but the gateway was deleted
    // → the resolver threw GatewayNotFoundError. We treat this as
    // a stale order, NOT a "no gateway configured" error.
    const err = new GatewayNotFoundError();
    const result = categorizePaymentError(err, 'gateway-uuid-001');
    expect(result.category).toBe('STALE_ORDER');
    expect(result.httpStatus).toBe(409); // Conflict — order needs re-creation
    expect(result.userMessageAr).toContain('لم يعد صالحًا');
  });

  it('GatewayDisabledError → GATEWAY_DISABLED (503)', () => {
    const err = new GatewayDisabledError('paymob');
    const result = categorizePaymentError(err);
    expect(result.category).toBe('GATEWAY_DISABLED');
    expect(result.httpStatus).toBe(503);
    expect(result.userMessageAr).toContain('غير متاحة');
  });

  it('GatewayNotImplementedError → GATEWAY_NOT_IMPLEMENTED (503)', () => {
    const err = new GatewayNotImplementedError('fawry');
    const result = categorizePaymentError(err);
    expect(result.category).toBe('GATEWAY_NOT_IMPLEMENTED');
    expect(result.httpStatus).toBe(503);
  });

  it('CredentialsMissingError → CREDENTIALS_MISSING (503)', () => {
    const err = new CredentialsMissingError('paymob');
    const result = categorizePaymentError(err);
    expect(result.category).toBe('CREDENTIALS_MISSING');
    expect(result.httpStatus).toBe(503);
  });

  it('EncryptionKeyMissingError → ENCRYPTION_KEY_MISSING (503)', () => {
    const err = new EncryptionKeyMissingError();
    const result = categorizePaymentError(err);
    expect(result.category).toBe('ENCRYPTION_KEY_MISSING');
    expect(result.httpStatus).toBe(503);
    expect(result.userMessageAr).toContain('تشفير');
  });

  it('GatewayConfigurationInvalidError → GATEWAY_CONFIG_INVALID (503)', () => {
    const err = new GatewayConfigurationInvalidError('paymob', 'Failed to decrypt');
    const result = categorizePaymentError(err);
    expect(result.category).toBe('GATEWAY_CONFIG_INVALID');
    expect(result.httpStatus).toBe(503);
    // The user-facing message does NOT include the raw internal message
    expect(result.userMessageAr).not.toContain('Failed to decrypt');
  });

  it('PaymentCreationFailedError with "Failed to connect to Paymob API" → PAYMOB_NETWORK_FAILURE (502)', () => {
    const err = new PaymentCreationFailedError('paymob', 'Failed to connect to Paymob API', {});
    const result = categorizePaymentError(err);
    expect(result.category).toBe('PAYMOB_NETWORK_FAILURE');
    expect(result.httpStatus).toBe(502);
    expect(result.userMessageAr).toContain('تحقق من اتصال الإنترنت');
  });

  it('PaymentCreationFailedError with "missing required fields" → PAYMOB_RESPONSE_INVALID (502)', () => {
    const err = new PaymentCreationFailedError('paymob', 'Paymob response missing required fields', {});
    const result = categorizePaymentError(err);
    expect(result.category).toBe('PAYMOB_RESPONSE_INVALID');
    expect(result.httpStatus).toBe(502);
  });

  it('PaymentCreationFailedError (generic) → PAYMOB_API_REJECTED (502)', () => {
    const err = new PaymentCreationFailedError('paymob', 'Paymob API request failed (HTTP 400)', {});
    const result = categorizePaymentError(err);
    expect(result.category).toBe('PAYMOB_API_REJECTED');
    expect(result.httpStatus).toBe(502);
    expect(result.userMessageAr).toContain('لم يتم خصم');
  });

  it('Non-PaymentError (plain Error) → UNKNOWN (500)', () => {
    const err = new Error('Something weird happened');
    const result = categorizePaymentError(err);
    expect(result.category).toBe('UNKNOWN');
    expect(result.httpStatus).toBe(500);
    // The user-facing message does NOT leak the raw error message
    expect(result.userMessageAr).not.toContain('Something weird happened');
  });

  it('null/undefined error → UNKNOWN', () => {
    expect(categorizePaymentError(null).category).toBe('UNKNOWN');
    expect(categorizePaymentError(undefined).category).toBe('UNKNOWN');
  });

  it('all messages are safe — never contain English error names or stack traces', () => {
    const errors = [
      new GatewayNotFoundError(),
      new GatewayDisabledError('paymob'),
      new GatewayNotImplementedError('fawry'),
      new CredentialsMissingError('paymob'),
      new EncryptionKeyMissingError(),
      new GatewayConfigurationInvalidError('paymob', 'Some internal message'),
      new PaymentCreationFailedError('paymob', 'Paymob API request failed (HTTP 500)', { secret: 'leak' }),
    ];
    for (const e of errors) {
      const r = categorizePaymentError(e);
      // None of the user-facing messages should contain English error names
      expect(r.userMessageAr).not.toContain('GatewayNotFoundError');
      expect(r.userMessageAr).not.toContain('PaymentCreationFailedError');
      expect(r.userMessageAr).not.toContain('HTTP');
      expect(r.userMessageAr).not.toContain('secret');
    }
  });

  it('PaymentError base class with arbitrary code → UNKNOWN', () => {
    const err = new PaymentError(PaymentErrorCode.UnsupportedCapability, 'arbitrary message');
    const result = categorizePaymentError(err);
    expect(result.category).toBe('UNKNOWN');
    expect(result.httpStatus).toBe(500);
  });
});

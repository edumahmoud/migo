// =====================================================
// Payment Gateway Core — Errors Tests
// =====================================================
// Tests: All error classes are PaymentError subclasses,
// toJSON() strips `cause`, error codes are unique.

import { describe, test, expect } from 'bun:test';
import {
  PaymentError,
  PaymentErrorCode,
  GatewayNotFoundError,
  GatewayDisabledError,
  GatewayNotImplementedError,
  GatewayConfigurationInvalidError,
  PaymentCreationFailedError,
  PaymentVerificationFailedError,
  WebhookVerificationFailedError,
  UnsupportedCapabilityError,
  CredentialsMissingError,
  EncryptionKeyMissingError,
  isPaymentError,
} from '../errors';

describe('Payment Errors', () => {
  test('all errors extend PaymentError', () => {
    const errors = [
      new GatewayNotFoundError('paymob'),
      new GatewayDisabledError('paymob'),
      new GatewayNotImplementedError('fawry'),
      new GatewayConfigurationInvalidError('paymob', 'missing key'),
      new PaymentCreationFailedError('paymob', 'timeout'),
      new PaymentVerificationFailedError('paymob', 'not found'),
      new WebhookVerificationFailedError('paymob', 'bad signature'),
      new UnsupportedCapabilityError('fawry', 'refund'),
      new CredentialsMissingError('paymob'),
      new EncryptionKeyMissingError(),
    ];

    for (const err of errors) {
      expect(err).toBeInstanceOf(PaymentError);
      expect(err.code).toBeTruthy();
      expect(err.message).toBeTruthy();
    }
  });

  test('error codes are unique', () => {
    const codes = Object.values(PaymentErrorCode);
    const unique = new Set(codes);
    expect(unique.size).toBe(codes.length);
  });

  test('toJSON() strips the `cause` field', () => {
    const err = new PaymentCreationFailedError(
      'paymob',
      'API timeout',
      { response: { status: 500, body: 'Internal server error' } },
    );

    const json = err.toJSON();
    expect(json.code).toBe(PaymentErrorCode.PaymentCreationFailed);
    expect(json.message).toContain('timeout');
    expect(json.provider).toBe('paymob');
    // cause must NOT appear in JSON
    expect(json.cause).toBeUndefined();
    expect(JSON.stringify(json)).not.toContain('Internal server error');
  });

  test('isPaymentError returns true for PaymentError instances', () => {
    expect(isPaymentError(new GatewayNotFoundError())).toBe(true);
    expect(isPaymentError(new Error('not a payment error'))).toBe(false);
    expect(isPaymentError(null)).toBe(false);
    expect(isPaymentError(undefined)).toBe(false);
    expect(isPaymentError('string error')).toBe(false);
  });

  test('GatewayNotFoundError includes provider in message', () => {
    const err = new GatewayNotFoundError('paymob');
    expect(err.message).toContain('paymob');
    expect(err.provider).toBe('paymob');
  });

  test('GatewayNotFoundError without provider', () => {
    const err = new GatewayNotFoundError();
    expect(err.message).not.toContain(':');
    expect(err.provider).toBeUndefined();
  });
});

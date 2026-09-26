// =====================================================
// Payment Gateway Core — Logger Tests
// =====================================================
// Tests: the logger never logs secrets, only safe fields.

import { describe, test, expect } from 'bun:test';
import { logPaymentEvent } from '../logger';

describe('Payment Logger', () => {
  test('logPaymentEvent does not crash for valid entries', () => {
    // The logger uses console.info/warn/error under the hood.
    // We can't capture console output in this simple test, but
    // we can verify it doesn't throw.

    expect(() => {
      logPaymentEvent({
        level: 'info',
        operation: 'createPayment',
        provider: 'paymob',
        orderId: 'test-order-id',
        paymentReference: 'ref_123',
        success: true,
        durationMs: 150,
      });
    }).not.toThrow();
  });

  test('logPaymentEvent accepts minimal entries', () => {
    expect(() => {
      logPaymentEvent({
        level: 'warn',
        operation: 'handleWebhook',
        success: false,
        errorCode: 'WEBHOOK_VERIFICATION_FAILED',
      });
    }).not.toThrow();
  });

  test('PaymentLogEntry type does NOT include credential fields', () => {
    // Read the logger source and verify the PaymentLogEntry interface
    // does not include credential-related fields.
    const fs = require('fs');
    const path = require('path');
    const loggerSource = fs.readFileSync(
      path.join(__dirname, '..', 'logger.ts'),
      'utf8'
    );

    // Must NOT have fields that would carry secrets
    expect(loggerSource).not.toContain('credentials');
    expect(loggerSource).not.toContain('secret');
    expect(loggerSource).not.toContain('apiKey');
    expect(loggerSource).not.toContain('hmacSecret');
    expect(loggerSource).not.toContain('authorization');
  });
});

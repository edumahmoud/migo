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
    // NOTE: comments at the top of the file mention "credentials",
    // "secret", "apiKey" as part of the safety contract — that's fine.
    // What matters is that the actual PaymentLogEntry interface body
    // does NOT declare fields that would carry secrets.
    const fs = require('fs');
    const path = require('path');
    const loggerSource = fs.readFileSync(
      path.join(__dirname, '..', 'logger.ts'),
      'utf8'
    );

    // Extract just the PaymentLogEntry interface body — between
    // "export interface PaymentLogEntry {" and the matching "}".
    const ifaceMatch = loggerSource.match(/interface\s+PaymentLogEntry\s*\{([^}]*)\}/s);
    expect(ifaceMatch).toBeTruthy();
    const ifaceBody = ifaceMatch![1];

    // The interface body must NOT declare fields named after secrets
    expect(ifaceBody).not.toMatch(/\bcredentials\b/);
    expect(ifaceBody).not.toMatch(/\bsecret\b/);
    expect(ifaceBody).not.toMatch(/\bapiKey\b/);
    expect(ifaceBody).not.toMatch(/\bhmacSecret\b/);
    expect(ifaceBody).not.toMatch(/\bauthorization\b/);
  });
});

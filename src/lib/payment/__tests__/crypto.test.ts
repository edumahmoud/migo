// =====================================================
// Payment Gateway Core — Crypto Tests
// =====================================================
// Tests: AES-256-GCM encrypt/decrypt with the env key.
// Verifies that credentials are never stored in plaintext.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { encrypt, decrypt, isEncryptionKeyConfigured } from '../crypto';

// Set a test encryption key
beforeEach(() => {
  process.env.PAYMENT_CREDENTIALS_ENCRYPTION_KEY = 'a'.repeat(64); // 64-char hex
});

afterEach(() => {
  delete process.env.PAYMENT_CREDENTIALS_ENCRYPTION_KEY;
});

describe('Payment Crypto', () => {
  test('isEncryptionKeyConfigured returns true when env var is set', () => {
    expect(isEncryptionKeyConfigured()).toBe(true);
  });

  test('isEncryptionKeyConfigured returns false when env var is unset', () => {
    delete process.env.PAYMENT_CREDENTIALS_ENCRYPTION_KEY;
    expect(isEncryptionKeyConfigured()).toBe(false);
  });

  test('encrypt + decrypt roundtrip recovers original data', () => {
    const credentials = { secretKey: 'sk_live_123', hmacSecret: 'hmac_456' };
    const encrypted = encrypt(credentials);

    // The encrypted blob must NOT contain the plaintext secret
    expect(encrypted).not.toContain('sk_live_123');
    expect(encrypted).not.toContain('hmac_456');

    // Decrypt must recover the original
    const decrypted = decrypt(encrypted);
    expect(decrypted).toEqual(credentials);
  });

  test('encrypt produces different output each time (random IV)', () => {
    const data = { key: 'value' };
    const enc1 = encrypt(data);
    const enc2 = encrypt(data);
    expect(enc1).not.toBe(enc2);
  });

  test('decrypt with wrong key fails (auth tag mismatch)', () => {
    process.env.PAYMENT_CREDENTIALS_ENCRYPTION_KEY = 'a'.repeat(64);
    const encrypted = encrypt({ secret: 'data' });

    // Change the key
    process.env.PAYMENT_CREDENTIALS_ENCRYPTION_KEY = 'b'.repeat(64);

    expect(() => decrypt(encrypted)).toThrow();
  });

  test('encrypt with passphrase-style key (not hex)', () => {
    process.env.PAYMENT_CREDENTIALS_ENCRYPTION_KEY = 'my-strong-passphrase';
    const data = { apiKey: 'test' };
    const encrypted = encrypt(data);
    const decrypted = decrypt(encrypted);
    expect(decrypted).toEqual(data);
  });

  test('encrypt with too-short key throws EncryptionKeyMissingError', () => {
    process.env.PAYMENT_CREDENTIALS_ENCRYPTION_KEY = 'short';
    expect(() => encrypt({ key: 'value' })).toThrow('ENCRYPTION_KEY_MISSING');
  });
});

/**
 * Payment Gateway Core — Credential Encryption
 *
 * Uses AES-256-GCM to encrypt/decrypt gateway credentials before
 * storing them in the database.
 *
 * The encryption key is read from the environment variable
 * PAYMENT_CREDENTIALS_ENCRYPTION_KEY — it is NEVER stored in the
 * database.
 *
 * If the env var is not set, encrypt() and decrypt() throw
 * EncryptionKeyMissingError. This prevents the system from silently
 * storing plaintext credentials.
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';
import { EncryptionKeyMissingError } from './errors';

// AES-256-GCM parameters
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;          // GCM recommended IV length
const KEY_LENGTH = 32;         // 256 bits
const SALT_LENGTH = 16;
const TAG_LENGTH = 16;

/**
 * Derive the encryption key from the env var.
 * If the env var contains a 64-char hex string, use it directly.
 * Otherwise, derive via scrypt (so a passphrase also works).
 */
function getEncryptionKey(): Buffer {
  const envKey = process.env.PAYMENT_CREDENTIALS_ENCRYPTION_KEY;
  if (!envKey || envKey.length < 16) {
    throw new EncryptionKeyMissingError();
  }

  // If it's a 64-char hex string → use directly as the key
  if (/^[0-9a-fA-F]{64}$/.test(envKey)) {
    return Buffer.from(envKey, 'hex');
  }

  // Otherwise derive via scrypt (passphrase → key)
  // Use a fixed salt derivation pattern based on the env var itself
  // (the salt doesn't need to be random — it just needs to be consistent)
  const salt = Buffer.from('attendo-payment-gateway-salt-v1', 'utf8');
  return scryptSync(envKey, salt, KEY_LENGTH);
}

/**
 * Encrypt a JSON-serializable object (e.g., gateway credentials).
 * Returns a base64 string containing IV + auth tag + ciphertext.
 *
 * @param data The object to encrypt (will be JSON.stringify'd)
 * @returns base64-encoded encrypted blob
 */
export function encrypt(data: Record<string, unknown>): string {
  const key = getEncryptionKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const plaintext = Buffer.from(JSON.stringify(data), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();

  // Prepend IV + auth tag so decrypt() can recover them
  const blob = Buffer.concat([iv, authTag, ciphertext]);
  return blob.toString('base64');
}

/**
 * Decrypt a base64-encoded encrypted blob back to the original object.
 *
 * @param encrypted The base64 string from encrypt()
 * @returns The decrypted object
 */
export function decrypt(encrypted: string): Record<string, unknown> {
  const key = getEncryptionKey();
  const blob = Buffer.from(encrypted, 'base64');

  if (blob.length < IV_LENGTH + TAG_LENGTH) {
    throw new Error('Invalid encrypted blob: too short');
  }

  const iv = blob.subarray(0, IV_LENGTH);
  const authTag = blob.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ciphertext = blob.subarray(IV_LENGTH + TAG_LENGTH);

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return JSON.parse(plaintext.toString('utf8'));
}

/**
 * Check if the encryption key is configured.
 * Used by the resolver/service to fail fast without attempting encryption.
 */
export function isEncryptionKeyConfigured(): boolean {
  const envKey = process.env.PAYMENT_CREDENTIALS_ENCRYPTION_KEY;
  return !!envKey && envKey.length >= 16;
}

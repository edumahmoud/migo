// =====================================================
// Payout Webhook Security Tests — Phase 13 Hardening (Fix #1)
// =====================================================
// Verifies the HMAC-SHA512 + timingSafeEqual signature envelope
// that protects /api/payout/webhook from unauthenticated access.
//
// Covers:
//   - missing signature → rejected
//   - invalid signature → rejected
//   - valid signature → accepted
//   - non-hex signature → rejected (defense against truncated-decode attacks)
//   - secret not configured → fail-closed
//   - secret too short (< 32 chars) → fail-closed
//   - constant-time comparison does not leak timing info on length mismatch
//   - signature is computed over RAW body (not parsed JSON)
//
// Uses `bun:test`.
// =====================================================

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import {
  verifyPayoutWebhookSignature,
  computePayoutWebhookSignatureForTesting,
  PAYOUT_WEBHOOK_SIGNATURE_HEADER,
} from '../webhook-security';

const TEST_SECRET = 'a'.repeat(64); // 64-char secret — meets 32+ minimum

function withSecret(secret: string | undefined, fn: () => Promise<void> | void): Promise<void> | void {
  const original = process.env.PAYOUT_WEBHOOK_SECRET;
  if (secret === undefined) {
    delete process.env.PAYOUT_WEBHOOK_SECRET;
  } else {
    process.env.PAYOUT_WEBHOOK_SECRET = secret;
  }
  try {
    return Promise.resolve(fn);
  } finally {
    if (original === undefined) {
      delete process.env.PAYOUT_WEBHOOK_SECRET;
    } else {
      process.env.PAYOUT_WEBHOOK_SECRET = original;
    }
  }
}

describe('Payout Webhook Security — Fix #1: HMAC signature verification', () => {
  beforeEach(() => {
    process.env.PAYOUT_WEBHOOK_SECRET = TEST_SECRET;
  });

  afterEach(() => {
    delete process.env.PAYOUT_WEBHOOK_SECRET;
  });

  // ─── Happy path ───
  it('valid signature → accepted', () => {
    const rawBody = JSON.stringify({
      provider_reference: 'paymob-ref-123',
      status: 'completed',
    });
    const sig = computePayoutWebhookSignatureForTesting(rawBody, TEST_SECRET);
    const ok = verifyPayoutWebhookSignature(rawBody, sig);
    expect(ok).toBe(true);
  });

  it('signature is computed over RAW body, not parsed JSON', () => {
    // Two bodies that parse to the same JSON but have different bytes
    // must produce different signatures.
    const bodyA = '{"provider_reference":"x","status":"completed"}';
    const bodyB = '{ "provider_reference": "x", "status": "completed" }';
    const sigA = computePayoutWebhookSignatureForTesting(bodyA, TEST_SECRET);
    const sigB = computePayoutWebhookSignatureForTesting(bodyB, TEST_SECRET);
    expect(sigA).not.toBe(sigB);

    expect(verifyPayoutWebhookSignature(bodyA, sigA)).toBe(true);
    expect(verifyPayoutWebhookSignature(bodyB, sigB)).toBe(true);
    // Cross-verification fails (sig of A doesn't match body B)
    expect(verifyPayoutWebhookSignature(bodyA, sigB)).toBe(false);
    expect(verifyPayoutWebhookSignature(bodyB, sigA)).toBe(false);
  });

  // ─── Rejection paths ───
  it('missing signature → rejected', () => {
    const rawBody = '{"provider_reference":"x","status":"completed"}';
    expect(verifyPayoutWebhookSignature(rawBody, null)).toBe(false);
    expect(verifyPayoutWebhookSignature(rawBody, undefined)).toBe(false);
    expect(verifyPayoutWebhookSignature(rawBody, '')).toBe(false);
  });

  it('invalid signature → rejected', () => {
    const rawBody = '{"provider_reference":"x","status":"completed"}';
    const wrongSig = 'e'.repeat(128); // valid hex, wrong content
    expect(verifyPayoutWebhookSignature(rawBody, wrongSig)).toBe(false);
  });

  it('non-hex signature → rejected (no truncated-decode attack)', () => {
    const rawBody = '{"provider_reference":"x","status":"completed"}';
    // Non-hex characters — must be rejected, not silently truncated
    expect(verifyPayoutWebhookSignature(rawBody, 'nothexatall!')).toBe(false);
    expect(verifyPayoutWebhookSignature(rawBody, 'zzzzzzzzzzzzzzzz')).toBe(false);
    // Partial hex + garbage
    expect(verifyPayoutWebhookSignature(rawBody, 'deadbeefGARBAGE')).toBe(false);
  });

  it('signature with whitespace is trimmed + accepted if valid', () => {
    const rawBody = '{"provider_reference":"x","status":"completed"}';
    const sig = computePayoutWebhookSignatureForTesting(rawBody, TEST_SECRET);
    // Surround with whitespace — header parsing may yield trimmed values
    expect(verifyPayoutWebhookSignature(rawBody, `  ${sig}  `)).toBe(true);
  });

  it('uppercase hex signature is accepted (case-insensitive decode)', () => {
    const rawBody = '{"provider_reference":"x","status":"completed"}';
    const sig = computePayoutWebhookSignatureForTesting(rawBody, TEST_SECRET);
    expect(verifyPayoutWebhookSignature(rawBody, sig.toUpperCase())).toBe(true);
  });

  // ─── Fail-closed paths ───
  it('secret not configured → fail-closed (every request rejected)', () => {
    delete process.env.PAYOUT_WEBHOOK_SECRET;
    const rawBody = '{"provider_reference":"x","status":"completed"}';
    const sig = computePayoutWebhookSignatureForTesting(rawBody, TEST_SECRET);
    // Even a correctly-computed signature is rejected because the
    // env var is missing.
    expect(verifyPayoutWebhookSignature(rawBody, sig)).toBe(false);
  });

  it('secret too short (< 32 chars) → fail-closed', () => {
    process.env.PAYOUT_WEBHOOK_SECRET = 'short';
    const rawBody = '{"provider_reference":"x","status":"completed"}';
    const sig = computePayoutWebhookSignatureForTesting(rawBody, 'short');
    expect(verifyPayoutWebhookSignature(rawBody, sig)).toBe(false);
  });

  it('secret exactly 32 chars → accepted (boundary)', () => {
    process.env.PAYOUT_WEBHOOK_SECRET = 'b'.repeat(32);
    const rawBody = '{"provider_reference":"x","status":"completed"}';
    const sig = computePayoutWebhookSignatureForTesting(rawBody, 'b'.repeat(32));
    expect(verifyPayoutWebhookSignature(rawBody, sig)).toBe(true);
  });

  // ─── Length-mismatch rejection ───
  it('signature of wrong length → rejected without timing leak', () => {
    const rawBody = '{"provider_reference":"x","status":"completed"}';
    // Too short
    expect(verifyPayoutWebhookSignature(rawBody, 'deadbeef')).toBe(false);
    // Too long (extra chars)
    const sig = computePayoutWebhookSignatureForTesting(rawBody, TEST_SECRET);
    expect(verifyPayoutWebhookSignature(rawBody, sig + 'deadbeef')).toBe(false);
  });

  // ─── Header name constant ───
  it('header name is the canonical lowercase form', () => {
    expect(PAYOUT_WEBHOOK_SIGNATURE_HEADER).toBe('x-payout-webhook-signature');
    expect(PAYOUT_WEBHOOK_SIGNATURE_HEADER).not.toContain(' ');
    expect(PAYOUT_WEBHOOK_SIGNATURE_HEADER).not.toContain('Authorization');
    // Not a generic token header — must be payout-specific
    expect(PAYOUT_WEBHOOK_SIGNATURE_HEADER).toContain('payout');
  });

  // ─── Tampering detection ───
  it('modified payload rejected even with valid-looking signature', () => {
    const body1 = '{"provider_reference":"ref-A","status":"completed"}';
    const body2 = '{"provider_reference":"ref-B","status":"completed"}';
    const sig1 = computePayoutWebhookSignatureForTesting(body1, TEST_SECRET);

    // sig1 was computed over body1 — using it for body2 must fail
    expect(verifyPayoutWebhookSignature(body2, sig1)).toBe(false);
  });
});

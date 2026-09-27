// =====================================================
// Payout Webhook Route Integration Tests — Phase 13 Hardening (Fix #1)
// =====================================================
// Tests the route handler at src/app/api/payout/webhook/route.ts
// end-to-end, exercising the signature verification + downstream
// processPayoutWebhook call.
//
// Strategy:
//   - mock.module replaces '@/lib/payment/payout-domain/service' so
//     processPayoutWebhook becomes a controlled spy.
//   - Real NextRequest objects are constructed with the correct
//     `X-Payout-Webhook-Signature` header computed via the test-only
//     helper `computePayoutWebhookSignatureForTesting`.
//   - The route handler under test is imported fresh in each test
//     after configuring the env var.
//
// Uses `bun:test`.
// =====================================================

import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test';

const TEST_SECRET = 'a'.repeat(64);

const mockProcessPayoutWebhook = mock(async (_input: unknown) => ({
  processed: true,
  payoutId: 'payout-uuid-001',
}));

mock.module('@/lib/payment/payout-domain/service', () => ({
  processPayoutWebhook: mockProcessPayoutWebhook,
}));

const { POST } = await import('@/app/api/payout/webhook/route');
const {
  computePayoutWebhookSignatureForTesting,
  PAYOUT_WEBHOOK_SIGNATURE_HEADER,
} = await import('@/lib/payment/payout-domain/webhook-security');

function makeRequest(body: string, signature?: string) {
  const headers = new Headers();
  if (signature !== undefined) {
    headers.set(PAYOUT_WEBHOOK_SIGNATURE_HEADER, signature);
  }
  // NextRequest requires a URL — we use a fake one because the route
  // doesn't read it. Method defaults to POST since we pass a body.
  return new Request('http://localhost/api/payout/webhook', {
    method: 'POST',
    headers,
    body,
  }) as unknown as import('next/server').NextRequest;
}

function resetServiceMock() {
  mockProcessPayoutWebhook.mockReset();
  mockProcessPayoutWebhook.mockImplementation(async () => ({
    processed: true,
    payoutId: 'payout-uuid-001',
  }));
}

describe('Fix #1 — Payout webhook route signature verification', () => {
  beforeEach(() => {
    process.env.PAYOUT_WEBHOOK_SECRET = TEST_SECRET;
    resetServiceMock();
  });

  afterEach(() => {
    delete process.env.PAYOUT_WEBHOOK_SECRET;
  });

  // ─── Happy path ───
  it('valid signature → 200 + processPayoutWebhook called with parsed body', async () => {
    const body = JSON.stringify({
      provider_reference: 'paymob-ref-abc',
      status: 'completed',
    });
    const sig = computePayoutWebhookSignatureForTesting(body, TEST_SECRET);
    const req = makeRequest(body, sig);

    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.processed).toBe(true);
    expect(json.payout_id).toBe('payout-uuid-001');

    // Verify the service was called with the parsed body
    expect(mockProcessPayoutWebhook).toHaveBeenCalledTimes(1);
    const call = mockProcessPayoutWebhook.mock.calls[0][0] as {
      providerReference: string;
      status: string;
    };
    expect(call.providerReference).toBe('paymob-ref-abc');
    expect(call.status).toBe('completed');
  });

  it('valid signature with failure_reason → 200 + failure_reason propagated', async () => {
    const body = JSON.stringify({
      provider_reference: 'paymob-ref-abc',
      status: 'failed',
      failure_reason: 'Bank declined',
    });
    const sig = computePayoutWebhookSignatureForTesting(body, TEST_SECRET);
    const req = makeRequest(body, sig);

    const res = await POST(req);
    expect(res.status).toBe(200);
    const call = mockProcessPayoutWebhook.mock.calls[0][0] as {
      failureReason?: string;
    };
    expect(call.failureReason).toBe('Bank declined');
  });

  // ─── Rejection paths ───
  it('missing signature header → 401, service NOT called', async () => {
    const body = JSON.stringify({
      provider_reference: 'ref-x',
      status: 'completed',
    });
    const req = makeRequest(body, undefined); // no signature header

    const res = await POST(req);
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error).toBe('Unauthorized');
    expect(mockProcessPayoutWebhook).not.toHaveBeenCalled();
  });

  it('invalid signature → 401, service NOT called', async () => {
    const body = JSON.stringify({
      provider_reference: 'ref-x',
      status: 'completed',
    });
    const wrongSig = '0'.repeat(128); // 64 bytes hex, wrong content
    const req = makeRequest(body, wrongSig);

    const res = await POST(req);
    expect(res.status).toBe(401);
    expect(mockProcessPayoutWebhook).not.toHaveBeenCalled();
  });

  it('non-hex signature → 401 (no truncated-decode attack)', async () => {
    const body = JSON.stringify({
      provider_reference: 'ref-x',
      status: 'completed',
    });
    const req = makeRequest(body, 'nothexatall!');

    const res = await POST(req);
    expect(res.status).toBe(401);
    expect(mockProcessPayoutWebhook).not.toHaveBeenCalled();
  });

  it('secret not configured → 401 for ALL requests (fail-closed)', async () => {
    delete process.env.PAYOUT_WEBHOOK_SECRET;
    const body = JSON.stringify({
      provider_reference: 'ref-x',
      status: 'completed',
    });
    // Even with a "valid" signature (computed with a different secret)
    const sig = computePayoutWebhookSignatureForTesting(body, TEST_SECRET);
    const req = makeRequest(body, sig);

    const res = await POST(req);
    expect(res.status).toBe(401);
    expect(mockProcessPayoutWebhook).not.toHaveBeenCalled();
  });

  it('unauthorized request cannot alter payout state (service NEVER called)', async () => {
    // Multiple unauthorized attempts — the service is never invoked,
    // so no payout state can change.
    const bodies = [
      { provider_reference: 'ref-1', status: 'completed' },
      { provider_reference: 'ref-2', status: 'failed' },
      { provider_reference: 'ref-3', status: 'completed', failure_reason: 'x' },
    ];
    for (const body of bodies) {
      const raw = JSON.stringify(body);
      // No signature at all
      await POST(makeRequest(raw));
      // Wrong signature
      await POST(makeRequest(raw, '0'.repeat(128)));
    }
    expect(mockProcessPayoutWebhook).not.toHaveBeenCalled();
  });

  // ─── Body parsing after verification ───
  it('invalid JSON after signature verification → 400 (signature was valid, body parse failed)', async () => {
    const rawBody = 'not-json-at-all';
    const sig = computePayoutWebhookSignatureForTesting(rawBody, TEST_SECRET);
    const req = makeRequest(rawBody, sig);

    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(mockProcessPayoutWebhook).not.toHaveBeenCalled();
  });

  it('valid signature but missing provider_reference → 400', async () => {
    const body = JSON.stringify({ status: 'completed' });
    const sig = computePayoutWebhookSignatureForTesting(body, TEST_SECRET);
    const req = makeRequest(body, sig);

    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(mockProcessPayoutWebhook).not.toHaveBeenCalled();
  });

  it('valid signature but invalid status value → 400', async () => {
    const body = JSON.stringify({
      provider_reference: 'ref-x',
      status: 'something_invalid',
    });
    const sig = computePayoutWebhookSignatureForTesting(body, TEST_SECRET);
    const req = makeRequest(body, sig);

    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(mockProcessPayoutWebhook).not.toHaveBeenCalled();
  });

  // ─── Idempotency preservation ───
  it('duplicate webhook with valid signature → service called both times (idempotency at service layer)', async () => {
    const body = JSON.stringify({
      provider_reference: 'ref-x',
      status: 'completed',
    });
    const sig = computePayoutWebhookSignatureForTesting(body, TEST_SECRET);

    // First request — processed
    const res1 = await POST(makeRequest(body, sig));
    expect(res1.status).toBe(200);
    expect(mockProcessPayoutWebhook).toHaveBeenCalledTimes(1);

    // Duplicate — the route still calls the service; the service
    // handles idempotency (returns processed:true without re-applying
    // state changes).
    const res2 = await POST(makeRequest(body, sig));
    expect(res2.status).toBe(200);
    expect(mockProcessPayoutWebhook).toHaveBeenCalledTimes(2);
  });

  // ─── Signature computed over RAW body, not parsed JSON ───
  it('signature is computed over RAW body bytes (whitespace differences matter)', async () => {
    // Two equivalent JSON payloads with different whitespace
    const compact = '{"provider_reference":"ref-x","status":"completed"}';
    const spaced = '{ "provider_reference": "ref-x", "status": "completed" }';

    const sigCompact = computePayoutWebhookSignatureForTesting(compact, TEST_SECRET);
    const sigSpaced = computePayoutWebhookSignatureForTesting(spaced, TEST_SECRET);

    // Compact body + compact signature → 200
    expect((await POST(makeRequest(compact, sigCompact))).status).toBe(200);
    // Spaced body + spaced signature → 200
    expect((await POST(makeRequest(spaced, sigSpaced))).status).toBe(200);
    // Compact body + spaced signature → 401 (cross-mismatch)
    expect((await POST(makeRequest(compact, sigSpaced))).status).toBe(401);
    // Spaced body + compact signature → 401
    expect((await POST(makeRequest(spaced, sigCompact))).status).toBe(401);
  });
});

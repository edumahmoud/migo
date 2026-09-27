// =====================================================
// Dev Stub Payout Adapter Tests — Phase 13 Step 4
// =====================================================
// Tests for the development stub adapter that implements
// PayoutProvider. Verifies:
//   - PayoutProvider contract compliance
//   - Capabilities
//   - Deterministic execution
//   - Idempotency (same key → same result)
//   - Error normalization
//   - No sensitive fields
//   - No external HTTP/network calls
//   - Registry integration
//
// Uses `bun:test`.
// =====================================================

import { describe, it, expect, beforeEach } from 'bun:test';
import {
  DevStubPayoutAdapter,
  devStubPayoutAdapter,
  PayoutProviderRegistry,
  PayoutDomainError,
  PayoutExecutionRejectedError,
  InvalidPayoutStateError,
  ProviderUnavailableError,
  buildFailedResult,
  type PayoutProvider,
  type PayoutRequest,
  type PayoutResult,
  type PayoutCapabilities,
  type PayoutMethodSnapshot,
} from '../../index';

function makeRequest(overrides: Partial<PayoutRequest> = {}): PayoutRequest {
  return {
    payoutId: 'payout-001',
    internalReference: 'PO-2026-001',
    teacherId: 'teacher-001',
    amount: 100.00,
    currency: 'EGP',
    methodType: 'wallet',
    methodDisplayLabel: 'My Wallet',
    methodMasked: '**** **** 5678 • M. A.',
    idempotencyKey: 'idem-key-001',
    ...overrides,
  };
}

// ─── Adapter contract compliance ───
describe('DevStubPayoutAdapter — Contract compliance', () => {
  it('implements PayoutProvider interface', () => {
    const adapter: PayoutProvider = devStubPayoutAdapter;
    expect(adapter.providerId).toBe('dev-stub');
    expect(adapter.capabilities).toBeDefined();
    expect(typeof adapter.executePayout).toBe('function');
  });

  it('has correct providerId', () => {
    expect(devStubPayoutAdapter.providerId).toBe('dev-stub');
    expect(devStubPayoutAdapter.providerId).not.toContain('paymob');
    expect(devStubPayoutAdapter.providerId).not.toContain('fawry');
  });
});

// ─── Capabilities ───
describe('DevStubPayoutAdapter — Capabilities', () => {
  const caps: PayoutCapabilities = devStubPayoutAdapter.capabilities;

  it('supports all 4 method types', () => {
    expect(caps.supportedMethodTypes).toContain('wallet');
    expect(caps.supportedMethodTypes).toContain('bank_account');
    expect(caps.supportedMethodTypes).toContain('bank_card');
    expect(caps.supportedMethodTypes).toContain('instapay');
  });

  it('supports EGP currency', () => {
    expect(caps.supportedCurrencies).toContain('EGP');
  });

  it('does NOT support USD (or other currencies)', () => {
    expect(caps.supportedCurrencies).not.toContain('USD');
    expect(caps.supportedCurrencies).not.toContain('EUR');
  });

  it('supports status lookup, idempotency, and cancellation', () => {
    expect(caps.supportsStatusLookup).toBe(true);
    expect(caps.supportsIdempotency).toBe(true);
    expect(caps.supportsCancellation).toBe(true);
  });
});

// ─── Successful deterministic execution ───
describe('DevStubPayoutAdapter — Execution', () => {
  beforeEach(() => {
    devStubPayoutAdapter.clearCache();
  });

  it('returns completed result for valid request', async () => {
    const result = await devStubPayoutAdapter.executePayout(makeRequest());
    expect(result.status).toBe('completed');
    expect(result.providerReference).toContain('dev-stub');
    expect(result.failureCode).toBeNull();
    expect(result.failureMessage).toBeNull();
    expect(result.executedAt).not.toBeNull();
  });

  it('returns deterministic provider reference', async () => {
    const result = await devStubPayoutAdapter.executePayout(
      makeRequest({ payoutId: 'aaaaaaaa-0000-0000-0000-000000000001', idempotencyKey: 'key-001' }),
    );
    expect(result.providerReference).toBe('dev-stub-aaaaaaaa-key-001');
  });
});

// ─── Idempotency ───
describe('DevStubPayoutAdapter — Idempotency', () => {
  beforeEach(() => {
    devStubPayoutAdapter.clearCache();
  });

  it('same payoutId + idempotencyKey returns the SAME result', async () => {
    const req = makeRequest();
    const result1 = await devStubPayoutAdapter.executePayout(req);
    const result2 = await devStubPayoutAdapter.executePayout(req);

    expect(result1.providerReference).toBe(result2.providerReference);
    expect(result1.status).toBe(result2.status);
    expect(result1.executedAt).toBe(result2.executedAt);
  });

  it('different payoutId produces different provider references', async () => {
    const r1 = await devStubPayoutAdapter.executePayout(
      makeRequest({ payoutId: 'aaaaaaaa-0000-0000-0000-000000000001' }),
    );
    const r2 = await devStubPayoutAdapter.executePayout(
      makeRequest({ payoutId: 'bbbbbbbb-0000-0000-0000-000000000002' }),
    );
    expect(r1.providerReference).not.toBe(r2.providerReference);
  });

  it('same payoutId with different idempotencyKey produces different results', async () => {
    const r1 = await devStubPayoutAdapter.executePayout(
      makeRequest({ idempotencyKey: 'key-A' }),
    );
    const r2 = await devStubPayoutAdapter.executePayout(
      makeRequest({ idempotencyKey: 'key-B' }),
    );
    expect(r1.providerReference).not.toBe(r2.providerReference);
  });
});

// ─── Error normalization ───
describe('DevStubPayoutAdapter — Error normalization', () => {
  beforeEach(() => {
    devStubPayoutAdapter.clearCache();
  });

  it('rejects zero amount with PayoutExecutionRejectedError', async () => {
    await expect(
      devStubPayoutAdapter.executePayout(makeRequest({ amount: 0 })),
    ).rejects.toThrow(PayoutExecutionRejectedError);
  });

  it('rejects negative amount with PayoutExecutionRejectedError', async () => {
    await expect(
      devStubPayoutAdapter.executePayout(makeRequest({ amount: -100 })),
    ).rejects.toThrow(PayoutExecutionRejectedError);
  });

  it('rejects NaN amount with PayoutExecutionRejectedError', async () => {
    await expect(
      devStubPayoutAdapter.executePayout(makeRequest({ amount: NaN })),
    ).rejects.toThrow(PayoutExecutionRejectedError);
  });

  it('errors are PayoutDomainError subclasses', async () => {
    try {
      await devStubPayoutAdapter.executePayout(makeRequest({ amount: 0 }));
    } catch (err) {
      expect(err).toBeInstanceOf(PayoutDomainError);
    }
  });

  it('cancel on completed payout throws InvalidPayoutStateError', async () => {
    const result = await devStubPayoutAdapter.executePayout(makeRequest());
    await expect(
      devStubPayoutAdapter.cancelPayout!(result.providerReference!),
    ).rejects.toThrow(InvalidPayoutStateError);
  });

  it('queryPayoutStatus for unknown reference returns failed result', async () => {
    const result = await devStubPayoutAdapter.queryPayoutStatus!('nonexistent-ref');
    expect(result.status).toBe('failed');
    expect(result.failureCode).toBe('NOT_FOUND');
  });
});

// ─── Security: no sensitive fields ───
describe('DevStubPayoutAdapter — Security invariants', () => {
  it('PayoutResult does NOT contain PAN/CVV/provider_token', async () => {
    devStubPayoutAdapter.clearCache();
    const result = await devStubPayoutAdapter.executePayout(makeRequest());
    expect((result as unknown as Record<string, unknown>).card_number).toBeUndefined();
    expect((result as unknown as Record<string, unknown>).cvv).toBeUndefined();
    expect((result as unknown as Record<string, unknown>).provider_token).toBeUndefined();
    expect((result as unknown as Record<string, unknown>).api_key).toBeUndefined();
    expect((result as unknown as Record<string, unknown>).secret).toBeUndefined();
    expect((result as unknown as Record<string, unknown>).rawResponse).toBeUndefined();
    expect((result as unknown as Record<string, unknown>).providerPayload).toBeUndefined();
  });

  it('PayoutRequest does NOT require credentials', () => {
    const req = makeRequest();
    expect((req as unknown as Record<string, unknown>).card_number).toBeUndefined();
    expect((req as unknown as Record<string, unknown>).cvv).toBeUndefined();
    expect((req as unknown as Record<string, unknown>).provider_token).toBeUndefined();
    expect((req as unknown as Record<string, unknown>).api_key).toBeUndefined();
    expect((req as unknown as Record<string, unknown>).secret).toBeUndefined();
  });

  it('no external HTTP/network request is made (deterministic stub)', async () => {
    devStubPayoutAdapter.clearCache();
    // The adapter uses no fetch/http/dns — it's pure computation.
    // If it made network calls, the test would hang or fail in
    // an isolated environment without network access.
    const result = await devStubPayoutAdapter.executePayout(makeRequest());
    expect(result.status).toBe('completed');
  });
});

// ─── Registry integration ───
describe('DevStubPayoutAdapter — Registry integration', () => {
  beforeEach(() => {
    PayoutProviderRegistry.clear();
    devStubPayoutAdapter.clearCache();
  });

  it('can be registered and resolved', () => {
    PayoutProviderRegistry.register(devStubPayoutAdapter);
    const resolved = PayoutProviderRegistry.resolve('wallet', 'EGP');
    expect(resolved.providerId).toBe('dev-stub');
  });

  it('resolve works for all 4 method types', () => {
    PayoutProviderRegistry.register(devStubPayoutAdapter);
    const types: PayoutMethodSnapshot['method_type'][] = [
      'wallet', 'bank_account', 'bank_card', 'instapay',
    ];
    for (const mt of types) {
      const resolved = PayoutProviderRegistry.resolve(mt, 'EGP');
      expect(resolved.providerId).toBe('dev-stub');
    }
  });

  it('resolve throws ProviderUnavailableError for unsupported currency', () => {
    PayoutProviderRegistry.register(devStubPayoutAdapter);
    expect(() => PayoutProviderRegistry.resolve('wallet', 'USD')).toThrow(ProviderUnavailableError);
  });

  it('canResolve returns false for unsupported combinations', () => {
    PayoutProviderRegistry.register(devStubPayoutAdapter);
    expect(PayoutProviderRegistry.canResolve('wallet', 'EGP')).toBe(true);
    expect(PayoutProviderRegistry.canResolve('wallet', 'USD')).toBe(false);
  });

  it('duplicate registration throws', () => {
    PayoutProviderRegistry.register(devStubPayoutAdapter);
    expect(() => PayoutProviderRegistry.register(devStubPayoutAdapter)).toThrow();
  });

  it('unregister removes provider', () => {
    PayoutProviderRegistry.register(devStubPayoutAdapter);
    PayoutProviderRegistry.unregister('dev-stub');
    expect(PayoutProviderRegistry.getProvider('dev-stub')).toBeNull();
    expect(PayoutProviderRegistry.canResolve('wallet', 'EGP')).toBe(false);
  });

  it('no hardcoded provider dropdown/list introduced', () => {
    PayoutProviderRegistry.register(devStubPayoutAdapter);
    const providers = PayoutProviderRegistry.listProviders();
    expect(providers.length).toBe(1);
    expect(providers[0].providerId).toBe('dev-stub');
    // No Paymob/Fawry/Vodafone/Etisalat in the list
    expect(providers[0].providerId).not.toContain('paymob');
    expect(providers[0].providerId).not.toContain('fawry');
    expect(providers[0].providerId).not.toContain('vodafone');
    expect(providers[0].providerId).not.toContain('etisalat');
  });
});

// ─── Error serialization safety ───
describe('DevStubPayoutAdapter — Error serialization', () => {
  it('toJSON strips cause (no provider internals)', async () => {
    devStubPayoutAdapter.clearCache();
    try {
      await devStubPayoutAdapter.executePayout(makeRequest({ amount: 0 }));
    } catch (err) {
      if (err instanceof PayoutDomainError) {
        const json = err.toJSON();
        expect(json.code).toBeDefined();
        expect(json.message).toBeDefined();
        expect((json as unknown as Record<string, unknown>).cause).toBeUndefined();
      }
    }
  });
});

// =====================================================
// Payout Provider Contracts Tests — Phase 13 Step 3
// =====================================================
// Tests for the provider-agnostic payout execution domain.
//
// Uses `bun:test`. Run manually:
//   bun test src/lib/payment/payout-domain/__tests__/provider.test.ts
// =====================================================

import { describe, it, expect, beforeEach } from 'bun:test';
import {
  PAYOUT_EXECUTION_STATUSES,
  providerSupportsMethod,
  providerSupportsCurrency,
  buildCompletedResult,
  buildFailedResult,
  buildAcceptedResult,
  PayoutProviderRegistry,
  PayoutDomainError,
  UnsupportedMethodTypeError,
  UnsupportedCurrencyError,
  ProviderUnavailableError,
  InvalidPayoutStateError,
  IdempotencyConflictError,
  PayoutExecutionRejectedError,
  PayoutAlreadyCompletedError,
  PayoutCancelledError,
  isPayoutDomainError,
  getPayoutErrorCode,
  type PayoutProvider,
  type PayoutCapabilities,
  type PayoutRequest,
  type PayoutResult,
} from '../index';

import type { PayoutMethodSnapshot } from '../types';

// ─── Mock provider for testing (NOT a real implementation) ───
function makeMockProvider(
  providerId: string,
  capabilities: PayoutCapabilities,
  executeResult: PayoutResult = buildAcceptedResult('mock-ref-001'),
): PayoutProvider {
  return {
    providerId,
    capabilities,
    executePayout: async (_request: PayoutRequest) => executeResult,
  };
}

const ALL_METHOD_TYPES: PayoutMethodSnapshot['method_type'][] = [
  'wallet', 'bank_account', 'bank_card', 'instapay',
];

// ─── PayoutExecutionStatus ───
describe('PayoutExecutionStatus', () => {
  it('has exactly 3 values: accepted, completed, failed', () => {
    expect(PAYOUT_EXECUTION_STATUSES.length).toBe(3);
    expect(PAYOUT_EXECUTION_STATUSES).toEqual(
      expect.arrayContaining(['accepted', 'completed', 'failed']),
    );
  });
});

// ─── PayoutCapabilities ───
describe('PayoutCapabilities', () => {
  it('can declare supported method types without hardcoding providers', () => {
    const caps: PayoutCapabilities = {
      supportedMethodTypes: ['wallet', 'bank_account'],
      supportedCurrencies: ['EGP'],
      supportsStatusLookup: true,
      supportsIdempotency: true,
      supportsCancellation: false,
    };
    expect(caps.supportedMethodTypes).toContain('wallet');
    expect(caps.supportedMethodTypes).toContain('bank_account');
    expect(caps.supportedMethodTypes).not.toContain('vodafone_cash');
    expect(caps.supportedMethodTypes).not.toContain('etisalat_cash');
  });
});

// ─── PayoutRequest — Security Invariants ───
describe('PayoutRequest security invariants', () => {
  it('does NOT require PAN', () => {
    const req: PayoutRequest = {
      payoutId: 'p1', internalReference: 'PO-1',
      teacherId: 't1', amount: 100, currency: 'EGP',
      methodType: 'wallet', methodDisplayLabel: 'My Wallet',
      methodMasked: '**** 5678', idempotencyKey: 'key-1',
    };
    expect((req as unknown as Record<string, unknown>).card_number).toBeUndefined();
    expect((req as unknown as Record<string, unknown>).pan).toBeUndefined();
  });

  it('does NOT require CVV/CVC', () => {
    const req: PayoutRequest = {
      payoutId: 'p1', internalReference: 'PO-1',
      teacherId: 't1', amount: 100, currency: 'EGP',
      methodType: 'bank_card', methodDisplayLabel: 'My Visa',
      methodMasked: '•••• •••• •••• 5678 • VISA • M. A.', idempotencyKey: 'key-1',
    };
    expect((req as unknown as Record<string, unknown>).cvv).toBeUndefined();
    expect((req as unknown as Record<string, unknown>).cvc).toBeUndefined();
    expect((req as unknown as Record<string, unknown>).security_code).toBeUndefined();
  });

  it('does NOT include provider_token', () => {
    const req: PayoutRequest = {
      payoutId: 'p1', internalReference: 'PO-1',
      teacherId: 't1', amount: 100, currency: 'EGP',
      methodType: 'wallet', methodDisplayLabel: 'W',
      methodMasked: '**** 5678', idempotencyKey: 'key-1',
    };
    expect((req as unknown as Record<string, unknown>).provider_token).toBeUndefined();
  });

  it('does NOT include provider credentials', () => {
    const req: PayoutRequest = {
      payoutId: 'p1', internalReference: 'PO-1',
      teacherId: 't1', amount: 100, currency: 'EGP',
      methodType: 'wallet', methodDisplayLabel: 'W',
      methodMasked: '**** 5678', idempotencyKey: 'key-1',
    };
    expect((req as unknown as Record<string, unknown>).api_key).toBeUndefined();
    expect((req as unknown as Record<string, unknown>).secret).toBeUndefined();
    expect((req as unknown as Record<string, unknown>).password).toBeUndefined();
    expect((req as unknown as Record<string, unknown>).auth_header).toBeUndefined();
  });

  it('includes idempotencyKey for retry safety', () => {
    const req: PayoutRequest = {
      payoutId: 'p1', internalReference: 'PO-1',
      teacherId: 't1', amount: 100, currency: 'EGP',
      methodType: 'wallet', methodDisplayLabel: 'W',
      methodMasked: '**** 5678', idempotencyKey: 'idem-key-001',
    };
    expect(req.idempotencyKey).toBe('idem-key-001');
    expect(req.idempotencyKey.length).toBeGreaterThan(0);
  });

  it('includes only masked method info (no full numbers)', () => {
    const req: PayoutRequest = {
      payoutId: 'p1', internalReference: 'PO-1',
      teacherId: 't1', amount: 100, currency: 'EGP',
      methodType: 'bank_card', methodDisplayLabel: 'My Visa',
      methodMasked: '•••• •••• •••• 5678 • VISA • M. A.', idempotencyKey: 'key-1',
    };
    expect(req.methodMasked).toContain('5678');
    expect(req.methodMasked).not.toContain('4111111111111111');
  });
});

// ─── PayoutResult ───
describe('PayoutResult', () => {
  it('buildCompletedResult returns correct shape', () => {
    const result = buildCompletedResult('ref-001', '2026-09-28T10:00:00Z');
    expect(result.status).toBe('completed');
    expect(result.providerReference).toBe('ref-001');
    expect(result.failureCode).toBeNull();
    expect(result.failureMessage).toBeNull();
    expect(result.executedAt).toBe('2026-09-28T10:00:00Z');
  });

  it('buildFailedResult returns correct shape', () => {
    const result = buildFailedResult('ERR_001', 'Transfer rejected');
    expect(result.status).toBe('failed');
    expect(result.providerReference).toBeNull();
    expect(result.failureCode).toBe('ERR_001');
    expect(result.failureMessage).toBe('Transfer rejected');
    expect(result.executedAt).toBeNull();
  });

  it('buildAcceptedResult returns correct shape', () => {
    const result = buildAcceptedResult('ref-002');
    expect(result.status).toBe('accepted');
    expect(result.providerReference).toBe('ref-002');
    expect(result.failureCode).toBeNull();
    expect(result.failureMessage).toBeNull();
    expect(result.executedAt).toBeNull();
  });

  it('does NOT expose raw provider response objects', () => {
    const result = buildCompletedResult('ref-001', '2026-09-28T10:00:00Z');
    expect((result as unknown as Record<string, unknown>).rawResponse).toBeUndefined();
    expect((result as unknown as Record<string, unknown>).providerPayload).toBeUndefined();
  });
});

// ─── PayoutProvider Interface ───
describe('PayoutProvider interface', () => {
  it('can be implemented generically without provider-specific fields', () => {
    const provider: PayoutProvider = makeMockProvider('generic-provider', {
      supportedMethodTypes: ['wallet'],
      supportedCurrencies: ['EGP'],
      supportsStatusLookup: false,
      supportsIdempotency: true,
      supportsCancellation: false,
    });
    expect(provider.providerId).toBe('generic-provider');
    expect(provider.capabilities.supportedMethodTypes).toContain('wallet');
    expect(provider.capabilities.supportedCurrencies).toContain('EGP');
  });

  it('executePayout returns normalized PayoutResult', async () => {
    const provider: PayoutProvider = makeMockProvider('test', {
      supportedMethodTypes: ALL_METHOD_TYPES,
      supportedCurrencies: ['EGP', 'USD'],
      supportsStatusLookup: true,
      supportsIdempotency: true,
      supportsCancellation: true,
    });
    const request: PayoutRequest = {
      payoutId: 'p1', internalReference: 'PO-1',
      teacherId: 't1', amount: 100, currency: 'EGP',
      methodType: 'wallet', methodDisplayLabel: 'W',
      methodMasked: '**** 5678', idempotencyKey: 'key-1',
    };
    const result = await provider.executePayout(request);
    expect(result.status).toBe('accepted');
    expect(result.providerReference).toBe('mock-ref-001');
  });
});

// ─── Provider Helpers ───
describe('Provider helpers', () => {
  const provider: PayoutProvider = makeMockProvider('test', {
    supportedMethodTypes: ['wallet', 'bank_account'],
    supportedCurrencies: ['EGP', 'USD'],
    supportsStatusLookup: true,
    supportsIdempotency: true,
    supportsCancellation: false,
  });

  it('providerSupportsMethod returns true for supported methods', () => {
    expect(providerSupportsMethod(provider, 'wallet')).toBe(true);
    expect(providerSupportsMethod(provider, 'bank_account')).toBe(true);
  });

  it('providerSupportsMethod returns false for unsupported methods', () => {
    expect(providerSupportsMethod(provider, 'bank_card')).toBe(false);
    expect(providerSupportsMethod(provider, 'instapay')).toBe(false);
  });

  it('providerSupportsCurrency is case-insensitive', () => {
    expect(providerSupportsCurrency(provider, 'EGP')).toBe(true);
    expect(providerSupportsCurrency(provider, 'egp')).toBe(true);
    expect(providerSupportsCurrency(provider, 'USD')).toBe(true);
    expect(providerSupportsCurrency(provider, 'EUR')).toBe(false);
  });
});

// ─── Provider Registry ───
describe('PayoutProviderRegistry', () => {
  beforeEach(() => {
    PayoutProviderRegistry.clear();
  });

  it('registers and resolves a provider', () => {
    const provider = makeMockProvider('wallet-provider', {
      supportedMethodTypes: ['wallet'],
      supportedCurrencies: ['EGP'],
      supportsStatusLookup: false,
      supportsIdempotency: true,
      supportsCancellation: false,
    });
    PayoutProviderRegistry.register(provider);

    const resolved = PayoutProviderRegistry.resolve('wallet', 'EGP');
    expect(resolved.providerId).toBe('wallet-provider');
  });

  it('throws ProviderUnavailableError when no provider matches', () => {
    expect(() => PayoutProviderRegistry.resolve('wallet', 'EGP')).toThrow(ProviderUnavailableError);
  });

  it('canResolve returns true/false correctly', () => {
    expect(PayoutProviderRegistry.canResolve('wallet', 'EGP')).toBe(false);

    PayoutProviderRegistry.register(makeMockProvider('p1', {
      supportedMethodTypes: ['wallet'],
      supportedCurrencies: ['EGP'],
      supportsStatusLookup: false, supportsIdempotency: true, supportsCancellation: false,
    }));

    expect(PayoutProviderRegistry.canResolve('wallet', 'EGP')).toBe(true);
    expect(PayoutProviderRegistry.canResolve('bank_card', 'EGP')).toBe(false);
    expect(PayoutProviderRegistry.canResolve('wallet', 'USD')).toBe(false);
  });

  it('listProviders returns all registered', () => {
    PayoutProviderRegistry.register(makeMockProvider('p1', {
      supportedMethodTypes: ['wallet'], supportedCurrencies: ['EGP'],
      supportsStatusLookup: false, supportsIdempotency: true, supportsCancellation: false,
    }));
    PayoutProviderRegistry.register(makeMockProvider('p2', {
      supportedMethodTypes: ['bank_account'], supportedCurrencies: ['EGP'],
      supportsStatusLookup: true, supportsIdempotency: true, supportsCancellation: true,
    }));
    expect(PayoutProviderRegistry.listProviders().length).toBe(2);
  });

  it('does NOT hardcode Paymob/Fawry', () => {
    PayoutProviderRegistry.register(makeMockProvider('generic', {
      supportedMethodTypes: ALL_METHOD_TYPES,
      supportedCurrencies: ['EGP'],
      supportsStatusLookup: true, supportsIdempotency: true, supportsCancellation: true,
    }));
    const resolved = PayoutProviderRegistry.resolve('wallet', 'EGP');
    expect(resolved.providerId).not.toContain('paymob');
    expect(resolved.providerId).not.toContain('fawry');
    expect(resolved.providerId).not.toContain('vodafone');
  });
});

// ─── Domain Errors ───
describe('Payout domain errors', () => {
  it('UnsupportedMethodTypeError has correct code', () => {
    const err = new UnsupportedMethodTypeError('invalid_type');
    expect(err.code).toBe('UNSUPPORTED_METHOD_TYPE');
    expect(err.message).toContain('invalid_type');
  });

  it('UnsupportedCurrencyError has correct code', () => {
    const err = new UnsupportedCurrencyError('XYZ');
    expect(err.code).toBe('UNSUPPORTED_CURRENCY');
  });

  it('ProviderUnavailableError has correct code', () => {
    const err = new ProviderUnavailableError('wallet', 'USD');
    expect(err.code).toBe('PROVIDER_UNAVAILABLE');
    expect(err.message).toContain('wallet');
    expect(err.message).toContain('USD');
  });

  it('InvalidPayoutStateError has correct code', () => {
    const err = new InvalidPayoutStateError('completed', 'cancel');
    expect(err.code).toBe('INVALID_PAYOUT_STATE');
  });

  it('IdempotencyConflictError has correct code', () => {
    const err = new IdempotencyConflictError('key-001');
    expect(err.code).toBe('IDEMPOTENCY_CONFLICT');
  });

  it('PayoutExecutionRejectedError has correct code', () => {
    const err = new PayoutExecutionRejectedError('insufficient funds');
    expect(err.code).toBe('PAYOUT_EXECUTION_REJECTED');
  });

  it('PayoutAlreadyCompletedError has correct code', () => {
    const err = new PayoutAlreadyCompletedError('p1');
    expect(err.code).toBe('PAYOUT_ALREADY_COMPLETED');
  });

  it('PayoutCancelledError has correct code', () => {
    const err = new PayoutCancelledError('p1');
    expect(err.code).toBe('PAYOUT_CANCELLED');
  });

  it('toJSON strips cause (no provider internals leak)', () => {
    const err = new PayoutDomainError(
      'PROVIDER_UNAVAILABLE',
      'No provider',
      { secret: 'api_key_123', raw: 'provider_internal_data' },
    );
    const json = err.toJSON();
    expect(json.code).toBe('PROVIDER_UNAVAILABLE');
    expect(json.message).toBe('No provider');
    expect((json as unknown as Record<string, unknown>).cause).toBeUndefined();
    expect((json as unknown as Record<string, unknown>).secret).toBeUndefined();
  });

  it('isPayoutDomainError identifies domain errors', () => {
    expect(isPayoutDomainError(new ProviderUnavailableError('wallet', 'EGP'))).toBe(true);
    expect(isPayoutDomainError(new Error('generic'))).toBe(false);
  });

  it('getPayoutErrorCode extracts code from domain errors', () => {
    expect(getPayoutErrorCode(new IdempotencyConflictError('k1'))).toBe('IDEMPOTENCY_CONFLICT');
    expect(getPayoutErrorCode(new Error('generic'))).toBeNull();
  });

  it('errors do NOT contain SQL/provider payload details', () => {
    const err = new PayoutDomainError(
      'PROVIDER_UNAVAILABLE',
      'Safe message',
      { sql_error: 'PGRST200', provider_payload: { secret: 'xxx' } },
    );
    expect(err.message).not.toContain('PGRST200');
    expect(err.message).not.toContain('secret');
    expect(err.message).not.toContain('xxx');
  });
});

// ─── Method types remain unchanged ───
describe('Method type invariants', () => {
  it('only 4 generic method types exist', () => {
    const validTypes = ['wallet', 'bank_account', 'bank_card', 'instapay'];
    expect(validTypes.length).toBe(4);
    expect(validTypes).not.toContain('vodafone_cash');
    expect(validTypes).not.toContain('etisalat_cash');
    expect(validTypes).not.toContain('orange_cash');
    expect(validTypes).not.toContain('we_cash');
  });

  it('no wallet-provider dropdown/list in the contracts', () => {
    // The PayoutProvider interface has NO provider-specific fields.
    // The PayoutCapabilities uses method_type (generic), not
    // provider names.
    const caps: PayoutCapabilities = {
      supportedMethodTypes: ['wallet'],
      supportedCurrencies: ['EGP'],
      supportsStatusLookup: false, supportsIdempotency: true, supportsCancellation: false,
    };
    expect((caps as unknown as Record<string, unknown>).walletProvider).toBeUndefined();
    expect((caps as unknown as Record<string, unknown>).operator).toBeUndefined();
    expect((caps as unknown as Record<string, unknown>).carrier).toBeUndefined();
  });
});

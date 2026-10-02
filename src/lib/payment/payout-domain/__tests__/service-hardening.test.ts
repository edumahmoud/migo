// =====================================================
// Payout Service Hardening Tests — Phase 13 Fixes #2, #3, #4
// =====================================================
// Verifies the three service-layer fixes:
//
//   Fix #2 — initiatePayout enforces amount ≤ teacher eligible balance
//   Fix #3 — initiatePayout links ledger entries with real teacher_share
//            (not the previous 0 placeholder that violated v82 CHECK)
//   Fix #4 — processPayoutWebhook resolves payout directly via
//            getPayoutByProviderReference (no redundant getPayoutById first)
//
// Strategy: bun:test's mock.module replaces the repository layer
// with controlled stubs so tests do NOT touch the database. The
// service's business logic is what's under test.
//
// Uses `bun:test`.
// =====================================================

import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test';

// ─── Mock the repository BEFORE importing the service ───
// Each test can re-configure the mock to exercise a different path.

const mockCreatePayout = mock(async (_input: unknown) => ({ id: 'payout-uuid-001' }));
const mockGetPayoutById = mock(async (_id: string) => null);
const mockGetPayoutByIdempotencyKey = mock(async (_key: string) => null);
const mockGetPayoutByProviderReference = mock(async (_ref: string) => null);
const mockGetEligibleLedgerEntries = mock(async (_teacherId: string) => [] as unknown[]);
const mockLinkLedgerEntry = mock(async (_payoutId: string, _ledgerId: string, _teacherId: string, _amount: number, _currency: string) => {});
const mockGetPayoutLedgerEntries = mock(async (_payoutId: string) => [] as unknown[]);
const mockUpdatePayoutStatus = mock(async (_id: string, _status: string) => true);
const mockUpdatePayoutProviderReference = mock(async (_id: string, _ref: string) => {});
const mockSetPayoutFailure = mock(async (_id: string, _reason: string) => {});
const mockWriteAuditLog = mock(async (_entry: unknown) => {});

mock.module('@/lib/payment/payout-domain/repository', () => ({
  createPayout: mockCreatePayout,
  getPayoutById: mockGetPayoutById,
  getPayoutByIdempotencyKey: mockGetPayoutByIdempotencyKey,
  getPayoutByProviderReference: mockGetPayoutByProviderReference,
  getEligibleLedgerEntries: mockGetEligibleLedgerEntries,
  linkLedgerEntry: mockLinkLedgerEntry,
  getPayoutLedgerEntries: mockGetPayoutLedgerEntries,
  updatePayoutStatus: mockUpdatePayoutStatus,
  updatePayoutProviderReference: mockUpdatePayoutProviderReference,
  setPayoutFailure: mockSetPayoutFailure,
  writeAuditLog: mockWriteAuditLog,
}));

// ─── Also mock resolvePayoutMethod (used by initiatePayout) ───
mock.module('@/lib/payment/payout-methods-repository', () => ({
  resolvePayoutMethod: mock(async () => ({
    id: 'method-1',
    teacher_id: 'teacher-1',
    method_type: 'wallet',
    display_label: 'My Wallet',
    details_masked: '**** 5678',
    is_active: true,
    is_default: true,
    verified_at: null,
    verified_by: null,
    created_at: '',
    updated_at: '',
    details: { method_type: 'wallet', wallet_number: '0100', holder_name: 'X' },
  })),
}));

const { initiatePayout, processPayoutWebhook } = await import('@/lib/payment/payout-domain/service');
const { PayoutExecutionRejectedError } = await import('@/lib/payment/payout-domain/errors');

function resetMocks() {
  mockCreatePayout.mockReset();
  mockGetPayoutById.mockReset();
  mockGetPayoutByIdempotencyKey.mockReset();
  mockGetPayoutByProviderReference.mockReset();
  mockGetEligibleLedgerEntries.mockReset();
  mockLinkLedgerEntry.mockReset();
  mockGetPayoutLedgerEntries.mockReset();
  mockUpdatePayoutStatus.mockReset();
  mockUpdatePayoutProviderReference.mockReset();
  mockSetPayoutFailure.mockReset();
  mockWriteAuditLog.mockReset();
  // Re-default the no-op stubs (bun:test uses mockImplementation)
  mockCreatePayout.mockImplementation(async () => ({ id: 'payout-uuid-001' }));
  mockGetPayoutById.mockImplementation(async () => null);
  mockGetPayoutByIdempotencyKey.mockImplementation(async () => null);
  mockGetPayoutByProviderReference.mockImplementation(async () => null);
  mockGetEligibleLedgerEntries.mockImplementation(async () => []);
  mockLinkLedgerEntry.mockImplementation(async () => {});
  mockGetPayoutLedgerEntries.mockImplementation(async () => []);
  mockUpdatePayoutStatus.mockImplementation(async () => true);
  mockUpdatePayoutProviderReference.mockImplementation(async () => {});
  mockSetPayoutFailure.mockImplementation(async () => {});
  mockWriteAuditLog.mockImplementation(async () => {});
}

function eligibleEntry(id: string, teacherShare: number, currency = 'EGP') {
  return {
    id,
    order_id: 'order-1',
    student_id: 'student-1',
    subject_id: 'subject-1',
    teacher_id: 'teacher-1',
    gateway_id: 'gw-1',
    currency,
    gross_amount: teacherShare * 1.4,
    platform_share: teacherShare * 0.1,
    teacher_share: teacherShare,
    gateway_fee: teacherShare * 0.05,
    net_amount: teacherShare,
    commission_rate: 0.1,
    status: 'paid',
    created_at: '2025-01-01',
  };
}

// =====================================================
// Fix #2 — eligible balance enforcement
// =====================================================

describe('Fix #2 — initiatePayout enforces amount ≤ eligible balance', () => {
  beforeEach(() => {
    resetMocks();
    mockGetPayoutByIdempotencyKey.mockImplementation(async () => null);
  });

  it('amount below eligible balance → accepted (createPayout called)', async () => {
    mockGetEligibleLedgerEntries.mockImplementation(async () => [
      eligibleEntry('l-1', 100),
      eligibleEntry('l-2', 200),
    ]);
    // 300 eligible, requesting 250
    const result = await initiatePayout({
      teacherId: 'teacher-1',
      payoutMethodId: 'method-1',
      amount: 250,
      currency: 'EGP',
      idempotencyKey: 'idem-1',
      internalReference: 'PO-001',
      initiatedBy: 'admin-1',
    });
    expect(result.payoutId).toBe('payout-uuid-001');
    expect(mockCreatePayout).toHaveBeenCalledTimes(1);
  });

  it('amount exactly equals eligible balance → accepted', async () => {
    mockGetEligibleLedgerEntries.mockImplementation(async () => [
      eligibleEntry('l-1', 100),
      eligibleEntry('l-2', 100),
    ]);
    // 200 eligible, requesting exactly 200
    const result = await initiatePayout({
      teacherId: 'teacher-1',
      payoutMethodId: 'method-1',
      amount: 200,
      currency: 'EGP',
      idempotencyKey: 'idem-2',
      internalReference: 'PO-002',
      initiatedBy: 'admin-1',
    });
    expect(result.payoutId).toBe('payout-uuid-001');
  });

  it('amount exceeds eligible balance → rejected with PayoutExecutionRejectedError', async () => {
    mockGetEligibleLedgerEntries.mockImplementation(async () => [
      eligibleEntry('l-1', 100),
    ]);
    // 100 eligible, requesting 250
    await expect(initiatePayout({
      teacherId: 'teacher-1',
      payoutMethodId: 'method-1',
      amount: 250,
      currency: 'EGP',
      idempotencyKey: 'idem-3',
      internalReference: 'PO-003',
      initiatedBy: 'admin-1',
    })).rejects.toThrow(/exceeds teacher's eligible balance/);
    expect(mockCreatePayout).not.toHaveBeenCalled();
  });

  it('teacher with no eligible balance → rejected', async () => {
    mockGetEligibleLedgerEntries.mockImplementation(async () => []);
    await expect(initiatePayout({
      teacherId: 'teacher-2',
      payoutMethodId: 'method-1',
      amount: 100,
      currency: 'EGP',
      idempotencyKey: 'idem-4',
      internalReference: 'PO-004',
      initiatedBy: 'admin-1',
    })).rejects.toThrow(/No eligible balance/);
    expect(mockCreatePayout).not.toHaveBeenCalled();
  });

  it('zero amount → rejected (existing check, still enforced)', async () => {
    mockGetEligibleLedgerEntries.mockImplementation(async () => [eligibleEntry('l-1', 100)]);
    await expect(initiatePayout({
      teacherId: 'teacher-1',
      payoutMethodId: 'method-1',
      amount: 0,
      currency: 'EGP',
      idempotencyKey: 'idem-5',
      internalReference: 'PO-005',
      initiatedBy: 'admin-1',
    })).rejects.toThrow(/Invalid amount/);
  });

  it('negative amount → rejected (existing check, still enforced)', async () => {
    mockGetEligibleLedgerEntries.mockImplementation(async () => [eligibleEntry('l-1', 100)]);
    await expect(initiatePayout({
      teacherId: 'teacher-1',
      payoutMethodId: 'method-1',
      amount: -50,
      currency: 'EGP',
      idempotencyKey: 'idem-6',
      internalReference: 'PO-006',
      initiatedBy: 'admin-1',
    })).rejects.toThrow(/Invalid amount/);
  });

  it('currency mismatch → entry excluded from eligible balance', async () => {
    mockGetEligibleLedgerEntries.mockImplementation(async () => [
      eligibleEntry('l-1', 100, 'USD'),
    ]);
    // Requesting EGP but eligible entries are USD → 0 eligible in EGP
    await expect(initiatePayout({
      teacherId: 'teacher-1',
      payoutMethodId: 'method-1',
      amount: 50,
      currency: 'EGP',
      idempotencyKey: 'idem-7',
      internalReference: 'PO-007',
      initiatedBy: 'admin-1',
    })).rejects.toThrow(/No eligible balance/);
  });

  it('concurrent-looking requests: each request re-evaluates eligible balance independently', async () => {
    // Two sequential calls — each fetches eligible entries fresh.
    // Eligible balance: 100 (one entry, l-1)
    mockGetEligibleLedgerEntries.mockImplementation(async () => [eligibleEntry('l-1', 100)]);
    // First request: 60 — OK
    await initiatePayout({
      teacherId: 'teacher-1',
      payoutMethodId: 'method-1',
      amount: 60,
      currency: 'EGP',
      idempotencyKey: 'idem-a',
      internalReference: 'PO-A',
      initiatedBy: 'admin-1',
    });
    // Second request: 60 — would also pass the service-layer check
    // (because the service can't atomically reserve the balance),
    // BUT the DB-layer UNIQUE(ledger_id) prevents the same entry from
    // being linked to both payouts. The service-layer check is a
    // sanity guard; the authoritative defense is at the DB layer.
    // We verify here that both calls reach createPayout (i.e., the
    // service does not artificially block the second one).
    await initiatePayout({
      teacherId: 'teacher-1',
      payoutMethodId: 'method-1',
      amount: 60,
      currency: 'EGP',
      idempotencyKey: 'idem-b',
      internalReference: 'PO-B',
      initiatedBy: 'admin-1',
    });
    expect(mockCreatePayout).toHaveBeenCalledTimes(2);
  });
});

// =====================================================
// Fix #3 — linkLedgerEntry uses real teacher_share (not 0)
// =====================================================

describe('Fix #3 — initiatePayout links ledger entries with real teacher_share', () => {
  beforeEach(() => {
    resetMocks();
    mockGetPayoutByIdempotencyKey.mockImplementation(async () => null);
  });

  it('linkLedgerEntry is called with each entry teacher_share (NOT 0)', async () => {
    mockGetEligibleLedgerEntries.mockImplementation(async () => [
      eligibleEntry('l-1', 60),
      eligibleEntry('l-2', 40),
    ]);

    await initiatePayout({
      teacherId: 'teacher-1',
      payoutMethodId: 'method-1',
      amount: 100,
      currency: 'EGP',
      idempotencyKey: 'idem-link-1',
      internalReference: 'PO-LINK-1',
      initiatedBy: 'admin-1',
      ledgerEntryIds: ['l-1', 'l-2'],
    });

    expect(mockLinkLedgerEntry).toHaveBeenCalledTimes(2);
    // First call: payout-uuid-001, l-1, teacher-1, 60, EGP
    const call1 = mockLinkLedgerEntry.mock.calls[0];
    expect(call1[0]).toBe('payout-uuid-001');
    expect(call1[1]).toBe('l-1');
    expect(call1[2]).toBe('teacher-1');
    expect(call1[3]).toBe(60); // ← THE FIX: real teacher_share, not 0
    expect(call1[4]).toBe('EGP');

    const call2 = mockLinkLedgerEntry.mock.calls[1];
    expect(call2[1]).toBe('l-2');
    expect(call2[3]).toBe(40); // ← real teacher_share
  });

  it('linkLedgerEntry is NOT called when no ledgerEntryIds provided', async () => {
    mockGetEligibleLedgerEntries.mockImplementation(async () => [eligibleEntry('l-1', 100)]);

    await initiatePayout({
      teacherId: 'teacher-1',
      payoutMethodId: 'method-1',
      amount: 100,
      currency: 'EGP',
      idempotencyKey: 'idem-link-2',
      internalReference: 'PO-LINK-2',
      initiatedBy: 'admin-1',
      // no ledgerEntryIds
    });

    expect(mockLinkLedgerEntry).not.toHaveBeenCalled();
  });

  it('ineligible ledger entry (already linked / wrong currency / not owned) → rejected', async () => {
    mockGetEligibleLedgerEntries.mockImplementation(async () => [
      eligibleEntry('l-1', 100),
      // l-2 NOT in eligible list (e.g., already linked to another payout)
    ]);

    await expect(initiatePayout({
      teacherId: 'teacher-1',
      payoutMethodId: 'method-1',
      amount: 100,
      currency: 'EGP',
      idempotencyKey: 'idem-link-3',
      internalReference: 'PO-LINK-3',
      initiatedBy: 'admin-1',
      ledgerEntryIds: ['l-1', 'l-2'], // l-2 is NOT eligible
    })).rejects.toThrow(/Ledger entry l-2 is not eligible/);

    expect(mockCreatePayout).not.toHaveBeenCalled();
  });

  it('amount_settled passed to linkLedgerEntry is always > 0 (v82 CHECK satisfied)', async () => {
    mockGetEligibleLedgerEntries.mockImplementation(async () => [
      eligibleEntry('l-1', 0.5),
      eligibleEntry('l-2', 1.5),
    ]);

    await initiatePayout({
      teacherId: 'teacher-1',
      payoutMethodId: 'method-1',
      amount: 2,
      currency: 'EGP',
      idempotencyKey: 'idem-link-4',
      internalReference: 'PO-LINK-4',
      initiatedBy: 'admin-1',
      ledgerEntryIds: ['l-1', 'l-2'],
    });

    // All amounts passed to linkLedgerEntry must be > 0
    for (const call of mockLinkLedgerEntry.mock.calls) {
      const amountSettled = call[3] as number;
      expect(amountSettled).toBeGreaterThan(0);
    }
  });
});

// =====================================================
// Fix #4 — processPayoutWebhook direct provider_reference lookup
// =====================================================

describe('Fix #4 — processPayoutWebhook resolves payout via getPayoutByProviderReference only', () => {
  beforeEach(() => {
    resetMocks();
  });

  it('calls getPayoutByProviderReference exactly once with the provided ref', async () => {
    const payout = {
      id: 'payout-1',
      teacher_id: 'teacher-1',
      payout_method_id: null,
      payout_method_type: 'wallet',
      payout_method_display_label: 'W',
      payout_method_masked: '****',
      amount: 100,
      currency: 'EGP',
      status: 'processing',
      idempotency_key: 'idem-1',
      internal_reference: 'PO-1',
      provider_reference: 'paymob-ref-abc',
      failure_reason: null,
      initiated_by: 'admin-1',
      initiated_at: '2025-01-01',
      executed_at: null,
      created_at: '2025-01-01',
      updated_at: '2025-01-01',
    };
    mockGetPayoutByProviderReference.mockImplementation(async () => payout);

    await processPayoutWebhook({
      providerReference: 'paymob-ref-abc',
      status: 'completed',
    });

    expect(mockGetPayoutByProviderReference).toHaveBeenCalledTimes(1);
    expect(mockGetPayoutByProviderReference.mock.calls[0][0]).toBe('paymob-ref-abc');
  });

  it('does NOT call getPayoutById (no redundant first lookup)', async () => {
    const payout = {
      id: 'payout-1',
      teacher_id: 'teacher-1',
      payout_method_id: null,
      payout_method_type: 'wallet',
      payout_method_display_label: 'W',
      payout_method_masked: '****',
      amount: 100,
      currency: 'EGP',
      status: 'processing',
      idempotency_key: 'idem-1',
      internal_reference: 'PO-1',
      provider_reference: 'paymob-ref-abc',
      failure_reason: null,
      initiated_by: 'admin-1',
      initiated_at: '2025-01-01',
      executed_at: null,
      created_at: '2025-01-01',
      updated_at: '2025-01-01',
    };
    mockGetPayoutByProviderReference.mockImplementation(async () => payout);

    await processPayoutWebhook({
      providerReference: 'paymob-ref-abc',
      status: 'completed',
    });

    // Fix #4: getPayoutById MUST NOT be called from processPayoutWebhook
    // (it was the wrong first-lookup in the previous implementation).
    expect(mockGetPayoutById).not.toHaveBeenCalled();
  });

  it('payout not found → returns { processed: false }', async () => {
    mockGetPayoutByProviderReference.mockImplementation(async () => null);

    const result = await processPayoutWebhook({
      providerReference: 'nonexistent-ref',
      status: 'completed',
    });

    expect(result.processed).toBe(false);
    expect(result.payoutId).toBeUndefined();
  });

  it('idempotent — same status → no reprocessing, returns { processed: true }', async () => {
    const payout = {
      id: 'payout-1',
      teacher_id: 'teacher-1',
      payout_method_id: null,
      payout_method_type: 'wallet',
      payout_method_display_label: 'W',
      payout_method_masked: '****',
      amount: 100,
      currency: 'EGP',
      status: 'completed', // already in target state
      idempotency_key: 'idem-1',
      internal_reference: 'PO-1',
      provider_reference: 'ref-1',
      failure_reason: null,
      initiated_by: 'admin-1',
      initiated_at: '2025-01-01',
      executed_at: null,
      created_at: '2025-01-01',
      updated_at: '2025-01-01',
    };
    mockGetPayoutByProviderReference.mockImplementation(async () => payout);

    const result = await processPayoutWebhook({
      providerReference: 'ref-1',
      status: 'completed',
    });

    expect(result.processed).toBe(true);
    expect(result.payoutId).toBe('payout-1');
    expect(mockUpdatePayoutStatus).not.toHaveBeenCalled();
    expect(mockWriteAuditLog).not.toHaveBeenCalled();
  });

  it('terminal state (cancelled) → no transition, no audit log', async () => {
    const payout = {
      id: 'payout-1',
      teacher_id: 'teacher-1',
      payout_method_id: null,
      payout_method_type: 'wallet',
      payout_method_display_label: 'W',
      payout_method_masked: '****',
      amount: 100,
      currency: 'EGP',
      status: 'cancelled', // terminal
      idempotency_key: 'idem-1',
      internal_reference: 'PO-1',
      provider_reference: 'ref-1',
      failure_reason: null,
      initiated_by: 'admin-1',
      initiated_at: '2025-01-01',
      executed_at: null,
      created_at: '2025-01-01',
      updated_at: '2025-01-01',
    };
    mockGetPayoutByProviderReference.mockImplementation(async () => payout);

    const result = await processPayoutWebhook({
      providerReference: 'ref-1',
      status: 'completed',
    });

    expect(result.processed).toBe(true);
    expect(mockUpdatePayoutStatus).not.toHaveBeenCalled();
  });

  it('valid transition processing → completed → updates status + writes audit log', async () => {
    const payout = {
      id: 'payout-1',
      teacher_id: 'teacher-1',
      payout_method_id: null,
      payout_method_type: 'wallet',
      payout_method_display_label: 'W',
      payout_method_masked: '****',
      amount: 100,
      currency: 'EGP',
      status: 'processing',
      idempotency_key: 'idem-1',
      internal_reference: 'PO-1',
      provider_reference: 'ref-1',
      failure_reason: null,
      initiated_by: 'admin-1',
      initiated_at: '2025-01-01',
      executed_at: null,
      created_at: '2025-01-01',
      updated_at: '2025-01-01',
    };
    mockGetPayoutByProviderReference.mockImplementation(async () => payout);

    const result = await processPayoutWebhook({
      providerReference: 'ref-1',
      status: 'completed',
    });

    expect(result.processed).toBe(true);
    expect(mockUpdatePayoutStatus).toHaveBeenCalledWith('payout-1', 'completed');
    expect(mockWriteAuditLog).toHaveBeenCalledTimes(1);
    const auditCall = mockWriteAuditLog.mock.calls[0][0] as { event: string };
    expect(auditCall.event).toBe('payout.completed');
  });

  it('valid transition processing → failed → sets failure + writes audit log', async () => {
    const payout = {
      id: 'payout-1',
      teacher_id: 'teacher-1',
      payout_method_id: null,
      payout_method_type: 'wallet',
      payout_method_display_label: 'W',
      payout_method_masked: '****',
      amount: 100,
      currency: 'EGP',
      status: 'processing',
      idempotency_key: 'idem-1',
      internal_reference: 'PO-1',
      provider_reference: 'ref-1',
      failure_reason: null,
      initiated_by: 'admin-1',
      initiated_at: '2025-01-01',
      executed_at: null,
      created_at: '2025-01-01',
      updated_at: '2025-01-01',
    };
    mockGetPayoutByProviderReference.mockImplementation(async () => payout);

    const result = await processPayoutWebhook({
      providerReference: 'ref-1',
      status: 'failed',
      failureReason: 'Provider rejected',
    });

    expect(result.processed).toBe(true);
    expect(mockSetPayoutFailure).toHaveBeenCalledWith('payout-1', 'Provider rejected');
    expect(mockWriteAuditLog).toHaveBeenCalledTimes(1);
  });

  it('invalid transition (pending → completed) → not processed, returns { processed: false, payoutId }', async () => {
    // The DB trigger only allows pending → processing | cancelled.
    // pending → completed is NOT a valid transition.
    const payout = {
      id: 'payout-1',
      teacher_id: 'teacher-1',
      payout_method_id: null,
      payout_method_type: 'wallet',
      payout_method_display_label: 'W',
      payout_method_masked: '****',
      amount: 100,
      currency: 'EGP',
      status: 'pending',
      idempotency_key: 'idem-1',
      internal_reference: 'PO-1',
      provider_reference: 'ref-1',
      failure_reason: null,
      initiated_by: 'admin-1',
      initiated_at: '2025-01-01',
      executed_at: null,
      created_at: '2025-01-01',
      updated_at: '2025-01-01',
    };
    mockGetPayoutByProviderReference.mockImplementation(async () => payout);

    const result = await processPayoutWebhook({
      providerReference: 'ref-1',
      status: 'completed',
    });

    expect(result.processed).toBe(false);
    expect(result.payoutId).toBe('payout-1');
    expect(mockUpdatePayoutStatus).not.toHaveBeenCalled();
  });
});

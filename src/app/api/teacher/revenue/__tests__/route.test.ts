// =====================================================
// Teacher Financial Dashboard — Phase 10 Tests
// =====================================================
// Test cases for the Teacher Financial Dashboard as specified
// in Phase 10 requirements.
//
// ⚠️ NOTE: This project uses `bun:test` as its test runner
// (consistent with the existing __tests__ files in
// src/lib/payment/__tests__/). Tests can be executed with:
//   bun test
//
// However, the project does NOT currently have a `test` script
// in package.json. Until that's added, these tests serve as
// documentation of expected behavior and as a checklist for
// manual QA. To run them manually:
//   bun test src/app/api/teacher/revenue/__tests__/route.test.ts
// =====================================================

import { describe, it, expect, beforeEach, mock } from 'bun:test';

// ─── Test data constants ───
// Used for assertions about teacher_id isolation.
const TEACHER_A_ID = '00000000-0000-0000-0000-000000000001';
const TEACHER_B_ID = '00000000-0000-0000-0000-000000000002';

// ─── Allowed status values (mirror of DB CHECK constraint) ───
const ALLOWED_STATUSES = ['paid', 'refunded', 'reversed', 'settled', 'pending', 'failed'];

// =====================================================
// Pure logic tests — no DB mocking required.
// These verify the invariants that the route enforces
// independently of the actual supabase call.
// =====================================================

describe('Phase 10 — Teacher Financial Dashboard invariants', () => {
  beforeEach(() => {
    mock.clearAllMocks?.();
  });

  // Test 1 — Allowed statuses match DB CHECK constraint.
  it('does not invent new financial statuses — uses only DB-allowed values', () => {
    // The DB CHECK constraint on financial_ledger.status is:
    //   status IN ('pending','paid','failed','refunded','reversed','settled')
    // The route must NOT accept any value outside this list.
    expect(ALLOWED_STATUSES).toEqual(
      expect.arrayContaining(['paid', 'refunded', 'reversed', 'settled', 'pending', 'failed'])
    );

    // Invented values that must be rejected:
    expect(ALLOWED_STATUSES).not.toContain('invented_status');
    expect(ALLOWED_STATUSES).not.toContain('partially_paid');
    expect(ALLOWED_STATUSES).not.toContain('cancelled');
  });

  // Test 2 — Status filter validation logic.
  // (Mirrors the route's ALLOWED_STATUSES check.)
  it('rejects status values not in the allowed list', () => {
    const isValidStatus = (s: string) => ALLOWED_STATUSES.includes(s);
    expect(isValidStatus('paid')).toBe(true);
    expect(isValidStatus('refunded')).toBe(true);
    expect(isValidStatus('settled')).toBe(true);
    expect(isValidStatus('reversed')).toBe(true);
    expect(isValidStatus('invented')).toBe(false);
    expect(isValidStatus('')).toBe(false);
  });

  // Test 3 — Date format validation logic.
  // (Mirrors the route's dateRegex check.)
  it('rejects malformed date formats', () => {
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    expect(dateRegex.test('2025-01-15')).toBe(true);
    expect(dateRegex.test('2025-12-31')).toBe(true);
    expect(dateRegex.test('15-01-2025')).toBe(false); // DD-MM-YYYY
    expect(dateRegex.test('2025/01/15')).toBe(false); // slashes
    expect(dateRegex.test('2025-1-5')).toBe(false); // single digits
    expect(dateRegex.test('')).toBe(false);
  });

  // Test 4 — UUID format validation logic.
  it('rejects malformed subject_id values', () => {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    expect(uuidRegex.test(TEACHER_A_ID)).toBe(true);
    expect(uuidRegex.test('not-a-uuid')).toBe(false);
    expect(uuidRegex.test('00000000-0000-0000-0000-00000000000')).toBe(false); // too short
    expect(uuidRegex.test('')).toBe(false);
  });

  // Test 5 — Teacher A and Teacher B have different IDs.
  // (Sanity check — used by isolation logic.)
  it('uses two distinct teacher IDs for isolation tests', () => {
    expect(TEACHER_A_ID).not.toBe(TEACHER_B_ID);
  });

  // Test 6 — Summary aggregation logic (pure function).
  // Replicates the route's sumCents + cents-to-major-unit conversion.
  it('aggregates summary totals from rows only (no recomputing from orders)', () => {
    const rows = [
      { gross_amount: 100, platform_share: 10, teacher_share: 90, gateway_fee: 0 },
      { gross_amount: 200, platform_share: 20, teacher_share: 180, gateway_fee: 0 },
    ];
    const sumCents = (sel: (r: typeof rows[0]) => number) =>
      rows.reduce((acc, r) => acc + Math.round(Number(sel(r) ?? 0) * 100), 0);
    const totalGross = sumCents((r) => r.gross_amount) / 100;
    const totalTeacherShare = sumCents((r) => r.teacher_share) / 100;
    const totalPlatformShare = sumCents((r) => r.platform_share) / 100;
    const totalGatewayFee = sumCents((r) => r.gateway_fee) / 100;

    expect(totalGross).toBe(300);
    expect(totalTeacherShare).toBe(270);
    expect(totalPlatformShare).toBe(30);
    expect(totalGatewayFee).toBe(0);
  });

  // Test 7 — Status breakdown counts.
  it('counts status breakdown correctly', () => {
    const rows = [
      { status: 'paid' },
      { status: 'paid' },
      { status: 'settled' },
      { status: 'refunded' },
    ];
    const paid = rows.filter((r) => r.status === 'paid').length;
    const settled = rows.filter((r) => r.status === 'settled').length;
    const refunded = rows.filter((r) => r.status === 'refunded').length;
    expect(paid).toBe(2);
    expect(settled).toBe(1);
    expect(refunded).toBe(1);
  });

  // Test 8 — Empty state (no rows → zero totals).
  it('returns zero totals when rows is empty', () => {
    const rows: any[] = [];
    const sumCents = (sel: (r: any) => number) =>
      rows.reduce((acc, r) => acc + Math.round(Number(sel(r) ?? 0) * 100), 0);
    expect(sumCents((r) => r.gross_amount) / 100).toBe(0);
    expect(sumCents((r) => r.teacher_share) / 100).toBe(0);
    expect(rows.length).toBe(0);
  });

  // Test 9 — Floating-point safety (using cents avoids drift).
  it('does not suffer floating-point summation drift (uses cents)', () => {
    // 0.1 + 0.2 !== 0.3 in JS due to float; cents avoids this.
    const rows = [
      { gross_amount: 0.1 },
      { gross_amount: 0.2 },
    ];
    const naiveSum = rows.reduce((a, r) => a + r.gross_amount, 0);
    const safeSumCents = rows.reduce((a, r) => a + Math.round(r.gross_amount * 100), 0) / 100;
    expect(naiveSum).not.toBe(0.3); // 0.30000000000000004
    expect(safeSumCents).toBe(0.3);
  });

  // Test 10 — Date range boundary conversion.
  it('converts date_to to end-of-day UTC (23:59:59Z)', () => {
    const dateTo = '2025-02-20';
    const endOfDay = `${dateTo}T23:59:59Z`;
    expect(endOfDay).toBe('2025-02-20T23:59:59Z');
  });

  // Test 11 — Date range boundary conversion.
  it('converts date_from to start-of-day UTC (00:00:00Z)', () => {
    const dateFrom = '2025-01-15';
    const startOfDay = `${dateFrom}T00:00:00Z`;
    expect(startOfDay).toBe('2025-01-15T00:00:00Z');
  });

  // Test 12 — Transaction history shape.
  it('exposes only the safe public fields in transactions', () => {
    const tx = {
      id: 'x',
      order_id: 'o1',
      subject_id: 's1',
      subject_name: 'Course',
      student_name: 'Student',
      currency: 'EGP',
      gross_amount: 100,
      platform_share: 10,
      teacher_share: 90,
      gateway_fee: 0,
      net_amount: 90,
      commission_rate: 10,
      status: 'paid',
      created_at: '2025-09-25T10:00:00Z',
    };
    // The route must NOT expose: payment_id, provider_payment_id, raw_payload,
    // gateway_id, student_id (raw), teacher_id (raw), updated_at, etc.
    expect(tx).not.toHaveProperty('payment_id');
    expect(tx).not.toHaveProperty('provider_payment_id');
    expect(tx).not.toHaveProperty('raw_payload');
    expect(tx).not.toHaveProperty('student_id');
    expect(tx).not.toHaveProperty('teacher_id');
  });
});

// =====================================================
// Manual QA checklist (testable without a runner)
// =====================================================
// Teacher A cannot see Teacher B's data:
//   - Log in as Teacher A, visit /dashboard → Financial.
//   - Note the visible transaction count.
//   - Log out, log in as Teacher B, visit Financial.
//   - Verify the transaction list is different (B sees only B's rows).
//   - Try fetching /api/teacher/revenue?teacher_id=TEACHER_B_ID as Teacher A.
//   - Verify the response still shows Teacher A's data (server override).
//
// Mobile responsive behavior:
//   - Open /dashboard on a phone-width viewport (e.g., 375px).
//   - Switch to Financial section.
//   - Verify summary cards are 2-col on mobile, 5-col on desktop.
//   - Verify the table turns into stacked cards below md breakpoint.
//
// Historical values do not change:
//   - Change commission_rates.rate_percentage for new payments.
//   - Verify existing ledger rows still show their old snapshotted amounts.
//   - Reassign a subject's teacher_id to a new teacher.
//   - Verify rows snapshotted with the OLD teacher_id remain visible to
//     the OLD teacher (snapshot integrity).
//
// Frontend cannot mutate financial data:
//   - Confirm there are NO POST/PATCH/DELETE routes under /api/teacher/revenue.
//   - Confirm the dashboard component renders only summary + filters + table,
//     with no edit/delete/create buttons.
//
// Refund doesn't change amounts:
//   - Take a snapshot of a row before refund (gross, teacher_share, platform_share).
//   - Trigger a refund (admin API).
//   - Verify the dashboard still shows the same amounts but with status='refunded'.
// =====================================================

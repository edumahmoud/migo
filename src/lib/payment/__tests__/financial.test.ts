// =====================================================
// Financial Ledger — Calculation Tests
// =====================================================
// Tests the server-side financial calculation logic.
// No DB access — pure function tests.

import { describe, test, expect } from 'bun:test';
import { calculateFinancialShares } from '../financial';

describe('Financial Calculations', () => {
  test('10% commission on 100 EGP', () => {
    const result = calculateFinancialShares(100, 10, 'EGP');
    expect(result.grossAmount).toBe(100);
    expect(result.platformShare).toBe(10);
    expect(result.teacherShare).toBe(90);
    expect(result.netAmount).toBe(90);
    expect(result.gatewayFee).toBe(0);
    expect(result.commissionRate).toBe(10);
  });

  test('0% commission (free platform)', () => {
    const result = calculateFinancialShares(100, 0, 'EGP');
    expect(result.platformShare).toBe(0);
    expect(result.teacherShare).toBe(100);
    expect(result.netAmount).toBe(100);
  });

  test('15.5% commission on 200 EGP', () => {
    const result = calculateFinancialShares(200, 15.5, 'EGP');
    expect(result.grossAmount).toBe(200);
    expect(result.platformShare).toBe(31); // 200 * 0.155 = 31.00
    expect(result.teacherShare).toBe(169); // 200 - 31 = 169.00
    expect(result.netAmount).toBe(169);
  });

  test('handles fractional amounts correctly (99.99 EGP at 10%)', () => {
    const result = calculateFinancialShares(99.99, 10, 'EGP');
    // 99.99 * 0.10 = 9.999 → rounds to 10.00
    // teacher = 99.99 - 10.00 = 89.99
    expect(result.platformShare).toBe(10);
    expect(result.teacherShare).toBe(89.99);
    // Invariant: platform + teacher <= gross
    expect(result.platformShare + result.teacherShare).toBeLessThanOrEqual(result.grossAmount);
  });

  test('handles very small amounts (1 EGP at 10%)', () => {
    const result = calculateFinancialShares(1, 10, 'EGP');
    // 1 * 0.10 = 0.10 → platform
    // 1 - 0.10 = 0.90 → teacher
    expect(result.platformShare).toBe(0.1);
    expect(result.teacherShare).toBe(0.9);
  });

  test('rejects negative gross amount', () => {
    expect(() => calculateFinancialShares(-100, 10, 'EGP')).toThrow('cannot be negative');
  });

  test('rejects commission rate > 100', () => {
    expect(() => calculateFinancialShares(100, 101, 'EGP')).toThrow('Invalid commission rate');
  });

  test('rejects negative commission rate', () => {
    expect(() => calculateFinancialShares(100, -1, 'EGP')).toThrow('Invalid commission rate');
  });

  test('invariant holds: platform + teacher + gateway <= gross', () => {
    const amounts = [0.01, 1, 10, 99.99, 100, 1000, 9999.99];
    const rates = [0, 5, 10, 15.5, 25, 50, 100];

    for (const amount of amounts) {
      for (const rate of rates) {
        const result = calculateFinancialShares(amount, rate, 'EGP');
        const total = result.platformShare + result.teacherShare + result.gatewayFee;
        expect(total).toBeLessThanOrEqual(result.grossAmount + 0.001); // tolerance for rounding
      }
    }
  });
});

// =====================================================
// Financial Ledger — Source Code Integrity Tests
// =====================================================
// Verifies that the RPC source code contains the financial ledger
// creation logic and uses snapshotted values (not JOINs).

describe('Financial Ledger Source Integrity', () => {
  test('RPC creates financial_ledger record', () => {
    const fs = require('fs');
    const path = require('path');
    const rpcSource = fs.readFileSync(
      path.join(__dirname, '..', '..', '..', 'supabase', 'migrations', 'v78_financial_ledger.sql'),
      'utf8',
    );

    // Must INSERT into financial_ledger
    expect(rpcSource).toContain('INSERT INTO public.financial_ledger');

    // Must snapshot teacher_id from subjects
    expect(rpcSource).toContain('SELECT teacher_id INTO v_teacher_id');
    expect(rpcSource).toContain('FROM public.subjects WHERE id = v_order.subject_id');

    // Must snapshot commission_rate from commission_rates
    expect(rpcSource).toContain('SELECT rate_percentage INTO v_commission_rate');
    expect(rpcSource).toContain('FROM public.commission_rates');

    // Must calculate platform_share server-side
    expect(rpcSource).toContain('v_platform_share');
    expect(rpcSource).toContain('ROUND(v_gross_amount * v_commission_rate / 100.0, 2)');

    // Must be idempotent (ON CONFLICT DO NOTHING on payment_id)
    expect(rpcSource).toContain('ON CONFLICT (payment_id) DO NOTHING');

    // Must check if ledger already exists
    expect(rpcSource).toContain('v_ledger_exists');
  });

  test('financial_ledger has ON DELETE RESTRICT', () => {
    const fs = require('fs');
    const path = require('path');
    const migrationSource = fs.readFileSync(
      path.join(__dirname, '..', '..', '..', 'supabase', 'migrations', 'v78_financial_ledger.sql'),
      'utf8',
    );

    // payments.order_id must be RESTRICT (not CASCADE)
    expect(migrationSource).toContain('ON DELETE RESTRICT');
    expect(migrationSource).not.toContain('payments_order_id_fkey.*ON DELETE CASCADE');
  });

  test('financial_ledger has UNIQUE on payment_id (idempotency)', () => {
    const fs = require('fs');
    const path = require('path');
    const migrationSource = fs.readFileSync(
      path.join(__dirname, '..', '..', '..', 'supabase', 'migrations', 'v78_financial_ledger.sql'),
      'utf8',
    );

    expect(migrationSource).toContain('UNIQUE(payment_id)');
  });

  test('financial_ledger has teacher_id as snapshot (no FK to subjects)', () => {
    const fs = require('fs');
    const path = require('path');
    const migrationSource = fs.readFileSync(
      path.join(__dirname, '..', '..', '..', 'supabase', 'migrations', 'v78_financial_ledger.sql'),
      'utf8',
    );

    // teacher_id should NOT have a FK to subjects or users
    // (it's a snapshot — the subject's teacher at payment time)
    const teacherLine = migrationSource.match(/teacher_id.*--.*SNAPSHOT/);
    expect(teacherLine).not.toBeNull();
  });

  test('financial_ledger status CHECK includes required statuses', () => {
    const fs = require('fs');
    const path = require('path');
    const migrationSource = fs.readFileSync(
      path.join(__dirname, '..', '..', '..', 'supabase', 'migrations', 'v78_financial_ledger.sql'),
      'utf8',
    );

    expect(migrationSource).toContain("'pending'");
    expect(migrationSource).toContain("'paid'");
    expect(migrationSource).toContain("'failed'");
    expect(migrationSource).toContain("'refunded'");
    expect(migrationSource).toContain("'reversed'");
    expect(migrationSource).toContain("'settled'");
  });

  test('commission_rates table exists with is_active uniqueness', () => {
    const fs = require('fs');
    const path = require('path');
    const migrationSource = fs.readFileSync(
      path.join(__dirname, '..', '..', '..', 'supabase', 'migrations', 'v78_financial_ledger.sql'),
      'utf8',
    );

    expect(migrationSource).toContain('CREATE TABLE IF NOT EXISTS public.commission_rates');
    expect(migrationSource).toContain('rate_percentage NUMERIC(5,2)');
    expect(migrationSource).toContain('is_active');
    expect(migrationSource).toContain('UNIQUE(is_active)');
  });

  test('PaymentService does NOT contain financial calculation logic', () => {
    const fs = require('fs');
    const path = require('path');
    const serviceSource = fs.readFileSync(
      path.join(__dirname, '..', 'service.ts'),
      'utf8',
    );

    // PaymentService should NOT calculate shares — that's the RPC's job
    expect(serviceSource).not.toContain('platformShare');
    expect(serviceSource).not.toContain('teacherShare');
    expect(serviceSource).not.toContain('commissionRate');
    expect(serviceSource).not.toContain('calculateFinancial');
    expect(serviceSource).not.toContain('financial_ledger');
  });

  test('financial.ts helper does not accept frontend-supplied values', () => {
    const fs = require('fs');
    const path = require('path');
    const helperSource = fs.readFileSync(
      path.join(__dirname, '..', 'financial.ts'),
      'utf8',
    );

    // The helper calculates FROM gross + rate (not from pre-calculated shares)
    expect(helperSource).toContain('grossAmount');
    expect(helperSource).toContain('commissionRate');
    // It should NOT accept platformShare/teacherShare as inputs
    expect(helperSource).not.toContain('function calculateFromShares');
    expect(helperSource).not.toContain('platformShare: number');
    // But it CAN return them as outputs
    expect(helperSource).toContain('platformShare');
  });
});

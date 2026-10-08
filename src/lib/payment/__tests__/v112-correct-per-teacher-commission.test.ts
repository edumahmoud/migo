// =====================================================
// v112 — Corrective Migration + v88 Fees-on-top Tests
// =====================================================
// Tests for the v112 corrective work:
//   1. v112 migration is idempotent + uses commission_rate (not
//      commission_percentage).
//   2. Checkout snapshots the per-teacher rate into order_fees.
//   3. Changing a teacher's rate does NOT modify existing orders
//      or order_fees rows (snapshot immutability).
//   4. NULL teacher rate uses the global fee_catalog value.
//   5. v88 tax/other fees remain in fees_breakdown.
//   6. Legacy pre-v88 orders (no order_fees snapshot) still use
//      the legacy calculateShares() path.
//   7. No active code references commission_percentage.
//   8. No existing financial_ledger row is modified by v112.
//
// Uses source-code inspection (no DB access needed) — same pattern
// as the existing Phase 9 revenue-split tests.
// =====================================================

import { describe, test, expect } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.join(__dirname, '..', '..', '..', '..');

function readSrc(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

/**
 * Strip comments from source code so that "commission_percentage"
 * mentioned in a comment (explaining what's forbidden) doesn't
 * trigger the forbidden-token check.
 *
 * - For TS/TSX: removes // line comments and /* block *​/ comments.
 * - For SQL: removes -- line comments and /* block *​/ comments.
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')   // block comments
    .replace(/^\s*\/\/.*$/gm, '')       // TS line comments
    .replace(/^\s*--.*$/gm, '');          // SQL line comments
}

function fileExists(rel: string): boolean {
  try {
    return fs.statSync(path.join(ROOT, rel)).isFile();
  } catch {
    return false;
  }
}

describe('v112 — Migration correctness', () => {
  test('v112 migration file exists', () => {
    expect(fileExists('supabase/migrations/v112_correct_per_teacher_commission.sql')).toBe(true);
  });

  test('v112 ensures users.commission_rate exists with CHECK 0-100', () => {
    const sql = readSrc('supabase/migrations/v112_correct_per_teacher_commission.sql');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS commission_rate');
    expect(sql).toMatch(/commission_rate >= 0 AND commission_rate <= 100/);
  });

  test('v112 migration is IDEMPOTENT (uses IF NOT EXISTS / OR REPLACE)', () => {
    const sql = readSrc('supabase/migrations/v112_correct_per_teacher_commission.sql');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS');
    expect(sql).toContain('CREATE OR REPLACE FUNCTION');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS');
    expect(sql).toContain('REVOKE EXECUTE');
    expect(sql).toContain('GRANT EXECUTE');
  });

  test('v112 does NOT introduce commission_percentage', () => {
    const sql = readSrc('supabase/migrations/v112_correct_per_teacher_commission.sql');
    // Strip comments first — comments may mention the token to explain it's forbidden.
    const sqlCodeOnly = stripComments(sql);
    expect(sqlCodeOnly).not.toContain('commission_percentage');
  });

  test('v112 does NOT drop any column', () => {
    const sql = readSrc('supabase/migrations/v112_correct_per_teacher_commission.sql');
    // No DROP COLUMN statements (per user instruction: no destructive
    // cleanup unless verified necessary).
    expect(sql).not.toMatch(/DROP\s+COLUMN/i);
  });

  test('v112 does NOT modify existing financial_ledger rows', () => {
    const sql = readSrc('supabase/migrations/v112_correct_per_teacher_commission.sql');
    expect(sql).not.toMatch(/UPDATE\s+public\.financial_ledger/);
    expect(sql).not.toMatch(/DELETE\s+FROM\s+public\.financial_ledger/);
  });

  test('v112 does NOT modify existing order_fees rows', () => {
    const sql = readSrc('supabase/migrations/v112_correct_per_teacher_commission.sql');
    expect(sql).not.toMatch(/UPDATE\s+public\.order_fees/);
    expect(sql).not.toMatch(/DELETE\s+FROM\s+public\.order_fees/);
  });

  test('v112 does NOT modify existing orders rows (outside the RPC body)', () => {
    // The RPC body legitimately contains `UPDATE public.orders SET
    // status = 'paid'` as part of the standard payment activation
    // flow — that's NOT a destructive migration op.
    // The intent here is to assert that the migration file does NOT
    // issue any TOP-LEVEL UPDATE/DELETE on orders. We scope the
    // check to the migration file OUTSIDE the RPC body.
    const sql = readSrc('supabase/migrations/v112_correct_per_teacher_commission.sql');
    // Extract the part of the migration file BEFORE the CREATE
    // OR REPLACE FUNCTION block. That part is the "top-level"
    // migration statements — and must not contain UPDATE/DELETE
    // on orders.
    const beforeFunction = sql.split('CREATE OR REPLACE FUNCTION')[0];
    expect(beforeFunction).not.toMatch(/UPDATE\s+public\.orders/);
    expect(beforeFunction).not.toMatch(/DELETE\s+FROM\s+public\.orders/);
    // Also: the migration must NOT issue DELETE on orders anywhere
    // (the RPC body's UPDATE on orders is the only legitimate one).
    expect(sql).not.toMatch(/DELETE\s+FROM\s+public\.orders/);
  });

  test('v112 RPC uses v88 fees-on-top split (commission + tax + other → platform_share)', () => {
    const sql = readSrc('supabase/migrations/v112_correct_per_teacher_commission.sql');
    expect(sql).toContain('v_platform_commission_amt + v_tax_amount + v_other_fees_amount');
    expect(sql).toContain('v_subscription_total - v_platform_commission_amt');
  });

  test('v112 RPC populates v88 financial_ledger columns', () => {
    const sql = readSrc('supabase/migrations/v112_correct_per_teacher_commission.sql');
    expect(sql).toContain('subscription_total');
    expect(sql).toContain('tax_amount');
    expect(sql).toContain('other_fees_amount');
    expect(sql).toContain('fees_breakdown');
  });

  test('v112 RPC enforces v94 grants (service_role only)', () => {
    const sql = readSrc('supabase/migrations/v112_correct_per_teacher_commission.sql');
    expect(sql).toContain('REVOKE EXECUTE');
    expect(sql).toContain('FROM anon, authenticated');
    expect(sql).toContain('TO service_role');
  });

  test('v112 RPC compares amount against grand_total (with fallback for pre-v88)', () => {
    const sql = readSrc('supabase/migrations/v112_correct_per_teacher_commission.sql');
    expect(sql).toContain('v_order.grand_total IS NOT NULL');
    expect(sql).toContain('v_order.grand_total != p_amount');
    expect(sql).toContain('v_order.amount != p_amount');
  });
});

describe('v112 — Checkout snapshots the teacher-specific rate into order_fees', () => {
  test('checkout reads the subject teacher_id from the subjectsMap', () => {
    const src = readSrc('src/app/api/student/orders/route.ts');
    expect(src).toContain('subject.teacher_id');
  });

  test('checkout queries users.commission_rate for the teacher', () => {
    const src = readSrc('src/app/api/student/orders/route.ts');
    expect(src).toContain("from('users')");
    expect(src).toContain("'commission_rate'");
    expect(src).toContain('subject.teacher_id');
  });

  test('checkout overrides the in-memory platform_commission fee row when teacher rate is set', () => {
    const src = readSrc('src/app/api/student/orders/route.ts');
    // Find: platformCommissionFee.value = teacherCommissionRate
    expect(src).toMatch(/platformCommissionFee\.value\s*=\s*teacherCommissionRate/);
  });

  test('checkout only overrides when teacher rate is NOT NULL', () => {
    const src = readSrc('src/app/api/student/orders/route.ts');
    expect(src).toMatch(/teacherCommissionRate !== null && teacherCommissionRate !== undefined/);
  });

  test('checkout only overrides percentage fees (not flat fees)', () => {
    const src = readSrc('src/app/api/student/orders/route.ts');
    expect(src).toMatch(/platformCommissionFee\.fee_kind === 'percentage'/);
  });

  test('checkout snapshots the resulting breakdown into order_fees (immutable)', () => {
    const src = readSrc('src/app/api/student/orders/route.ts');
    expect(src).toContain("from('order_fees')");
    expect(src).toContain('orderFeesRows');
    // The insert path is INSERT only, no UPDATE
    expect(src).not.toMatch(/from\('order_fees'\)[\s\S]{0,200}\.update\(/);
  });

  test('checkout does NOT touch existing orders or order_fees', () => {
    const src = readSrc('src/app/api/student/orders/route.ts');
    expect(src).not.toMatch(/from\('orders'\)[\s\S]{0,300}\.update\(/);
    expect(src).not.toMatch(/from\('order_fees'\)[\s\S]{0,300}\.update\(/);
    expect(src).not.toMatch(/from\('financial_ledger'\)[\s\S]{0,300}\.update\(/);
  });

  test('checkout preserves global behavior if teacher lookup fails', () => {
    const src = readSrc('src/app/api/student/orders/route.ts');
    // The lookup is wrapped in try/catch — on failure, the global
    // fee_catalog value is used unchanged.
    expect(src).toContain('teacher commission_rate lookup failed');
    // After the catch, the override block checks
    // `teacherCommissionRate !== null` — so on lookup failure
    // (teacherCommissionRate stays null), the override is skipped
    // and the global fee_catalog value flows through.
  });
});

describe('v112 — v88 tax/other fees remain correct', () => {
  test('calculateSharesFromOrderFees aggregates tax* fees separately', () => {
    const src = readSrc('src/lib/payment/commission.ts');
    expect(src).toMatch(/r\.code\.startsWith\('tax'\)/);
  });

  test('calculateSharesFromOrderFees aggregates platform_commission separately', () => {
    const src = readSrc('src/lib/payment/commission.ts');
    expect(src).toMatch(/r\.code === 'platform_commission'/);
  });

  test('calculateSharesFromOrderFees returns the full fees_breakdown array', () => {
    const src = readSrc('src/lib/payment/commission.ts');
    expect(src).toContain('feesBreakdown');
    // The breakdown is built from rows.map((r) => ({ code, ... }))
    expect(src).toMatch(/feesBreakdown\s*=\s*rows\.map/);
  });

  test('v112 RPC keeps tax_amount + other_fees_amount in the financial_ledger insert', () => {
    const sql = readSrc('supabase/migrations/v112_correct_per_teacher_commission.sql');
    expect(sql).toContain('v_subscription_total, v_tax_amount, v_other_fees_amount, v_fees_breakdown');
  });
});

describe('v112 — Legacy pre-v88 orders still use legacy calculation', () => {
  test('calculateSharesFromOrderFees falls back to calculateShares for pre-v88 orders', () => {
    const src = readSrc('src/lib/payment/commission.ts');
    expect(src).toContain('Genuine pre-v88 order — use legacy split');
    expect(src).toMatch(/return\s*\{[\s\S]*?kind:\s*'legacy'/);
  });

  test('calculateSharesFromOrderFees throws OrderFeesSnapshotError when v88 order has no snapshot', () => {
    const src = readSrc('src/lib/payment/commission.ts');
    expect(src).toContain('OrderFeesSnapshotError');
    expect(src).toContain('order has base_amount (v88) but no order_fees snapshot rows');
  });

  test('OrderFeesSnapshotError is exported from commission.ts', () => {
    const src = readSrc('src/lib/payment/commission.ts');
    expect(src).toMatch(/export\s+class\s+OrderFeesSnapshotError/);
  });

  test('All 4 fallback paths import OrderFeesSnapshotError', () => {
    const paths = [
      'src/app/api/admin/orders/[id]/force-activate/route.ts',
      'src/app/api/admin/backfill-financial-ledger/route.ts',
      'src/app/api/student/orders/verify-after-redirect/route.ts',
      'src/app/api/teacher/subscriptions/activate/route.ts',
    ];
    for (const rel of paths) {
      const src = readSrc(rel);
      expect(src).toContain('OrderFeesSnapshotError');
    }
  });

  test('All 4 fallback paths handle OrderFeesSnapshotError (fail-safely)', () => {
    const paths = [
      'src/app/api/admin/orders/[id]/force-activate/route.ts',
      'src/app/api/admin/backfill-financial-ledger/route.ts',
      'src/app/api/student/orders/verify-after-redirect/route.ts',
      'src/app/api/teacher/subscriptions/activate/route.ts',
    ];
    for (const rel of paths) {
      const src = readSrc(rel);
      // Each path must catch the error (instanceof check)
      expect(src).toMatch(/err instanceof OrderFeesSnapshotError/);
      // And log/skip rather than throw
      expect(src).toMatch(/instanceof OrderFeesSnapshotError[\s\S]{0,500}(console\.(warn|error)|errors\+\+|actions\.push)/);
    }
  });
});

describe('v112 — No code references commission_percentage', () => {
  test('commission.ts does NOT reference commission_percentage', () => {
    const src = readSrc('src/lib/payment/commission.ts');
    // Strip comments first — comments may mention the token to explain it's forbidden.
    const codeOnly = stripComments(src);
    expect(codeOnly).not.toContain('commission_percentage');
  });

  test('PATCH endpoint does NOT reference commission_percentage', () => {
    const src = readSrc('src/app/api/admin/teachers/[id]/commission/route.ts');
    const codeOnly = stripComments(src);
    expect(codeOnly).not.toContain('commission_percentage');
  });

  test('GET admin/teachers route does NOT reference commission_percentage', () => {
    const src = readSrc('src/app/api/admin/teachers/route.ts');
    const codeOnly = stripComments(src);
    expect(codeOnly).not.toContain('commission_percentage');
  });

  test('GET admin/teachers/[id] route does NOT reference commission_percentage', () => {
    const src = readSrc('src/app/api/admin/teachers/[id]/route.ts');
    const codeOnly = stripComments(src);
    expect(codeOnly).not.toContain('commission_percentage');
  });

  test('admin-teachers-section.tsx does NOT reference commission_percentage', () => {
    const src = readSrc('src/components/admin/admin-teachers-section.tsx');
    const codeOnly = stripComments(src);
    expect(codeOnly).not.toContain('commission_percentage');
  });

  test('student/orders checkout does NOT reference commission_percentage', () => {
    const src = readSrc('src/app/api/student/orders/route.ts');
    const codeOnly = stripComments(src);
    expect(codeOnly).not.toContain('commission_percentage');
  });

  test('force-activate does NOT reference commission_percentage', () => {
    const src = readSrc('src/app/api/admin/orders/[id]/force-activate/route.ts');
    const codeOnly = stripComments(src);
    expect(codeOnly).not.toContain('commission_percentage');
  });

  test('backfill-financial-ledger does NOT reference commission_percentage', () => {
    const src = readSrc('src/app/api/admin/backfill-financial-ledger/route.ts');
    const codeOnly = stripComments(src);
    expect(codeOnly).not.toContain('commission_percentage');
  });

  test('verify-after-redirect does NOT reference commission_percentage', () => {
    const src = readSrc('src/app/api/student/orders/verify-after-redirect/route.ts');
    const codeOnly = stripComments(src);
    expect(codeOnly).not.toContain('commission_percentage');
  });

  test('teacher/subscriptions/activate does NOT reference commission_percentage', () => {
    const src = readSrc('src/app/api/teacher/subscriptions/activate/route.ts');
    const codeOnly = stripComments(src);
    expect(codeOnly).not.toContain('commission_percentage');
  });

  test('v112 migration does NOT reference commission_percentage', () => {
    const sql = readSrc('supabase/migrations/v112_correct_per_teacher_commission.sql');
    const sqlCodeOnly = stripComments(sql);
    expect(sqlCodeOnly).not.toContain('commission_percentage');
  });
});

describe('v112 — Historical safety invariants', () => {
  test('No code path UPDATEs financial_ledger after creation', () => {
    const files = [
      'src/app/api/admin/orders/[id]/force-activate/route.ts',
      'src/app/api/admin/backfill-financial-ledger/route.ts',
      'src/app/api/student/orders/verify-after-redirect/route.ts',
      'src/app/api/teacher/subscriptions/activate/route.ts',
      'src/app/api/admin/teachers/[id]/commission/route.ts',
      'src/app/api/student/orders/route.ts',
    ];
    for (const rel of files) {
      const src = readSrc(rel);
      const codeOnly = src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      expect(codeOnly).not.toMatch(/from\('financial_ledger'\)[\s\S]{0,300}\.update\(/);
    }
  });

  test('No code path UPDATEs order_fees after creation', () => {
    const files = [
      'src/app/api/admin/orders/[id]/force-activate/route.ts',
      'src/app/api/admin/backfill-financial-ledger/route.ts',
      'src/app/api/student/orders/verify-after-redirect/route.ts',
      'src/app/api/teacher/subscriptions/activate/route.ts',
      'src/app/api/admin/teachers/[id]/commission/route.ts',
      'src/app/api/student/orders/route.ts',
    ];
    for (const rel of files) {
      const src = readSrc(rel);
      const codeOnly = src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      expect(codeOnly).not.toMatch(/from\('order_fees'\)[\s\S]{0,300}\.update\(/);
    }
  });

  test('PATCH commission endpoint updates ONLY users (not financial_ledger / order_fees / orders)', () => {
    const src = readSrc('src/app/api/admin/teachers/[id]/commission/route.ts');
    const codeOnly = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(codeOnly).not.toMatch(/from\('financial_ledger'\)/);
    expect(codeOnly).not.toMatch(/from\('order_fees'\)/);
    expect(codeOnly).not.toMatch(/from\('orders'\)[\s\S]{0,300}\.update\(/);
  });
});

describe('v112 — Per-teacher rate semantics', () => {
  test('Two teachers with different rates produce different order_fees snapshots (via checkout override)', () => {
    // The checkout reads users.commission_rate per teacher and overrides
    // the in-memory platform_commission fee value BEFORE calculateFees().
    // So Teacher A (10%) and Teacher B (5%) produce different
    // calculated_amount values for their respective orders.
    const src = readSrc('src/app/api/student/orders/route.ts');
    expect(src).toMatch(/platformCommissionFee\.value\s*=\s*teacherCommissionRate/);
  });

  test('Changing a teacher rate does NOT modify existing orders (no UPDATE on orders)', () => {
    // The PATCH endpoint only updates users.commission_rate. Existing
    // orders + order_fees snapshots are immutable. Only NEW orders
    // created after the PATCH will use the new rate.
    const src = readSrc('src/app/api/admin/teachers/[id]/commission/route.ts');
    expect(src).not.toMatch(/from\('orders'\)/);
    expect(src).not.toMatch(/from\('order_fees'\)/);
  });

  test('NULL teacher rate uses the global fee_catalog value (no override applied)', () => {
    const src = readSrc('src/app/api/student/orders/route.ts');
    // The override is conditional: only when teacherCommissionRate is
    // not null. NULL → the in-memory feeRows keeps the global
    // platform_commission value from fee_catalog.
    expect(src).toMatch(/if\s*\(teacherCommissionRate !== null && teacherCommissionRate !== undefined\)/);
  });
});

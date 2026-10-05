// =====================================================
// v111 / v112 — Per-Teacher Commission Tests
// =====================================================
// Tests for the three v111 changes (preserved by v112):
//   1. Fix #1: student_count sourced from subject_students (approved)
//      in admin teachers list + detail routes.
//   2. Fix #2: per-teacher commission resolution helper +
//      migration v112 (canonical) + applied in all financial ledger
//      insert paths (force-activate, backfill, verify-after-redirect
//      x3, teacher subscriptions/activate verify-fallback).
//   3. Fix #3: PATCH /api/admin/teachers/[id]/commission endpoint +
//      editable column in Teacher Accounts list + modal display.
//
// v112 CORRECTIVE: the v111 migration committed in the repo used the
// wrong column name (`commission_percentage`). The deployed DB uses
// `users.commission_rate` (per the v88/v89/v94 architecture). v112 is
// the CANONICAL corrective migration. All TS code now references
// `commission_rate`. The committed v111 migration file is OBSOLETE
// and must NOT be run against the deployed DB.
//
// HISTORICAL SAFETY assertion:
//   - financial_ledger.commission_rate is a SNAPSHOT (per-row, taken
//     at payment time). Changes to users.commission_rate do NOT
//     modify any existing ledger row.
//   - The PATCH endpoint updates ONLY users.commission_rate.
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

// Walk src/ + supabase/migrations/ for `commission_percentage` references
// in ACTIVE CODE (comments stripped). Returns the list of files
// containing the forbidden token.
function findForbiddenCommissionPercentage(): string[] {
  const forbidden: string[] = [];
  const roots = ['src', 'supabase/migrations'];
  for (const root of roots) {
    walk(path.join(ROOT, root), (absPath) => {
      if (!absPath.endsWith('.ts') && !absPath.endsWith('.tsx') && !absPath.endsWith('.sql')) return;
      // Skip the v111 migration file itself — it's OBSOLETE but kept
      // in the repo for traceability. It WILL contain the forbidden
      // token. We assert its obsolescence separately.
      if (absPath.endsWith('v111_per_teacher_commission.sql')) return;
      // Skip this test file itself — it references the token in its
      // own assertions (negated).
      if (absPath.endsWith('v111-per-teacher-commission.test.ts')) return;
      if (absPath.endsWith('v112-correct-per-teacher-commission.test.ts')) return;
      const content = fs.readFileSync(absPath, 'utf8');
      // Strip comments first — comments may mention the token to
      // explain it's forbidden. Only ACTIVE CODE matters.
      const codeOnly = stripComments(content);
      if (codeOnly.includes('commission_percentage')) {
        forbidden.push(path.relative(ROOT, absPath));
      }
    });
  }
  return forbidden;
}

function walk(dir: string, visit: (absPath: string) => void): void {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const absPath = path.join(dir, e.name);
    if (e.isDirectory()) {
      walk(absPath, visit);
    } else if (e.isFile()) {
      visit(absPath);
    }
  }
}

// ──────────────────────────────────────────────────────────────
// v112 — Canonical corrective migration
// ──────────────────────────────────────────────────────────────
describe('v112 — Corrective migration file', () => {
  test('v112 migration file exists', () => {
    expect(fileExists('supabase/migrations/v112_correct_per_teacher_commission.sql')).toBe(true);
  });

  test('v112 adds users.commission_rate with 0-100 CHECK (NOT commission_percentage)', () => {
    const sql = readSrc('supabase/migrations/v112_correct_per_teacher_commission.sql');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS commission_rate');
    expect(sql).toContain('NUMERIC(5,2)');
    expect(sql).toMatch(/commission_rate >= 0 AND commission_rate <= 100/);
    // FORBIDDEN: the v112 migration must NOT introduce commission_percentage
    // (strip comments first — comments may mention the token to explain it's forbidden)
    const sqlCodeOnly = stripComments(sql);
    expect(sqlCodeOnly).not.toContain('commission_percentage');
  });

  test('v112 RPC uses v88 fees-on-top model (reads money split from order_fees)', () => {
    const sql = readSrc('supabase/migrations/v112_correct_per_teacher_commission.sql');
    // Reads from order_fees snapshot
    expect(sql).toContain('SELECT code, name_ar, name_en, fee_kind, value, base_amount, calculated_amount');
    expect(sql).toContain('FROM public.order_fees WHERE order_id = p_order_id');
    // Aggregates by category
    expect(sql).toContain("v_fee_row.code = 'platform_commission'");
    expect(sql).toMatch(/v_fee_row\.code LIKE 'tax%'/);
    // v88 split formulas
    expect(sql).toContain('v_platform_share := v_platform_commission_amt + v_tax_amount + v_other_fees_amount');
    expect(sql).toContain('v_teacher_share := v_subscription_total - v_platform_commission_amt');
    // v88 columns inserted into financial_ledger
    expect(sql).toContain('subscription_total, tax_amount, other_fees_amount, fees_breakdown');
  });

  test('v112 RPC looks up per-teacher rate first (commission_rate)', () => {
    const sql = readSrc('supabase/migrations/v112_correct_per_teacher_commission.sql');
    expect(sql).toContain('SELECT u.commission_rate INTO v_commission_rate');
    expect(sql).toContain('FROM public.users u');
    expect(sql).toContain('SELECT rate_percentage INTO v_commission_rate');
    expect(sql).toContain('FROM public.commission_rates');
    expect(sql).toContain('v_commission_rate := 0');
  });

  test('v112 RPC snapshots the resolved rate into financial_ledger.commission_rate', () => {
    const sql = readSrc('supabase/migrations/v112_correct_per_teacher_commission.sql');
    expect(sql).toContain('INSERT INTO public.financial_ledger');
    expect(sql).toContain('v_commission_rate');
  });

  test('v112 re-asserts v94 security posture (service_role-only)', () => {
    const sql = readSrc('supabase/migrations/v112_correct_per_teacher_commission.sql');
    expect(sql).toContain('REVOKE EXECUTE ON FUNCTION');
    expect(sql).toContain('FROM anon, authenticated');
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION');
    expect(sql).toContain('TO service_role');
  });

  test('v112 migration does NOT modify any existing financial_ledger row', () => {
    const sql = readSrc('supabase/migrations/v112_correct_per_teacher_commission.sql');
    expect(sql).not.toMatch(/UPDATE\s+public\.financial_ledger/);
    expect(sql).not.toMatch(/DELETE\s+FROM\s+public\.financial_ledger/);
  });

  test('v112 migration does NOT touch existing order_fees rows; orders only updated inside RPC body', () => {
    const sql = readSrc('supabase/migrations/v112_correct_per_teacher_commission.sql');
    // order_fees: no UPDATE/DELETE anywhere
    expect(sql).not.toMatch(/UPDATE\s+public\.order_fees/);
    expect(sql).not.toMatch(/DELETE\s+FROM\s+public\.order_fees/);
    // orders: no DELETE anywhere; no UPDATE in top-level migration
    // statements (only the RPC body has the standard
    // `UPDATE public.orders SET status='paid'` for activation).
    const beforeFunction = sql.split('CREATE OR REPLACE FUNCTION')[0];
    expect(beforeFunction).not.toMatch(/UPDATE\s+public\.orders/);
    expect(beforeFunction).not.toMatch(/DELETE\s+FROM\s+public\.orders/);
    expect(sql).not.toMatch(/DELETE\s+FROM\s+public\.orders/);
  });
});

// ──────────────────────────────────────────────────────────────
// v111 — Committed migration is OBSOLETE
// ──────────────────────────────────────────────────────────────
describe('v111 — Committed migration is OBSOLETE (replaced by v112)', () => {
  test('v111 migration file still exists (for traceability)', () => {
    expect(fileExists('supabase/migrations/v111_per_teacher_commission.sql')).toBe(true);
  });

  test('v111 migration uses the WRONG column name (commission_percentage) — superseded by v112', () => {
    // Documenting that v111 is obsolete. v112 is canonical.
    const sql = readSrc('supabase/migrations/v111_per_teacher_commission.sql');
    expect(sql).toContain('commission_percentage');
  });
});

// ──────────────────────────────────────────────────────────────
// Per-teacher commission resolver helper (v112-aligned)
// ──────────────────────────────────────────────────────────────
describe('v112 — Per-teacher commission resolver helper', () => {
  test('commission.ts helper file exists', () => {
    expect(fileExists('src/lib/payment/commission.ts')).toBe(true);
  });

  test('helper queries users.commission_rate (NOT commission_percentage)', () => {
    const src = readSrc('src/lib/payment/commission.ts');
    expect(src).toContain("from('users')");
    expect(src).toContain("'commission_rate'");
    // FORBIDDEN: the helper must NOT reference commission_percentage
    expect(stripComments(src)).not.toContain('commission_percentage');
  });

  test('falls back to commission_rates (global) when per-teacher is null', () => {
    const src = readSrc('src/lib/payment/commission.ts');
    expect(src).toContain("from('commission_rates')");
    expect(src).toContain("eq('is_active', true)");
  });

  test('returns 0 when neither per-teacher nor global rate exists', () => {
    const src = readSrc('src/lib/payment/commission.ts');
    expect(src).toContain('default_zero');
    expect(src).toMatch(/rate:\s*0/);
  });

  test('calculateSharesFromOrderFees helper exists (v88 model)', () => {
    const src = readSrc('src/lib/payment/commission.ts');
    expect(src).toContain('calculateSharesFromOrderFees');
    expect(src).toContain("from('order_fees')");
    // v88 split formulas
    expect(src).toMatch(/platformCommissionAmt \+ taxAmount \+ otherFeesAmount/);
    expect(src).toMatch(/subscriptionTotal - platformCommissionAmt/);
  });

  test('calculateSharesFromOrderFees throws OrderFeesSnapshotError on invalid v88 snapshot', () => {
    const src = readSrc('src/lib/payment/commission.ts');
    expect(src).toContain('OrderFeesSnapshotError');
    expect(src).toContain('order has base_amount (v88) but no order_fees snapshot rows');
  });

  test('calculateSharesFromOrderFees falls back to legacy for pre-v88 orders', () => {
    const src = readSrc('src/lib/payment/commission.ts');
    expect(src).toContain('Genuine pre-v88 order — use legacy split');
    expect(src).toContain('calculateShares(');
  });

  test('legacy calculateShares preserves platform + teacher = gross invariant', () => {
    const src = readSrc('src/lib/payment/commission.ts');
    expect(src).toMatch(/Math\.round\(grossAmount \* commissionRate\) \/ 100/);
    expect(src).toMatch(/teacherShare = grossAmount - platformShare/);
  });
});

// ──────────────────────────────────────────────────────────────
// Fix #1: Student count from subject_students
// ──────────────────────────────────────────────────────────────
describe('Fix #1: Student count from subject_students', () => {
  test('admin teachers LIST route counts from subject_students (NOT financial_ledger)', () => {
    const src = readSrc('src/app/api/admin/teachers/route.ts');
    expect(src).toContain("from('subject_students')");
    expect(src).toContain(".eq('status', 'approved')");
    expect(src).not.toMatch(/from\('financial_ledger'\)[\s\S]{0,200}student_id/);
  });

  test('admin teachers DETAIL route counts from subject_students', () => {
    const src = readSrc('src/app/api/admin/teachers/[id]/route.ts');
    expect(src).toContain("from('subject_students')");
    expect(src).toContain(".eq('status', 'approved')");
    expect(src).not.toMatch(/from\('financial_ledger'\)[\s\S]{0,150}student_id[\s\S]{0,150}status.*paid/);
  });

  test('admin teachers LIST route handles empty teacherIds (no .in() on empty array)', () => {
    const src = readSrc('src/app/api/admin/teachers/route.ts');
    expect(src).toContain('allSubjectIds.length === 0');
  });
});

// ──────────────────────────────────────────────────────────────
// Fix #2: All TS commission paths use the resolver helper + v88 split
// ──────────────────────────────────────────────────────────────
describe('Fix #2: All TS commission paths use v88 helper (calculateSharesFromOrderFees)', () => {
  const PATHS = [
    'src/app/api/admin/orders/[id]/force-activate/route.ts',
    'src/app/api/admin/backfill-financial-ledger/route.ts',
    'src/app/api/student/orders/verify-after-redirect/route.ts',
    'src/app/api/teacher/subscriptions/activate/route.ts',
  ];

  for (const rel of PATHS) {
    test(`${rel} imports the v88 commission helper`, () => {
      const src = readSrc(rel);
      expect(src).toContain("from '@/lib/payment/commission'");
      expect(src).toContain('getEffectiveCommissionRate');
      expect(src).toContain('calculateSharesFromOrderFees');
      expect(src).toContain('OrderFeesSnapshotError');
    });

    test(`${rel} does NOT use legacy calculateShares (only via the v88 helper)`, () => {
      const src = readSrc(rel);
      // The legacy calculateShares() is no longer called directly in
      // these paths — only via calculateSharesFromOrderFees() which
      // falls back to it internally for pre-v88 orders.
      expect(src).not.toMatch(/import.*\bcalculateShares\b/);
      expect(src).not.toMatch(/=\s*calculateShares\(/);
    });

    test(`${rel} does NOT reference commission_percentage`, () => {
      const src = readSrc(rel);
      expect(stripComments(src)).not.toContain('commission_percentage');
    });
  }

  test('verify-after-redirect uses the resolver in ALL THREE ledger-insert sites', () => {
    const src = readSrc('src/app/api/student/orders/verify-after-redirect/route.ts');
    const matches = src.match(/getEffectiveCommissionRate\(/g);
    expect(matches).toBeTruthy();
    expect(matches!.length).toBeGreaterThanOrEqual(3);
  });

  test('verify-after-redirect uses calculateSharesFromOrderFees in ALL THREE sites', () => {
    const src = readSrc('src/app/api/student/orders/verify-after-redirect/route.ts');
    const matches = src.match(/calculateSharesFromOrderFees\(/g);
    expect(matches).toBeTruthy();
    expect(matches!.length).toBeGreaterThanOrEqual(3);
  });
});

// ──────────────────────────────────────────────────────────────
// Fix #3: PATCH commission API + editable UI
// ──────────────────────────────────────────────────────────────
describe('Fix #3: PATCH commission API + editable UI', () => {
  test('PATCH /api/admin/teachers/[id]/commission endpoint file exists', () => {
    expect(fileExists('src/app/api/admin/teachers/[id]/commission/route.ts')).toBe(true);
  });

  test('PATCH endpoint validates commission_rate is 0-100 OR null', () => {
    const src = readSrc('src/app/api/admin/teachers/[id]/commission/route.ts');
    expect(src).toContain('z.union');
    expect(src).toContain('z.number().finite().min(0).max(100)');
    expect(src).toContain('z.null()');
    // Body schema field is commission_rate (NOT commission_percentage)
    expect(src).toMatch(/commission_rate:\s*z\.union/);
  });

  test('PATCH endpoint is admin-only (requireAdmin)', () => {
    const src = readSrc('src/app/api/admin/teachers/[id]/commission/route.ts');
    expect(src).toContain('requireAdmin');
    expect(src).toContain('authErrorResponse');
  });

  test('PATCH endpoint updates ONLY users.commission_rate', () => {
    const src = readSrc('src/app/api/admin/teachers/[id]/commission/route.ts');
    expect(src).toContain("from('users')");
    expect(src).toContain('commission_rate: roundedValue');
    // The endpoint must NOT update financial_ledger at all
    expect(src).not.toMatch(/from\('financial_ledger'\)[\s\S]{0,300}\.update\(/);
    expect(src).not.toContain('.rpc(');
  });

  test('PATCH endpoint rounds to 2 decimals (NUMERIC(5,2) precision)', () => {
    const src = readSrc('src/app/api/admin/teachers/[id]/commission/route.ts');
    expect(src).toMatch(/Math\.round\(newValue \* 100\) \/ 100/);
  });

  test('PATCH endpoint returns historical_note field', () => {
    const src = readSrc('src/app/api/admin/teachers/[id]/commission/route.ts');
    expect(src).toContain('historical_note');
  });

  test('PATCH endpoint does NOT reference commission_percentage', () => {
    const src = readSrc('src/app/api/admin/teachers/[id]/commission/route.ts');
    expect(stripComments(src)).not.toContain('commission_percentage');
  });

  test('GET /api/admin/teachers includes commission_rate in SELECT', () => {
    const src = readSrc('src/app/api/admin/teachers/route.ts');
    expect(src).toContain('commission_rate');
    expect(stripComments(src)).not.toContain('commission_percentage');
  });

  test('GET /api/admin/teachers/[id] includes commission_rate in SELECT', () => {
    const src = readSrc('src/app/api/admin/teachers/[id]/route.ts');
    expect(src).toContain('commission_rate');
    expect(stripComments(src)).not.toContain('commission_percentage');
  });

  test('TeacherRow interface includes commission_rate', () => {
    const src = readSrc('src/components/admin/admin-teachers-section.tsx');
    expect(src).toMatch(/commission_rate:\s*number \| null/);
    expect(stripComments(src)).not.toContain('commission_percentage');
  });

  test('Teacher Accounts list renders the commission column (header + cell)', () => {
    const src = readSrc('src/components/admin/admin-teachers-section.tsx');
    expect(src).toContain('العمولة %');
    expect(src).toContain('startEditCommission');
    expect(src).toContain('saveCommission');
    expect(src).toContain('cancelEditCommission');
  });

  test('UI save handler validates 0-100 client-side before PATCH', () => {
    const src = readSrc('src/components/admin/admin-teachers-section.tsx');
    expect(src).toMatch(/parsed < 0 || parsed > 100/);
  });

  test('UI PATCHes /api/admin/teachers/[id]/commission with commission_rate body field', () => {
    const src = readSrc('src/components/admin/admin-teachers-section.tsx');
    expect(src).toContain('/api/admin/teachers/${teacherId}/commission');
    expect(src).toContain('commission_rate: newValue');
  });

  test('Detail modal shows commission_rate (read-only display)', () => {
    const src = readSrc('src/components/admin/admin-teachers-section.tsx');
    expect(src).toContain('نسبة العمولة');
    expect(src).toContain('teacherDetail.teacher?.commission_rate');
  });
});

// ──────────────────────────────────────────────────────────────
// Checkout: per-teacher rate applied to order_fees snapshot
// ──────────────────────────────────────────────────────────────
describe('Fix #3 (checkout): per-teacher rate override at order creation', () => {
  test('checkout queries users.commission_rate for the subject teacher', () => {
    const src = readSrc('src/app/api/student/orders/route.ts');
    expect(src).toContain("from('users')");
    expect(src).toContain("'commission_rate'");
    expect(src).toContain('teacherCommissionRate');
  });

  test('checkout overrides the platform_commission fee value when teacher rate is set', () => {
    const src = readSrc('src/app/api/student/orders/route.ts');
    expect(src).toContain("f.code === 'platform_commission'");
    expect(src).toMatch(/platformCommissionFee\.value = teacherCommissionRate/);
  });

  test('checkout preserves global fee_catalog value when teacher rate is NULL', () => {
    const src = readSrc('src/app/api/student/orders/route.ts');
    // The override is conditional on `teacherCommissionRate !== null`
    expect(src).toMatch(/teacherCommissionRate !== null && teacherCommissionRate !== undefined/);
  });

  test('checkout does NOT reference commission_percentage', () => {
    const src = readSrc('src/app/api/student/orders/route.ts');
    expect(stripComments(src)).not.toContain('commission_percentage');
  });

  test('checkout does NOT modify existing orders (only inserts new ones)', () => {
    const src = readSrc('src/app/api/student/orders/route.ts');
    expect(src).not.toMatch(/from\('orders'\)[\s\S]{0,200}\.update\(/);
    expect(src).not.toMatch(/from\('order_fees'\)[\s\S]{0,200}\.update\(/);
  });
});

// ──────────────────────────────────────────────────────────────
// Historical safety invariants
// ──────────────────────────────────────────────────────────────
describe('Historical safety invariants', () => {
  test('financial_ledger.commission_rate is a SNAPSHOT column (v78 definition)', () => {
    const src = readSrc('supabase/migrations/v78_financial_ledger.sql');
    expect(src).toMatch(/commission_rate\s+NUMERIC\(5,2\)\s+NOT NULL/);
    expect(src).toMatch(/SNAPSHOT of the rate at payment time/);
  });

  test('v112 RPC uses ON CONFLICT (payment_id) DO NOTHING — idempotent ledger inserts', () => {
    const sql = readSrc('supabase/migrations/v112_correct_per_teacher_commission.sql');
    expect(sql).toContain('ON CONFLICT (payment_id) DO NOTHING');
  });

  test('No code path UPDATEs financial_ledger after creation', () => {
    const files = [
      'src/app/api/admin/orders/[id]/force-activate/route.ts',
      'src/app/api/admin/backfill-financial-ledger/route.ts',
      'src/app/api/student/orders/verify-after-redirect/route.ts',
      'src/app/api/teacher/subscriptions/activate/route.ts',
      'src/app/api/admin/teachers/[id]/commission/route.ts',
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
    ];
    for (const rel of files) {
      const src = readSrc(rel);
      const codeOnly = src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      expect(codeOnly).not.toMatch(/from\('order_fees'\)[\s\S]{0,300}\.update\(/);
    }
  });

  test('PATCH commission endpoint does NOT recalculate historical ledger rows', () => {
    const src = readSrc('src/app/api/admin/teachers/[id]/commission/route.ts');
    const codeOnly = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    // Must NOT touch financial_ledger at all
    expect(codeOnly).not.toMatch(/from\('financial_ledger'\)/);
    // Must NOT touch order_fees at all
    expect(codeOnly).not.toMatch(/from\('order_fees'\)/);
  });
});

// ──────────────────────────────────────────────────────────────
// Repository-wide forbidden-token check
// ──────────────────────────────────────────────────────────────
describe('Repository-wide forbidden token check', () => {
  test('NO active TS/SQL file references commission_percentage (except the obsolete v111 migration)', () => {
    const offenders = findForbiddenCommissionPercentage();
    if (offenders.length > 0) {
      console.error('Files containing commission_percentage:', offenders);
    }
    expect(offenders).toEqual([]);
  });
});

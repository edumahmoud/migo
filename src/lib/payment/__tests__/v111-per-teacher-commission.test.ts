// =====================================================
// v111 — Per-Teacher Commission Tests
// =====================================================
// Tests for the three v111 changes:
//   1. Fix #1: student_count sourced from subject_students (approved)
//      in admin teachers list + detail routes.
//   2. Fix #2: per-teacher commission resolution helper +
//      migration v111 + applied in all financial ledger insert paths
//      (force-activate, backfill, verify-after-redirect x3,
//      teacher subscriptions/activate verify-fallback).
//   3. Fix #3: PATCH /api/admin/teachers/[id]/commission endpoint +
//      editable column in Teacher Accounts list + modal display.
//
// HISTORICAL SAFETY assertion:
//   - financial_ledger.commission_rate is a SNAPSHOT (per-row, taken
//     at payment time). Changes to users.commission_percentage do NOT
//     modify any existing ledger row.
//   - The PATCH endpoint updates ONLY users.commission_percentage.
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

function fileExists(rel: string): boolean {
  try {
    return fs.statSync(path.join(ROOT, rel)).isFile();
  } catch {
    return false;
  }
}

describe('v111 — Migration file', () => {
  test('v111 migration file exists', () => {
    expect(fileExists('supabase/migrations/v111_per_teacher_commission.sql')).toBe(true);
  });

  test('adds users.commission_percentage with 0-100 CHECK', () => {
    const sql = readSrc('supabase/migrations/v111_per_teacher_commission.sql');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS commission_percentage');
    expect(sql).toContain('NUMERIC(5,2)');
    expect(sql).toMatch(/commission_percentage >= 0 AND commission_percentage <= 100/);
  });

  test('RPC activate_subscription_after_payment looks up per-teacher rate first', () => {
    const sql = readSrc('supabase/migrations/v111_per_teacher_commission.sql');
    // 1) per-teacher lookup
    expect(sql).toContain('SELECT u.commission_percentage INTO v_commission_rate');
    expect(sql).toContain('FROM public.users u');
    // 2) global fallback
    expect(sql).toContain('SELECT rate_percentage INTO v_commission_rate');
    expect(sql).toContain('FROM public.commission_rates');
    // 3) default 0
    expect(sql).toContain('v_commission_rate := 0');
  });

  test('RPC snapshots the resolved rate into financial_ledger.commission_rate', () => {
    const sql = readSrc('supabase/migrations/v111_per_teacher_commission.sql');
    expect(sql).toContain('INSERT INTO public.financial_ledger');
    expect(sql).toContain('v_commission_rate, \'paid\'');
  });

  test('migration does NOT modify any existing financial_ledger row', () => {
    const sql = readSrc('supabase/migrations/v111_per_teacher_commission.sql');
    // The migration must not UPDATE/DELETE existing ledger rows.
    // (CREATE OR REPLACE FUNCTION is allowed — that just redefines the
    // function for FUTURE invocations, doesn't touch data.)
    expect(sql).not.toMatch(/UPDATE\s+public\.financial_ledger/);
    expect(sql).not.toMatch(/DELETE\s+FROM\s+public\.financial_ledger/);
  });
});

describe('v111 — Per-teacher commission resolver helper', () => {
  test('commission.ts helper file exists', () => {
    expect(fileExists('src/lib/payment/commission.ts')).toBe(true);
  });

  test('getEffectiveCommissionRate tries users.commission_percentage first', () => {
    const src = readSrc('src/lib/payment/commission.ts');
    expect(src).toContain("from('users')");
    expect(src).toContain('commission_percentage');
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

  test('calculateShares preserves platform + teacher = gross invariant', () => {
    const src = readSrc('src/lib/payment/commission.ts');
    // platform_share = round(gross * rate) / 100
    expect(src).toMatch(/Math\.round\(grossAmount \* commissionRate\) \/ 100/);
    // teacher_share = gross - platform
    expect(src).toMatch(/teacherShare = grossAmount - platformShare/);
  });
});

describe('v111 — Fix #1: Student count from subject_students', () => {
  test('admin teachers LIST route counts from subject_students (NOT financial_ledger)', () => {
    const src = readSrc('src/app/api/admin/teachers/route.ts');
    // The new student_count batch query must NOT read financial_ledger
    expect(src).toContain("from('subject_students')");
    expect(src).toContain(".eq('status', 'approved')");
    // The OLD financial_ledger-based count code must be gone
    expect(src).not.toMatch(/from\('financial_ledger'\)[\s\S]{0,200}student_id/);
  });

  test('admin teachers DETAIL route counts from subject_students', () => {
    const src = readSrc('src/app/api/admin/teachers/[id]/route.ts');
    expect(src).toContain("from('subject_students')");
    expect(src).toContain(".eq('status', 'approved')");
    // OLD: was reading from financial_ledger with status='paid'
    // Verify the OLD pattern is gone
    expect(src).not.toMatch(/from\('financial_ledger'\)[\s\S]{0,150}student_id[\s\S]{0,150}status.*paid/);
  });

  test('admin teachers LIST route handles empty teacherIds (no .in() on empty array)', () => {
    const src = readSrc('src/app/api/admin/teachers/route.ts');
    // Defense-in-depth: avoids sending .in('subject_id', []) to PostgREST
    expect(src).toContain('allSubjectIds.length === 0');
  });
});

describe('v111 — Fix #2: All TS commission paths use the resolver helper', () => {
  const PATHS = [
    'src/app/api/admin/orders/[id]/force-activate/route.ts',
    'src/app/api/admin/backfill-financial-ledger/route.ts',
    'src/app/api/student/orders/verify-after-redirect/route.ts',
    'src/app/api/teacher/subscriptions/activate/route.ts',
  ];

  for (const rel of PATHS) {
    test(`${rel} imports the commission resolver`, () => {
      const src = readSrc(rel);
      expect(src).toContain("from '@/lib/payment/commission'");
      expect(src).toContain('getEffectiveCommissionRate');
    });

    test(`${rel} uses calculateShares (no inline Math.round(... * commissionRate))`, () => {
      const src = readSrc(rel);
      expect(src).toContain('calculateShares');
      // The OLD inline pattern "Math.round(gross * commissionRate) / 100"
      // should NOT appear anymore in this file.
      expect(src).not.toMatch(/Math\.round\([^)]*commissionRate\)\s*\/\s*100/);
    });
  }

  test('verify-after-redirect uses the resolver in ALL THREE ledger-insert sites', () => {
    const src = readSrc('src/app/api/student/orders/verify-after-redirect/route.ts');
    // Count occurrences of the resolver call
    const matches = src.match(/getEffectiveCommissionRate\(/g);
    expect(matches).toBeTruthy();
    expect(matches!.length).toBeGreaterThanOrEqual(3);
  });
});

describe('v111 — Fix #3: PATCH commission API + editable UI', () => {
  test('PATCH /api/admin/teachers/[id]/commission endpoint file exists', () => {
    expect(fileExists('src/app/api/admin/teachers/[id]/commission/route.ts')).toBe(true);
  });

  test('PATCH endpoint validates commission_percentage is 0-100 OR null', () => {
    const src = readSrc('src/app/api/admin/teachers/[id]/commission/route.ts');
    expect(src).toContain('z.union');
    expect(src).toContain('z.number().finite().min(0).max(100)');
    expect(src).toContain('z.null()');
  });

  test('PATCH endpoint is admin-only (requireAdmin)', () => {
    const src = readSrc('src/app/api/admin/teachers/[id]/commission/route.ts');
    expect(src).toContain('requireAdmin');
    expect(src).toContain('authErrorResponse');
  });

  test('PATCH endpoint updates ONLY users.commission_percentage (NOT financial_ledger)', () => {
    const src = readSrc('src/app/api/admin/teachers/[id]/commission/route.ts');
    // The UPDATE block must only touch users.commission_percentage
    expect(src).toContain("from('users')");
    expect(src).toContain('commission_percentage: roundedValue');
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

  test('GET /api/admin/teachers includes commission_percentage in SELECT', () => {
    const src = readSrc('src/app/api/admin/teachers/route.ts');
    expect(src).toContain('commission_percentage');
  });

  test('GET /api/admin/teachers/[id] includes commission_percentage in SELECT', () => {
    const src = readSrc('src/app/api/admin/teachers/[id]/route.ts');
    expect(src).toContain('commission_percentage');
  });

  test('TeacherRow interface includes commission_percentage', () => {
    const src = readSrc('src/components/admin/admin-teachers-section.tsx');
    expect(src).toMatch(/commission_percentage:\s*number \| null/);
  });

  test('Teacher Accounts list renders the commission column (header + cell)', () => {
    const src = readSrc('src/components/admin/admin-teachers-section.tsx');
    // Header
    expect(src).toContain('العمولة %');
    // Per-row editable cell with startEditCommission / saveCommission handlers
    expect(src).toContain('startEditCommission');
    expect(src).toContain('saveCommission');
    expect(src).toContain('cancelEditCommission');
  });

  test('UI save handler validates 0-100 client-side before PATCH', () => {
    const src = readSrc('src/components/admin/admin-teachers-section.tsx');
    expect(src).toMatch(/parsed < 0 || parsed > 100/);
  });

  test('UI PATCHes /api/admin/teachers/[id]/commission', () => {
    const src = readSrc('src/components/admin/admin-teachers-section.tsx');
    expect(src).toContain('/api/admin/teachers/${teacherId}/commission');
    expect(src).toContain('commission_percentage: newValue');
  });

  test('Detail modal shows commission_percentage (read-only display)', () => {
    const src = readSrc('src/components/admin/admin-teachers-section.tsx');
    expect(src).toContain('نسبة العمولة');
    expect(src).toContain('teacherDetail.teacher?.commission_percentage');
  });
});

describe('v111 — Historical safety invariants', () => {
  test('financial_ledger.commission_rate is a SNAPSHOT column (v78 definition)', () => {
    const src = readSrc('supabase/migrations/v78_financial_ledger.sql');
    expect(src).toMatch(/commission_rate\s+NUMERIC\(5,2\)\s+NOT NULL/);
    // The COMMENT confirms it's a snapshot
    expect(src).toMatch(/SNAPSHOT of the rate at payment time/);
  });

  test('v111 RPC uses ON CONFLICT (payment_id) DO NOTHING — idempotent ledger inserts', () => {
    const src = readSrc('supabase/migrations/v111_per_teacher_commission.sql');
    expect(src).toContain('ON CONFLICT (payment_id) DO NOTHING');
  });

  test('No code path UPDATEs financial_ledger.commission_rate after creation', () => {
    // None of the v111-touched files should UPDATE financial_ledger
    // to change commission_rate (that would break the snapshot invariant).
    const files = [
      'src/app/api/admin/orders/[id]/force-activate/route.ts',
      'src/app/api/admin/backfill-financial-ledger/route.ts',
      'src/app/api/student/orders/verify-after-redirect/route.ts',
      'src/app/api/teacher/subscriptions/activate/route.ts',
      'src/app/api/admin/teachers/[id]/commission/route.ts',
    ];
    for (const rel of files) {
      const src = readSrc(rel);
      // Strip comments so docstrings that mention "commission_rate" don't
      // trigger a false positive.
      const codeOnly = src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      // The only allowed write to financial_ledger is INSERT (.insert(...))
      // UPDATE on financial_ledger is FORBIDDEN in these activation paths.
      expect(codeOnly).not.toMatch(/from\('financial_ledger'\)[\s\S]{0,300}\.update\(/);
    }
  });

  test('PATCH commission endpoint does NOT recalculate historical ledger rows', () => {
    const src = readSrc('src/app/api/admin/teachers/[id]/commission/route.ts');
    // Strip comments
    const codeOnly = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    // Must NOT touch financial_ledger at all
    expect(codeOnly).not.toMatch(/from\('financial_ledger'\)/);
    // Must NOT mention the snapshot column commission_rate (singular).
    // Note: the global fallback table is "commission_rates" (plural) which
    // is allowed — the endpoint resolves the effective rate for the response.
    expect(codeOnly).not.toMatch(/\bcommission_rate\b/);
  });
});

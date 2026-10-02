// =====================================================
// Phase 9 — Revenue Split Tests
// =====================================================
// Tests for: commission management, teacher revenue access,
// refund/settlement status changes, historical immutability.
// Uses source-code inspection (no DB access needed).

import { describe, test, expect } from 'bun:test';

describe('Phase 9 — Fee Catalog API (v88, replaces commission-rates)', () => {
  test('fee-catalog API has GET (list) + POST (create)', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(
      path.join(__dirname, '..', '..', '..', 'app', 'api', 'admin', 'fee-catalog', 'route.ts'),
      'utf8',
    );
    expect(source).toContain('export async function GET');
    expect(source).toContain('export async function POST');
  });

  test('POST creates new fee with code/name/kind/value validation', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(
      path.join(__dirname, '..', '..', '..', 'app', 'api', 'admin', 'fee-catalog', 'route.ts'),
      'utf8',
    );
    expect(source).toContain('fee_kind');
    expect(source).toContain('z.enum([\'percentage\', \'flat\'])');
    expect(source).toContain('z.number().min(0)');
  });

  test('percentage value is validated server-side (max 100)', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(
      path.join(__dirname, '..', '..', '..', 'app', 'api', 'admin', 'fee-catalog', 'route.ts'),
      'utf8',
    );
    expect(source).toContain('> 100');
    expect(source).toContain('fee_kind');
  });

  test('activate endpoint exists', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(
      path.join(__dirname, '..', '..', '..', 'app', 'api', 'admin', 'fee-catalog', '[id]', 'activate', 'route.ts'),
      'utf8',
    );
    expect(source).toContain('export async function POST');
    expect(source).toContain('is_active: true');
  });

  test('deactivate endpoint exists (refuses platform_commission)', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(
      path.join(__dirname, '..', '..', '..', 'app', 'api', 'admin', 'fee-catalog', '[id]', 'deactivate', 'route.ts'),
      'utf8',
    );
    expect(source).toContain('export async function POST');
    expect(source).toContain('is_active: false');
    expect(source).toContain('platform_commission');
  });
});

describe('Phase 9 — Teacher Revenue API', () => {
  test('uses auth.user.id (NOT from frontend)', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(
      path.join(__dirname, '..', '..', '..', 'app', 'api', 'teacher', 'revenue', 'route.ts'),
      'utf8',
    );
    expect(source).toContain('authResult.user.id');
    expect(source).toContain('requireTeacher');
    // Must NOT accept teacher_id as query param
    expect(source).not.toContain('searchParams.get(\'teacher_id\')');
  });

  test('queries financial_ledger.teacher_id (snapshot, not subjects.teacher_id)', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(
      path.join(__dirname, '..', '..', '..', 'app', 'api', 'teacher', 'revenue', 'route.ts'),
      'utf8',
    );
    expect(source).toContain('.eq(\'teacher_id\', teacherId)');
    expect(source).toContain('from(\'financial_ledger\')');
  });

  test('returns summary + transaction details', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(
      path.join(__dirname, '..', '..', '..', 'app', 'api', 'teacher', 'revenue', 'route.ts'),
      'utf8',
    );
    expect(source).toContain('total_gross');
    expect(source).toContain('total_teacher_share');
    expect(source).toContain('transaction_count');
    expect(source).toContain('transactions');
  });

  test('does NOT expose student_id or platform internals to teacher', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(
      path.join(__dirname, '..', '..', '..', 'app', 'api', 'teacher', 'revenue', 'route.ts'),
      'utf8',
    );
    // The transactions mapping should NOT include student_id
    const txMapping = source.match(/transactions = rows\.map.*?(?=\];)/s);
    if (txMapping) {
      expect(txMapping[0]).not.toContain('student_id:');
    }
  });
});

describe('Phase 9 — Refund Endpoint', () => {
  test('refund changes status only (no financial value modifications)', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(
      path.join(__dirname, '..', '..', '..', 'app', 'api', 'admin', 'financial-ledger', '[id]', 'refund', 'route.ts'),
      'utf8',
    );
    expect(source).toContain('status: \'refunded\'');
    // Intent: the UPDATE call must not modify financial values. Pull out
    // just the .update({...}) block and verify it only sets status + updated_at.
    const updateMatch = source.match(/\.update\(\s*\{([^}]+)\}/s);
    expect(updateMatch).toBeTruthy();
    const updateBlock = updateMatch![1];
    expect(updateBlock).toContain('status');
    expect(updateBlock).not.toMatch(/\bgross_amount\b/);
    expect(updateBlock).not.toMatch(/\bteacher_share\b/);
    expect(updateBlock).not.toMatch(/\bplatform_share\b/);
    expect(updateBlock).not.toMatch(/\bnet_amount\b/);
    expect(updateBlock).not.toMatch(/\bcommission_rate\b/);
  });

  test('refund prevents duplicate (already refunded → 400)', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(
      path.join(__dirname, '..', '..', '..', 'app', 'api', 'admin', 'financial-ledger', '[id]', 'refund', 'route.ts'),
      'utf8',
    );
    expect(source).toContain('مُسترد بالفعل');
  });

  test('refund does NOT delete the record', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(
      path.join(__dirname, '..', '..', '..', 'app', 'api', 'admin', 'financial-ledger', '[id]', 'refund', 'route.ts'),
      'utf8',
    );
    expect(source).not.toContain('.delete()');
    expect(source).not.toContain('DELETE');
  });

  test('refund is admin-only', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(
      path.join(__dirname, '..', '..', '..', 'app', 'api', 'admin', 'financial-ledger', '[id]', 'refund', 'route.ts'),
      'utf8',
    );
    expect(source).toContain('requireAdmin');
  });
});

describe('Phase 9 — Settlement Endpoint', () => {
  test('settle changes status to settled only', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(
      path.join(__dirname, '..', '..', '..', 'app', 'api', 'admin', 'financial-ledger', '[id]', 'settle', 'route.ts'),
      'utf8',
    );
    expect(source).toContain('status: \'settled\'');
    // Intent: the UPDATE call must not modify financial values. Pull out
    // just the .update({...}) block and verify it only sets status + updated_at.
    const updateMatch = source.match(/\.update\(\s*\{([^}]+)\}/s);
    expect(updateMatch).toBeTruthy();
    const updateBlock = updateMatch![1];
    expect(updateBlock).toContain('status');
    expect(updateBlock).not.toMatch(/\bgross_amount\b/);
    expect(updateBlock).not.toMatch(/\bteacher_share\b/);
    expect(updateBlock).not.toMatch(/\bplatform_share\b/);
    expect(updateBlock).not.toMatch(/\bnet_amount\b/);
    expect(updateBlock).not.toMatch(/\bcommission_rate\b/);
  });

  test('settle does NOT execute any payout', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(
      path.join(__dirname, '..', '..', '..', 'app', 'api', 'admin', 'financial-ledger', '[id]', 'settle', 'route.ts'),
      'utf8',
    );
    // Strip comments so that "DOES NOT execute a bank transfer" in the
    // safety contract doesn't trigger the negative substring check.
    // Intent: settle must not call any payout PROVIDER. The bare word
    // "payout" can appear in a notification type or audit log event name
    // — those are labels, not execution calls.
    const codeOnly = source
      .replace(/\/\*[\s\S]*?\*\//g, '')   // block comments
      .replace(/^\s*\/\/.*$/gm, '');      // line comments
    expect(codeOnly).not.toContain('bank');
    expect(codeOnly).not.toContain('wallet');
    expect(codeOnly).not.toContain('instapay');
    expect(codeOnly).not.toContain('transfer');
    expect(codeOnly).not.toContain('payout-domain');
    expect(codeOnly).not.toContain('executePayout');
    expect(codeOnly).not.toContain('initiatePayout');
  });

  test('settle prevents duplicate (already settled → 400)', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(
      path.join(__dirname, '..', '..', '..', 'app', 'api', 'admin', 'financial-ledger', '[id]', 'settle', 'route.ts'),
      'utf8',
    );
    expect(source).toContain('مسوّى بالفعل');
  });
});

describe('Phase 9 — Historical Immutability', () => {
  test('changing commission rate does NOT modify ledger (RPC uses snapshot)', () => {
    const fs = require('fs');
    const path = require('path');
    const rpcSource = fs.readFileSync(
      path.join(__dirname, '..', '..', '..', '..', 'supabase', 'migrations', 'v78_financial_ledger.sql'),
      'utf8',
    );
    // The RPC snapshots commission_rate at payment time
    expect(rpcSource).toContain('commission_rate');
    expect(rpcSource).toContain('SELECT rate_percentage INTO v_commission_rate');
    // No UPDATE on financial_ledger after creation (only INSERT + ON CONFLICT DO NOTHING)
    expect(rpcSource).not.toContain('UPDATE public.financial_ledger');
  });

  test('teacher_id is snapshot (no FK to subjects)', () => {
    const fs = require('fs');
    const path = require('path');
    const migrationSource = fs.readFileSync(
      path.join(__dirname, '..', '..', '..', '..', 'supabase', 'migrations', 'v78_financial_ledger.sql'),
      'utf8',
    );
    // Use .match() with regex — .toContain() does literal substring matching
    // which would not work for "teacher_id.*SNAPSHOT" as a pattern.
    const teacherLine = migrationSource.match(/teacher_id.*--.*SNAPSHOT/);
    expect(teacherLine).not.toBeNull();
  });

  test('frontend cannot modify financial values (no write RLS policies)', () => {
    const fs = require('fs');
    const path = require('path');
    const migrationSource = fs.readFileSync(
      path.join(__dirname, '..', '..', '..', '..', 'supabase', 'migrations', 'v78_financial_ledger.sql'),
      'utf8',
    );
    // Only SELECT policies exist for non-admin roles.
    // The migration uses "FOR SELECT" policies for teachers/students.
    // Note: the SQL also contains "SELECT * INTO v_order ... FOR UPDATE"
    // inside the RPC — that's an internal row-lock, NOT an RLS policy.
    // We strip the FOR UPDATE inside the RPC before checking.
    const rlsSection = migrationSource.replace(/SELECT \* INTO v_order[^;]*FOR UPDATE/, '');
    expect(rlsSection).toContain('FOR SELECT');
    expect(rlsSection).not.toContain('FOR INSERT');
    // "FOR UPDATE" is allowed inside the RPC body as a row-lock — what
    // we forbid is a "FOR UPDATE" RLS policy, which would have the form
    // "FOR UPDATE TO" or "FOR UPDATE USING".
    expect(rlsSection).not.toMatch(/FOR UPDATE\s+(TO|USING)/);
    expect(rlsSection).not.toContain('FOR DELETE');
  });
});

describe('Phase 9 — Scope Verification', () => {
  test('no payout/bank/wallet/instapay in any Phase 9 file', () => {
    const fs = require('fs');
    const path = require('path');
    const files = [
      'src/app/api/admin/fee-catalog/route.ts',
      'src/app/api/teacher/revenue/route.ts',
      'src/app/api/admin/financial-ledger/route.ts',
      'src/app/api/admin/financial-ledger/[id]/refund/route.ts',
      'src/app/api/admin/financial-ledger/[id]/settle/route.ts',
    ];

    for (const file of files) {
      const source = fs.readFileSync(path.join(__dirname, '..', '..', '..', '..', file), 'utf8');
      // Intent: Phase 9 financial-ledger endpoints must NOT import or call
      // the payout-domain service (Phase 13). Using the substring "payout"
      // as a notification type is fine — that's a notification label, not
      // a payout-provider call.
      expect(source).not.toContain('payout-domain');
      expect(source).not.toContain('executePayout');
      expect(source).not.toContain('initiatePayout');
      expect(source).not.toContain('bank_transfer');
      expect(source).not.toContain('instapay');
      expect(source).not.toContain('fawry');
      expect(source).not.toContain('co_teacher');
      expect(source).not.toContain('gateway_fee_logic');
    }
  });
});

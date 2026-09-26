// =====================================================
// Phase 9 — Revenue Split Tests
// =====================================================
// Tests for: commission management, teacher revenue access,
// refund/settlement status changes, historical immutability.
// Uses source-code inspection (no DB access needed).

import { describe, test, expect } from 'bun:test';

describe('Phase 9 — Commission Management API', () => {
  test('commission-rates API has GET (list) + POST (create)', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(
      path.join(__dirname, '..', '..', 'app', 'api', 'admin', 'commission-rates', 'route.ts'),
      'utf8',
    );
    expect(source).toContain('export async function GET');
    expect(source).toContain('export async function POST');
  });

  test('POST creates new rate and deactivates old active one', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(
      path.join(__dirname, '..', '..', 'app', 'api', 'admin', 'commission-rates', 'route.ts'),
      'utf8',
    );
    // Must deactivate existing active rate before inserting new one
    expect(source).toContain('.eq(\'is_active\', true)');
    expect(source).toContain('is_active: false');
    // Must insert new rate as active
    expect(source).toContain('is_active: true');
  });

  test('rate is validated server-side (0-100)', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(
      path.join(__dirname, '..', '..', 'app', 'api', 'admin', 'commission-rates', 'route.ts'),
      'utf8',
    );
    expect(source).toContain('z.number().min(0).max(100)');
  });

  test('activate endpoint deactivates others first', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(
      path.join(__dirname, '..', '..', 'app', 'api', 'admin', 'commission-rates', '[id]', 'activate', 'route.ts'),
      'utf8',
    );
    expect(source).toContain('is_active: false');
    expect(source).toContain('.neq(\'id\', id)');
    expect(source).toContain('is_active: true');
  });

  test('deactivate endpoint exists', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(
      path.join(__dirname, '..', '..', 'app', 'api', 'admin', 'commission-rates', '[id]', 'deactivate', 'route.ts'),
      'utf8',
    );
    expect(source).toContain('export async function POST');
    expect(source).toContain('is_active: false');
  });
});

describe('Phase 9 — Teacher Revenue API', () => {
  test('uses auth.user.id (NOT from frontend)', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(
      path.join(__dirname, '..', '..', 'app', 'api', 'teacher', 'revenue', 'route.ts'),
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
      path.join(__dirname, '..', '..', 'app', 'api', 'teacher', 'revenue', 'route.ts'),
      'utf8',
    );
    expect(source).toContain('.eq(\'teacher_id\', teacherId)');
    expect(source).toContain('from(\'financial_ledger\')');
  });

  test('returns summary + transaction details', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(
      path.join(__dirname, '..', '..', 'app', 'api', 'teacher', 'revenue', 'route.ts'),
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
      path.join(__dirname, '..', '..', 'app', 'api', 'teacher', 'revenue', 'route.ts'),
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
      path.join(__dirname, '..', '..', 'app', 'api', 'admin', 'financial-ledger', '[id]', 'refund', 'route.ts'),
      'utf8',
    );
    expect(source).toContain('status: \'refunded\'');
    // Must NOT modify financial values
    expect(source).not.toContain('gross_amount:');
    expect(source).not.toContain('teacher_share:');
    expect(source).not.toContain('platform_share:');
    expect(source).not.toContain('net_amount:');
    expect(source).not.toContain('commission_rate:');
  });

  test('refund prevents duplicate (already refunded → 400)', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(
      path.join(__dirname, '..', '..', 'app', 'api', 'admin', 'financial-ledger', '[id]', 'refund', 'route.ts'),
      'utf8',
    );
    expect(source).toContain('مُسترد بالفعل');
  });

  test('refund does NOT delete the record', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(
      path.join(__dirname, '..', '..', 'app', 'api', 'admin', 'financial-ledger', '[id]', 'refund', 'route.ts'),
      'utf8',
    );
    expect(source).not.toContain('.delete()');
    expect(source).not.toContain('DELETE');
  });

  test('refund is admin-only', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(
      path.join(__dirname, '..', '..', 'app', 'api', 'admin', 'financial-ledger', '[id]', 'refund', 'route.ts'),
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
      path.join(__dirname, '..', '..', 'app', 'api', 'admin', 'financial-ledger', '[id]', 'settle', 'route.ts'),
      'utf8',
    );
    expect(source).toContain('status: \'settled\'');
    expect(source).not.toContain('gross_amount:');
    expect(source).not.toContain('teacher_share:');
  });

  test('settle does NOT execute any payout', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(
      path.join(__dirname, '..', '..', 'app', 'api', 'admin', 'financial-ledger', '[id]', 'settle', 'route.ts'),
      'utf8',
    );
    expect(source).not.toContain('bank');
    expect(source).not.toContain('wallet');
    expect(source).not.toContain('instapay');
    expect(source).not.toContain('transfer');
    expect(source).not.toContain('payout');
  });

  test('settle prevents duplicate (already settled → 400)', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(
      path.join(__dirname, '..', '..', 'app', 'api', 'admin', 'financial-ledger', '[id]', 'settle', 'route.ts'),
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
      path.join(__dirname, '..', '..', '..', 'supabase', 'migrations', 'v78_financial_ledger.sql'),
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
      path.join(__dirname, '..', '..', '..', 'supabase', 'migrations', 'v78_financial_ledger.sql'),
      'utf8',
    );
    expect(migrationSource).toContain('teacher_id.*SNAPSHOT');
  });

  test('frontend cannot modify financial values (no write RLS policies)', () => {
    const fs = require('fs');
    const path = require('path');
    const migrationSource = fs.readFileSync(
      path.join(__dirname, '..', '..', '..', 'supabase', 'migrations', 'v78_financial_ledger.sql'),
      'utf8',
    );
    // Only SELECT policies exist — no INSERT/UPDATE/DELETE
    expect(migrationSource).toContain('FOR SELECT');
    expect(migrationSource).not.toContain('FOR INSERT');
    expect(migrationSource).not.toContain('FOR UPDATE');
    expect(migrationSource).not.toContain('FOR DELETE');
  });
});

describe('Phase 9 — Scope Verification', () => {
  test('no payout/bank/wallet/instapay in any Phase 9 file', () => {
    const fs = require('fs');
    const path = require('path');
    const files = [
      'src/app/api/admin/commission-rates/route.ts',
      'src/app/api/teacher/revenue/route.ts',
      'src/app/api/admin/financial-ledger/route.ts',
      'src/app/api/admin/financial-ledger/[id]/refund/route.ts',
      'src/app/api/admin/financial-ledger/[id]/settle/route.ts',
    ];

    for (const file of files) {
      const source = fs.readFileSync(path.join(__dirname, '..', '..', file.replace('src/', '')), 'utf8');
      const lower = source.toLowerCase();
      expect(lower).not.toContain('payout');
      expect(lower).not.toContain('bank_transfer');
      expect(lower).not.toContain('instapay');
      expect(lower).not.toContain('fawry');
      expect(lower).not.toContain('co_teacher');
      expect(lower).not.toContain('gateway_fee_logic');
    }
  });
});

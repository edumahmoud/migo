import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helpers';
import { escapePostgrestIlike } from '@/lib/api-security';

/**
 * GET /api/admin/teachers/[id]/transactions
 *
 * Returns ALL settlement/payout transactions for a specific teacher.
 * Includes:
 *   - teacher_payouts rows (manual settlements + system payouts)
 *   - linked financial_ledger entries per payout
 *   - audit log events
 *
 * Each transaction has a code (from internal_reference or provider_reference).
 *
 * Also supports search by teacher code OR email via query param:
 *   GET /api/admin/teachers/[id]/transactions?search=email_or_code
 *
 * If 'search' is provided, the endpoint first looks up the teacher by
 * email or teacher_code, then returns their transactions.
 */

interface RouteContext { params: Promise<{ id: string }> }

export async function GET(request: NextRequest, ctx: RouteContext) {
  const auth = await requireAdmin(request);
  if (!auth.success) return authErrorResponse(auth);

  let { id: teacherId } = await ctx.params;

  // Support search by email or teacher_code
  const search = request.nextUrl.searchParams.get('search')?.trim();
  if (search) {
    // Escape ALL PostgREST metachars (not just `%` and `_`) to prevent
    // predicate-injection via `,()` and `.` which PostgREST uses as
    // predicate/field separators.
    const safeSearch = escapePostgrestIlike(search);
    const { data: teacher } = await supabaseServer
      .from('users')
      .select('id, email, name, teacher_code')
      .or(`email.ilike.%${safeSearch}%,teacher_code.ilike.%${safeSearch}%`)
      .eq('role', 'teacher')
      .maybeSingle();

    if (teacher) {
      teacherId = (teacher as { id: string }).id;
    } else {
      return NextResponse.json({
        success: false,
        error: 'لم يتم العثور على معلم بهذا البريد أو الكود',
      }, { status: 404 });
    }
  }

  // 1. Fetch all payouts for this teacher
  const { data: payouts, error: payoutsErr } = await supabaseServer
    .from('teacher_payouts')
    .select(`
      id, teacher_id, payout_method_type, payout_method_display_label,
      payout_method_masked, amount, currency, status,
      internal_reference, provider_reference, failure_reason,
      initiated_by, initiated_at, executed_at, created_at
    `)
    .eq('teacher_id', teacherId)
    .order('created_at', { ascending: false })
    .limit(100);

  if (payoutsErr) {
    return NextResponse.json({ success: false, error: 'تعذّر جلب المعاملات' }, { status: 500 });
  }

  // 2. For each payout, fetch linked ledger entries
  const payoutIds = (payouts ?? []).map((p: { id: string }) => p.id);
  let linkedEntries: Array<Record<string, unknown>> = [];
  if (payoutIds.length > 0) {
    const { data: entries } = await supabaseServer
      .from('teacher_payout_ledger_entries')
      .select(`
        payout_id, ledger_id, amount_settled, currency, settled_at,
        ledger:financial_ledger!inner (
          id, order_id, student_id, subject_id,
          gross_amount, teacher_share, platform_share,
          commission_rate, status, created_at
        )
      `)
      .in('payout_id', payoutIds);
    linkedEntries = (entries ?? []) as Array<Record<string, unknown>>;
  }

  // 3. Fetch audit logs
  let auditLogs: Array<Record<string, unknown>> = [];
  if (payoutIds.length > 0) {
    const { data: logs } = await supabaseServer
      .from('teacher_payout_audit_log')
      .select('payout_id, event, actor_id, details, created_at')
      .in('payout_id', payoutIds)
      .order('created_at', { ascending: false });
    auditLogs = (logs ?? []) as Array<Record<string, unknown>>;
  }

  // 4. Build the response — merge payouts + linked entries
  const transactions = (payouts ?? []).map((p: {
    id: string; teacher_id: string; payout_method_type: string;
    payout_method_display_label: string; payout_method_masked: string;
    amount: number; currency: string; status: string;
    internal_reference: string; provider_reference: string | null;
    failure_reason: string | null; initiated_by: string;
    initiated_at: string; executed_at: string | null; created_at: string;
  }) => {
    // Find linked entries for this payout
    const entries = linkedEntries.filter(
      (e) => (e.payout_id as string) === p.id
    );

    // Find audit logs for this payout
    const logs = auditLogs.filter(
      (l) => (l.payout_id as string) === p.id
    );

    // Generate transaction code
    const txCode = p.provider_reference || p.internal_reference || `TX-${p.id.slice(0, 8).toUpperCase()}`;

    // Status label (Arabic)
    const statusLabel: Record<string, string> = {
      pending: 'معلّق',
      processing: 'قيد المعالجة',
      completed: 'مكتمل',
      failed: 'فشل',
      cancelled: 'ملغي',
    };

    return {
      id: p.id,
      transaction_code: txCode,
      amount: Number(p.amount),
      currency: p.currency,
      status: p.status,
      status_label: statusLabel[p.status] ?? p.status,
      method_type: p.payout_method_type,
      method_label: p.payout_method_display_label,
      method_masked: p.payout_method_masked,
      initiated_at: p.initiated_at,
      executed_at: p.executed_at,
      created_at: p.created_at,
      failure_reason: p.failure_reason,
      linked_entries: entries.map((e) => ({
        ledger_id: (e.ledger as Record<string, unknown> | null)?.id ?? e.ledger_id,
        amount_settled: Number(e.amount_settled),
        currency: e.currency,
        settled_at: e.settled_at,
        order_id: (e.ledger as Record<string, unknown> | null)?.order_id,
        student_id: (e.ledger as Record<string, unknown> | null)?.student_id,
        subject_id: (e.ledger as Record<string, unknown> | null)?.subject_id,
        gross_amount: Number((e.ledger as Record<string, unknown> | null)?.gross_amount ?? 0),
        teacher_share: Number((e.ledger as Record<string, unknown> | null)?.teacher_share ?? 0),
      })),
      audit_logs: logs.map((l) => ({
        event: l.event,
        actor_id: l.actor_id,
        details: l.details,
        created_at: l.created_at,
      })),
    };
  });

  // 5. Get teacher info
  const { data: teacherInfo } = await supabaseServer
    .from('users')
    .select('id, name, email, teacher_code')
    .eq('id', teacherId)
    .maybeSingle();

  return NextResponse.json({
    success: true,
    teacher: teacherInfo as { id: string; name: string | null; email: string; teacher_code: string | null } | null,
    transactions,
    count: transactions.length,
  });
}

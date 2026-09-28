import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helpers';

/**
 * GET /api/admin/teachers/[id]
 *
 * Returns detailed info for a single teacher:
 *   - Account info (id, name, email, phone, account_status, created_at)
 *   - Payout methods (masked — no encrypted details exposed)
 *   - Financial summary (total revenue, settled, pending from financial_ledger)
 *   - Recent financial transactions (paginated, last 10)
 *
 * Authorization: requireAdmin.
 * Sensitive data masking: payout method details_encrypted is NEVER returned.
 *   Only `details_masked` (last4 + card_brand / wallet_number / etc.) is returned.
 */
interface RouteContext { params: Promise<{ id: string }> }

export async function GET(request: NextRequest, ctx: RouteContext) {
  const auth = await requireAdmin(request);
  if (!auth.success) return authErrorResponse(auth);

  const { id: teacherId } = await ctx.params;

  // 1. Fetch teacher account info
  const { data: teacher, error: teacherErr } = await supabaseServer
    .from('users')
    .select('id, name, email, phone, account_status, created_at')
    .eq('id', teacherId)
    .eq('role', 'teacher')
    .maybeSingle();

  if (teacherErr || !teacher) {
    return NextResponse.json(
      { success: false, error: 'المعلم غير موجود' },
      { status: 404 },
    );
  }

  // 2. Fetch payout methods (masked only — NEVER expose encrypted details)
  //    Only show ACTIVE methods to the admin (disabled methods are not
  //    usable for transfers — no need to clutter the admin view).
  const { data: payoutMethods } = await supabaseServer
    .from('teacher_payout_methods')
    .select('id, method_type, display_label, details_masked, is_active, is_default, verified_at, verified_by, created_at, updated_at')
    .eq('teacher_id', teacherId)
    .eq('is_active', true)  // Only active methods
    .order('created_at', { ascending: false });

  // 3. Fetch financial summary from financial_ledger
  const { data: ledgerSummary } = await supabaseServer
    .from('financial_ledger')
    .select('teacher_share, status, currency')
    .eq('teacher_id', teacherId);

  // Aggregate the summary
  const summary = {
    total_revenue: 0,
    total_settled: 0,
    total_pending: 0,
    transaction_count: 0,
    currency: 'EGP',
  };

  for (const row of (ledgerSummary ?? []) as Array<{ teacher_share: number; status: string; currency: string }>) {
    summary.total_revenue += Number(row.teacher_share);
    if (row.status === 'settled') summary.total_settled += Number(row.teacher_share);
    if (row.status === 'paid') summary.total_pending += Number(row.teacher_share);
    summary.transaction_count++;
    summary.currency = row.currency;
  }

  summary.total_revenue = Number(summary.total_revenue.toFixed(2));
  summary.total_settled = Number(summary.total_settled.toFixed(2));
  summary.total_pending = Number(summary.total_pending.toFixed(2));

  // 4. Fetch recent financial transactions (last 10)
  const { data: recentTransactions } = await supabaseServer
    .from('financial_ledger')
    .select('id, payment_id, order_id, student_id, subject_id, gross_amount, platform_share, teacher_share, commission_rate, status, currency, created_at')
    .eq('teacher_id', teacherId)
    .order('created_at', { ascending: false })
    .limit(10);

  // 5. Fetch subject count + student count
  const { count: subjectCount } = await supabaseServer
    .from('subjects')
    .select('id', { count: 'exact', head: true })
    .eq('teacher_id', teacherId);

  const { count: studentCount } = await supabaseServer
    .from('financial_ledger')
    .select('student_id', { count: 'exact', head: true })
    .eq('teacher_id', teacherId)
    .eq('status', 'paid');

  return NextResponse.json({
    success: true,
    teacher: {
      ...teacher as Record<string, unknown>,
      subject_count: subjectCount ?? 0,
      student_count: studentCount ?? 0,
    },
    payout_methods: (payoutMethods ?? []).map((pm) => ({
      ...pm as Record<string, unknown>,
      // details_encrypted is NEVER selected (not in the query above).
      // details_masked is safe (last4, card_brand, wallet_number, etc.)
    })),
    financial_summary: summary,
    recent_transactions: recentTransactions ?? [],
  });
}

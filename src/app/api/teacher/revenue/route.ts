import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { requireTeacher, authErrorResponse } from '@/lib/auth-helpers';

/**
 * GET /api/teacher/revenue
 *
 * Shows the authenticated teacher's revenue from the financial_ledger.
 * Uses financial_ledger.teacher_id (snapshot) — NOT subjects.teacher_id.
 *
 * The teacher_id comes from auth.user.id (session) — NOT from the frontend.
 * A teacher cannot view another teacher's revenue.
 *
 * Returns:
 *   - summary: total gross, total teacher_share, transaction count
 *   - transactions: per-record details (date, course name, amount, status)
 */
export async function GET(request: NextRequest) {
  const authResult = await requireTeacher(request);
  if (!authResult.success) return authErrorResponse(authResult);

  const teacherId = authResult.user.id;

  // Fetch all ledger records for this teacher (snapshot)
  const { data: ledger, error } = await supabaseServer
    .from('financial_ledger')
    .select(`
      id, order_id, student_id, subject_id, teacher_id,
      currency, gross_amount, teacher_share, platform_share, net_amount,
      commission_rate, status, created_at,
      subject:subjects!subject_id(name)
    `)
    .eq('teacher_id', teacherId)
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  const rows = ledger ?? [];

  // Calculate summary
  const summary = {
    total_gross: rows.reduce((sum: number, r: Record<string, unknown>) => sum + Number(r.gross_amount), 0),
    total_teacher_share: rows.reduce((sum: number, r: Record<string, unknown>) => sum + Number(r.teacher_share), 0),
    total_platform_share: rows.reduce((sum: number, r: Record<string, unknown>) => sum + Number(r.platform_share), 0),
    transaction_count: rows.length,
    settled_count: rows.filter((r: Record<string, unknown>) => r.status === 'settled').length,
    pending_count: rows.filter((r: Record<string, unknown>) => r.status === 'paid').length,
    refunded_count: rows.filter((r: Record<string, unknown>) => r.status === 'refunded').length,
  };

  // Map to public-safe format (no student_id, no platform_share details)
  const transactions = rows.map((r: Record<string, unknown>) => ({
    id: r.id,
    order_id: r.order_id,
    subject_name: (r.subject as { name?: string } | null)?.name ?? '—',
    currency: r.currency,
    gross_amount: r.gross_amount,
    teacher_share: r.teacher_share,
    status: r.status,
    created_at: r.created_at,
  }));

  return NextResponse.json({
    success: true,
    summary: {
      total_gross: summary.total_gross.toFixed(2),
      total_teacher_share: summary.total_teacher_share.toFixed(2),
      total_platform_share: summary.total_platform_share.toFixed(2),
      transaction_count: summary.transaction_count,
      settled_count: summary.settled_count,
      pending_count: summary.pending_count,
      refunded_count: summary.refunded_count,
    },
    transactions,
  });
}

import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { requireTeacher, authErrorResponse } from '@/lib/auth-helpers';

/**
 * GET /api/teacher/revenue
 *
 * Phase 10 — Teacher Financial Dashboard data source.
 *
 * Reads financial data ONLY from `financial_ledger` (snapshotted values).
 * Never recomputes from orders/payments. The teacher_id comes from the
 * server-side authenticated session (auth.user.id) — NOT from the frontend.
 * A teacher cannot view another teacher's revenue.
 *
 * Query params (all optional, all server-side validated):
 *   - date_from  ISO date (YYYY-MM-DD) — filter created_at >= date_from
 *   - date_to    ISO date (YYYY-MM-DD) — filter created_at <= date_to (end of day)
 *   - subject_id UUID — filter by snapshot subject_id
 *   - status     one of: paid | refunded | reversed | settled | pending | failed
 *
 * Returns:
 *   - summary: total_gross, total_teacher_share, total_platform_share,
 *              total_gateway_fee, transaction_count + status breakdowns
 *   - transactions: per-record details (date, student name, course name,
 *                    amounts, gateway_fee, status)
 *   - subjects: list of distinct subjects owned by this teacher (for filter dropdown)
 */
export async function GET(request: NextRequest) {
  const authResult = await requireTeacher(request);
  if (!authResult.success) return authErrorResponse(authResult);

  // ── Server-side source of truth for teacher_id ──
  // NEVER accept teacher_id from query params, body, or headers.
  const teacherId = authResult.user.id;

  // ── Parse + validate filters (defense in depth) ──
  const url = new URL(request.url);
  const dateFrom = url.searchParams.get('date_from');
  const dateTo = url.searchParams.get('date_to');
  const subjectId = url.searchParams.get('subject_id');
  const status = url.searchParams.get('status');

  // Validate date format (YYYY-MM-DD) — reject anything else.
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (dateFrom && !dateRegex.test(dateFrom)) {
    return NextResponse.json(
      { success: false, error: 'صيغة date_from غير صحيحة. استخدم YYYY-MM-DD' },
      { status: 400 }
    );
  }
  if (dateTo && !dateRegex.test(dateTo)) {
    return NextResponse.json(
      { success: false, error: 'صيغة date_to غير صحيحة. استخدم YYYY-MM-DD' },
      { status: 400 }
    );
  }
  // Validate UUID if provided
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (subjectId && !uuidRegex.test(subjectId)) {
    return NextResponse.json(
      { success: false, error: 'subject_id غير صالح' },
      { status: 400 }
    );
  }
  // Validate status against DB CHECK constraint
  const ALLOWED_STATUSES = ['paid', 'refunded', 'reversed', 'settled', 'pending', 'failed'];
  if (status && !ALLOWED_STATUSES.includes(status)) {
    return NextResponse.json(
      { success: false, error: `status غير صالح. القيم المسموحة: ${ALLOWED_STATUSES.join(', ')}` },
      { status: 400 }
    );
  }

  // ── Build query against financial_ledger (snapshotted values) ──
  let query = supabaseServer
    .from('financial_ledger')
    .select(
      `
      id, order_id, student_id, subject_id, teacher_id,
      gateway_id, currency,
      gross_amount, platform_share, teacher_share, gateway_fee, net_amount,
      commission_rate, status, created_at,
      subject:subjects!subject_id(name),
      student:users!student_id(name)
      `
    )
    .eq('teacher_id', teacherId); // CRITICAL — server-side enforced scope

  // Date range filters
  if (dateFrom) {
    // created_at >= date_from 00:00:00 UTC
    query = query.gte('created_at', `${dateFrom}T00:00:00Z`);
  }
  if (dateTo) {
    // created_at <= date_to 23:59:59 UTC
    query = query.lte('created_at', `${dateTo}T23:59:59Z`);
  }
  if (subjectId) {
    query = query.eq('subject_id', subjectId);
  }
  if (status) {
    query = query.eq('status', status);
  }

  // Order newest first. Raise limit to 1000 to accommodate filtered views
  // (was 100 in Phase 9 — insufficient with no filters + many transactions).
  const { data: ledger, error } = await query
    .order('created_at', { ascending: false })
    .limit(1000);

  if (error) {
    console.error('[teacher/revenue] ledger query error:', error.message);
    return NextResponse.json(
      { success: false, error: 'فشل في قراءة سجل المعاملات' },
      { status: 500 }
    );
  }

  const rows = ledger ?? [];

  // ── Compute summary from rows only (no recomputing from orders) ──
  // Use cents (piasters) to avoid floating-point summation drift.
  const sumCents = (selector: (r: any) => number | null | undefined): number =>
    rows.reduce(
      (acc, r) => acc + Math.round((Number(selector(r) ?? 0)) * 100),
      0
    );

  const summary = {
    total_gross: sumCents((r) => r.gross_amount) / 100,
    total_teacher_share: sumCents((r) => r.teacher_share) / 100,
    total_platform_share: sumCents((r) => r.platform_share) / 100,
    total_gateway_fee: sumCents((r) => r.gateway_fee) / 100,
    transaction_count: rows.length,
    settled_count: rows.filter((r) => r.status === 'settled').length,
    paid_count: rows.filter((r) => r.status === 'paid').length,
    refunded_count: rows.filter((r) => r.status === 'refunded').length,
    reversed_count: rows.filter((r) => r.status === 'reversed').length,
    pending_count: rows.filter((r) => r.status === 'pending').length,
    failed_count: rows.filter((r) => r.status === 'failed').length,
  };

  // ── Map to public-safe shape ──
  // NOTE: We expose platform_share + gateway_fee to the teacher for transparency
  // (their dashboard shows how the gross splits between teacher / platform / gateway).
  // The teacher already owns this snapshot — it's their revenue. We DO NOT expose
  // other teachers' rows (filtered by teacher_id above).
  const extractNameRaw = (rel: unknown): string => {
    if (!rel) return '—';
    if (Array.isArray(rel)) return (rel[0] as { name?: string } | null)?.name ?? '—';
    return (rel as { name?: string }).name ?? '—';
  };
  const transactions = rows.map((r: any) => ({
    id: r.id,
    order_id: r.order_id,
    subject_id: r.subject_id,
    subject_name: extractNameRaw(r.subject),
    student_name: extractNameRaw(r.student),
    currency: r.currency,
    gross_amount: Number(r.gross_amount),
    platform_share: Number(r.platform_share),
    teacher_share: Number(r.teacher_share),
    gateway_fee: Number(r.gateway_fee),
    net_amount: Number(r.net_amount),
    commission_rate: Number(r.commission_rate),
    status: r.status,
    created_at: r.created_at,
  }));

  // ── Subjects list (for filter dropdown) ──
  // Only subjects that appear in this teacher's ledger (snapshot teacher_id).
  // We do NOT use subjects.teacher_id — that would re-introduce "current" teacher
  // of the subject, breaking historical accuracy.
  const subjectsForFilter: { subject_id: string; subject_name: string }[] = [];
  const seenSubjectIds = new Set<string>();
  for (const r of rows as any[]) {
    if (r.subject_id && !seenSubjectIds.has(r.subject_id)) {
      seenSubjectIds.add(r.subject_id);
      subjectsForFilter.push({
        subject_id: r.subject_id,
        subject_name: extractNameRaw(r.subject),
      });
    }
  }

  return NextResponse.json({
    success: true,
    filters: {
      date_from: dateFrom ?? null,
      date_to: dateTo ?? null,
      subject_id: subjectId ?? null,
      status: status ?? null,
    },
    summary: {
      total_gross: summary.total_gross.toFixed(2),
      total_teacher_share: summary.total_teacher_share.toFixed(2),
      total_platform_share: summary.total_platform_share.toFixed(2),
      total_gateway_fee: summary.total_gateway_fee.toFixed(2),
      transaction_count: summary.transaction_count,
      settled_count: summary.settled_count,
      paid_count: summary.paid_count,
      refunded_count: summary.refunded_count,
      reversed_count: summary.reversed_count,
      pending_count: summary.pending_count,
      failed_count: summary.failed_count,
    },
    transactions,
    subjects: subjectsForFilter,
  });
}

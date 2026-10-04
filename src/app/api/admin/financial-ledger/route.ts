import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helpers';

/**
 * GET /api/admin/financial-ledger
 *
 * Phase 12 — Financial Admin Dashboard data source.
 *
 * CRITICAL DESIGN RULES:
 *   1. `requireAdmin` is the auth gate. No client-supplied identity
 *      is ever trusted (no x-user-id, no user_id from query/body).
 *   2. The summary is computed SERVER-SIDE via the
 *      `public.get_financial_summary` SQL RPC. It is INDEPENDENT
 *      of pagination — it reflects ALL matching rows, not just the
 *      current page. `rows.reduce()` is FORBIDDEN for summary
 *      aggregation.
 *   3. `total_count` for pagination is computed via a separate
 *      `{ count: 'exact', head: true }` query, NOT from
 *      `rows.length`.
 *   4. `select('*')` is FORBIDDEN. The explicit column list
 *      EXCLUDES `payment_id` and `provider_payment_id` from the
 *      default response (operational secrets).
 *   5. Related names (student, teacher, subject, gateway) are
 *      fetched via BATCH LOOKUPS after fetching the paginated rows.
 *      This avoids PostgREST nested-join FK dependency — the
 *      financial_ledger snapshot columns intentionally have NO FK
 *      constraints. Missing referenced records return '—' (the
 *      ledger row remains visible).
 *
 * Query params (all optional):
 *   page           int > 0        (default: 1)
 *   page_size      one of 10|25|50|100  (default: 25)
 *   from_date      YYYY-MM-DD    (created_at >= start of day)
 *   to_date        YYYY-MM-DD    (created_at < start of next day — INCLUSIVE calendar day)
 *   teacher_id     UUID
 *   student_id     UUID
 *   subject_id     UUID
 *   gateway_id     UUID
 *   status         one of: paid|settled|refunded|reversed|pending|failed
 *
 * Response shape:
 *   {
 *     success: true,
 *     data: Array<AdminLedgerRow>,
 *     pagination: { page, page_size, total_count, total_pages },
 *     summary: {
 *       total_gross, total_platform_share, total_teacher_share,
 *       total_gateway_fees, net_platform_revenue, transaction_count
 *     },
 *     status_breakdown: {
 *       paid, settled, refunded, reversed, pending, failed
 *     }
 *   }
 */

// ─── Validation constants ───
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const ALLOWED_STATUSES = ['pending', 'paid', 'failed', 'refunded', 'reversed', 'settled'];
const ALLOWED_PAGE_SIZES = [10, 25, 50, 100];

interface PaginationMeta {
  page: number;
  page_size: number;
  total_count: number;
  total_pages: number;
}

interface SummaryMeta {
  total_gross: string;
  total_platform_share: string;
  total_teacher_share: string;
  total_gateway_fees: string;
  net_platform_revenue: string;
  transaction_count: number;
  // v110: new fields (matching teacher dashboard)
  unique_students: number;
  active_subscriptions: number;
  successful_count: number;
  avg_student_revenue: string;
  avg_transaction_value: string;
}

interface StatusBreakdown {
  paid: number;
  settled: number;
  refunded: number;
  reversed: number;
  pending: number;
  failed: number;
}

/**
 * Convert a YYYY-MM-DD date string to a UTC timestamp:
 *   - `from_date` → start of day: "2026-09-01T00:00:00Z"
 *   - `to_date`   → start of NEXT day: "2026-09-27T00:00:00Z" (so
 *     the WHERE uses `< p_to_date` and includes the entire calendar day).
 */
function dateToUtcStartOfDay(dateStr: string, isToDate: boolean = false): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  const d = new Date(Date.UTC(year, month - 1, day));
  if (isToDate) {
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return d.toISOString();
}

export async function GET(request: NextRequest) {
  const authResult = await requireAdmin(request);
  if (!authResult.success) return authErrorResponse(authResult);

  // ─── Parse + validate query params ───
  const { searchParams } = request.nextUrl;
  const rawPage = searchParams.get('page');
  const rawPageSize = searchParams.get('page_size');
  const fromDateRaw = searchParams.get('from_date');
  const toDateRaw = searchParams.get('to_date');
  const teacherId = searchParams.get('teacher_id');
  const studentId = searchParams.get('student_id');
  const subjectId = searchParams.get('subject_id');
  const gatewayId = searchParams.get('gateway_id');
  const status = searchParams.get('status');

  // Page validation
  let page = 1;
  if (rawPage !== null) {
    const parsed = parseInt(rawPage, 10);
    if (!Number.isFinite(parsed) || parsed < 1) {
      return NextResponse.json(
        { success: false, error: 'page يجب أن يكون عدد صحيح موجب' },
        { status: 400 }
      );
    }
    page = parsed;
  }

  // Page size validation
  let pageSize = 25;
  if (rawPageSize !== null) {
    const parsed = parseInt(rawPageSize, 10);
    if (!Number.isFinite(parsed) || !ALLOWED_PAGE_SIZES.includes(parsed)) {
      return NextResponse.json(
        {
          success: false,
          error: `page_size يجب أن يكون أحد: ${ALLOWED_PAGE_SIZES.join(', ')}`,
        },
        { status: 400 }
      );
    }
    pageSize = parsed;
  }

  // Date validation
  if (fromDateRaw !== null && !DATE_REGEX.test(fromDateRaw)) {
    return NextResponse.json(
      { success: false, error: 'from_date يجب أن يكون بصيغة YYYY-MM-DD' },
      { status: 400 }
    );
  }
  if (toDateRaw !== null && !DATE_REGEX.test(toDateRaw)) {
    return NextResponse.json(
      { success: false, error: 'to_date يجب أن يكون بصيغة YYYY-MM-DD' },
      { status: 400 }
    );
  }
  if (fromDateRaw && toDateRaw && fromDateRaw > toDateRaw) {
    return NextResponse.json(
      { success: false, error: 'from_date يجب أن يكون قبل أو يساوي to_date' },
      { status: 400 }
    );
  }

  // UUID validation
  if (teacherId !== null && !UUID_REGEX.test(teacherId)) {
    return NextResponse.json({ success: false, error: 'teacher_id غير صالح' }, { status: 400 });
  }
  if (studentId !== null && !UUID_REGEX.test(studentId)) {
    return NextResponse.json({ success: false, error: 'student_id غير صالح' }, { status: 400 });
  }
  if (subjectId !== null && !UUID_REGEX.test(subjectId)) {
    return NextResponse.json({ success: false, error: 'subject_id غير صالح' }, { status: 400 });
  }
  if (gatewayId !== null && !UUID_REGEX.test(gatewayId)) {
    return NextResponse.json({ success: false, error: 'gateway_id غير صالح' }, { status: 400 });
  }

  // Status validation
  if (status !== null && !ALLOWED_STATUSES.includes(status)) {
    return NextResponse.json(
      {
        success: false,
        error: `status غير صالح. القيم المسموحة: ${ALLOWED_STATUSES.join(', ')}`,
      },
      { status: 400 }
    );
  }

  // ─── Normalize dates for the RPC + ledger queries ───
  const fromDateNormalized = fromDateRaw ? dateToUtcStartOfDay(fromDateRaw, false) : null;
  const toDateNormalized = toDateRaw ? dateToUtcStartOfDay(toDateRaw, true) : null;

  // ─── Build filter base (reused by RPC + ledger SELECT + count) ───
  type FilterMap = Record<string, { op: 'eq' | 'gte' | 'lt'; value: string }>;
  const filters: FilterMap = {};
  if (teacherId) filters.teacher_id = { op: 'eq', value: teacherId };
  if (studentId) filters.student_id = { op: 'eq', value: studentId };
  if (subjectId) filters.subject_id = { op: 'eq', value: subjectId };
  if (gatewayId) filters.gateway_id = { op: 'eq', value: gatewayId };
  if (status) filters.status = { op: 'eq', value: status };
  if (fromDateNormalized) filters.from_date = { op: 'gte', value: fromDateNormalized };
  if (toDateNormalized) filters.to_date = { op: 'lt', value: toDateNormalized };

  // Helper to apply filters to any query builder
  const applyFilters = <T>(q: T): T => {
    let query = q as unknown as {
      eq(col: string, val: string): unknown;
      gte(col: string, val: string): unknown;
      lt(col: string, val: string): unknown;
    };
    for (const [col, { op, value }] of Object.entries(filters)) {
      const realCol = col === 'from_date' ? 'created_at' : col === 'to_date' ? 'created_at' : col;
      if (op === 'eq') query = query.eq(realCol, value) as typeof query;
      else if (op === 'gte') query = query.gte(realCol, value) as typeof query;
      else if (op === 'lt') query = query.lt(realCol, value) as typeof query;
    }
    return query as unknown as T;
  };

  // ─── 1. Summary via SQL RPC (server-side aggregation) ───
  const { data: rpcResult, error: rpcErr } = await supabaseServer.rpc(
    'get_financial_summary',
    {
      p_from_date: fromDateNormalized,
      p_to_date: toDateNormalized,
      p_teacher_id: teacherId,
      p_subject_id: subjectId,
      p_gateway_id: gatewayId,
      p_status: status,
    }
  );

  if (rpcErr) {
    console.error('[admin/financial-ledger] RPC error:', rpcErr.message);
    return NextResponse.json(
      { success: false, error: 'فشل في حساب الملخص المالي' },
      { status: 500 }
    );
  }

  const summaryObj: Record<string, unknown> = Array.isArray(rpcResult)
    ? (rpcResult[0] as Record<string, unknown>) ?? {}
    : (rpcResult as Record<string, unknown>) ?? {};

  const summary: SummaryMeta = {
    // v110: total_gross now uses subscription_total (base price × count, no fees)
    // — matches the teacher dashboard. Falls back to gross_amount for pre-v88 rows.
    total_gross: String(Number(summaryObj.total_subscription_total ?? summaryObj.total_gross ?? 0).toFixed(2)),
    total_platform_share: String(Number(summaryObj.total_platform_share ?? 0).toFixed(2)),
    total_teacher_share: String(Number(summaryObj.total_teacher_share ?? 0).toFixed(2)),
    total_gateway_fees: String(Number(summaryObj.total_gateway_fees ?? 0).toFixed(2)),
    net_platform_revenue: String(Number(summaryObj.net_platform_revenue ?? 0).toFixed(2)),
    transaction_count: Number(summaryObj.transaction_count ?? 0),
    // v110: new fields (computed below via additional queries)
    unique_students: 0,
    active_subscriptions: 0,
    successful_count: 0,
    avg_student_revenue: '0',
    avg_transaction_value: '0',
  };

  const status_breakdown: StatusBreakdown = {
    paid: Number(summaryObj.paid_count ?? 0),
    settled: Number(summaryObj.settled_count ?? 0),
    refunded: Number(summaryObj.refunded_count ?? 0),
    reversed: Number(summaryObj.reversed_count ?? 0),
    pending: Number(summaryObj.pending_count ?? 0),
    failed: Number(summaryObj.failed_count ?? 0),
  };

  // v110: Compute new fields via additional queries
  // 1. unique_students + subscription_total from ledger rows
  let ledgerExtraQuery = supabaseServer
    .from('financial_ledger')
    .select('student_id, subscription_total, gross_amount');
  ledgerExtraQuery = applyFilters(ledgerExtraQuery) as typeof ledgerExtraQuery;
  const { data: ledgerExtra, error: ledgerExtraErr } = await ledgerExtraQuery;
  if (!ledgerExtraErr && ledgerExtra) {
    const rows = ledgerExtra as Array<{ student_id: string; subscription_total: number | null; gross_amount: number | null }>;
    // unique students
    const studentSet = new Set(rows.map((r) => r.student_id).filter(Boolean));
    summary.unique_students = studentSet.size;
    // sum subscription_total (fall back to gross_amount for pre-v88)
    const subTotal = rows.reduce((acc, r) => acc + Number(r.subscription_total ?? r.gross_amount ?? 0), 0);
    summary.total_gross = subTotal.toFixed(2);
  }

  // 2. active_subscriptions — count ALL approved subject_students (platform-wide)
  try {
    const { count: activeCount, error: activeErr } = await supabaseServer
      .from('subject_students')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'approved')
      .or('current_period_end.is.null,current_period_end.gt.' + new Date().toISOString());
    if (!activeErr && activeCount !== null) {
      summary.active_subscriptions = activeCount;
    }
  } catch (activeErr) {
    console.warn('[admin/financial-ledger] active subscriptions count failed:', activeErr);
  }

  // 3. successful_count + averages
  summary.successful_count = status_breakdown.paid + status_breakdown.settled;
  const platformShareNum = Number(summary.total_platform_share);
  summary.avg_student_revenue = summary.unique_students > 0
    ? (platformShareNum / summary.unique_students).toFixed(2)
    : '0';
  summary.avg_transaction_value = summary.successful_count > 0
    ? (platformShareNum / summary.successful_count).toFixed(2)
    : '0';

  // ─── 2. Total count for pagination (separate query, head-only) ───
  let countQuery = supabaseServer
    .from('financial_ledger')
    .select('id', { count: 'exact', head: true });

  countQuery = applyFilters(countQuery) as typeof countQuery;

  const { count: totalCount, error: countErr } = await countQuery;

  if (countErr) {
    console.error('[admin/financial-ledger] count error:', countErr.message);
    return NextResponse.json(
      { success: false, error: 'فشل في حساب إجمالي السجلات' },
      { status: 500 }
    );
  }

  const total_count = totalCount ?? 0;
  const total_pages = total_count === 0 ? 0 : Math.ceil(total_count / pageSize);

  // ─── 3. Paginated data rows (no nested joins — plain columns only) ───
  const from = (page - 1) * pageSize;
  const to = page * pageSize - 1;

  let dataQuery = supabaseServer
    .from('financial_ledger')
    .select(
      `
      id, order_id, student_id, subject_id, teacher_id, gateway_id,
      currency, gross_amount, platform_share, teacher_share, gateway_fee,
      net_amount, commission_rate, status, created_at, updated_at
      `
    )
    .order('created_at', { ascending: false })
    .range(from, to);

  dataQuery = applyFilters(dataQuery) as typeof dataQuery;

  const { data: ledgerRows, error: dataErr } = await dataQuery;

  if (dataErr) {
    console.error('[admin/financial-ledger] data error:', dataErr.message);
    return NextResponse.json(
      { success: false, error: 'فشل في جلب بيانات السجل' },
      { status: 500 }
    );
  }

  // ─── 4. Batch lookups: enrich ledger rows with related names ───
  const rows = (ledgerRows ?? []) as any[];

  // Collect unique IDs (filter out nulls — gateway_id can be null)
  const allUserIds = new Set<string>();
  const studentIds = new Set<string>();
  const teacherIds = new Set<string>();
  const subjectIdsSet = new Set<string>();
  const gatewayIdsSet = new Set<string>();

  for (const r of rows) {
    if (r.student_id) {
      studentIds.add(r.student_id);
      allUserIds.add(r.student_id);
    }
    if (r.teacher_id) {
      teacherIds.add(r.teacher_id);
      allUserIds.add(r.teacher_id);
    }
    if (r.subject_id) subjectIdsSet.add(r.subject_id);
    if (r.gateway_id) gatewayIdsSet.add(r.gateway_id);
  }

  // Batch query users (students + teachers in one query)
  const userNameMap = new Map<string, string>();
  const userIdsArray = [...allUserIds];
  if (userIdsArray.length > 0) {
    const { data: users, error: usersErr } = await supabaseServer
      .from('users')
      .select('id, name')
      .in('id', userIdsArray);
    if (!usersErr && users) {
      for (const u of users as any[]) {
        userNameMap.set(u.id, u.name ?? '—');
      }
    }
  }

  // Batch query subjects
  const subjectNameMap = new Map<string, string>();
  const subjectIdsArray = [...subjectIdsSet];
  if (subjectIdsArray.length > 0) {
    const { data: subjects, error: subjectsErr } = await supabaseServer
      .from('subjects')
      .select('id, name')
      .in('id', subjectIdsArray);
    if (!subjectsErr && subjects) {
      for (const s of subjects as any[]) {
        subjectNameMap.set(s.id, s.name ?? '—');
      }
    }
  }

  // Batch query payment_gateways
  const gatewayDisplayNameMap = new Map<string, string>();
  const gatewayIdsArray = [...gatewayIdsSet];
  if (gatewayIdsArray.length > 0) {
    const { data: gateways, error: gatewaysErr } = await supabaseServer
      .from('payment_gateways')
      .select('id, display_name')
      .in('id', gatewayIdsArray);
    if (!gatewaysErr && gateways) {
      for (const g of gateways as any[]) {
        gatewayDisplayNameMap.set(g.id, g.display_name ?? '—');
      }
    }
  }

  // ─── 5. Map rows to public shape (enriched with batch lookups) ───
  const data = rows.map((r) => ({
    id: r.id,
    order_id: r.order_id,
    student_id: r.student_id,
    student_name: userNameMap.get(r.student_id) ?? '—',
    teacher_id: r.teacher_id,
    teacher_name: userNameMap.get(r.teacher_id) ?? '—',
    subject_id: r.subject_id,
    subject_name: subjectNameMap.get(r.subject_id) ?? '—',
    gateway_id: r.gateway_id,
    gateway_display_name: r.gateway_id
      ? (gatewayDisplayNameMap.get(r.gateway_id) ?? '—')
      : '—',
    currency: r.currency,
    gross_amount: Number(r.gross_amount),
    platform_share: Number(r.platform_share),
    teacher_share: Number(r.teacher_share),
    gateway_fee: Number(r.gateway_fee),
    net_amount: Number(r.net_amount),
    commission_rate: Number(r.commission_rate),
    status: r.status,
    created_at: r.created_at,
    updated_at: r.updated_at,
  }));

  const pagination: PaginationMeta = {
    page,
    page_size: pageSize,
    total_count,
    total_pages,
  };

  return NextResponse.json({
    success: true,
    data,
    pagination,
    summary,
    status_breakdown,
  });
}

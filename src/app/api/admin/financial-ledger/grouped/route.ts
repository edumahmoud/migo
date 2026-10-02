import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helpers';

/**
 * GET /api/admin/financial-ledger/grouped?group_by=teacher|subject|gateway&from_date=YYYY-MM-DD&to_date=YYYY-MM-DD
 *
 * Returns financial ledger data grouped by the requested dimension:
 *   - group_by=teacher  → aggregate by teacher_id (+ teacher name)
 *   - group_by=subject  → aggregate by subject_id (+ subject name)
 *   - group_by=gateway  → aggregate by gateway_id (+ gateway display name)
 *   - group_by=currency → aggregate by currency
 *
 * For each group, returns:
 *   - gross_amount (sum)
 *   - platform_share (sum)
 *   - teacher_share (sum)
 *   - gateway_fee (sum)
 *   - net_amount (sum)
 *   - transaction_count
 *   - unique_students (count of distinct student_id)
 *   - unique_subjects (count of distinct subject_id — only meaningful
 *     when group_by != subject)
 *
 * Filters (all optional):
 *   - from_date YYYY-MM-DD (inclusive, calendar day start in UTC)
 *   - to_date   YYYY-MM-DD (inclusive, calendar day end in UTC)
 *   - status    one of paid|settled|refunded|reversed|pending|failed
 *               (default: paid + settled, matching the breakdown endpoint)
 *
 * Response: {
 *   success: true,
 *   group_by: 'teacher'|'subject'|'gateway'|'currency',
 *   groups: Array<{
 *     key: string (UUID or currency code),
 *     label: string (display name — for teacher/subject/gateway),
 *     gross_amount: number,
 *     platform_share: number,
 *     teacher_share: number,
 *     gateway_fee: number,
 *     net_amount: number,
 *     transaction_count: number,
 *     unique_students: number,
 *     unique_subjects: number,
 *   }>,
 *   summary: {
 *     total_gross, total_platform, total_teacher, total_count,
 *     total_unique_students, total_unique_subjects
 *   }
 * }
 *
 * Authorization: admin/superadmin only.
 * Uses service-role (bypasses RLS) — the explicit requireAdmin gate
 * is the authorization.
 */

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const ALLOWED_STATUSES = ['pending', 'paid', 'failed', 'refunded', 'reversed', 'settled'];
const ALLOWED_GROUP_BY = ['teacher', 'subject', 'gateway', 'currency'] as const;
type GroupBy = typeof ALLOWED_GROUP_BY[number];

function dateToUtcStartOfDay(dateStr: string, isToDate: boolean = false): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  const d = new Date(Date.UTC(year, month - 1, day));
  if (isToDate) {
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return d.toISOString();
}

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.success) return authErrorResponse(auth);

  const { searchParams } = request.nextUrl;
  const groupByRaw = searchParams.get('group_by') ?? 'teacher';
  if (!ALLOWED_GROUP_BY.includes(groupByRaw as GroupBy)) {
    return NextResponse.json(
      { success: false, error: `group_by يجب أن يكون أحد: ${ALLOWED_GROUP_BY.join(', ')}` },
      { status: 400 },
    );
  }
  const groupBy = groupByRaw as GroupBy;

  const fromDateRaw = searchParams.get('from_date');
  const toDateRaw = searchParams.get('to_date');
  const status = searchParams.get('status');

  if (fromDateRaw && !DATE_REGEX.test(fromDateRaw)) {
    return NextResponse.json(
      { success: false, error: 'from_date يجب أن يكون YYYY-MM-DD' },
      { status: 400 },
    );
  }
  if (toDateRaw && !DATE_REGEX.test(toDateRaw)) {
    return NextResponse.json(
      { success: false, error: 'to_date يجب أن يكون YYYY-MM-DD' },
      { status: 400 },
    );
  }
  if (status && !ALLOWED_STATUSES.includes(status)) {
    return NextResponse.json(
      { success: false, error: `status غير صالح` },
      { status: 400 },
    );
  }

  const fromDateNormalized = fromDateRaw ? dateToUtcStartOfDay(fromDateRaw, false) : null;
  const toDateNormalized = toDateRaw ? dateToUtcStartOfDay(toDateRaw, true) : null;

  // Build the query — fetch the raw ledger rows + their FK dimension
  const groupColumn = groupBy === 'teacher' ? 'teacher_id'
    : groupBy === 'subject' ? 'subject_id'
    : groupBy === 'gateway' ? 'gateway_id'
    : 'currency'; // groupBy === 'currency'

  let query = supabaseServer
    .from('financial_ledger')
    .select(`
      ${groupColumn},
      gross_amount, platform_share, teacher_share, gateway_fee, net_amount,
      student_id, subject_id, currency, status, created_at
    `);

  // Default status filter: paid + settled (matches breakdown endpoint)
  if (status) {
    query = query.eq('status', status);
  } else {
    query = query.in('status', ['paid', 'settled']);
  }

  if (fromDateNormalized) query = query.gte('created_at', fromDateNormalized);
  if (toDateNormalized) query = query.lt('created_at', toDateNormalized);

  query = query.order('created_at', { ascending: true }).limit(5000);

  const { data: rows, error } = await query;

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  if (!rows || rows.length === 0) {
    return NextResponse.json({
      success: true,
      group_by: groupBy,
      groups: [],
      summary: {
        total_gross: 0, total_platform: 0, total_teacher: 0,
        total_count: 0, total_unique_students: 0, total_unique_subjects: 0,
      },
    });
  }

  // Aggregate in JS — the data volume is capped at 5000 rows
  const groups = new Map<string, {
    gross: number;
    platform: number;
    teacher: number;
    gateway_fee: number;
    net: number;
    count: number;
    studentIds: Set<string>;
    subjectIds: Set<string>;
    currency: string;
  }>();

  for (const row of rows as Array<Record<string, unknown>>) {
    const key = String(row[groupColumn] ?? '—');
    if (!groups.has(key)) {
      groups.set(key, {
        gross: 0, platform: 0, teacher: 0, gateway_fee: 0, net: 0, count: 0,
        studentIds: new Set(), subjectIds: new Set(),
        currency: String(row.currency ?? 'EGP'),
      });
    }
    const g = groups.get(key)!;
    g.gross += Number(row.gross_amount ?? 0);
    g.platform += Number(row.platform_share ?? 0);
    g.teacher += Number(row.teacher_share ?? 0);
    g.gateway_fee += Number(row.gateway_fee ?? 0);
    g.net += Number(row.net_amount ?? 0);
    g.count += 1;
    if (row.student_id) g.studentIds.add(String(row.student_id));
    if (row.subject_id) g.subjectIds.add(String(row.subject_id));
  }

  // For teacher/subject/gateway groups, fetch display names in batch
  const groupKeys = [...groups.keys()].filter((k) => k !== '—' && k !== 'null');
  const labelMap = new Map<string, string>();

  if (groupKeys.length > 0) {
    if (groupBy === 'teacher' || groupBy === 'subject') {
      // Both are UUIDs in the `users` or `subjects` table
      const table = groupBy === 'teacher' ? 'users' : 'subjects';
      const ids = groupKeys.filter((k) => UUID_REGEX.test(k));
      if (ids.length > 0) {
        const { data } = await supabaseServer
          .from(table)
          .select('id, name')
          .in('id', ids);
        for (const r of (data ?? []) as Array<{ id: string; name: string | null }>) {
          labelMap.set(r.id, r.name ?? '—');
        }
      }
    } else if (groupBy === 'gateway') {
      const ids = groupKeys.filter((k) => UUID_REGEX.test(k));
      if (ids.length > 0) {
        const { data } = await supabaseServer
          .from('payment_gateways')
          .select('id, display_name')
          .in('id', ids);
        for (const r of (data ?? []) as Array<{ id: string; display_name: string | null }>) {
          labelMap.set(r.id, r.display_name ?? '—');
        }
      }
    }
    // groupBy === 'currency' → key IS the label (no lookup needed)
  }

  // Build the response — sort by gross_amount desc
  const groupArray = Array.from(groups.entries())
    .map(([key, v]) => ({
      key,
      label: groupBy === 'currency' ? key : (labelMap.get(key) ?? '—'),
      gross_amount: Number(v.gross.toFixed(2)),
      platform_share: Number(v.platform.toFixed(2)),
      teacher_share: Number(v.teacher.toFixed(2)),
      gateway_fee: Number(v.gateway_fee.toFixed(2)),
      net_amount: Number(v.net.toFixed(2)),
      transaction_count: v.count,
      unique_students: v.studentIds.size,
      unique_subjects: v.subjectIds.size,
      currency: v.currency,
    }))
    .sort((a, b) => b.gross_amount - a.gross_amount);

  // Summary — union of all student IDs + subject IDs across groups
  const allStudentIds = new Set<string>();
  const allSubjectIds = new Set<string>();
  for (const g of groups.values()) {
    g.studentIds.forEach((s) => allStudentIds.add(s));
    g.subjectIds.forEach((s) => allSubjectIds.add(s));
  }

  const summary = {
    total_gross: Number(groupArray.reduce((s, r) => s + r.gross_amount, 0).toFixed(2)),
    total_platform: Number(groupArray.reduce((s, r) => s + r.platform_share, 0).toFixed(2)),
    total_teacher: Number(groupArray.reduce((s, r) => s + r.teacher_share, 0).toFixed(2)),
    total_count: groupArray.reduce((s, r) => s + r.transaction_count, 0),
    total_unique_students: allStudentIds.size,
    total_unique_subjects: allSubjectIds.size,
  };

  return NextResponse.json({
    success: true,
    group_by: groupBy,
    groups: groupArray,
    summary,
  });
}

import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helpers';

/**
 * GET /api/admin/financial-ledger/breakdown?period=day|month|year&from=...&to=...&teacher_id=...
 *
 * Returns time-grouped financial summary from financial_ledger.
 * Groups by day, month, or year.
 *
 * Each row: { period, gross_amount, platform_share, teacher_share,
 *             gateway_fee, net_platform, transaction_count }
 *
 * period format depends on the grouping:
 *   day:   "2026-09-30"
 *   month: "2026-09"
 *   year:  "2026"
 *
 * Optional filters:
 *   - from: ISO date string (start of range)
 *   - to: ISO date string (end of range)
 *   - teacher_id: filter by specific teacher
 *   - subject_id: filter by specific subject
 */

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.success) return authErrorResponse(auth);

  const period = (request.nextUrl.searchParams.get('period') || 'month') as 'day' | 'month' | 'year';
  const from = request.nextUrl.searchParams.get('from');
  const to = request.nextUrl.searchParams.get('to');
  const teacherId = request.nextUrl.searchParams.get('teacher_id');
  const subjectId = request.nextUrl.searchParams.get('subject_id');

  // Build query — include student_id + subject_id for unique counts
  let query = supabaseServer
    .from('financial_ledger')
    .select('gross_amount, platform_share, teacher_share, net_amount, created_at, status, student_id, subject_id');

  // Status filter — include paid + settled (exclude refunded/reversed/failed)
  query = query.in('status', ['paid', 'settled']);

  // Date range
  if (from) query = query.gte('created_at', from);
  if (to) query = query.lte('created_at', to);

  // Teacher filter
  if (teacherId) query = query.eq('teacher_id', teacherId);

  // Subject filter
  if (subjectId) query = query.eq('subject_id', subjectId);

  // Order + limit
  query = query.order('created_at', { ascending: true }).limit(5000);

  const { data: rows, error } = await query;

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  if (!rows || rows.length === 0) {
    return NextResponse.json({
      success: true,
      breakdown: [],
      summary: { total_gross: 0, total_platform: 0, total_teacher: 0, total_count: 0, total_unique_students: 0, total_unique_subjects: 0 },
    });
  }

  // Group by period
  const groups = new Map<string, {
    gross: number;
    platform: number;
    teacher: number;
    net_platform: number;
    count: number;
    studentIds: Set<string>;
    subjectIds: Set<string>;
  }>();

  for (const row of rows as Array<{
    gross_amount: number | string;
    platform_share: number | string;
    teacher_share: number | string;
    net_amount: number | string;
    created_at: string;
    student_id: string;
    subject_id: string;
  }>) {
    const date = new Date(row.created_at);
    let key: string;
    if (period === 'day') {
      key = date.toISOString().slice(0, 10);
    } else if (period === 'month') {
      key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    } else {
      key = String(date.getFullYear());
    }

    if (!groups.has(key)) {
      groups.set(key, { gross: 0, platform: 0, teacher: 0, net_platform: 0, count: 0, studentIds: new Set(), subjectIds: new Set() });
    }
    const g = groups.get(key)!;
    g.gross += Number(row.gross_amount);
    g.platform += Number(row.platform_share);
    g.teacher += Number(row.teacher_share);
    g.net_platform += Number(row.platform_share);
    g.count += 1;
    g.studentIds.add(row.student_id);
    g.subjectIds.add(row.subject_id);
  }

  // Build sorted array
  const breakdown = Array.from(groups.entries())
    .map(([period_key, v]) => ({
      period: period_key,
      gross_amount: Number(v.gross.toFixed(2)),
      platform_share: Number(v.platform.toFixed(2)),
      teacher_share: Number(v.teacher.toFixed(2)),
      net_platform: Number(v.net_platform.toFixed(2)),
      transaction_count: v.count,
      unique_students: v.studentIds.size,
      unique_subjects: v.subjectIds.size,
    }))
    .sort((a, b) => b.period.localeCompare(a.period));

  // Summary — include unique totals
  const allStudentIds = new Set<string>();
  const allSubjectIds = new Set<string>();
  for (const g of groups.values()) {
    g.studentIds.forEach(s => allStudentIds.add(s));
    g.subjectIds.forEach(s => allSubjectIds.add(s));
  }

  const summary = {
    total_gross: Number(breakdown.reduce((s, r) => s + r.gross_amount, 0).toFixed(2)),
    total_platform: Number(breakdown.reduce((s, r) => s + r.platform_share, 0).toFixed(2)),
    total_teacher: Number(breakdown.reduce((s, r) => s + r.teacher_share, 0).toFixed(2)),
    total_count: breakdown.reduce((s, r) => s + r.transaction_count, 0),
    total_unique_students: allStudentIds.size,
    total_unique_subjects: allSubjectIds.size,
  };

  return NextResponse.json({
    success: true,
    breakdown,
    summary,
  });
}

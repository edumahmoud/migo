import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helpers';

/**
 * GET /api/admin/teachers?page=1&pageSize=20&search=query
 *
 * Returns a PAGINATED list of teachers with basic account info.
 * Server-side pagination — does NOT load all teachers into the browser.
 *
 * Each teacher row includes:
 *   - id, name, email, phone, account_status, created_at
 *   - subject_count (number of subjects they teach)
 *   - student_count (number of unique students across their subjects)
 *   - total_revenue (sum of teacher_share from financial_ledger —
 *     server-side aggregated, NOT loaded into the browser)
 *
 * Search: matches name OR email (case-insensitive, ILIKE).
 *
 * Authorization: requireAdmin (admin or superadmin only).
 * RLS: the service role bypasses RLS — the explicit requireAdmin
 * check is the authorization gate.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.success) return authErrorResponse(auth);

  const { searchParams } = new URL(request.url);
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get('pageSize') ?? '20', 10) || 20));
  const search = (searchParams.get('search') ?? '').trim();
  const from = (page - 1) * pageSize;
  const to = page * pageSize - 1;

  // Build the query
  let query = supabaseServer
    .from('users')
    .select('id, name, email, phone, account_status, created_at', { count: 'exact' })
    .eq('role', 'teacher')
    .order('created_at', { ascending: false })
    .range(from, to);

  if (search) {
    // ILIKE = case-insensitive search
    query = query.or(`name.ilike.%${search}%,email.ilike.%${search}%`);
  }

  const { data: teachers, count, error } = await query;

  if (error) {
    return NextResponse.json(
      { success: false, error: 'تعذّر جلب قائمة المعلمين' },
      { status: 500 },
    );
  }

  // Fetch subject_count + student_count + total_revenue per teacher
  // using a batched query (1 query for ALL teachers on the page, not N queries).
  const teacherIds = (teachers ?? []).map((t) => (t as { id: string }).id);

  if (teacherIds.length === 0) {
    return NextResponse.json({
      success: true,
      data: [],
      pagination: { page, page_size: pageSize, total_count: 0, total_pages: 0 },
    });
  }

  // Batch: count subjects per teacher
  const { data: subjectCounts } = await supabaseServer
    .from('subjects')
    .select('teacher_id')
    .in('teacher_id', teacherIds);

  const subjectCountMap = new Map<string, number>();
  for (const s of (subjectCounts ?? []) as Array<{ teacher_id: string }>) {
    subjectCountMap.set(s.teacher_id, (subjectCountMap.get(s.teacher_id) ?? 0) + 1);
  }

  // Batch: sum teacher_share from financial_ledger per teacher
  // Fetch BOTH 'paid' and 'settled' to get the COMPLETE picture.
  // 'paid' = money in platform account (not yet sent to teacher)
  // 'settled' = money actually sent to teacher
  const { data: revenueData } = await supabaseServer
    .from('financial_ledger')
    .select('teacher_id, teacher_share, status')
    .in('teacher_id', teacherIds)
    .in('status', ['paid', 'settled']);

  // Compute three separate amounts per teacher:
  // - total_earned: ALL money (paid + settled) — what the teacher earned
  // - total_settled: only 'settled' — what was actually sent to the teacher
  // - total_pending: only 'paid' — what's available for payout (in platform account)
  const earnedMap = new Map<string, number>();
  const settledMap = new Map<string, number>();
  const pendingMap = new Map<string, number>();
  for (const r of (revenueData ?? []) as Array<{ teacher_id: string; teacher_share: number; status: string }>) {
    const share = Number(r.teacher_share);
    earnedMap.set(r.teacher_id, (earnedMap.get(r.teacher_id) ?? 0) + share);
    if (r.status === 'settled') {
      settledMap.set(r.teacher_id, (settledMap.get(r.teacher_id) ?? 0) + share);
    } else if (r.status === 'paid') {
      pendingMap.set(r.teacher_id, (pendingMap.get(r.teacher_id) ?? 0) + share);
    }
  }

  // Batch: count unique students per teacher
  const { data: studentCounts } = await supabaseServer
    .from('financial_ledger')
    .select('teacher_id, student_id')
    .in('teacher_id', teacherIds)
    .in('status', ['paid', 'settled']);

  const studentCountMap = new Map<string, Set<string>>();
  for (const r of (studentCounts ?? []) as Array<{ teacher_id: string; student_id: string }>) {
    if (!studentCountMap.has(r.teacher_id)) studentCountMap.set(r.teacher_id, new Set());
    studentCountMap.get(r.teacher_id)!.add(r.student_id);
  }

  // Build the response — 3 separate financial fields
  const data = (teachers ?? []).map((t) => {
    const teacher = t as { id: string; name: string | null; email: string; phone: string | null; account_status: string; created_at: string };
    return {
      id: teacher.id,
      name: teacher.name ?? '—',
      email: teacher.email,
      phone: teacher.phone ?? null,
      account_status: teacher.account_status,
      created_at: teacher.created_at,
      subject_count: subjectCountMap.get(teacher.id) ?? 0,
      student_count: studentCountMap.get(teacher.id)?.size ?? 0,
      // Renamed from 'total_revenue' to be more accurate:
      total_earned: Number((earnedMap.get(teacher.id) ?? 0).toFixed(2)),     // paid + settled
      total_settled: Number((settledMap.get(teacher.id) ?? 0).toFixed(2)),  // actually sent to teacher
      total_pending: Number((pendingMap.get(teacher.id) ?? 0).toFixed(2)),  // available for payout
      // Keep backward-compat alias
      total_revenue: Number((earnedMap.get(teacher.id) ?? 0).toFixed(2)),
    };
  });

  return NextResponse.json({
    success: true,
    data,
    pagination: {
      page,
      page_size: pageSize,
      total_count: count ?? 0,
      total_pages: Math.ceil((count ?? 0) / pageSize),
    },
  });
}

import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helpers';
import { escapePostgrestIlike } from '@/lib/api-security';

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
    // v112: per-teacher commission column is `commission_rate` (NOT
    // `commission_percentage`). NULL = use the global platform default.
    .select('id, name, email, phone, account_status, created_at, auto_payout_enabled, commission_rate', { count: 'exact' })
    .eq('role', 'teacher')
    .order('created_at', { ascending: false })
    .range(from, to);

  if (search) {
    // ILIKE = case-insensitive search — escape ALL PostgREST metachars
    // (not just `%` and `_`) to prevent predicate-injection via
    // `,()` and `.` which PostgREST uses as predicate/field separators.
    const safeSearch = escapePostgrestIlike(search);
    query = query.or(`name.ilike.%${safeSearch}%,email.ilike.%${safeSearch}%`);
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

  // Batch: fetch all subjects owned by these teachers in ONE query.
  // Used for both subject_count (count rows per teacher) AND as input
  // for the student_count join below (subject_id → teacher_id).
  const { data: teacherSubjects } = await supabaseServer
    .from('subjects')
    .select('id, teacher_id')
    .in('teacher_id', teacherIds);

  const subjectCountMap = new Map<string, number>();
  const teacherToSubjects = new Map<string, string[]>();
  for (const s of (teacherSubjects ?? []) as Array<{ id: string; teacher_id: string }>) {
    subjectCountMap.set(s.teacher_id, (subjectCountMap.get(s.teacher_id) ?? 0) + 1);
    if (!teacherToSubjects.has(s.teacher_id)) teacherToSubjects.set(s.teacher_id, []);
    teacherToSubjects.get(s.teacher_id)!.push(s.id);
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

  // Batch: count unique APPROVED students per teacher, sourced from
  // subject_students (the authoritative enrollment table) joined to
  // subjects.teacher_id. The previous implementation read from
  // financial_ledger, which only counted students who had already paid —
  // teachers with approved-but-unpaid enrollments showed 0 students.
  //
  // subject_students.status = 'approved' — only approved enrollments
  // count toward the teacher's student roster (matches the v104
  // backfill + the activate_subscription_after_payment RPC behavior).
  //
  // Two-step query (avoids nested PostgREST filter ambiguity):
  //   1. teacher → subject_ids map (built above alongside subject_count).
  //   2. Fetch approved subject_students for those subject_ids, then
  //      aggregate UNIQUE student_id per teacher (a student enrolled in
  //      two of the teacher's subjects counts once).
  const allSubjectIds = Array.from(teacherToSubjects.values()).flat();
  // Avoid sending an empty `.in()` to PostgREST (which would error).
  const { data: enrollments } = allSubjectIds.length === 0
    ? { data: [] }
    : await supabaseServer
        .from('subject_students')
        .select('subject_id, student_id')
        .in('subject_id', allSubjectIds)
        .eq('status', 'approved');

  // subject_id → teacher_id (for aggregation)
  const subjectToTeacher = new Map<string, string>();
  for (const [tid, sids] of teacherToSubjects.entries()) {
    for (const sid of sids) subjectToTeacher.set(sid, tid);
  }

  const studentCountMap = new Map<string, Set<string>>();
  for (const row of (enrollments ?? []) as Array<{ subject_id: string; student_id: string }>) {
    const tid = subjectToTeacher.get(row.subject_id);
    if (!tid) continue;
    if (!studentCountMap.has(tid)) studentCountMap.set(tid, new Set());
    studentCountMap.get(tid)!.add(row.student_id);
  }

  // Build the response — 3 separate financial fields
  const data = (teachers ?? []).map((t) => {
    const teacher = t as { id: string; name: string | null; email: string; phone: string | null; account_status: string; created_at: string; auto_payout_enabled: boolean | null; commission_rate: number | null };
    return {
      id: teacher.id,
      name: teacher.name ?? '—',
      email: teacher.email,
      phone: teacher.phone ?? null,
      account_status: teacher.account_status,
      created_at: teacher.created_at,
      auto_payout_enabled: teacher.auto_payout_enabled ?? false,
      // v112: per-teacher platform commission rate (null = use global default).
      commission_rate: teacher.commission_rate ?? null,
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

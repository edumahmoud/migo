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
  const { data: revenueData } = await supabaseServer
    .from('financial_ledger')
    .select('teacher_id, teacher_share')
    .in('teacher_id', teacherIds)
    .eq('status', 'paid');

  const revenueMap = new Map<string, number>();
  for (const r of (revenueData ?? []) as Array<{ teacher_id: string; teacher_share: number }>) {
    revenueMap.set(r.teacher_id, (revenueMap.get(r.teacher_id) ?? 0) + Number(r.teacher_share));
  }

  // Batch: count unique students per teacher (from subject_students joined
  // with subjects). We can't do a join easily via Supabase client, so we
  // fetch subject_ids per teacher first, then count students.
  // For now, we use the financial_ledger's student count as a proxy
  // (number of unique students who paid this teacher).
  const { data: studentCounts } = await supabaseServer
    .from('financial_ledger')
    .select('teacher_id, student_id')
    .in('teacher_id', teacherIds)
    .eq('status', 'paid');

  const studentCountMap = new Map<string, Set<string>>();
  for (const r of (studentCounts ?? []) as Array<{ teacher_id: string; student_id: string }>) {
    if (!studentCountMap.has(r.teacher_id)) studentCountMap.set(r.teacher_id, new Set());
    studentCountMap.get(r.teacher_id)!.add(r.student_id);
  }

  // Build the response
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
      total_revenue: Number((revenueMap.get(teacher.id) ?? 0).toFixed(2)),
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

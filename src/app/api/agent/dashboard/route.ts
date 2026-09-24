import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { requireAgent, authErrorResponse } from '@/lib/auth-helpers';

/**
 * GET /api/agent/dashboard
 *
 * Returns the calling agent's own aggregated financial/stats dashboard:
 *   - totals: { total_registrations, total_unique_students, total_courses }
 *   - per_course: [{ subject_id, subject_name, level, sub_level, students_count }]
 *   - per_month: [{ month: 'YYYY-MM', count }] for last 12 months
 *   - recent: [{ id, student_id, student_name, student_email, student_code, subject_id, subject_name, enrolled_at }]
 *
 * NOTE: No monetary totals yet — fee/commission logic is deferred.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAgent(request);
  if (!auth.success) return authErrorResponse(auth);

  const { agent } = auth;

  const { data: enrollments, error } = await supabaseServer
    .from('subject_students')
    .select(
      'id, subject_id, student_id, status, enrolled_at, ' +
        'subject:subjects(id, name, level, sub_level), ' +
        'student:users!student_id(id, email, name, student_code)'
    )
    .eq('enrollment_agent_id', agent.id)
    .order('enrolled_at', { ascending: false })
    .limit(1000);

  if (error) {
    return NextResponse.json(
      { success: false, error: 'فشل تحميل لوحة النتائج' },
      { status: 500 }
    );
  }

  const list = ((enrollments ?? []) as unknown) as Array<{
    id: string;
    subject_id: string;
    student_id: string;
    status: string;
    enrolled_at: string;
    subject: { id: string; name: string; level: string | null; sub_level: string | null } | null;
    student: { id: string; email: string; name: string | null; student_code: string | null } | null;
  }>;

  const total_registrations = list.length;
  const uniqueStudentIds = new Set<string>();
  const perCourseMap = new Map<string, { subject_id: string; subject_name: string; level: string | null; sub_level: string | null; students_count: number }>();
  const perMonthMap = new Map<string, number>();

  for (const e of list) {
    uniqueStudentIds.add(e.student_id);
    const sId = e.subject?.id ?? e.subject_id;
    if (!perCourseMap.has(sId)) {
      perCourseMap.set(sId, {
        subject_id: sId,
        subject_name: e.subject?.name ?? '—',
        level: e.subject?.level ?? null,
        sub_level: e.subject?.sub_level ?? null,
        students_count: 0,
      });
    }
    perCourseMap.get(sId)!.students_count += 1;
    if (e.enrolled_at) {
      const month = e.enrolled_at.slice(0, 7);
      perMonthMap.set(month, (perMonthMap.get(month) ?? 0) + 1);
    }
  }

  const perMonth: Array<{ month: string; count: number }> = [];
  const now = new Date();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    perMonth.push({ month, count: perMonthMap.get(month) ?? 0 });
  }

  const recent = list.slice(0, 10).map((e) => ({
    id: e.id,
    student_id: e.student_id,
    student_name: e.student?.name ?? null,
    student_email: e.student?.email ?? null,
    student_code: e.student?.student_code ?? null,
    subject_id: e.subject?.id ?? e.subject_id,
    subject_name: e.subject?.name ?? null,
    enrolled_at: e.enrolled_at,
  }));

  return NextResponse.json({
    success: true,
    totals: {
      total_registrations,
      total_unique_students: uniqueStudentIds.size,
      total_courses: perCourseMap.size,
    },
    per_course: Array.from(perCourseMap.values()),
    per_month: perMonth,
    recent,
  });
}

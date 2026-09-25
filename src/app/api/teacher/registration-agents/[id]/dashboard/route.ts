import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { requireTeacher, authErrorResponse } from '@/lib/auth-helpers';

/**
 * GET /api/teacher/registration-agents/[id]/dashboard
 *
 * Returns aggregated financial/stats data for a single agent:
 *   - total_registrations  (count of subject_students rows)
 *   - total_unique_students (count of distinct student_id)
 *   - per_course: [{ subject_id, subject_name, level, sub_level, students_count }]
 *   - per_month: [{ month: 'YYYY-MM', count }] for last 12 months
 *   - recent: [{ student_id, student_name, student_email, student_code, subject_name, enrolled_at }]
 *
 * Verifies the agent belongs to the requesting teacher (via direct
 * teacher_id on the agent row, with source-teacher fallback for old rows).
 *
 * NOTE: This endpoint does NOT compute monetary totals — fee/commission
 * logic is intentionally deferred. The counts returned here are the
 * building blocks the teacher can later multiply by a per-course fee.
 */
interface RouteContext {
  params: Promise<{ id: string }>;
}

interface PerCourseRow {
  subject_id: string;
  subject_name: string;
  level: string | null;
  sub_level: string | null;
  students_count: number;
}

interface PerMonthRow {
  month: string;
  count: number;
}

interface RecentRow {
  id: string;
  student_id: string;
  student_name: string | null;
  student_email: string | null;
  student_code: string | null;
  subject_id: string;
  subject_name: string | null;
  enrolled_at: string;
}

export async function GET(request: NextRequest, ctx: RouteContext) {
  const auth = await requireTeacher(request);
  if (!auth.success) return authErrorResponse(auth);

  const { id } = await ctx.params;
  const teacherId = auth.user.id;

  // 1) Verify ownership: direct teacher_id (v65) or via source (legacy).
  const { data: agentRow, error: agentErr } = await supabaseServer
    .from('registration_agents')
    .select('id, teacher_id, source_id, display_name, source:registration_sources(teacher_id)')
    .eq('id', id)
    .single();

  if (agentErr || !agentRow) {
    return NextResponse.json(
      { success: false, error: 'الوكيل غير موجود' },
      { status: 404 }
    );
  }

  const directTeacher = (agentRow as { teacher_id: string | null }).teacher_id;
  const sourceTeacher = (
    agentRow.source as unknown as { teacher_id: string } | null
  )?.teacher_id;
  const effectiveTeacher = directTeacher ?? sourceTeacher;

  if (effectiveTeacher !== teacherId) {
    return NextResponse.json(
      { success: false, error: 'لا تملك صلاحية الوصول لهذا الوكيل' },
      { status: 403 }
    );
  }

  // 2) Fetch ALL enrollments created by this agent, joined with subject + student.
  // `student:users!student_id(...)` hint is REQUIRED (subject_students has multiple FKs to users).
  const { data: enrollments, error: enrollErr } = await supabaseServer
    .from('subject_students')
    .select(
      'id, subject_id, student_id, status, enrolled_at, ' +
        'subject:subjects(id, name, level, sub_level), ' +
        'student:users!student_id(id, email, name, student_code)'
    )
    .eq('enrollment_agent_id', id)
    .order('enrolled_at', { ascending: false })
    .limit(1000);

  if (enrollErr) {
    return NextResponse.json(
      { success: false, error: 'فشل تحميل بيانات التسجيلات' },
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

  // 3) Aggregate in JS (the data volume is bounded to 1000 rows per agent).
  const total_registrations = list.length;
  const uniqueStudentIds = new Set<string>();
  const perCourseMap = new Map<string, PerCourseRow>();
  const perMonthMap = new Map<string, number>();

  for (const e of list) {
    uniqueStudentIds.add(e.student_id);

    const sId = e.subject?.id ?? e.subject_id;
    const sName = e.subject?.name ?? '—';
    if (!perCourseMap.has(sId)) {
      perCourseMap.set(sId, {
        subject_id: sId,
        subject_name: sName,
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

  // Per-month: fill last 12 months (including zeros)
  const perMonth: PerMonthRow[] = [];
  const now = new Date();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    perMonth.push({ month, count: perMonthMap.get(month) ?? 0 });
  }

  const recent: RecentRow[] = list.slice(0, 10).map((e) => ({
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
    agent: {
      id: (agentRow as { id: string }).id,
      display_name: (agentRow as { display_name: string | null }).display_name,
    },
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

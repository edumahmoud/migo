import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateRequest, getUserRole, authErrorResponse } from '@/lib/auth-helpers';

/**
 * GET /api/agent/student-subscriptions
 *
 * Returns a complete log of all student subscriptions for the calling
 * agent's teacher. Includes active, expired, and free enrollments.
 *
 * Authorization:
 *   - registration_agent: must be linked to a teacher (active agent row)
 *   - admin/superadmin: sees all subscriptions
 *   - teacher: sees own courses' subscriptions
 *
 * Returns:
 *   subscriptions: Array<{
 *     id, student_id, student_name, student_email, student_code,
 *     subject_id, subject_name, enrollment_method, status,
 *     period_start, period_end, next_billing_at, monthly_price,
 *     currency, enrolled_at
 *   }>
 */
export async function GET(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if (!auth.success) return authErrorResponse(auth);

  const role = await getUserRole(auth.user.id);
  if (!role || !['teacher', 'admin', 'superadmin', 'registration_agent'].includes(role)) {
    return NextResponse.json({ success: false, error: 'غير مصرح' }, { status: 403 });
  }

  // 1. Determine the teacher_id scope.
  let teacherIds: string[] = [];
  if (role === 'teacher') {
    teacherIds = [auth.user.id];
  } else if (role === 'admin' || role === 'superadmin') {
    // All teachers
    const { data: allTeachers } = await supabaseServer
      .from('users')
      .select('id')
      .eq('role', 'teacher');
    teacherIds = (allTeachers ?? []).map((u: { id: string }) => u.id);
  } else if (role === 'registration_agent') {
    const { data: agent } = await supabaseServer
      .from('registration_agents')
      .select('teacher_id')
      .eq('user_id', auth.user.id)
      .eq('is_active', true)
      .maybeSingle();
    const teacherId = (agent as { teacher_id: string } | null)?.teacher_id;
    if (!teacherId) {
      return NextResponse.json({ success: false, error: 'لا يوجد مشرف مرتبط بحسابك' }, { status: 403 });
    }
    teacherIds = [teacherId];
  }

  if (teacherIds.length === 0) {
    return NextResponse.json({ success: true, subscriptions: [] });
  }

  // 2. Fetch all subjects owned by these teachers (two-step to avoid JOIN issues).
  const { data: subjectRows, error: subjectErr } = await supabaseServer
    .from('subjects')
    .select('id, name, teacher_id, currency')
    .in('teacher_id', teacherIds);

  if (subjectErr) {
    return NextResponse.json({ success: false, error: subjectErr.message }, { status: 500 });
  }

  const subjectIds = (subjectRows ?? []).map((s: { id: string }) => s.id);
  const subjectMap = new Map<string, { id: string; name: string; teacher_id: string; currency: string }>(
    (subjectRows ?? []).map((s: { id: string; name: string; teacher_id: string; currency: string }) =>
      [s.id, { id: s.id, name: s.name, teacher_id: s.teacher_id, currency: s.currency }]
    )
  );

  if (subjectIds.length === 0) {
    return NextResponse.json({ success: true, subscriptions: [] });
  }

  // 3. Fetch all subject_students rows for these subjects.
  const { data: enrollmentRows, error: enrollErr } = await supabaseServer
    .from('subject_students')
    .select('id, subject_id, student_id, status, enrollment_method, current_period_start, current_period_end, next_billing_at, monthly_price, enrolled_at')
    .in('subject_id', subjectIds)
    .order('enrolled_at', { ascending: false, nullsFirst: false })
    .limit(500);

  if (enrollErr) {
    return NextResponse.json({ success: false, error: enrollErr.message }, { status: 500 });
  }

  if (!enrollmentRows || enrollmentRows.length === 0) {
    return NextResponse.json({ success: true, subscriptions: [] });
  }

  // 4. Fetch student profiles (two-step to avoid JOIN).
  const studentIds = Array.from(new Set(
    (enrollmentRows as Array<{ student_id: string }>).map((e) => e.student_id)
  ));
  const { data: studentRows } = await supabaseServer
    .from('users')
    .select('id, name, email, student_code')
    .in('id', studentIds);
  const studentMap = new Map<string, { id: string; name: string; email: string; student_code: string | null }>(
    (studentRows ?? []).map((u: { id: string; name: string; email: string; student_code: string | null }) =>
      [u.id, { id: u.id, name: u.name, email: u.email, student_code: u.student_code }]
    )
  );

  // 5. Combine into a flat list.
  const subscriptions = (enrollmentRows as Array<{
    id: string;
    subject_id: string;
    student_id: string;
    status: string;
    enrollment_method: string;
    current_period_start: string | null;
    current_period_end: string | null;
    next_billing_at: string | null;
    monthly_price: number | null;
    enrolled_at: string | null;
  }>).map((e) => {
    const subject = subjectMap.get(e.subject_id);
    const student = studentMap.get(e.student_id);
    return {
      id: e.id,
      student_id: e.student_id,
      student_name: student?.name ?? '',
      student_email: student?.email ?? '',
      student_code: student?.student_code ?? null,
      subject_id: e.subject_id,
      subject_name: subject?.name ?? '',
      enrollment_method: e.enrollment_method,
      status: e.status,
      period_start: e.current_period_start,
      period_end: e.current_period_end,
      next_billing_at: e.next_billing_at,
      monthly_price: e.monthly_price !== null && e.monthly_price !== undefined ? Number(e.monthly_price) : null,
      currency: subject?.currency ?? 'EGP',
      enrolled_at: e.enrolled_at,
    };
  });

  return NextResponse.json({ success: true, subscriptions });
}

import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { requireEligibleStudent, authErrorResponse } from '@/lib/auth-helpers';

/**
 * GET /api/student/activation/me
 *
 * Returns the calling PENDING student's:
 *   - student_code (existing Student Code from v64)
 *   - account_status
 *   - linked teachers (from teacher_student_links where status='approved')
 *   - available courses for those teachers (subscription_open=true, is_paused=false)
 *     with their real price (server-side source of truth)
 *
 * Used by the activation page to render the whole flow.
 */
export async function GET(request: NextRequest) {
  const auth = await requireEligibleStudent(request);
  if (!auth.success) return authErrorResponse(auth);

  const studentId = auth.user.id;

  // 1. Student's own profile (student_code + account_status).
  const { data: profile, error: profileErr } = await supabaseServer
    .from('users')
    .select('id, email, name, student_code, account_status')
    .eq('id', studentId)
    .maybeSingle();

  if (profileErr || !profile) {
    return NextResponse.json(
      { success: false, error: 'تعذّر تحميل بيانات الطالب' },
      { status: 500 }
    );
  }

  // 2. Linked teachers (auto-approved links from the activation flow).
  const { data: links } = await supabaseServer
    .from('teacher_student_links')
    .select('teacher_id, status, created_at, teacher:users!teacher_id(id, name, email, teacher_code)')
    .eq('student_id', studentId)
    .eq('status', 'approved');

  const teacherIds = ((links ?? []) as Array<{ teacher_id: string }>).map((l) => l.teacher_id);

  // 3. Available courses for those teachers.
  let courses: Array<{
    id: string;
    name: string;
    description: string | null;
    level: string | null;
    sub_level: string | null;
    price: number;
    currency: string;
    join_code: string | null;
    teacher_id: string;
    teacher_name: string | null;
  }> = [];
  if (teacherIds.length > 0) {
    const { data: subjectRows, error: subjectErr } = await supabaseServer
      .from('subjects')
      .select('id, name, description, level, sub_level, price, currency, join_code, teacher_id, is_paused, subscription_open')
      .in('teacher_id', teacherIds)
      .eq('is_paused', false)
      .eq('subscription_open', true);

    if (subjectErr) {
      console.error('[activation/me] subjects query error:', subjectErr);
    }

    const teacherNameById = new Map<string, string | null>();
    for (const l of (links ?? []) as unknown as Array<{
      teacher: { id: string; name: string | null } | null;
      teacher_id: string;
    }>) {
      if (l.teacher) {
        teacherNameById.set(l.teacher_id, l.teacher.name);
      }
    }

    courses = ((subjectRows ?? []) as Array<{
      id: string;
      name: string;
      description: string | null;
      level: string | null;
      sub_level: string | null;
      price: number;
      currency: string;
      join_code: string | null;
      teacher_id: string;
      is_paused: boolean;
      subscription_open: boolean;
    }>).map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      level: s.level,
      sub_level: s.sub_level,
      price: Number(s.price),
      currency: s.currency,
      join_code: s.join_code,
      teacher_id: s.teacher_id,
      teacher_name: teacherNameById.get(s.teacher_id) ?? null,
    }));
  }

  // 4. Active orders + payment status.
  const { data: orders } = await supabaseServer
    .from('orders')
    .select('id, subject_id, amount, currency, provider, status, confirmation_mode, created_at, paid_at')
    .eq('student_id', studentId)
    .order('created_at', { ascending: false })
    .limit(10);

  // 5. Existing subscriptions (for showing period/expiry on the activation page).
  const { data: subscriptions } = await supabaseServer
    .from('subject_students')
    .select('subject_id, status, enrollment_method, current_period_start, current_period_end, next_billing_at, monthly_price, enrolled_at')
    .eq('student_id', studentId)
    .eq('enrollment_method', 'self_paid')
    .order('current_period_end', { ascending: false, nullsFirst: false });

  return NextResponse.json({
    success: true,
    student: profile,
    linked_teachers: (links ?? []) as Array<unknown>,
    available_courses: courses,
    recent_orders: orders ?? [],
    subscriptions: subscriptions ?? [],
  });
}

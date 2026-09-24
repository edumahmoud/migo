import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseServer } from '@/lib/supabase-server';
import { requireAgent, authErrorResponse } from '@/lib/auth-helpers';

/**
 * POST /api/agent/lookup-student-by-code
 *
 * Body: { studentCode: string }
 *
 * Looks up a student by their student_code, verifies they are linked to
 * the agent's teacher (via teacher_student_links.status='approved'),
 * and returns their profile + their currently-enrolled courses for that
 * teacher (so the agent can avoid re-enrolling them in courses they're
 * already in).
 *
 * Used by the agent portal's "طالب مسجّل مسبقاً" mode.
 */
const BodySchema = z.object({
  studentCode: z.string().trim().min(1).max(40),
});

export async function POST(request: NextRequest) {
  const auth = await requireAgent(request);
  if (!auth.success) return authErrorResponse(auth);

  const { sourceTeacherId } = auth;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: 'صيغة JSON غير صالحة' }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: 'الكود غير صالح' }, { status: 400 });
  }

  // Find the student by code.
  const { data: student, error: studentErr } = await supabaseServer
    .from('users')
    .select('id, email, name, student_code, role')
    .eq('student_code', parsed.data.studentCode.toUpperCase())
    .maybeSingle();

  if (studentErr) {
    return NextResponse.json({ success: false, error: 'تعذّر البحث' }, { status: 500 });
  }

  if (!student) {
    return NextResponse.json(
      { success: false, error: 'لا يوجد طالب بهذا الكود' },
      { status: 404 }
    );
  }

  // Verify the student is linked to the agent's teacher.
  const { data: link } = await supabaseServer
    .from('teacher_student_links')
    .select('teacher_id, student_id, status')
    .eq('teacher_id', sourceTeacherId)
    .eq('student_id', (student as { id: string }).id)
    .eq('status', 'approved')
    .maybeSingle();

  if (!link) {
    return NextResponse.json(
      {
        success: false,
        error: 'هذا الطالب غير مرتبط بمعلمك. لا يمكنك تسجيله في دورات جديدة.',
      },
      { status: 403 }
    );
  }

  // Fetch the courses this student is currently enrolled in (for this teacher).
  const { data: enrollments } = await supabaseServer
    .from('subject_students')
    .select('subject_id, status, subject:subjects!inner(id, name, level, sub_level)')
    .eq('student_id', (student as { id: string }).id)
    .eq('subject.teacher_id', sourceTeacherId);

  const currentlyEnrolledCourses = ((enrollments ?? []) as unknown as Array<{
    subject_id: string;
    status: string;
    subject: Array<{ id: string; name: string; level: string | null; sub_level: string | null }>;
  }>)
    .map((e) => {
      const s = e.subject?.[0];
      return {
        subject_id: e.subject_id,
        subject_name: s?.name ?? '—',
        level: s?.level ?? null,
        sub_level: s?.sub_level ?? null,
        status: e.status,
      };
    });

  return NextResponse.json({
    success: true,
    student: {
      id: (student as { id: string }).id,
      email: (student as { email: string }).email,
      name: (student as { name: string | null }).name,
      student_code: (student as { student_code: string | null }).student_code,
    },
    currently_enrolled_courses: currentlyEnrolledCourses,
  });
}

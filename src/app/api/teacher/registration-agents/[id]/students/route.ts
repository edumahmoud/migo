import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { requireTeacher, authErrorResponse } from '@/lib/auth-helpers';

/**
 * GET /api/teacher/registration-agents/[id]/students
 *
 * Returns the list of students registered by THIS agent (via
 * subject_students.enrollment_agent_id = agent.id), joined with the
 * subject and the student user row.
 *
 * Verifies the agent belongs to a source owned by the requesting teacher.
 */
interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, ctx: RouteContext) {
  const auth = await requireTeacher(request);
  if (!auth.success) return authErrorResponse(auth);

  const { id } = await ctx.params;
  const teacherId = auth.user.id;

  // Verify ownership: agent.source → source.teacher_id === requester.
  const { data: agentRow, error: agentErr } = await supabaseServer
    .from('registration_agents')
    .select('id, source_id, source:registration_sources!inner(id, teacher_id)')
    .eq('id', id)
    .single();

  if (agentErr || !agentRow) {
    return NextResponse.json(
      { success: false, error: 'الوكيل غير موجود' },
      { status: 404 }
    );
  }

  const ownerTeacherId =
    (agentRow.source as unknown as { teacher_id: string } | null)?.teacher_id ?? null;

  if (ownerTeacherId !== teacherId) {
    return NextResponse.json(
      { success: false, error: 'لا تملك صلاحية الوصول لهذا الوكيل' },
      { status: 403 }
    );
  }

  // Fetch all enrollments this agent created, joined with subject + student user.
  const { data, error } = await supabaseServer
    .from('subject_students')
    .select(
      'id, subject_id, student_id, status, enrollment_method, enrolled_at, ' +
        'subject:subjects(id, name, join_code, level, sub_level, is_paused), ' +
        'student:users(id, email, name, student_code, username)'
    )
    .eq('enrollment_agent_id', id)
    .order('enrolled_at', { ascending: false })
    .limit(500);

  if (error) {
    return NextResponse.json(
      { success: false, error: 'فشل تحميل طلاب الوكيل' },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true, students: data ?? [] });
}

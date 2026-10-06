import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseServer } from '@/lib/supabase-server';
import { requireAgent, authErrorResponse } from '@/lib/auth-helpers';

/**
 * POST /api/agent/students/[id]/activate
 *
 * Agent-side endpoint to lift a course-scoped suspension on a student.
 * Mirrors /api/teacher/students/[id]/activate but uses requireAgent.
 *
 * Body:
 *   { subjectId: string }
 *
 * Returns:
 *   { success: true, lifted: <count> }
 */
const ActivateSchema = z.object({
  subjectId: z.string().uuid(),
});

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(request: NextRequest, ctx: RouteContext) {
  const auth = await requireAgent(request);
  if (!auth.success) return authErrorResponse(auth);

  const { id: studentId } = await ctx.params;
  const teacherId = auth.sourceTeacherId;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: 'صيغة JSON غير صالحة' },
      { status: 400 },
    );
  }

  const parsed = ActivateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: 'البيانات غير صالحة', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { subjectId } = parsed.data;

  // Verify the subject belongs to the agent's teacher.
  const { data: subject } = await supabaseServer
    .from('subjects')
    .select('id, teacher_id')
    .eq('id', subjectId)
    .maybeSingle();

  if (!subject) {
    return NextResponse.json(
      { success: false, error: 'المقرر غير موجود' },
      { status: 404 },
    );
  }

  if (subject.teacher_id !== teacherId) {
    return NextResponse.json(
      { success: false, error: 'لا تملك هذا المقرر' },
      { status: 403 },
    );
  }

  const nowIso = new Date().toISOString();
  const { data: lifted, error: updateErr } = await supabaseServer
    .from('student_suspensions')
    .update({ is_active: false, lifted_at: nowIso, lifted_by: auth.user.id })
    .eq('student_id', studentId)
    .eq('scope', 'course')
    .eq('subject_id', subjectId)
    .eq('is_active', true)
    .select('id');

  if (updateErr) {
    console.error('[POST /api/agent/students/[id]/activate] update error:', updateErr);
    return NextResponse.json(
      { success: false, error: 'فشل فك الإيقاف' },
      { status: 500 },
    );
  }

  return NextResponse.json({
    success: true,
    lifted: (lifted ?? []).length,
  });
}

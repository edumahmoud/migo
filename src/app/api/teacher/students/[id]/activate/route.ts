import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseServer } from '@/lib/supabase-server';
import { requireTeacher, authErrorResponse } from '@/lib/auth-helpers';

/**
 * POST /api/teacher/students/[id]/activate
 *
 * Lift an active suspension for a student. Teachers can only lift
 * course-scoped suspensions on subjects they own.
 *
 * Body:
 *   { scope: 'course', subjectId: string }
 *
 * Returns:
 *   { success: true, lifted: <count> }
 */
const ActivateSchema = z.object({
  scope: z.enum(['course', 'global']),
  subjectId: z.string().uuid().optional(),
});

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(request: NextRequest, ctx: RouteContext) {
  const auth = await requireTeacher(request);
  if (!auth.success) return authErrorResponse(auth);

  const { id: studentId } = await ctx.params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: 'صيغة JSON غير صالحة' },
      { status: 400 }
    );
  }

  const parsed = ActivateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: 'البيانات غير صالحة', details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { scope, subjectId } = parsed.data;

  if (scope === 'course' && !subjectId) {
    return NextResponse.json(
      { success: false, error: 'يجب تحديد المقرر' },
      { status: 400 }
    );
  }

  if (scope === 'global') {
    return NextResponse.json(
      { success: false, error: 'فك الإيقاف على مستوى المنصة متاح للمشرف فقط.' },
      { status: 403 }
    );
  }

  // Verify ownership of the subject.
  const { data: subject } = await supabaseServer
    .from('subjects')
    .select('id, teacher_id')
    .eq('id', subjectId!)
    .maybeSingle();

  if (!subject) {
    return NextResponse.json(
      { success: false, error: 'المقرر غير موجود' },
      { status: 404 }
    );
  }

  if (subject.teacher_id !== auth.user.id) {
    return NextResponse.json(
      { success: false, error: 'لا تملك هذا المقرر' },
      { status: 403 }
    );
  }

  const nowIso = new Date().toISOString();
  const { data: lifted, error: updateErr } = await supabaseServer
    .from('student_suspensions')
    .update({ is_active: false, lifted_at: nowIso, lifted_by: auth.user.id })
    .eq('student_id', studentId)
    .eq('scope', 'course')
    .eq('subject_id', subjectId!)
    .eq('is_active', true)
    .select('id');

  if (updateErr) {
    console.error('[POST /api/teacher/students/[id]/activate] update error:', updateErr);
    return NextResponse.json(
      { success: false, error: 'فشل فك الإيقاف' },
      { status: 500 }
    );
  }

  return NextResponse.json({
    success: true,
    lifted: (lifted ?? []).length,
  });
}

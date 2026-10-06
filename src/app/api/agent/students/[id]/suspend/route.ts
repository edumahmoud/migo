import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseServer } from '@/lib/supabase-server';
import { requireAgent, authErrorResponse } from '@/lib/auth-helpers';

/**
 * POST /api/agent/students/[id]/suspend
 *
 * Agent-side endpoint to suspend a student in one of the agent's
 * teacher's courses. Mirrors the teacher's
 * /api/teacher/students/[id]/suspend but uses requireAgent + the
 * agent's sourceTeacherId for ownership verification.
 *
 * Agents can ONLY issue course-scoped suspensions (scope='course')
 * — global suspensions are admin-only and will be rejected here.
 *
 * Body:
 *   {
 *     subjectId: string,             // required
 *     durationHours?: number | null, // null = indefinite
 *     reason?: string
 *   }
 *
 * Returns:
 *   { success: true, suspension: {...} }
 *   { success: false, error: '...' }
 */
const SuspendSchema = z.object({
  subjectId: z.string().uuid(),
  durationHours: z.number().positive().max(24 * 365).nullable().optional(),
  reason: z.string().trim().max(500).optional(),
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

  const parsed = SuspendSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: 'البيانات غير صالحة', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { subjectId, durationHours, reason } = parsed.data;

  // Verify the subject belongs to the agent's teacher.
  const { data: subject, error: subjectErr } = await supabaseServer
    .from('subjects')
    .select('id, name, teacher_id')
    .eq('id', subjectId)
    .maybeSingle();

  if (subjectErr || !subject) {
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

  // Verify the student is enrolled in this subject.
  const { data: enrollment } = await supabaseServer
    .from('subject_students')
    .select('id, status')
    .eq('subject_id', subjectId)
    .eq('student_id', studentId)
    .maybeSingle();

  if (!enrollment) {
    return NextResponse.json(
      { success: false, error: 'الطالب غير مسجل في هذا المقرر' },
      { status: 404 },
    );
  }

  // Compute expires_at.
  let expiresAt: string | null = null;
  if (durationHours !== null && durationHours !== undefined) {
    expiresAt = new Date(Date.now() + durationHours * 3600 * 1000).toISOString();
  }

  // Lift any existing active suspension for this (student, course).
  const nowIso = new Date().toISOString();
  await supabaseServer
    .from('student_suspensions')
    .update({ is_active: false, lifted_at: nowIso, lifted_by: auth.user.id })
    .eq('student_id', studentId)
    .eq('scope', 'course')
    .eq('subject_id', subjectId)
    .eq('is_active', true);

  // Insert the new suspension. Uses the service role so the agent's
  // session doesn't need direct INSERT privileges on student_suspensions
  // (the RLS policy allows teachers, but agents aren't teachers —
  // we explicitly proxy via the agent's sourceTeacherId ownership
  // check above).
  const { data: suspension, error: insertErr } = await supabaseServer
    .from('student_suspensions')
    .insert({
      student_id: studentId,
      subject_id: subjectId,
      scope: 'course',
      reason: reason ?? null,
      suspended_by: auth.user.id,
      expires_at: expiresAt,
      is_active: true,
    })
    .select('id, student_id, subject_id, scope, reason, suspended_by, suspended_at, expires_at, is_active')
    .single();

  if (insertErr) {
    console.error('[POST /api/agent/students/[id]/suspend] insert error:', insertErr);
    return NextResponse.json(
      { success: false, error: 'فشل إنشاء الإيقاف: ' + (insertErr.message ?? 'unknown') },
      { status: 500 },
    );
  }

  return NextResponse.json({
    success: true,
    suspension,
  });
}

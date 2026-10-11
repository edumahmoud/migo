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

  // v131: Refuse to suspend a subject that already has an active
  // (non-expired) suspension. Previously this route silently lifted
  // any existing suspension and created a new one — which made it
  // impossible to tell from the UI whether a re-suspend extended the
  // existing period or reset it, and also bypassed the user's mental
  // model of "the subject is paused, I can't pause it again".
  //
  // Now we explicitly reject with a 409 so the client can show a clear
  // message ("ارفع الإيقاف الحالي أولاً"). The user must lift the
  // existing suspension before issuing a new one.
  const nowIso = new Date().toISOString();
  const { data: existingActive, error: existingErr } = await supabaseServer
    .from('student_suspensions')
    .select('id, expires_at')
    .eq('student_id', studentId)
    .eq('scope', 'course')
    .eq('subject_id', subjectId)
    .eq('is_active', true)
    .maybeSingle();

  if (existingErr) {
    console.error('[POST /api/agent/students/[id]/suspend] existing-check error:', existingErr);
    return NextResponse.json(
      { success: false, error: 'فشل التحقق من الإيقافات الحالية' },
      { status: 500 },
    );
  }

  if (existingActive) {
    const stillActive =
      existingActive.expires_at === null || existingActive.expires_at > nowIso;
    if (stillActive) {
      return NextResponse.json(
        {
          success: false,
          error: 'يوجد إيقاف نشط لهذا المقرر بالفعل. ارفع الإيقاف الحالي أولاً لإعادة الإيقاف.',
          code: 'ALREADY_SUSPENDED',
        },
        { status: 409 },
      );
    }
  }

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
    // v131: handle the unique partial index violation gracefully —
    // this happens if a parallel request created an active suspension
    // between our pre-check above and this INSERT.
    if (insertErr.code === '23505') {
      return NextResponse.json(
        {
          success: false,
          error: 'يوجد إيقاف نشط لهذا المقرر بالفعل. ارفع الإيقاف الحالي أولاً لإعادة الإيقاف.',
          code: 'ALREADY_SUSPENDED',
        },
        { status: 409 },
      );
    }
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

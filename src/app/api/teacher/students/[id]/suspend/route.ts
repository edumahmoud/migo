import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseServer } from '@/lib/supabase-server';
import { requireTeacher, authErrorResponse } from '@/lib/auth-helpers';
import { notifyUser } from '@/lib/notifications-service';

/**
 * POST /api/teacher/students/[id]/suspend
 *
 * Suspend a student either globally (scope='global') or per-course
 * (scope='course'). Teachers can ONLY issue course-scoped suspensions
 * for students enrolled in their own subjects — global suspensions
 * are admin-only and will be rejected at the RLS layer.
 *
 * Body:
 *   {
 *     scope: 'course' | 'global',   // teachers should send 'course'
 *     subjectId: string,             // required when scope='course'
 *     durationHours?: number | null, // null = indefinite; otherwise hours
 *     reason?: string
 *   }
 *
 * Returns:
 *   { success: true, suspension: {...} }
 *   { success: false, error: '...' }
 */
const SuspendSchema = z.object({
  scope: z.enum(['course', 'global']),
  subjectId: z.string().uuid().optional(),
  durationHours: z.number().positive().max(24 * 365).nullable().optional(),
  reason: z.string().trim().max(500).optional(),
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

  const parsed = SuspendSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: 'البيانات غير صالحة', details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { scope, subjectId, durationHours, reason } = parsed.data;

  if (scope === 'course' && !subjectId) {
    return NextResponse.json(
      { success: false, error: 'يجب تحديد المقرر للإيقاف على مستوى المقرر' },
      { status: 400 }
    );
  }

  // Teachers can ONLY issue course-scoped suspensions.
  if (scope === 'global') {
    return NextResponse.json(
      {
        success: false,
        error: 'الإيقاف على مستوى المنصة متاح للمشرف فقط. استخدم scope=course لإيقاف الطالب من مقرر معين.',
      },
      { status: 403 }
    );
  }

  // Verify the teacher owns this subject.
  const { data: subject, error: subjectErr } = await supabaseServer
    .from('subjects')
    .select('id, name, teacher_id')
    .eq('id', subjectId!)
    .maybeSingle();

  if (subjectErr || !subject) {
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

  // Verify the student is enrolled in this subject.
  const { data: enrollment } = await supabaseServer
    .from('subject_students')
    .select('id, status')
    .eq('subject_id', subjectId!)
    .eq('student_id', studentId)
    .maybeSingle();

  if (!enrollment) {
    return NextResponse.json(
      { success: false, error: 'الطالب غير مسجل في هذا المقرر' },
      { status: 404 }
    );
  }

  // Compute expires_at if duration given.
  let expiresAt: string | null = null;
  if (durationHours !== null && durationHours !== undefined) {
    expiresAt = new Date(Date.now() + durationHours * 3600 * 1000).toISOString();
  }

  // Lift any existing active suspension for this (student, scope=course, subject).
  const nowIso = new Date().toISOString();
  await supabaseServer
    .from('student_suspensions')
    .update({ is_active: false, lifted_at: nowIso, lifted_by: auth.user.id })
    .eq('student_id', studentId)
    .eq('scope', 'course')
    .eq('subject_id', subjectId!)
    .eq('is_active', true);

  // Insert the new suspension.
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
    console.error('[POST /api/teacher/students/[id]/suspend] insert error:', insertErr);
    return NextResponse.json(
      { success: false, error: 'فشل إنشاء الإيقاف: ' + (insertErr.message ?? 'unknown') },
      { status: 500 }
    );
  }

  // v130: Notify the student about the suspension
  try {
    const durationText = expiresAt
      ? `حتى ${new Date(expiresAt).toLocaleString('ar-EG', { dateStyle: 'medium', timeStyle: 'short' })}`
      : 'إيقاف غير محدد المدة';
    await notifyUser(
      studentId,
      'system',
      'تم إيقافك من مقرر',
      `تم إيقافك من مقرر "${subject.name}" ${durationText}` +
      (reason ? `. السبب: ${reason}` : '') +
      `. تواصل مع المعلم للاستفسار.`,
      undefined
    );
  } catch (notifErr) {
    console.error('[suspend] Failed to notify student:', notifErr);
  }

  return NextResponse.json({
    success: true,
    suspension,
  });
}

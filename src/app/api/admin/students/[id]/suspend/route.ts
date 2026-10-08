import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseServer } from '@/lib/supabase-server';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helpers';

/**
 * POST /api/admin/students/[id]/suspend
 *
 * Admin-only. Suspend a student globally or per-course.
 *
 * Body:
 *   {
 *     scope: 'global' | 'course',
 *     subjectId?: string,             // required when scope='course'
 *     durationHours?: number | null,  // null = indefinite
 *     reason?: string
 *   }
 */
const SuspendSchema = z.object({
  scope: z.enum(['global', 'course']),
  subjectId: z.string().uuid().optional(),
  durationHours: z.number().positive().max(24 * 365 * 5).nullable().optional(),
  reason: z.string().trim().max(500).optional(),
});

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(request: NextRequest, ctx: RouteContext) {
  const auth = await requireAdmin(request);
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

  // Verify the student exists.
  const { data: student } = await supabaseServer
    .from('users')
    .select('id, role')
    .eq('id', studentId)
    .maybeSingle();

  if (!student) {
    return NextResponse.json(
      { success: false, error: 'المستخدم غير موجود' },
      { status: 404 }
    );
  }

  if (student.role !== 'student') {
    return NextResponse.json(
      { success: false, error: 'الإيقاف متاح لحسابات الطلاب فقط' },
      { status: 400 }
    );
  }

  // For course-scoped suspensions, verify the subject exists.
  if (scope === 'course') {
    const { data: subject } = await supabaseServer
      .from('subjects')
      .select('id, name')
      .eq('id', subjectId!)
      .maybeSingle();

    if (!subject) {
      return NextResponse.json(
        { success: false, error: 'المقرر غير موجود' },
        { status: 404 }
      );
    }
  }

  // Compute expires_at.
  let expiresAt: string | null = null;
  if (durationHours !== null && durationHours !== undefined) {
    expiresAt = new Date(Date.now() + durationHours * 3600 * 1000).toISOString();
  }

  // Lift any existing active suspension for the same (student, scope, subject).
  const nowIso = new Date().toISOString();
  const matchBuilder = supabaseServer
    .from('student_suspensions')
    .update({ is_active: false, lifted_at: nowIso, lifted_by: auth.user.id })
    .eq('student_id', studentId)
    .eq('scope', scope)
    .eq('is_active', true);

  if (scope === 'course') {
    matchBuilder.eq('subject_id', subjectId!);
  } else {
    matchBuilder.is('subject_id', null);
  }

  await matchBuilder;

  // Insert the new suspension.
  const { data: suspension, error: insertErr } = await supabaseServer
    .from('student_suspensions')
    .insert({
      student_id: studentId,
      subject_id: scope === 'course' ? subjectId : null,
      scope,
      reason: reason ?? null,
      suspended_by: auth.user.id,
      expires_at: expiresAt,
      is_active: true,
    })
    .select('id, student_id, subject_id, scope, reason, suspended_by, suspended_at, expires_at, is_active')
    .single();

  if (insertErr) {
    console.error('[POST /api/admin/students/[id]/suspend] insert error:', insertErr);
    return NextResponse.json(
      { success: false, error: 'فشل إنشاء الإيقاف: ' + (insertErr.message ?? 'unknown') },
      { status: 500 }
    );
  }

  return NextResponse.json({
    success: true,
    suspension,
  });
}

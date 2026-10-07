import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseServer } from '@/lib/supabase-server';
import { requireAgent, authErrorResponse } from '@/lib/auth-helpers';
import { notifyUser } from '@/lib/notifications-service';

/**
 * POST /api/agent/enrollment
 *
 * Agent-side wrapper around the teacher's enrollment approve/reject
 * flow. Mirrors /api/enrollment but uses requireAgent + verifies
 * subject ownership via the agent's sourceTeacherId.
 *
 * Body:
 *   {
 *     action: 'approve' | 'reject' | 'approveAll' | 'rejectAll',
 *     subjectId: string,
 *     studentId?: string,  // required for 'approve' + 'reject'
 *   }
 *
 * Authorization:
 *   - Caller must be a registration_agent
 *   - The subject must belong to the agent's teacher (sourceTeacherId)
 *
 * Side effects:
 *   - approve → subject_students.status = 'approved' + teacher_student_links
 *     upsert (status='approved') + notifyUser (student gets a notification)
 *   - reject → subject_students row deleted (or status='rejected')
 *   - approveAll / rejectAll → applies to ALL pending enrollments in the
 *     specified subject
 */
const BodySchema = z.object({
  action: z.enum(['approve', 'reject', 'approveAll', 'rejectAll']),
  subjectId: z.string().uuid(),
  studentId: z.string().uuid().optional(),
});

export async function POST(request: NextRequest) {
  const auth = await requireAgent(request);
  if (!auth.success) return authErrorResponse(auth);

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

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: 'البيانات غير صالحة', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { action, subjectId, studentId } = parsed.data;

  // For 'approve' + 'reject', studentId is required.
  if ((action === 'approve' || action === 'reject') && !studentId) {
    return NextResponse.json(
      { success: false, error: 'معرف الطالب مطلوب لهذا الإجراء' },
      { status: 400 },
    );
  }

  // Verify the subject belongs to the agent's teacher.
  const { data: subject, error: subjectErr } = await supabaseServer
    .from('subjects')
    .select('id, name, teacher_id, price')
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

  // Fetch pending enrollment rows that match the action scope.
  let pendingQuery = supabaseServer
    .from('subject_students')
    .select('id, student_id, subject_id, status, enrollment_method')
    .eq('subject_id', subjectId)
    .eq('status', 'pending');

  if (action === 'approve' || action === 'reject') {
    pendingQuery = pendingQuery.eq('student_id', studentId!);
  }

  const { data: pendingRows, error: pendingErr } = await pendingQuery;

  if (pendingErr) {
    return NextResponse.json(
      { success: false, error: 'تعذّر جلب الطلبات المعلّقة' },
      { status: 500 },
    );
  }

  if (!pendingRows || pendingRows.length === 0) {
    return NextResponse.json({
      success: true,
      action,
      affected: 0,
      message: 'لا توجد طلبات معلّقة مطابقة',
    });
  }

  const affectedStudentIds: string[] = [];
  let affected = 0;

  if (action === 'approve' || action === 'approveAll') {
    // Update each pending enrollment to 'approved'.
    const studentIds = pendingRows.map((r: { student_id: string }) => r.student_id);
    affectedStudentIds.push(...studentIds);

    const { error: updateErr } = await supabaseServer
      .from('subject_students')
      .update({
        status: 'approved',
        enrolled_at: new Date().toISOString(),
        enrollment_method: 'teacher_add',
      })
      .in('student_id', studentIds)
      .eq('subject_id', subjectId)
      .eq('status', 'pending');

    if (updateErr) {
      return NextResponse.json(
        { success: false, error: 'فشل قبول الطلبات: ' + updateErr.message },
        { status: 500 },
      );
    }

    affected = studentIds.length;

    // Upsert teacher_student_links (status='approved') so the student
    // appears in the teacher's "Students" section.
    const linkRows = studentIds.map(sid => ({
      teacher_id: teacherId,
      student_id: sid,
      status: 'approved',
      initiated_by: 'teacher',
    }));

    await supabaseServer
      .from('teacher_student_links')
      .upsert(linkRows, { onConflict: 'teacher_id,student_id' })
      .then(({ error }) => {
        if (error) console.warn('[agent/enrollment] teacher_student_links upsert failed:', error.message);
      });

    // Activate the students' user accounts (defensive — pending → active).
    await supabaseServer
      .from('users')
      .update({ account_status: 'active', updated_at: new Date().toISOString() })
      .in('id', studentIds)
      .in('account_status', ['pending', 'pending_verification', null]);
  } else {
    // action === 'reject' || action === 'rejectAll' → DELETE the pending rows.
    const studentIds = pendingRows.map((r: { student_id: string }) => r.student_id);
    affectedStudentIds.push(...studentIds);

    const { error: deleteErr } = await supabaseServer
      .from('subject_students')
      .delete()
      .in('student_id', studentIds)
      .eq('subject_id', subjectId)
      .eq('status', 'pending');

    if (deleteErr) {
      return NextResponse.json(
        { success: false, error: 'فشل رفض الطلبات: ' + deleteErr.message },
        { status: 500 },
      );
    }

    affected = studentIds.length;
  }

  // Send a notification to each affected student (best-effort).
  for (const sid of affectedStudentIds) {
    try {
      const verb = action.startsWith('approve') ? 'تم قبول' : 'تم رفض';
      await notifyUser(
        sid,
        'enrollment_status',
        `${verb} طلب الانضمام`,
        `${verb} طلبك للانضمام إلى المقرر: ${subject.name}`,
      );
    } catch (err) {
      console.warn('[agent/enrollment] notifyUser failed:', err);
    }
  }

  return NextResponse.json({
    success: true,
    action,
    affected,
    message: action.startsWith('approve')
      ? `تم قبول ${affected} طلب`
      : `تم رفض ${affected} طلب`,
  });
}

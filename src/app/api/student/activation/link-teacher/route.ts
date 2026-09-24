import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseServer } from '@/lib/supabase-server';
import { requirePendingStudent, authErrorResponse } from '@/lib/auth-helpers';

/**
 * POST /api/student/activation/link-teacher
 *
 * Body: { teacherCode: string }
 *
 * Validates the teacher code and creates an APPROVED teacher_student_links row.
 * Distinct from the existing /api/link-teacher flow (which creates a PENDING link
 * requiring teacher approval) — the activation flow auto-approves because the
 * student is paying (the teacher has no reason to reject a paying student).
 *
 * Validation (server-side):
 *   - Code exists
 *   - Teacher exists + is active (not banned)
 *   - Student is PENDING (the requirePendingStudent guard)
 *   - If a link already exists (any status), update it to 'approved'.
 *   - If no link, create one with status='approved', initiated_by='student'.
 */
const BodySchema = z.object({
  teacherCode: z.string().trim().min(1).max(40),
});

export async function POST(request: NextRequest) {
  const auth = await requirePendingStudent(request);
  if (!auth.success) return authErrorResponse(auth);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: 'صيغة JSON غير صالحة' }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: 'الكود غير صالح' },
      { status: 400 }
    );
  }

  // Lookup teacher by teacher_code (uppercase, exact match).
  const { data: teacher, error: teacherErr } = await supabaseServer
    .from('users')
    .select('id, name, email, role, teacher_code')
    .eq('teacher_code', parsed.data.teacherCode.toUpperCase())
    .maybeSingle();

  if (teacherErr) {
    return NextResponse.json({ success: false, error: 'تعذّر البحث عن المعلم' }, { status: 500 });
  }

  if (!teacher) {
    return NextResponse.json({ success: false, error: 'كود المعلم غير صحيح' }, { status: 404 });
  }

  const teacherRow = teacher as { id: string; name: string | null; email: string; role: string; teacher_code: string };

  if (teacherRow.role !== 'teacher') {
    return NextResponse.json(
      { success: false, error: 'هذا الكود لا ينتمي إلى معلم' },
      { status: 400 }
    );
  }

  // Check if teacher is banned (defense — admin may have banned them).
  const { data: bannedRecord } = await supabaseServer
    .from('banned_users')
    .select('id, is_active, ban_until')
    .eq('email', teacherRow.email)
    .maybeSingle();

  if (bannedRecord) {
    const isActive = (bannedRecord as { is_active: boolean | null }).is_active !== false;
    const banUntil = (bannedRecord as { ban_until: string | null }).ban_until;
    const isExpired = banUntil && new Date(banUntil) <= new Date();
    if (isActive && !isExpired) {
      return NextResponse.json(
        { success: false, error: 'هذا المعلم موقوف. تواصل مع الإدارة.' },
        { status: 403 }
      );
    }
  }

  // Upsert the link (auto-approved for the activation flow).
  const studentId = auth.user.id;
  const { data: upserted, error: upsertErr } = await supabaseServer
    .from('teacher_student_links')
    .upsert(
      {
        teacher_id: teacherRow.id,
        student_id: studentId,
        status: 'approved',
        initiated_by: 'student',
      },
      { onConflict: 'teacher_id,student_id' }
    )
    .select('id, teacher_id, student_id, status, initiated_by, created_at')
    .single();

  if (upsertErr) {
    return NextResponse.json(
      { success: false, error: 'فشل الربط مع المعلم: ' + upsertErr.message },
      { status: 500 }
    );
  }

  return NextResponse.json({
    success: true,
    link: upserted,
    teacher: { id: teacherRow.id, name: teacherRow.name, email: teacherRow.email },
  });
}

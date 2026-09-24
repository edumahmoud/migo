import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { randomBytes, randomUUID } from 'crypto';
import { supabaseServer } from '@/lib/supabase-server';
import { requireAgent, authErrorResponse } from '@/lib/auth-helpers';

/**
 * POST /api/agent/register-student
 *
 * Body:
 *   {
 *     studentEmail: string,
 *     studentName:  string,
 *     studentPhone?: string,   // optional
 *     subjectId:    string     // UUID of the course (subjects.id) the student
 *                              // is being enrolled into
 *   }
 *
 * Flow:
 *   1. requireAgent → agent.user_id, agent.source_id, source.teacher_id
 *   2. Validate subjectId belongs to source.teacher_id (defense-in-depth;
 *      RLS also blocks the INSERT below).
 *   3. Find existing user by email.
 *      - If found → reuse existing user.id (NO duplicate account).
 *      - If not found → admin.createUser with email + temp password +
 *        user_metadata.role='student'. handle_new_user() trigger inserts
 *        the public.users row + the new trg_generate_student_code trigger
 *        auto-fills student_code.
 *   4. Ensure users.student_code is set (older students may not have one).
 *   5. INSERT into subject_students with status='approved',
 *      enrollment_source_id = agent.source_id,
 *      enrollment_agent_id   = agent.id,
 *      enrolled_by           = agent.user_id,
 *      enrollment_method     = 'agent_register',
 *      enrolled_at           = now()
 *      ON CONFLICT (subject_id, student_id) DO NOTHING.
 *      If the row already exists, return 'already_enrolled' (do NOT error).
 *
 * Returns:
 *   {
 *     success: true,
 *     studentId, studentEmail, studentName,
 *     studentCode,
 *     temporaryPassword | null,   // only for newly-created accounts
 *     newlyCreated: true | false,
 *     alreadyEnrolled: true | false,
 *     enrollment: { id, subjectId, subjectName, sourceId, sourceName, agentId, enrolledAt }
 *   }
 */
const BodySchema = z.object({
  studentEmail: z.string().trim().email().max(254),
  studentName: z.string().trim().min(1).max(120),
  studentPhone: z.string().trim().max(40).optional(),
  subjectId: z.string().uuid(),
});

function generateTempPassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(10);
  let out = '';
  for (let i = 0; i < 10; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

function generateStudentCode(): string {
  // 8-char uppercase hex (UUID-derived for low collision).
  return randomUUID().replace(/-/g, '').substring(0, 8).toUpperCase();
}

export async function POST(request: NextRequest) {
  const auth = await requireAgent(request);
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
      { success: false, error: 'البيانات غير صالحة', details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { studentEmail, studentName, studentPhone, subjectId } = parsed.data;
  const { agent, sourceTeacherId } = auth;
  const agentUserId = auth.user.id;

  // 1. Confirm subjectId is owned by the agent's teacher.
  const { data: subject, error: subjectErr } = await supabaseServer
    .from('subjects')
    .select('id, name, teacher_id')
    .eq('id', subjectId)
    .single();

  if (subjectErr || !subject) {
    return NextResponse.json({ success: false, error: 'الدورة غير موجودة' }, { status: 404 });
  }

  if (subject.teacher_id !== sourceTeacherId) {
    return NextResponse.json(
      { success: false, error: 'غير مصرح لك بتسجيل طلاب في هذه الدورة' },
      { status: 403 }
    );
  }

  // 2. Look up the student by email in public.users (faster than listUsers).
  const { data: existingProfile } = await supabaseServer
    .from('users')
    .select('id, email, name, role, student_code')
    .eq('email', studentEmail)
    .maybeSingle();

  let studentId: string;
  let temporaryPassword: string | null = null;
  let studentCode: string | null | undefined = existingProfile?.student_code;
  let newlyCreated = false;

  if (existingProfile) {
    // Reuse existing account.
    studentId = existingProfile.id;

    // Ensure the role is at least 'student' (don't downgrade teachers/admins/agents).
    if (existingProfile.role === 'student') {
      // fine
    } else if (existingProfile.role === 'registration_agent') {
      // weird but not our problem; don't change
    }
    // ensure name is set if it was empty
    if (!existingProfile.name && studentName) {
      await supabaseServer.from('users').update({ name: studentName }).eq('id', studentId);
    }
  } else {
    // No public.users row → check auth.users for an account that just hasn't
    // been mirrored (rare race); otherwise create a brand-new auth user.
    temporaryPassword = generateTempPassword();

    const { data: created, error: createErr } = await supabaseServer.auth.admin.createUser({
      email: studentEmail,
      password: temporaryPassword,
      email_confirm: true,
      user_metadata: {
        name: studentName,
        role: 'student',
        phone: studentPhone,
      },
    });

    if (createErr || !created?.user) {
      // Distinguish "email already exists in auth.users but no public row" vs other errors.
      const msg = createErr?.message ?? '';
      if (msg.toLowerCase().includes('already') || msg.toLowerCase().includes('registered')) {
        // listUsers fallback
        const { data: list } = await supabaseServer.auth.admin.listUsers({
          page: 1,
          perPage: 1000,
        });
        const found = list?.users?.find((u) => u.email?.toLowerCase() === studentEmail.toLowerCase());
        if (found) {
          studentId = found.id;
          temporaryPassword = null;
        } else {
          return NextResponse.json(
            { success: false, error: 'فشل إنشاء حساب الطالب: ' + msg },
            { status: 500 }
          );
        }
      } else {
        return NextResponse.json(
          { success: false, error: 'فشل إنشاء حساب الطالب: ' + msg },
          { status: 500 }
        );
      }
    } else {
      studentId = created.user.id;
      newlyCreated = true;
    }

    // Mirror row may not have been inserted yet (race). Patch defensively.
    const { data: justCreated } = await supabaseServer
      .from('users')
      .select('id, role, student_code, name')
      .eq('id', studentId)
      .maybeSingle();

    if (!justCreated) {
      await supabaseServer.from('users').insert({
        id: studentId,
        email: studentEmail,
        name: studentName,
        role: 'student',
      });
      studentCode = undefined; // will be filled below
    } else {
      if (justCreated.role !== 'student') {
        await supabaseServer.from('users').update({ role: 'student' }).eq('id', studentId);
      }
      studentCode = justCreated.student_code;
    }
  }

  // 3. Ensure student_code is set (for pre-existing rows that predate v64 trigger).
  if (!studentCode) {
    let attempts = 0;
    let code = generateStudentCode();
    while (attempts < 5) {
      const { data: dup } = await supabaseServer
        .from('users')
        .select('id')
        .eq('student_code', code)
        .maybeSingle();
      if (!dup) break;
      code = generateStudentCode();
      attempts++;
    }
    const { data: updated } = await supabaseServer
      .from('users')
      .update({ student_code: code })
      .eq('id', studentId)
      .select('student_code')
      .single();
    studentCode = updated?.student_code ?? code;
  }

  // 4. Insert (or upsert-noop) the enrollment row.
  const { data: existingEnrollment } = await supabaseServer
    .from('subject_students')
    .select('id, subject_id, student_id, status, enrollment_agent_id, enrolled_at')
    .eq('subject_id', subjectId)
    .eq('student_id', studentId)
    .maybeSingle();

  let enrollmentId: string | undefined = existingEnrollment?.id;
  let alreadyEnrolled = !!existingEnrollment;

  if (!existingEnrollment) {
    const { data: enrollment, error: enrollmentErr } = await supabaseServer
      .from('subject_students')
      .insert({
        subject_id: subjectId,
        student_id: studentId,
        status: 'approved',
        enrollment_source_id: agent.source_id,
        enrollment_agent_id: agent.id,
        enrolled_by: agentUserId,
        enrollment_method: 'agent_register',
        enrolled_at: new Date().toISOString(),
      })
      .select('id, enrolled_at')
      .single();

    if (enrollmentErr) {
      console.error('[agent/register-student] INSERT subject_students error:', enrollmentErr);
      return NextResponse.json(
        { success: false, error: 'فشل تسجيل الطالب في الدورة: ' + enrollmentErr.message },
        { status: 500 }
      );
    }

    enrollmentId = enrollment?.id;

    // Also upsert the global teacher↔student "follow" link so the student
    // appears in the teacher's "Students" section AND can receive quizzes.
    // (status='approved', initiated_by='teacher' — the agent acts on the
    // teacher's behalf.)
    const teacherId = subject.teacher_id;
    try {
      await supabaseServer
        .from('teacher_student_links')
        .upsert(
          {
            teacher_id: teacherId,
            student_id: studentId,
            status: 'approved',
            initiated_by: 'teacher',
          },
          { onConflict: 'teacher_id,student_id' }
        );
    } catch (linkErr) {
      // Non-fatal — enrollment itself succeeded.
      console.warn('[agent/register-student] teacher_student_links upsert failed:', linkErr);
    }
  } else {
    // Existing enrollment. If it was made by ANOTHER agent/teacher, leave attribution intact.
    // If the existing row lacks attribution (self-join), backfill it for this agent.
    if (!existingEnrollment.enrollment_agent_id) {
      await supabaseServer
        .from('subject_students')
        .update({
          enrollment_source_id: agent.source_id,
          enrollment_agent_id: agent.id,
          enrolled_by: agentUserId,
          enrollment_method: 'agent_register',
          enrolled_at: existingEnrollment.enrolled_at ?? new Date().toISOString(),
        })
        .eq('id', existingEnrollment.id);
    }

    // Also ensure the global teacher↔student link exists (in case the
    // student was enrolled by self-join code only).
    const teacherId = subject.teacher_id;
    try {
      await supabaseServer
        .from('teacher_student_links')
        .upsert(
          {
            teacher_id: teacherId,
            student_id: studentId,
            status: 'approved',
            initiated_by: 'teacher',
          },
          { onConflict: 'teacher_id,student_id' }
        );
    } catch (linkErr) {
      console.warn('[agent/register-student] teacher_student_links upsert (existing) failed:', linkErr);
    }
  }

  // 5. Resolve agent display name for the response (v65: agent may not have a source).
  let sourceName: string | null = null;
  if (agent.source_id) {
    const { data: sourceRow } = await supabaseServer
      .from('registration_sources')
      .select('id, name, kind')
      .eq('id', agent.source_id)
      .maybeSingle();
    sourceName = (sourceRow as { name: string } | null)?.name ?? null;
  }
  // Fallback to the agent's own display_name if no source.
  if (!sourceName) {
    const { data: agentRow } = await supabaseServer
      .from('registration_agents')
      .select('display_name')
      .eq('id', agent.id)
      .maybeSingle();
    sourceName = (agentRow as { display_name: string | null } | null)?.display_name ?? null;
  }

  return NextResponse.json({
    success: true,
    studentId,
    studentEmail,
    studentName,
    studentCode,
    temporaryPassword,
    newlyCreated,
    alreadyEnrolled,
    enrollment: {
      id: enrollmentId,
      subjectId: subject.id,
      subjectName: subject.name,
      sourceId: agent.source_id,
      sourceName,
      agentId: agent.id,
      agentName: sourceName, // alias for clarity in the new model
      enrolledAt: new Date().toISOString(),
    },
  });
}

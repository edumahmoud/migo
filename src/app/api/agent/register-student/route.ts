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
 *     enrollments: [{ subjectId, subjectName, enrollmentId, alreadyEnrolled, error }]
 *     summary: { totalRequested, totalSucceeded, totalAlreadyEnrolled, totalFailed }
 *
 * v2 (multi-course): accepts `subjectIds: string[]` (array) and registers
 * the student in EACH course in one request. For backward compat, still
 * accepts `subjectId: string` (single) and treats it as a 1-element array.
 */
const BodySchema = z.object({
  studentEmail: z.string().trim().email().max(254).optional(),
  studentName: z.string().trim().min(1).max(120).optional(),
  studentPhone: z.string().trim().max(40).optional(),
  studentCode: z.string().trim().min(1).max(40).optional(),  // v3 (existing-student mode)
  subjectId: z.string().uuid().optional(),     // backward compat (single)
  subjectIds: z.array(z.string().uuid()).optional(),  // v2 (multi)
}).refine(
  (d) =>
    ((d.studentEmail && d.studentEmail.length > 0) || (d.studentCode && d.studentCode.length > 0)) &&
    ((d.subjectId && d.subjectId.length > 0) || (d.subjectIds && d.subjectIds.length > 0)),
  { message: 'يجب تحديد طالب ومقرر واحد على الأقل' }
);

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

  const { studentEmail, studentName, studentPhone, studentCode: inputStudentCode, subjectId, subjectIds } = parsed.data;
  const { agent, sourceTeacherId } = auth;
  const agentUserId = auth.user.id;

  // Normalize to an array (backward compat: single subjectId → [subjectId]).
  // Dedupe in case the frontend sent the same id twice.
  const requestedSubjectIds = Array.from(
    new Set([
      ...(subjectIds ?? []),
      ...(subjectId ? [subjectId] : []),
    ])
  );

  if (requestedSubjectIds.length === 0) {
    return NextResponse.json(
      { success: false, error: 'يجب تحديد مقرر واحد على الأقل' },
      { status: 400 }
    );
  }

  // 1. Fetch all requested subjects at once + verify ownership + subscription_open.
  const { data: subjectsData, error: subjectsErr } = await supabaseServer
    .from('subjects')
    .select('id, name, teacher_id, is_paused, subscription_open')
    .in('id', requestedSubjectIds);

  if (subjectsErr) {
    return NextResponse.json(
      { success: false, error: 'فشل تحميل بيانات المقررات' },
      { status: 500 }
    );
  }

  const subjectsMap = new Map<string, { id: string; name: string; teacher_id: string; is_paused: boolean; subscription_open: boolean }>(
    ((subjectsData ?? []) as Array<{ id: string; name: string; teacher_id: string; is_paused: boolean; subscription_open: boolean }>)
      .map((s) => [s.id, s])
  );

  // Verify ALL requested subjects exist AND belong to the agent's teacher.
  for (const id of requestedSubjectIds) {
    const s = subjectsMap.get(id);
    if (!s) {
      return NextResponse.json(
        { success: false, error: `المقرر ${id} غير موجود` },
        { status: 404 }
      );
    }
    if (s.teacher_id !== sourceTeacherId) {
      return NextResponse.json(
        { success: false, error: `غير مصرح لك بتسجيل طلاب في المقرر: ${s.name}` },
        { status: 403 }
      );
    }
    if (s.is_paused) {
      return NextResponse.json(
        { success: false, error: `المقرر "${s.name}" متوقف بالكامل (paused)` },
        { status: 400 }
      );
    }
    if (s.subscription_open === false) {
      return NextResponse.json(
        { success: false, error: `التسجيل مُوقَف للمقرر: ${s.name}` },
        { status: 400 }
      );
    }
  }

  // 2. Determine the student. Two paths:
  //    (a) inputStudentCode → look up by code (must already be linked to the teacher)
  //    (b) studentEmail → find by email or create new account
  let studentId: string | undefined;
  let temporaryPassword: string | null = null;
  let resolvedStudentEmail: string | undefined;
  let resolvedStudentName: string | undefined;
  let studentCode: string | null | undefined;
  let newlyCreated = false;

  if (inputStudentCode) {
    // Existing-student mode — look up by code.
    const { data: studentByCode, error: codeErr } = await supabaseServer
      .from('users')
      .select('id, email, name, role, student_code')
      .eq('student_code', inputStudentCode.toUpperCase())
      .maybeSingle();

    if (codeErr || !studentByCode) {
      return NextResponse.json(
        { success: false, error: 'لا يوجد طالب بهذا الكود' },
        { status: 404 }
      );
    }

    // Verify the student is linked to this agent's teacher.
    const { data: link } = await supabaseServer
      .from('teacher_student_links')
      .select('teacher_id, student_id, status')
      .eq('teacher_id', sourceTeacherId)
      .eq('student_id', (studentByCode as { id: string }).id)
      .eq('status', 'approved')
      .maybeSingle();

    if (!link) {
      return NextResponse.json(
        {
          success: false,
          error: 'هذا الطالب غير مرتبط بمعلمك. لا يمكنك تسجيله في دورات جديدة.',
        },
        { status: 403 }
      );
    }

    studentId = (studentByCode as { id: string }).id;
    resolvedStudentEmail = (studentByCode as { email: string }).email;
    resolvedStudentName = (studentByCode as { name: string | null }).name ?? undefined;
    studentCode = (studentByCode as { student_code: string | null }).student_code;
    temporaryPassword = null;  // existing student — no temp password
  } else if (studentEmail) {
    resolvedStudentEmail = studentEmail;
    resolvedStudentName = studentName;

  // 2b. Look up the student by email in public.users (faster than listUsers).
  const { data: existingProfile } = await supabaseServer
    .from('users')
    .select('id, email, name, role, student_code')
    .eq('email', studentEmail)
    .maybeSingle();

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
  }  // closes inner if (existingProfile) {} else {}

  }  // closes else if (studentEmail) {}

  if (!studentId) {
    return NextResponse.json(
      { success: false, error: 'تعذّر تحديد هوية الطالب' },
      { status: 400 }
    );
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

  // 4. Insert (or upsert-noop) the enrollment rows — ONE PER requested subject.
  // First, fetch all existing enrollments for this student in the requested
  // subjects (in one query).
  const { data: existingEnrollmentsRows } = await supabaseServer
    .from('subject_students')
    .select('id, subject_id, status, enrollment_agent_id, enrolled_at')
    .eq('student_id', studentId)
    .in('subject_id', requestedSubjectIds);

  const existingBySubject = new Map<
    string,
    { id: string; status: string; enrollment_agent_id: string | null; enrolled_at: string | null }
  >(
    ((existingEnrollmentsRows ?? []) as Array<{
      id: string; subject_id: string; status: string;
      enrollment_agent_id: string | null; enrolled_at: string | null;
    }>).map((r) => [r.subject_id, r])
  );

  interface EnrollmentResult {
    subjectId: string;
    subjectName: string;
    enrollmentId: string | null;
    alreadyEnrolled: boolean;
    error: string | null;
  }
  const enrollments: EnrollmentResult[] = [];

  for (const subjectId of requestedSubjectIds) {
    const subject = subjectsMap.get(subjectId)!;
    const existing = existingBySubject.get(subjectId);

    if (existing) {
      // Existing enrollment. If it lacks attribution (self-join), backfill it.
      if (!existing.enrollment_agent_id) {
        await supabaseServer
          .from('subject_students')
          .update({
            enrollment_source_id: agent.source_id,
            enrollment_agent_id: agent.id,
            enrolled_by: agentUserId,
            enrollment_method: 'agent_register',
            enrolled_at: existing.enrolled_at ?? new Date().toISOString(),
          })
          .eq('id', existing.id);
      }
      enrollments.push({
        subjectId,
        subjectName: subject.name,
        enrollmentId: existing.id,
        alreadyEnrolled: true,
        error: null,
      });
    } else {
      // New enrollment row.
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
        console.error(
          `[agent/register-student] INSERT subject_students error for subject ${subjectId}:`,
          enrollmentErr
        );
        enrollments.push({
          subjectId,
          subjectName: subject.name,
          enrollmentId: null,
          alreadyEnrolled: false,
          error: enrollmentErr.message,
        });
        continue;
      }

      enrollments.push({
        subjectId,
        subjectName: subject.name,
        enrollmentId: enrollment?.id ?? null,
        alreadyEnrolled: false,
        error: null,
      });
    }
  }

  // 5. Upsert the global teacher↔student link ONCE (the teacher is the same
  //    for all subjects since they're all owned by sourceTeacherId).
  try {
    await supabaseServer
      .from('teacher_student_links')
      .upsert(
        {
          teacher_id: sourceTeacherId,
          student_id: studentId,
          status: 'approved',
          initiated_by: 'teacher',
        },
        { onConflict: 'teacher_id,student_id' }
      );
  } catch (linkErr) {
    console.warn('[agent/register-student] teacher_student_links upsert failed:', linkErr);
  }

  // 6. Resolve agent display name for the response.
  let sourceName: string | null = null;
  if (agent.source_id) {
    const { data: sourceRow } = await supabaseServer
      .from('registration_sources')
      .select('id, name, kind')
      .eq('id', agent.source_id)
      .maybeSingle();
    sourceName = (sourceRow as { name: string } | null)?.name ?? null;
  }
  if (!sourceName) {
    const { data: agentRow } = await supabaseServer
      .from('registration_agents')
      .select('display_name')
      .eq('id', agent.id)
      .maybeSingle();
    sourceName = (agentRow as { display_name: string | null } | null)?.display_name ?? null;
  }

  // 7. Summary.
  const totalRequested = enrollments.length;
  const totalSucceeded = enrollments.filter((e) => e.error === null).length;
  const totalAlreadyEnrolled = enrollments.filter((e) => e.alreadyEnrolled).length;
  const totalFailed = enrollments.filter((e) => e.error !== null).length;

  return NextResponse.json({
    success: true,
    studentId,
    studentEmail: resolvedStudentEmail ?? null,
    studentName: resolvedStudentName ?? null,
    studentCode,
    temporaryPassword,
    newlyCreated,
    enrollments,
    summary: {
      totalRequested,
      totalSucceeded,
      totalAlreadyEnrolled,
      totalFailed,
    },
    agent: {
      id: agent.id,
      agentName: sourceName,
      sourceId: agent.source_id,
      sourceName,
    },
    enrolledAt: new Date().toISOString(),
    // Legacy single-enrollment field kept for backward compat with old
    // clients — points to the FIRST successful enrollment.
    enrollment: enrollments.length > 0
      ? {
        id: enrollments[0].enrollmentId,
        subjectId: enrollments[0].subjectId,
        subjectName: enrollments[0].subjectName,
        sourceId: agent.source_id,
        sourceName,
        agentId: agent.id,
        agentName: sourceName,
        enrolledAt: new Date().toISOString(),
      }
      : null,
    // For backward compat with old UIs:
    alreadyEnrolled: totalAlreadyEnrolled > 0,
  });
}

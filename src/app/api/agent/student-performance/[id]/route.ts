import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { requireAgent, authErrorResponse } from '@/lib/auth-helpers';

/**
 * GET /api/agent/student-performance/[id]
 *
 * Returns comprehensive performance data for a single student,
 * scoped to the agent's teacher's courses only.
 *
 * Response:
 *   {
 *     success: true,
 *     student: { id, name, email, student_code, account_status, created_at },
 *     enrollments: Array<{
 *       subject_id, subject_name, status, enrollment_method,
 *       current_period_start, current_period_end, monthly_price
 *     }>,
 *     assignments: {
 *       submitted: Array<{ id, subject_name, title, score, max_score, status, submitted_at, due_date }>,
 *       not_submitted: Array<{ id, subject_name, title, max_score, due_date }>,
 *     },
 *     quizzes: {
 *       completed: Array<{ id, subject_name, title, score, max_score, completed_at }>,
 *       not_completed: Array<{ id, subject_name, title }>,
 *     },
 *     attendance: Array<{
 *       subject_id, subject_name,
 *       present, late, absent, total, percentage
 *     }>,
 *     lesson_progress: Array<{
 *       subject_id, subject_name, completed_lessons, total_lessons, percentage
 *     }>,
 *   }
 */
interface RouteContext { params: Promise<{ id: string }> }

export async function GET(request: NextRequest, ctx: RouteContext) {
  const auth = await requireAgent(request);
  if (!auth.success) return authErrorResponse(auth);

  const { id: studentId } = await ctx.params;
  const teacherId = auth.sourceTeacherId;

  try {
    // 1. Fetch student profile
    const { data: student, error: studentErr } = await supabaseServer
      .from('users')
      .select('id, name, email, student_code, account_status, created_at')
      .eq('id', studentId)
      .maybeSingle();

    if (studentErr || !student) {
      return NextResponse.json(
        { success: false, error: 'الطالب غير موجود' },
        { status: 404 },
      );
    }

    // 2. Fetch student's enrollments in the AGENT'S teacher's subjects only
    const { data: teacherSubjects } = await supabaseServer
      .from('subjects')
      .select('id, name, is_paused, price')
      .eq('teacher_id', teacherId);
    const teacherSubjectIds = (teacherSubjects ?? []).map((s: { id: string }) => s.id);
    const subjectNameById = new Map<string, string>(
      (teacherSubjects ?? []).map((s: { id: string; name: string }) => [s.id, s.name])
    );

    let enrollments: Array<{
      subject_id: string; subject_name: string; status: string;
      enrollment_method: string; current_period_start: string | null;
      current_period_end: string | null; monthly_price: number | null;
      is_paused: boolean; is_free: boolean;
    }> = [];

    if (teacherSubjectIds.length > 0) {
      const { data: enrollRows } = await supabaseServer
        .from('subject_students')
        .select('subject_id, status, enrollment_method, current_period_start, current_period_end, monthly_price')
        .eq('student_id', studentId)
        .in('subject_id', teacherSubjectIds)
        .order('enrolled_at', { ascending: false });

      // v130: also fetch is_paused for each subject
      const { data: subjData } = await supabaseServer
        .from('subjects')
        .select('id, name, is_paused, price')
        .eq('teacher_id', teacherId);
      const subjMap = new Map<string, { name: string; is_paused: boolean; price: number | null }>(
        (subjData ?? []).map((s: { id: string; name: string; is_paused: boolean; price: number | null }) =>
          [s.id, { name: s.name, is_paused: s.is_paused, price: s.price }])
      );

      enrollments = (enrollRows ?? []).map((e: Record<string, unknown>) => {
        const subjInfo = subjMap.get(e.subject_id as string) ?? { name: '—', is_paused: false, price: null };
        const price = subjInfo.price !== null && subjInfo.price !== undefined ? Number(subjInfo.price) : null;
        return {
          subject_id: e.subject_id as string,
          subject_name: subjInfo.name,
          status: e.status as string,
          enrollment_method: e.enrollment_method as string,
          current_period_start: e.current_period_start as string | null,
          current_period_end: e.current_period_end as string | null,
          monthly_price: e.monthly_price !== null && e.monthly_price !== undefined ? Number(e.monthly_price) : null,
          is_paused: subjInfo.is_paused,
          is_free: price === null || price === 0,
        };
      });
    }

    const enrolledSubjectIds = enrollments.map(e => e.subject_id);

    // 3. Fetch assignments — submitted + not submitted
    let assignmentsSubmitted: Array<Record<string, unknown>> = [];
    let assignmentsNotSubmitted: Array<Record<string, unknown>> = [];

    if (enrolledSubjectIds.length > 0) {
      // All assignments for the teacher's subjects
      const { data: allAssignments } = await supabaseServer
        .from('assignments')
        .select('id, subject_id, title, max_score, due_date')
        .in('subject_id', enrolledSubjectIds);

      const assignmentIds = (allAssignments ?? []).map((a: { id: string }) => a.id);

      if (assignmentIds.length > 0) {
        // Fetch the student's submissions for these assignments
        const { data: submissions } = await supabaseServer
          .from('submissions')
          .select('id, assignment_id, score, status, submitted_at')
          .eq('student_id', studentId)
          .in('assignment_id', assignmentIds);

        const submittedByAssignment = new Map<string, Record<string, unknown>>();
        for (const s of (submissions ?? []) as Record<string, unknown>[]) {
          submittedByAssignment.set(s.assignment_id as string, s);
        }

        for (const a of (allAssignments ?? []) as Record<string, unknown>[]) {
          const sub = submittedByAssignment.get(a.id as string);
          if (sub) {
            assignmentsSubmitted.push({
              id: a.id,
              subject_name: subjectNameById.get(a.subject_id as string) ?? '—',
              title: a.title ?? '—',
              score: sub.score !== null && sub.score !== undefined ? Number(sub.score) : null,
              max_score: Number(a.max_score ?? 0),
              status: sub.status,
              submitted_at: sub.submitted_at,
              due_date: a.due_date,
            });
          } else {
            assignmentsNotSubmitted.push({
              id: a.id,
              subject_name: subjectNameById.get(a.subject_id as string) ?? '—',
              title: a.title ?? '—',
              max_score: Number(a.max_score ?? 0),
              due_date: a.due_date,
            });
          }
        }
      }
    }

    // 4. Fetch quizzes — completed + not completed
    let quizzesCompleted: Array<Record<string, unknown>> = [];
    let quizzesNotCompleted: Array<Record<string, unknown>> = [];

    if (enrolledSubjectIds.length > 0) {
      const { data: allQuizzes } = await supabaseServer
        .from('quizzes')
        .select('id, subject_id, title, max_score')
        .in('subject_id', enrolledSubjectIds);

      const quizIds = (allQuizzes ?? []).map((q: { id: string }) => q.id);

      if (quizIds.length > 0) {
        const { data: scores } = await supabaseServer
          .from('scores')
          .select('id, quiz_id, score, max_score, completed_at')
          .eq('student_id', studentId)
          .in('quiz_id', quizIds)
          .order('completed_at', { ascending: false });

        const completedByQuiz = new Map<string, Record<string, unknown>>();
        for (const s of (scores ?? []) as Record<string, unknown>[]) {
          if (!completedByQuiz.has(s.quiz_id as string)) {
            completedByQuiz.set(s.quiz_id as string, s);
          }
        }

        for (const q of (allQuizzes ?? []) as Record<string, unknown>[]) {
          const score = completedByQuiz.get(q.id as string);
          if (score) {
            quizzesCompleted.push({
              id: q.id,
              subject_name: subjectNameById.get(q.subject_id as string) ?? '—',
              title: q.title ?? '—',
              score: Number(score.score ?? 0),
              max_score: Number(score.max_score ?? q.max_score ?? 0),
              completed_at: score.completed_at,
            });
          } else {
            quizzesNotCompleted.push({
              id: q.id,
              subject_name: subjectNameById.get(q.subject_id as string) ?? '—',
              title: q.title ?? '—',
            });
          }
        }
      }
    }

    // 5. Fetch attendance per subject
    let attendance: Array<Record<string, unknown>> = [];

    if (enrolledSubjectIds.length > 0) {
      const { data: sessions } = await supabaseServer
        .from('attendance_sessions')
        .select('id, subject_id')
        .in('subject_id', enrolledSubjectIds);

      const sessionBySubject = new Map<string, string[]>();
      for (const s of (sessions ?? []) as { id: string; subject_id: string }[]) {
        if (!sessionBySubject.has(s.subject_id)) sessionBySubject.set(s.subject_id, []);
        sessionBySubject.get(s.subject_id)!.push(s.id);
      }

      const allSessionIds = (sessions ?? []).map((s: { id: string }) => s.id);

      if (allSessionIds.length > 0) {
        const { data: records } = await supabaseServer
          .from('attendance_records')
          .select('session_id, student_id, attendance_status')
          .in('session_id', allSessionIds)
          .eq('student_id', studentId);

        const recordsBySession = new Map<string, string>();
        for (const r of (records ?? []) as { session_id: string; attendance_status: string }[]) {
          recordsBySession.set(r.session_id, r.attendance_status);
        }

        for (const [subjectId, sessionIds] of sessionBySubject) {
          let present = 0, late = 0, absent = 0;
          for (const sid of sessionIds) {
            const status = recordsBySession.get(sid);
            if (status === 'present') present++;
            else if (status === 'late') late++;
            else if (status === 'absent') absent++;
          }
          const total = present + late + absent;
          const percentage = total > 0 ? Math.round(((present + late) / total) * 100) : 0;
          attendance.push({
            subject_id: subjectId,
            subject_name: subjectNameById.get(subjectId) ?? '—',
            present, late, absent, total, percentage,
          });
        }
      }
    }

    // 6. Fetch lesson progress per subject
    let lessonProgress: Array<Record<string, unknown>> = [];

    if (enrolledSubjectIds.length > 0) {
      // Count total lessons per subject
      const { data: lessonsData } = await supabaseServer
        .from('lessons')
        .select('id, subject_id')
        .in('subject_id', enrolledSubjectIds);

      const lessonsBySubject = new Map<string, string[]>();
      for (const l of (lessonsData ?? []) as { id: string; subject_id: string }[]) {
        if (!lessonsBySubject.has(l.subject_id)) lessonsBySubject.set(l.subject_id, []);
        lessonsBySubject.get(l.subject_id)!.push(l.id);
      }

      const allLessonIds = (lessonsData ?? []).map((l: { id: string }) => l.id);

      if (allLessonIds.length > 0) {
        const { data: progress } = await supabaseServer
          .from('lesson_progress')
          .select('lesson_id, student_id, is_completed')
          .eq('student_id', studentId)
          .in('lesson_id', allLessonIds)
          .eq('is_completed', true);

        const completedLessonIds = new Set<string>(
          (progress ?? []).map((p: { lesson_id: string }) => p.lesson_id)
        );

        for (const [subjectId, lessonIds] of lessonsBySubject) {
          const completed = lessonIds.filter(id => completedLessonIds.has(id)).length;
          const total = lessonIds.length;
          const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;
          lessonProgress.push({
            subject_id: subjectId,
            subject_name: subjectNameById.get(subjectId) ?? '—',
            completed_lessons: completed,
            total_lessons: total,
            percentage,
          });
        }
      }
    }

    return NextResponse.json({
      success: true,
      student: {
        id: student.id,
        name: student.name,
        email: student.email,
        student_code: student.student_code,
        account_status: student.account_status,
        created_at: student.created_at,
      },
      enrollments,
      assignments: {
        submitted: assignmentsSubmitted,
        not_submitted: assignmentsNotSubmitted,
      },
      quizzes: {
        completed: quizzesCompleted,
        not_completed: quizzesNotCompleted,
      },
      attendance,
      lesson_progress: lessonProgress,
    });
  } catch (err) {
    console.error('[GET /api/agent/student-performance] error:', err);
    return NextResponse.json(
      { success: false, error: 'حدث خطأ أثناء تحميل أداء الطالب' },
      { status: 500 },
    );
  }
}

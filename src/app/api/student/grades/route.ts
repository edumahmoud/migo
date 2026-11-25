import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest, authErrorResponse } from '@/lib/auth-helpers';
import { supabaseServer } from '@/lib/supabase-server';
import { checkRateLimit, validateRequest } from '@/lib/api-security';
import { computeTotals, typeAverage, type CourseGrades, type GradeItem } from '@/lib/gradebook';

export const runtime = 'nodejs';

/**
 * GET /api/student/grades
 * The signed-in student's gradebook: for each approved course, every assignment and quiz with the
 * student's own result. Reads with the service role but only ever for the caller's own id.
 * Assignment scores are hidden when the teacher turned show_grade off.
 */
export async function GET(request: NextRequest) {
  try {
    const bad = validateRequest(request);
    if (bad) return bad;
    const rl = checkRateLimit(request);
    if (!rl.allowed) return NextResponse.json({ success: false, error: 'طلبات كثيرة جداً' }, { status: 429 });
    const auth = await authenticateRequest(request);
    if (!auth.success) return authErrorResponse(auth);
    const uid = auth.user.id;

    const { data: enr } = await supabaseServer
      .from('subject_students').select('subject_id').eq('student_id', uid).eq('status', 'approved');
    const subjectIds = [...new Set((enr || []).map((e: { subject_id: string }) => e.subject_id))];
    if (subjectIds.length === 0) return NextResponse.json({ success: true, courses: [], overall: null });

    const [subjR, asgR, quizR, subR, scoreR] = await Promise.all([
      supabaseServer.from('subjects').select('id, name, color').in('id', subjectIds),
      supabaseServer.from('assignments').select('id, subject_id, title, due_date, max_score, show_grade, created_at').in('subject_id', subjectIds),
      supabaseServer.from('quizzes').select('id, subject_id, title, scheduled_date, is_finished, created_at').in('subject_id', subjectIds),
      supabaseServer.from('submissions').select('assignment_id, score, feedback, status, submitted_at, graded_at').eq('student_id', uid),
      supabaseServer.from('scores').select('quiz_id, quiz_title, score, total, completed_at').eq('student_id', uid),
    ]);

    const subs = new Map<string, { score: number | null; feedback: string | null; status: string; submitted_at: string }>();
    for (const s of subR.data || []) subs.set(s.assignment_id, s);
    const best = new Map<string, { score: number; total: number; completed_at: string }>();
    for (const s of scoreR.data || []) {
      const cur = best.get(s.quiz_id);
      // Highest attempt counts (Canvas default is "keep highest" when retakes are allowed)
      if (!cur || s.score / (s.total || 1) > cur.score / (cur.total || 1)) best.set(s.quiz_id, s);
    }

    const bySubject = new Map<string, GradeItem[]>();
    const push = (sid: string, it: GradeItem) => { const a = bySubject.get(sid) || []; a.push(it); bySubject.set(sid, a); };

    for (const a of asgR.data || []) {
      const sub = subs.get(a.id);
      const max = Number(a.max_score) || 100;
      let status: GradeItem['status'] = 'missing';
      let score: number | null = null;
      if (sub) {
        if (sub.status === 'graded' && sub.score !== null && sub.score !== undefined) {
          if (a.show_grade === false) status = 'hidden';
          else { status = 'graded'; score = Number(sub.score); }
        } else status = 'submitted';
      }
      push(a.subject_id, {
        type: 'assignment', id: a.id, title: a.title, date: a.due_date || sub?.submitted_at || a.created_at,
        score, max, status, feedback: status === 'graded' ? sub?.feedback ?? null : null,
      });
    }
    for (const q of quizR.data || []) {
      const sc = best.get(q.id);
      push(q.subject_id, {
        type: 'quiz', id: q.id, title: q.title, date: sc?.completed_at || q.scheduled_date || q.created_at,
        score: sc ? Number(sc.score) : null, max: sc ? Number(sc.total) : 0, status: sc ? 'graded' : 'not_taken',
      });
    }

    const courses: CourseGrades[] = (subjR.data || []).map((s: { id: string; name: string; color: string | null }) => {
      const items = (bySubject.get(s.id) || []).sort((x, y) => (y.date || '').localeCompare(x.date || ''));
      const t = computeTotals(items);
      return { subjectId: s.id, name: s.name, color: s.color, items, earned: t.earned, possible: t.possible, percent: t.percent, letter: t.letter, gradedCount: t.gradedCount, totalCount: items.length,
        quizAvg: typeAverage(items, 'quiz'), assignmentAvg: typeAverage(items, 'assignment'),
        quizCount: items.filter((i) => i.type === 'quiz').length, assignmentCount: items.filter((i) => i.type === 'assignment').length };
    }).sort((a: CourseGrades, b: CourseGrades) => a.name.localeCompare(b.name));

    const withGrades = courses.filter((c) => c.percent !== null);
    const overall = withGrades.length
      ? Math.round((withGrades.reduce((n, c) => n + (c.percent as number), 0) / withGrades.length) * 10) / 10
      : null;

    return NextResponse.json({ success: true, courses, overall });
  } catch (err) {
    console.error('[student/grades] failed:', err);
    return NextResponse.json({ success: false, error: 'تعذّر تحميل الدرجات' }, { status: 500 });
  }
}

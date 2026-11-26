import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest, authErrorResponse } from '@/lib/auth-helpers';
import { supabaseServer } from '@/lib/supabase-server';
import { checkRateLimit, validateRequest } from '@/lib/api-security';
import { gradeAnswer, cairoWallClockToMs } from '@/lib/quiz-grading';
import type { QuizQuestion } from '@/lib/types';

export const maxDuration = 60;
export const runtime = 'nodejs';

/**
 * POST /api/quizzes/check  { quizId, questionIndex, answer }
 * Per-question feedback while the student is taking the quiz. When the teacher hides results
 * (show_results === false) the server says nothing about correctness. Otherwise it returns whether
 * the answer is right and the key for that one question. The score is only ever written by /submit.
 */
export async function POST(request: NextRequest) {
  try {
    const bad = validateRequest(request);
    if (bad) return bad;
    const rl = checkRateLimit(request);
    if (!rl.allowed) return NextResponse.json({ success: false, error: 'طلبات كثيرة جداً' }, { status: 429 });
    const auth = await authenticateRequest(request);
    if (!auth.success) return authErrorResponse(auth);
    const uid = auth.user.id;

    const body = await request.json().catch(() => ({}));
    const quizId = body?.quizId;
    const idx = body?.questionIndex;
    const raw = body?.answer;
    if (typeof quizId !== 'string' || !Number.isInteger(idx)) return NextResponse.json({ success: false, error: 'بيانات ناقصة' }, { status: 400 });

    const { data: quiz, error } = await supabaseServer.from('quizzes').select('*').eq('id', quizId).single();
    if (error || !quiz) return NextResponse.json({ success: false, error: 'الاختبار غير موجود' }, { status: 404 });

    if (quiz.user_id !== uid) {
      const { data: link } = await supabaseServer
        .from('teacher_student_links').select('id').eq('teacher_id', quiz.user_id).eq('student_id', uid).eq('status', 'approved').maybeSingle();
      if (!link) return NextResponse.json({ success: false, error: 'غير مصرح' }, { status: 403 });
      if (quiz.is_finished) return NextResponse.json({ success: false, error: 'الاختبار منتهي' }, { status: 403 });
      if (quiz.scheduled_date) {
        const start = cairoWallClockToMs(quiz.scheduled_date, quiz.scheduled_time || '00:00');
        if (start !== null && start > Date.now()) return NextResponse.json({ success: false, error: 'الاختبار لم يبدأ بعد' }, { status: 403 });
      }
    }

    const questions: QuizQuestion[] = Array.isArray(quiz.questions) ? quiz.questions : [];
    const q = questions[idx];
    if (!q) return NextResponse.json({ success: false, error: 'السؤال غير موجود' }, { status: 404 });

    if (quiz.show_results === false) return NextResponse.json({ success: true, hidden: true, isCorrect: null });

    const ans = (typeof raw === 'string' || (raw && typeof raw === 'object')) ? (raw as string | Record<string, string>) : '';
    const isCorrect = await gradeAnswer(q, ans);
    return NextResponse.json({
      success: true,
      isCorrect,
      correctAnswer: q.type === 'matching' ? undefined : q.correctAnswer,
      pairs: q.type === 'matching' ? q.pairs : undefined,
    });
  } catch (e) {
    console.error('[quizzes/check]', e);
    return NextResponse.json({ success: false, error: 'خطأ غير متوقع' }, { status: 500 });
  }
}

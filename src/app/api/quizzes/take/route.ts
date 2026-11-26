import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest, authErrorResponse, getUserRole } from '@/lib/auth-helpers';
import { supabaseServer } from '@/lib/supabase-server';
import { checkRateLimit, validateRequest } from '@/lib/api-security';
import { sanitizeQuestions } from '@/lib/quiz-sanitize';
import type { QuizQuestion } from '@/lib/types';

export const runtime = 'nodejs';

/**
 * POST /api/quizzes/take  { quizId, review? }
 * Returns the quiz. Owners and admins get the full quiz. A student gets the questions without the
 * answer key, except in review mode after they have submitted, when the teacher allows results and review.
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
    const review = body?.review === true;
    if (typeof quizId !== 'string') return NextResponse.json({ success: false, error: 'quizId مطلوب' }, { status: 400 });

    const { data: quiz, error } = await supabaseServer.from('quizzes').select('*').eq('id', quizId).single();
    if (error || !quiz) return NextResponse.json({ success: false, error: 'الاختبار غير موجود' }, { status: 404 });

    const role = await getUserRole(uid);
    const isStaff = quiz.user_id === uid || role === 'admin' || role === 'superadmin';
    let full = isStaff;

    if (!isStaff) {
      const { data: link } = await supabaseServer
        .from('teacher_student_links').select('id').eq('teacher_id', quiz.user_id).eq('student_id', uid).eq('status', 'approved').maybeSingle();
      if (!link) return NextResponse.json({ success: false, error: 'غير مصرح' }, { status: 403 });
      if (review && quiz.show_review !== false && quiz.show_results !== false) {
        const { count } = await supabaseServer.from('scores').select('id', { count: 'exact', head: true }).eq('quiz_id', quizId).eq('student_id', uid);
        if ((count || 0) > 0) full = true;
      }
    }

    const questions: QuizQuestion[] = Array.isArray(quiz.questions) ? quiz.questions : [];
    return NextResponse.json({ success: true, quiz: { ...quiz, questions: full ? questions : sanitizeQuestions(questions) } });
  } catch (e) {
    console.error('[quizzes/take]', e);
    return NextResponse.json({ success: false, error: 'خطأ غير متوقع' }, { status: 500 });
  }
}

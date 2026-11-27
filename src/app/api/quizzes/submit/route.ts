import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { authenticateRequest, authErrorResponse } from '@/lib/auth-helpers';
import { supabaseServer } from '@/lib/supabase-server';
import { checkRateLimit, validateRequest } from '@/lib/api-security';
import { gradeAnswer, cairoWallClockToMs } from '@/lib/quiz-grading';
import type { QuizQuestion } from '@/lib/types';
import { checkFacePass } from '@/lib/face-pass';

export const maxDuration = 60;
export const runtime = 'nodejs';

/**
 * POST /api/quizzes/submit  { quizId, answers: [{ questionIndex, answer }] }
 * The server grades the raw answers and writes the score. The client never sends isCorrect or a score.
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

    const body = await request.json();
    const quizId = body?.quizId;
    const answers: Array<{ questionIndex: number; answer: unknown }> = Array.isArray(body?.answers) ? body.answers : [];
    if (typeof quizId !== 'string') return NextResponse.json({ success: false, error: 'quizId مطلوب' }, { status: 400 });

    const { data: quiz, error: qErr } = await supabaseServer.from('quizzes').select('*').eq('id', quizId).single();
    if (qErr || !quiz) return NextResponse.json({ success: false, error: 'الاختبار غير موجود' }, { status: 404 });
    const isOwner = quiz.user_id === uid;

    if (!isOwner) {
      const { data: link } = await supabaseServer
        .from('teacher_student_links').select('id').eq('teacher_id', quiz.user_id).eq('student_id', uid).eq('status', 'approved').maybeSingle();
      if (!link) return NextResponse.json({ success: false, error: 'غير مصرح' }, { status: 403 });
      if (quiz.is_finished) return NextResponse.json({ success: false, error: 'الاختبار منتهي' }, { status: 403 });
      if (quiz.scheduled_date) {
        const start = cairoWallClockToMs(quiz.scheduled_date, quiz.scheduled_time || '00:00');
        if (start !== null && start > Date.now()) return NextResponse.json({ success: false, error: 'الاختبار لم يبدأ بعد' }, { status: 403 });
      }
      if (quiz.allow_retake !== true) {
        const { count } = await supabaseServer.from('scores').select('id', { count: 'exact', head: true }).eq('quiz_id', quizId).eq('student_id', uid);
        if ((count || 0) > 0) return NextResponse.json({ success: false, error: 'تم تسليم هذا الاختبار من قبل' }, { status: 409 });
      }
      if (quiz.reexam_only_new_since) {
        const { count: oldCount } = await supabaseServer.from('scores').select('id', { count: 'exact', head: true })
          .eq('quiz_id', quizId).eq('student_id', uid).lt('completed_at', quiz.reexam_only_new_since);
        if ((oldCount || 0) > 0) return NextResponse.json({ success: false, error: 'هذا الاختبار متاح فقط للطلاب الذين لم يؤدوه' }, { status: 409 });
      }
    }

    // Official exam with camera check: the pass comes from a server-side face match; without it nothing is saved.
    const faceOk = quiz.require_face === true && !isOwner ? checkFacePass(body?.facePass, uid, `exam:${quizId}`) : null;
    if (faceOk === false) return NextResponse.json({ success: false, code: 'face_required', error: 'التحقق بالوجه مطلوب لتسليم هذا الاختبار' }, { status: 403 });

    // Official exam: fingerprint proofs (flag only). Each proof is the device secret released by the phone after a fingerprint check.
    const proofOk = async (secret: unknown) => {
      if (typeof secret !== 'string' || !/^[0-9a-f]{64}$/.test(secret)) return false;
      const { data: cred } = await supabaseServer.from('biometric_credentials').select('id')
        .eq('user_id', uid).eq('secret_hash', createHash('sha256').update(secret).digest('hex')).is('revoked_at', null).maybeSingle();
      return !!cred;
    };
    const startOk = quiz.require_bio === true ? await proofOk(body?.bioStartSecret) : false;
    const submitOk = quiz.require_bio === true ? await proofOk(body?.bioSecret) : false;

    const questions: QuizQuestion[] = Array.isArray(quiz.questions) ? quiz.questions : [];
    if (questions.length === 0) return NextResponse.json({ success: false, error: 'لا توجد أسئلة' }, { status: 400 });

    const byIdx = new Map<number, unknown>();
    for (const a of answers) if (Number.isInteger(a?.questionIndex)) byIdx.set(a.questionIndex, a.answer);

    const userAnswers = await Promise.all(questions.map(async (q, i) => {
      const raw = byIdx.get(i);
      const ans = (typeof raw === 'string' || (raw && typeof raw === 'object')) ? (raw as string | Record<string, string>) : '';
      const isCorrect = await gradeAnswer(q, ans as string | Record<string, string>);
      return { questionIndex: i, type: q.type, answer: ans, isCorrect };
    }));
    const score = userAnswers.filter((a) => a.isCorrect).length;

    const { data: row, error: insErr } = await supabaseServer.from('scores').insert({
      student_id: uid, teacher_id: quiz.user_id, quiz_id: quizId, quiz_title: quiz.title,
      score, total: questions.length, user_answers: userAnswers,
      ...(quiz.require_bio === true ? { bio_start_verified: startOk, bio_submit_verified: submitOk } : {}),
    }).select('id').single();
    if (insErr) return NextResponse.json({ success: false, error: 'فشل حفظ الدرجة' }, { status: 500 });

    return NextResponse.json({ success: true, score, total: questions.length, userAnswers, scoreId: row?.id });
  } catch (e) {
    console.error('[quizzes/submit]', e);
    return NextResponse.json({ success: false, error: 'خطأ غير متوقع' }, { status: 500 });
  }
}

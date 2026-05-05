import { NextRequest, NextResponse } from 'next/server';
import { explainWrongAnswer } from '@/lib/gemini';
import { authenticateRequest, authErrorResponse } from '@/lib/auth-helpers';
import { checkRateLimit, getRateLimitHeaders, validateRequest, sanitizeString, safeErrorResponse } from '@/lib/api-security';

export async function POST(request: NextRequest) {
  try {
    const validationError = validateRequest(request);
    if (validationError) return validationError;

    const rateLimit = checkRateLimit(request);
    const rateLimitHeaders = getRateLimitHeaders(rateLimit.remaining, rateLimit.retryAfterMs);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { success: false, error: 'طلبات كثيرة جداً. يرجى المحاولة لاحقاً' },
        { status: 429, headers: rateLimitHeaders }
      );
    }

    const authResult = await authenticateRequest(request);
    if (!authResult.success) return authErrorResponse(authResult);

    const body = await request.json();
    const { question, correctAnswer, studentAnswer, questionType } = body;

    if (!question || !correctAnswer || !studentAnswer) {
      return NextResponse.json(
        { success: false, error: 'جميع الحقول مطلوبة' },
        { status: 400 }
      );
    }

    const sanitizedQuestion = sanitizeString(question, 2000);
    const sanitizedCorrectAnswer = sanitizeString(correctAnswer, 1000);
    const sanitizedStudentAnswer = sanitizeString(studentAnswer, 1000);
    const sanitizedType = sanitizeString(questionType || 'mcq', 50);

    const explainPromise = explainWrongAnswer(
      sanitizedQuestion,
      sanitizedCorrectAnswer,
      sanitizedStudentAnswer,
      sanitizedType
    );
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('انتهت مهلة الشرح')), 30000)
    );
    const explanation = await Promise.race([explainPromise, timeoutPromise]);

    return NextResponse.json(
      { success: true, data: { explanation } },
      { headers: rateLimitHeaders }
    );
  } catch (error: unknown) {
    console.error('[Explain API] Error:', error);

    const errMsg = error instanceof Error ? error.message : String(error);

    if (errMsg.includes('429') || errMsg.includes('quota') || errMsg.includes('rate_limit')) {
      return NextResponse.json(
        { success: false, error: 'تم تجاوز حد الطلبات. يرجى المحاولة بعد دقيقة' },
        { status: 429 }
      );
    }

    return safeErrorResponse('حدث خطأ أثناء شرح الإجابة');
  }
}

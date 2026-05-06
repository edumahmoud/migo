import { NextRequest, NextResponse } from 'next/server';

// IMPORTANT: On Vercel Hobby plan, maxDuration is capped at 60s.
export const maxDuration = 60;
export const runtime = 'nodejs';
import { generateQuiz } from '@/lib/gemini';
import { authenticateRequest, authErrorResponse } from '@/lib/auth-helpers';
import { checkRateLimit, getRateLimitHeaders, validateRequest, sanitizeString, safeErrorResponse } from '@/lib/api-security';

/**
 * POST /api/gemini/quiz
 *
 * Generate a quiz from content with optional configuration.
 *
 * Body: {
 *   content: string,
 *   questionTypes?: { mcq?: number, boolean?: number, completion?: number, matching?: number },
 *   totalQuestions?: number,
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const validationError = validateRequest(request, { largeBody: true });
    if (validationError) return validationError;

    const authResult = await authenticateRequest(request);
    if (!authResult.success) return authErrorResponse(authResult);

    const rateLimit = checkRateLimit(request, authResult.success ? authResult.user.id : undefined);
    const rateLimitHeaders = getRateLimitHeaders(rateLimit.remaining, rateLimit.retryAfterMs);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { success: false, error: 'طلبات كثيرة جداً. يرجى المحاولة لاحقاً' },
        { status: 429, headers: rateLimitHeaders }
      );
    }

    const body = await request.json();
    const rawContent = body.content;
    const questionTypes = body.questionTypes as { mcq?: number; boolean?: number; completion?: number; matching?: number } | undefined;

    if (!rawContent || typeof rawContent !== 'string' || rawContent.trim().length === 0) {
      return NextResponse.json(
        { success: false, error: 'المحتوى مطلوب' },
        { status: 400, headers: rateLimitHeaders }
      );
    }

    const sanitizedContent = sanitizeString(rawContent, 20000);
    if (sanitizedContent.length === 0) {
      return NextResponse.json(
        { success: false, error: 'المحتوى غير صالح بعد التنظيف' },
        { status: 400, headers: rateLimitHeaders }
      );
    }

    // Generate quiz using AI (Google Gemini) with timeout
    console.log('[Quiz API] Generating quiz for user:', authResult.user.id, 'config:', questionTypes);
    const quizPromise = generateQuiz(sanitizedContent, questionTypes);
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('انتهت مهلة إنشاء الاختبار. يرجى المحاولة مرة أخرى')), 55000)
    );
    const questions = await Promise.race([quizPromise, timeoutPromise]);
    console.log('[Quiz API] Quiz generated successfully, questions:', questions.length);

    return NextResponse.json(
      { success: true, data: { questions } },
      { headers: rateLimitHeaders }
    );
  } catch (error: unknown) {
    console.error('[Quiz API] Error:', error);

    const errMsg = error instanceof Error ? error.message : String(error);

    if (errMsg.includes('429') || errMsg.includes('quota') || errMsg.includes('RESOURCE_EXHAUSTED')) {
      return NextResponse.json(
        { success: false, error: 'تم تجاوز حد الطلبات للذكاء الاصطناعي. يرجى المحاولة بعد دقيقة' },
        { status: 429 }
      );
    }

    if (errMsg.includes('API_KEY') || errMsg.includes('401') || errMsg.includes('403')) {
      return NextResponse.json(
        { success: false, error: 'خطأ في تكوين خدمة الذكاء الاصطناعي. يرجى التواصل مع الإدارة' },
        { status: 503 }
      );
    }

    if (errMsg.includes('مهلة') || errMsg.includes('timeout') || errMsg.includes('timed out')) {
      return NextResponse.json(
        { success: false, error: 'انتهت مهلة إنشاء الاختبار. يرجى المحاولة مرة أخرى' },
        { status: 504 }
      );
    }

    if (errMsg.includes('not configured')) {
      return NextResponse.json(
        { success: false, error: 'خدمة الذكاء الاصطناعي غير مفعلة حالياً. يرجى التواصل مع الإدارة' },
        { status: 503 }
      );
    }

    return safeErrorResponse('حدث خطأ أثناء إنشاء الاختبار');
  }
}

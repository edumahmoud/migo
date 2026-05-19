import { NextRequest, NextResponse } from 'next/server';
import { explainWrongAnswer, isAiError } from '@/lib/ai';
import { authenticateRequest, authErrorResponse } from '@/lib/auth-helpers';
import { checkRateLimit, getRateLimitHeaders, validateRequest, sanitizeString, safeErrorResponse } from '@/lib/api-security';
import { supabaseServer } from '@/lib/supabase-server';

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

    // Fetch student name from DB for personalized AI responses
    let studentName: string | undefined;
    try {
      const { data: profile } = await supabaseServer
        .from('users')
        .select('name')
        .eq('id', authResult.user.id)
        .single();
      studentName = profile?.name || undefined;
    } catch {
      // Name lookup failed — will use default in AI prompt
    }

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
      sanitizedType,
      studentName
    );
    // The AI layer manages its own global timeout budget across the fallback chain.
    // No duplicate route-level timeout — the provider-manager handles it internally.
    const explanation = await explainPromise;

    return NextResponse.json(
      { success: true, data: { explanation } },
      { headers: rateLimitHeaders }
    );
  } catch (error: unknown) {
    console.error('[Explain API] Error:', error);

    // ─── Handle AiProviderError (structured errors from our AI service) ───
    if (isAiError(error)) {
      const statusMap: Record<string, number> = {
        'RATE_LIMIT': 429,
        'AUTH_ERROR': 503,
        'TIMEOUT': 504,
        'NOT_CONFIGURED': 503,
        'MODEL_ERROR': 503,
        'CONNECTION_ERROR': 504,
        'EMPTY_RESPONSE': 502,
        'UNKNOWN': 500,
      };
      const status = statusMap[error.code] || 500;
      console.error('[Explain API] AiProviderError:', error.code, error.provider, error.userMessage);
      return NextResponse.json(
        { success: false, error: error.userMessage },
        { status }
      );
    }

    // Fallback for unstructured errors
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error('[Explain API] Unhandled error:', errMsg);
    return safeErrorResponse('حدث خطأ أثناء شرح الإجابة');
  }
}

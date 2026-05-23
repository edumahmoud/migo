import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 60;
export const runtime = 'nodejs';
import { explainWrongAnswer, isAiError } from '@/lib/ai';
import { authenticateRequest, authErrorResponse } from '@/lib/auth-helpers';
import { checkRateLimit, getRateLimitHeaders, validateRequest, sanitizeString, safeErrorResponse } from '@/lib/api-security';
import { supabaseServer } from '@/lib/supabase-server';

export async function POST(request: NextRequest) {
  try {
    const validationError = validateRequest(request);
    if (validationError) return validationError;

    // Authenticate FIRST — we need the user ID for per-user rate limiting
    const authResult = await authenticateRequest(request);
    if (!authResult.success) return authErrorResponse(authResult);

    // Per-user rate limiting (fairer for shared networks like schools)
    // 30 req/min per user — more generous for students reviewing wrong answers
    // Falls back to IP if userId is somehow missing
    const rateLimit = checkRateLimit(request, authResult.user.id, 30);
    const rateLimitHeaders = getRateLimitHeaders(rateLimit.remaining, rateLimit.retryAfterMs);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { success: false, error: 'طلبات كثيرة جداً. يرجى الانتظار قليلاً ثم المحاولة' },
        { status: 429, headers: rateLimitHeaders }
      );
    }

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

    if (!question || !studentAnswer) {
      return NextResponse.json(
        { success: false, error: 'السؤال وإجابة الطالب مطلوبان' },
        { status: 400 }
      );
    }

    // Allow missing correctAnswer — the AI can still explain based on the question alone.
    // This is important for matching and completion questions where the client may not
    // always have the correctAnswer readily available.
    const effectiveCorrectAnswer = correctAnswer || 'غير محدد';

    const sanitizedQuestion = sanitizeString(question, 2000);
    const sanitizedCorrectAnswer = sanitizeString(effectiveCorrectAnswer, 1000);
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

      // Provide friendlier messages for common AI rate limit errors
      let userMessage = error.userMessage;
      if (error.code === 'RATE_LIMIT') {
        userMessage = 'خدمة الذكاء الاصطناعي مشغولة حالياً. يرجى الانتظار قليلاً ثم المحاولة مرة أخرى';
      }

      console.error('[Explain API] AiProviderError:', error.code, error.provider, error.userMessage);
      return NextResponse.json(
        { success: false, error: userMessage },
        { status }
      );
    }

    // Fallback for unstructured errors
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error('[Explain API] Unhandled error:', errMsg);
    return safeErrorResponse('حدث خطأ أثناء شرح الإجابة');
  }
}

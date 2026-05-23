import { NextRequest, NextResponse } from 'next/server';
import { evaluateCompletionAnswer, evaluateCompletionDetailed, isAiError } from '@/lib/ai';

// Allow up to 60 seconds for AI evaluation
export const maxDuration = 60;
export const runtime = 'nodejs';
import { authenticateRequest, authErrorResponse } from '@/lib/auth-helpers';
import { checkRateLimit, getRateLimitHeaders, validateRequest, sanitizeString, safeErrorResponse } from '@/lib/api-security';

export async function POST(request: NextRequest) {
  try {
    // Content-Type and size validation
    const validationError = validateRequest(request);
    if (validationError) return validationError;

    // Rate limiting
    const rateLimit = checkRateLimit(request);
    const rateLimitHeaders = getRateLimitHeaders(rateLimit.remaining, rateLimit.retryAfterMs);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { success: false, error: 'طلبات كثيرة جداً. يرجى المحاولة لاحقاً' },
        { status: 429, headers: rateLimitHeaders }
      );
    }

    // Authentication — use centralized auth helper
    const authResult = await authenticateRequest(request);
    if (!authResult.success) return authErrorResponse(authResult);

    const body = await request.json();
    const { question, correctAnswer, studentAnswer, detailed } = body;

    if (!question || !correctAnswer || !studentAnswer) {
      return NextResponse.json(
        { success: false, error: 'جميع الحقول مطلوبة' },
        { status: 400, headers: rateLimitHeaders }
      );
    }

    if (typeof question !== 'string' || typeof correctAnswer !== 'string' || typeof studentAnswer !== 'string') {
      return NextResponse.json(
        { success: false, error: 'يجب أن تكون جميع الحقول نصية' },
        { status: 400, headers: rateLimitHeaders }
      );
    }

    // Sanitize inputs with reasonable length limits
    const sanitizedQuestion = sanitizeString(question, 2000);
    const sanitizedCorrectAnswer = sanitizeString(correctAnswer, 1000);
    const sanitizedStudentAnswer = sanitizeString(studentAnswer, 1000);

    if (!sanitizedQuestion || !sanitizedCorrectAnswer || !sanitizedStudentAnswer) {
      return NextResponse.json(
        { success: false, error: 'حقول غير صالحة بعد التنظيف' },
        { status: 400, headers: rateLimitHeaders }
      );
    }

    // First check exact match (case-insensitive)
    const studentLower = sanitizedStudentAnswer.toLowerCase().trim();
    const correctLower = sanitizedCorrectAnswer.toLowerCase().trim();

    if (studentLower === correctLower) {
      return NextResponse.json(
        {
          success: true,
          data: detailed
            ? { isCorrect: true, reasoning: 'الإجابة مطابقة تماماً للإجابة الصحيحة' }
            : { isCorrect: true }
        },
        { headers: rateLimitHeaders }
      );
    }

    // ─── Arabic text normalization ───
    // Remove diacritics (tashkeel), normalize alef variants, normalize taa marbuta
    const normalizeArabic = (s: string) =>
      s.replace(/[\u064B-\u065F\u0670]/g, '')   // remove fatha, damma, kasra, shadda, sukun, etc.
       .replace(/[أإآٱ]/g, 'ا')                  // normalize alef variants → bare alef
       .replace(/ة/g, 'ه')                        // taa marbuta → haa
       .replace(/ى/g, 'ي');                       // alef maqsura → yaa

    // Check Arabic-normalized forms (handles diacritics, alef variants, taa marbuta)
    const studentArNorm = normalizeArabic(studentLower).trim();
    const correctArNorm = normalizeArabic(correctLower).trim();

    if (studentArNorm === correctArNorm && studentArNorm.length >= 2) {
      return NextResponse.json(
        {
          success: true,
          data: detailed
            ? { isCorrect: true, reasoning: 'الإجابة مطابقة بعد تطبيع النص العربي' }
            : { isCorrect: true }
        },
        { headers: rateLimitHeaders }
      );
    }

    // ─── Flexible local matching (before AI call) ───
    const normalize = (s: string) =>
      normalizeArabic(s)
       .toLowerCase()
       .replace(/[-_\s]/g, '')
       .replace(/ing$/, '')
       .replace(/tion$/, '')
       .replace(/ment$/, '')
       .replace(/ness$/, '')
       .replace(/able$/, '')
       .replace(/ible$/, '');

    const studentNorm = normalize(studentLower);
    const correctNorm = normalize(correctLower);

    if (studentNorm === correctNorm && studentNorm.length >= 3) {
      return NextResponse.json(
        {
          success: true,
          data: detailed
            ? { isCorrect: true, reasoning: 'الإجابة مطابقة صرفياً للإجابة الصحيحة (اختلاف في الصيغة فقط)' }
            : { isCorrect: true }
        },
        { headers: rateLimitHeaders }
      );
    }

    // Check if one contains the other (e.g., "test" in "testing")
    if (
      (studentNorm.length >= 4 && correctNorm.includes(studentNorm)) ||
      (correctNorm.length >= 4 && studentNorm.includes(correctNorm))
    ) {
      const lenDiff = Math.abs(studentNorm.length - correctNorm.length);
      const maxLen = Math.max(studentNorm.length, correctNorm.length);
      if (maxLen > 0 && lenDiff / maxLen < 0.4) {
        return NextResponse.json(
          {
            success: true,
            data: detailed
              ? { isCorrect: true, reasoning: 'الإجابة مطابقة صرفياً للإجابة الصحيحة (اختلاف في الصيغة فقط)' }
              : { isCorrect: true }
          },
          { headers: rateLimitHeaders }
        );
      }
    }

    // ─── Detailed mode: returns isCorrect + reasoning (for teacher AI grading) ───
    if (detailed) {
      // The AI layer manages its own global timeout budget across the fallback chain.
      const result = await evaluateCompletionDetailed(
        sanitizedQuestion,
        sanitizedCorrectAnswer,
        sanitizedStudentAnswer,
      );

      return NextResponse.json(
        { success: true, data: result },
        { headers: rateLimitHeaders }
      );
    }

    // ─── Standard mode: returns isCorrect only (for student quiz evaluation) ───
    // The AI layer manages its own global timeout budget across the fallback chain.
    const isCorrect = await evaluateCompletionAnswer(
      sanitizedQuestion,
      sanitizedCorrectAnswer,
      sanitizedStudentAnswer
    );

    return NextResponse.json(
      { success: true, data: { isCorrect } },
      { headers: rateLimitHeaders }
    );
  } catch (error: unknown) {
    console.error('[Evaluate API] Error:', error);

    // ─── Handle AiProviderError (structured errors from our AI service) ───
    if (isAiError(error)) {
      // On rate limit, fall back to exact match (return false with fallback flag)
      if (error.code === 'RATE_LIMIT') {
        return NextResponse.json(
          { success: true, data: { isCorrect: false, fallback: true } },
          { headers: getRateLimitHeaders(0, 60000) }
        );
      }
      const statusMap: Record<string, number> = {
        'AUTH_ERROR': 503,
        'TIMEOUT': 504,
        'NOT_CONFIGURED': 503,
        'MODEL_ERROR': 503,
        'CONNECTION_ERROR': 504,
        'EMPTY_RESPONSE': 502,
        'MALFORMED_JSON': 502,
        'UNKNOWN': 500,
      };
      const status = statusMap[error.code] || 500;
      console.error('[Evaluate API] AiProviderError:', error.code, error.provider, error.userMessage);
      return NextResponse.json(
        { success: false, error: error.userMessage },
        { status }
      );
    }

    // Fallback for unstructured errors
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error('[Evaluate API] Unhandled error:', errMsg);
    return safeErrorResponse('حدث خطأ أثناء تقييم الإجابة');
  }
}

import { NextRequest, NextResponse } from 'next/server';

// IMPORTANT: On Vercel Hobby plan, maxDuration is capped at 60s.
export const maxDuration = 60;
export const runtime = 'nodejs';
import { generateQuiz, isAiError } from '@/lib/ai';
import { authenticateRequest, authErrorResponse } from '@/lib/auth-helpers';
import { checkRateLimit, getRateLimitHeaders, validateRequest, sanitizeString, safeErrorResponse } from '@/lib/api-security';
import { supabaseServer } from '@/lib/supabase-server';

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

    // Fetch user name for personalized AI responses
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

    // Generate quiz using AI (Gemini) with fallback chain
    // The AI layer now manages its own global timeout budget across the fallback chain.
    // No duplicate route-level timeout — the provider-manager handles it internally.
    console.log('[Quiz API] Generating quiz for user:', authResult.user.id, 'config:', questionTypes);
    const questions = await generateQuiz(sanitizedContent, questionTypes, studentName);
    console.log('[Quiz API] Quiz generated successfully, questions:', questions.length);

    return NextResponse.json(
      { success: true, data: { questions } },
      { headers: rateLimitHeaders }
    );
  } catch (error: unknown) {
    console.error('[Quiz API] Error:', error);

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
      console.error('[Quiz API] AiProviderError:', error.code, error.provider, error.userMessage);
      return NextResponse.json(
        { success: false, error: error.userMessage },
        { status }
      );
    }

    // Fallback for unstructured errors
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error('[Quiz API] Unhandled error:', errMsg);
    return safeErrorResponse('حدث خطأ أثناء إنشاء الاختبار');
  }
}

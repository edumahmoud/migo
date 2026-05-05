import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { evaluateCompletionAnswer } from '@/lib/gemini';
import { checkRateLimit, getRateLimitHeaders, validateRequest, sanitizeString, safeErrorResponse } from '@/lib/api-security';

async function getAuthenticatedUserId(request: NextRequest): Promise<string | null> {
  let token = '';

  const authHeader = request.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    token = authHeader.substring(7);
  }

  if (!token) {
    const authCookie = request.cookies.get('sb-access-token')?.value;
    if (authCookie) {
      try {
        const parsed = JSON.parse(authCookie);
        token = parsed?.access_token || authCookie;
      } catch {
        token = authCookie;
      }
    }
  }

  if (!token) return null;

  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
    const supabase = createClient(supabaseUrl, supabaseAnonKey);
    const { data: { user } } = await supabase.auth.getUser(token);
    return user?.id || null;
  } catch {
    return null;
  }
}

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

    const body = await request.json();
    const { question, correctAnswer, studentAnswer } = body;

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

    // Authentication check
    const userId = await getAuthenticatedUserId(request);
    if (!userId) {
      return NextResponse.json(
        { success: false, error: 'يرجى تسجيل الدخول أولاً' },
        { status: 401, headers: rateLimitHeaders }
      );
    }

    // Evaluate using Gemini API (includes exact-match fast path)
    const isCorrect = await evaluateCompletionAnswer(
      sanitizedQuestion,
      sanitizedCorrectAnswer,
      sanitizedStudentAnswer
    );

    return NextResponse.json(
      { success: true, data: { isCorrect } },
      { headers: rateLimitHeaders }
    );
  } catch (error) {
    console.error('Evaluation error:', error);
    return safeErrorResponse('حدث خطأ أثناء تقييم الإجابة');
  }
}

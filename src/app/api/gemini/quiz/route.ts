import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { generateQuiz } from '@/lib/gemini';
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
    const validationError = validateRequest(request, { largeBody: true });
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
    const rawContent = body.content;

    if (!rawContent || typeof rawContent !== 'string' || rawContent.trim().length === 0) {
      return NextResponse.json(
        { success: false, error: 'المحتوى مطلوب' },
        { status: 400, headers: rateLimitHeaders }
      );
    }

    // Sanitize and limit content length
    const sanitizedContent = sanitizeString(rawContent, 50000);
    if (sanitizedContent.length === 0) {
      return NextResponse.json(
        { success: false, error: 'المحتوى غير صالح بعد التنظيف' },
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

    // Generate quiz using Gemini API
    const questions = await generateQuiz(sanitizedContent);

    return NextResponse.json(
      { success: true, data: { questions } },
      { headers: rateLimitHeaders }
    );
  } catch (error) {
    console.error('Quiz generation error:', error);
    return safeErrorResponse('حدث خطأ أثناء إنشاء الاختبار');
  }
}

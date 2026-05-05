import { NextRequest, NextResponse } from 'next/server';
import { generateSummary } from '@/lib/gemini';
import { authenticateRequest, authErrorResponse } from '@/lib/auth-helpers';
import { checkRateLimit, getRateLimitHeaders, sanitizeString, safeErrorResponse } from '@/lib/api-security';
import { supabaseServer } from '@/lib/supabase-server';

/**
 * POST /api/gemini/summary
 *
 * Accepts text content as JSON, generates an AI summary, and saves it to the database.
 * PDF text extraction now happens CLIENT-SIDE (see src/lib/pdf-client.ts),
 * so this endpoint only handles text input.
 *
 * Request body: { content: string, title?: string }
 */
export async function POST(request: NextRequest) {
  try {
    // Auth check first (before rate limit, so we can rate-limit per user)
    const authResult = await authenticateRequest(request);
    if (!authResult.success) return authErrorResponse(authResult);

    // Rate limiting — per user if authenticated, per IP otherwise
    const rateLimit = checkRateLimit(request, authResult.success ? authResult.user.id : undefined);
    const rateLimitHeaders = getRateLimitHeaders(rateLimit.remaining, rateLimit.retryAfterMs);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { success: false, error: 'طلبات كثيرة جداً. يرجى المحاولة لاحقاً' },
        { status: 429, headers: rateLimitHeaders }
      );
    }

    const userId = authResult.user.id;

    // Parse JSON body with specific error handling
    let body: { content?: string; title?: string };
    try {
      body = await request.json();
    } catch {
      console.error('[Summary API] Failed to parse JSON body');
      return NextResponse.json(
        { success: false, error: 'تنسيق الطلب غير صالح' },
        { status: 400 }
      );
    }

    const rawContent = body.content;
    const title = body.title || 'ملخص';

    if (!rawContent || typeof rawContent !== 'string' || rawContent.trim().length === 0) {
      return NextResponse.json(
        { success: false, error: 'المحتوى مطلوب' },
        { status: 400, headers: rateLimitHeaders }
      );
    }

    // Sanitize and limit content length (200K chars — AI models can't handle more anyway)
    const sanitizedContent = sanitizeString(rawContent, 200000);
    if (sanitizedContent.length === 0) {
      return NextResponse.json(
        { success: false, error: 'المحتوى غير صالح بعد التنظيف' },
        { status: 400, headers: rateLimitHeaders }
      );
    }

    // Generate summary using AI (Groq) with timeout
    console.log('[Summary API] Generating summary for user:', userId, 'content length:', sanitizedContent.length);
    const summaryPromise = generateSummary(sanitizedContent);
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('انتهت مهلة إنشاء الملخص. يرجى المحاولة مرة أخرى')), 90000)
    );
    const summary = await Promise.race([summaryPromise, timeoutPromise]);
    console.log('[Summary API] Summary generated successfully, length:', summary.length);

    // ─── SAVE SUMMARY TO DATABASE (server-side, bypasses RLS) ───
    console.log('[Summary API] Saving summary to DB for user:', userId, 'title:', title);
    const { data: savedSummary, error: dbError } = await supabaseServer
      .from('summaries')
      .insert({
        user_id: userId,
        title,
        original_content: rawContent,
        summary_content: summary,
      })
      .select()
      .single();

    if (dbError) {
      console.error('[Summary API] DB insert failed:', dbError.message, dbError.code, dbError.details);
      // Still return the summary to the client even if DB save fails,
      // but include a warning so the client knows it wasn't persisted
      return NextResponse.json(
        {
          success: true,
          data: {
            summary,
            extractedText: rawContent,
            saved: false,
            saveError: dbError.message,
          },
          warning: 'تم إنشاء الملخص لكن فشل حفظه في قاعدة البيانات. يرجى المحاولة مرة أخرى.',
        },
        { headers: rateLimitHeaders }
      );
    }

    console.log('[Summary API] Summary saved successfully, id:', savedSummary.id);

    return NextResponse.json(
      {
        success: true,
        data: {
          summary,
          extractedText: rawContent,
          saved: true,
          summaryId: savedSummary.id,
          savedSummary,
        },
      },
      { headers: rateLimitHeaders }
    );
  } catch (error: unknown) {
    console.error('[Summary API] Error:', error);

    const errMsg = error instanceof Error ? error.message : String(error);

    if (errMsg.includes('429') || errMsg.includes('quota') || errMsg.includes('RESOURCE_EXHAUSTED') || errMsg.includes('rate_limit') || errMsg.includes('Rate limit')) {
      return NextResponse.json(
        { success: false, error: 'تم تجاوز حد الطلبات للذكاء الاصطناعي. يرجى المحاولة بعد دقيقة' },
        { status: 429 }
      );
    }

    if (errMsg.includes('API_KEY') || errMsg.includes('401') || errMsg.includes('403') || errMsg.includes('API key not valid') || errMsg.includes('Incorrect API key')) {
      return NextResponse.json(
        { success: false, error: 'خطأ في تكوين خدمة الذكاء الاصطناعي. يرجى التواصل مع الإدارة' },
        { status: 503 }
      );
    }

    if (errMsg.includes('مهلة') || errMsg.includes('timeout') || errMsg.includes('timed out')) {
      return NextResponse.json(
        { success: false, error: 'انتهت مهلة إنشاء الملخص. يرجى المحاولة مرة أخرى' },
        { status: 504 }
      );
    }

    if (errMsg.includes('not configured')) {
      return NextResponse.json(
        { success: false, error: 'خدمة الذكاء الاصطناعي غير مفعلة حالياً. يرجى التواصل مع الإدارة' },
        { status: 503 }
      );
    }

    if (errMsg.includes('model') || errMsg.includes('not found') || errMsg.includes('not available')) {
      return NextResponse.json(
        { success: false, error: 'نموذج الذكاء الاصطناعي غير متاح حالياً. يرجى المحاولة لاحقاً' },
        { status: 503 }
      );
    }

    // Include the actual error in the response for debugging
    console.error('[Summary API] Unhandled error details:', errMsg);
    return NextResponse.json(
      { success: false, error: `حدث خطأ أثناء إنشاء الملخص: ${errMsg.substring(0, 200)}` },
      { status: 500 }
    );
  }
}

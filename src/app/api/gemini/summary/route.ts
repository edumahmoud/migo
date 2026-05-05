import { NextRequest, NextResponse } from 'next/server';
import { generateSummary } from '@/lib/gemini';
import { authenticateRequest, authErrorResponse } from '@/lib/auth-helpers';
import { checkRateLimit, getRateLimitHeaders, validateRequest, sanitizeString, safeErrorResponse } from '@/lib/api-security';
import { extractPdfText, validatePdfFile, getPdfErrorMessage } from '@/lib/pdf-extract';
import { supabaseServer } from '@/lib/supabase-server';

/**
 * POST /api/gemini/summary
 *
 * Two modes:
 * 1. JSON body { content: string, title?: string } — summarize text directly
 * 2. FormData with 'file' field + optional 'title' — extract PDF text on server then summarize
 *
 * After generating the summary, it is SAVED directly to the database
 * using the service role key (bypasses RLS). This ensures the summary
 * is persisted even if the client-side insert would fail due to RLS issues.
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
    const contentType = request.headers.get('content-type') || '';
    let rawContent = '';
    let title = '';

    if (contentType.includes('multipart/form-data')) {
      // ─── PDF file mode ───
      const formData = await request.formData();
      const validation = validatePdfFile(formData);

      if ('error' in validation) {
        return validation.error;
      }

      const file = validation.file;
      title = (formData.get('title') as string) || file.name.replace(/\.pdf$/i, '');

      console.log('[Summary API] Processing PDF file:', file.name, 'size:', file.size, 'user:', userId);

      try {
        const buffer = Buffer.from(await file.arrayBuffer());
        const { text } = await extractPdfText(buffer);
        rawContent = text;
        console.log('[Summary API] PDF text extracted, length:', rawContent.length);
      } catch (pdfErr) {
        console.error('[Summary API] PDF extraction error:', pdfErr);
        const { message, status } = getPdfErrorMessage(pdfErr);
        return NextResponse.json(
          { success: false, error: message },
          { status, headers: rateLimitHeaders }
        );
      }
    } else {
      // ─── Text mode ───
      // Use centralized validation for content-type and body size
      const validationError = validateRequest(request, { largeBody: true });
      if (validationError) return validationError;

      const body = await request.json();
      rawContent = body.content;
      title = body.title || 'ملخص';

      if (!rawContent || typeof rawContent !== 'string' || rawContent.trim().length === 0) {
        return NextResponse.json(
          { success: false, error: 'المحتوى مطلوب' },
          { status: 400, headers: rateLimitHeaders }
        );
      }
    }

    // Sanitize and limit content length
    const sanitizedContent = sanitizeString(rawContent, 200000); // 200K chars for large PDFs
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
    // This is the critical fix: instead of relying on the client to insert
    // (which fails silently due to RLS), we save on the server using the
    // service role key. This guarantees the summary is persisted.
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

    return safeErrorResponse('حدث خطأ أثناء إنشاء الملخص');
  }
}

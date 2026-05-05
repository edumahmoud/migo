import { NextRequest, NextResponse } from 'next/server';
import { generateSummary } from '@/lib/gemini';
import { authenticateRequest, authErrorResponse } from '@/lib/auth-helpers';
import { checkRateLimit, getRateLimitHeaders, sanitizeString, safeErrorResponse } from '@/lib/api-security';

/**
 * POST /api/gemini/summary
 *
 * Two modes:
 * 1. JSON body { content: string } — summarize text directly
 * 2. FormData with 'file' field — extract PDF text on server then summarize
 *
 * This handles both text and PDF inputs in a single endpoint.
 */
export async function POST(request: NextRequest) {
  try {
    // Rate limiting
    const rateLimit = checkRateLimit(request);
    const rateLimitHeaders = getRateLimitHeaders(rateLimit.remaining, rateLimit.retryAfterMs);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { success: false, error: 'طلبات كثيرة جداً. يرجى المحاولة لاحقاً' },
        { status: 429, headers: rateLimitHeaders }
      );
    }

    // Auth check
    const authResult = await authenticateRequest(request);
    if (!authResult.success) return authErrorResponse(authResult);

    const contentType = request.headers.get('content-type') || '';
    let rawContent = '';

    if (contentType.includes('multipart/form-data')) {
      // ─── PDF file mode ───
      const formData = await request.formData();
      const file = formData.get('file');

      if (!file || !(file instanceof File)) {
        return NextResponse.json(
          { success: false, error: 'يرجى اختيار ملف PDF' },
          { status: 400, headers: rateLimitHeaders }
        );
      }

      if (!file.name.toLowerCase().endsWith('.pdf') && file.type !== 'application/pdf') {
        return NextResponse.json(
          { success: false, error: 'يجب أن يكون الملف بصيغة PDF' },
          { status: 400, headers: rateLimitHeaders }
        );
      }

      if (file.size > 20 * 1024 * 1024) {
        return NextResponse.json(
          { success: false, error: 'حجم الملف كبير جداً (الحد الأقصى 20 ميجابايت)' },
          { status: 400, headers: rateLimitHeaders }
        );
      }

      console.log('[Summary API] Processing PDF file:', file.name, 'size:', file.size, 'user:', authResult.user.id);

      try {
        const buffer = Buffer.from(await file.arrayBuffer());
        // Use eval('require') to bypass Turbopack static analysis
        // pdf-parse is a CommonJS module that Turbopack can't resolve with import()
        const pdfParse = eval('require')('pdf-parse');
        const data = await pdfParse(buffer);
        rawContent = data.text || '';

        if (!rawContent.trim()) {
          return NextResponse.json(
            { success: false, error: 'لم يتم العثور على نص في الملف. تأكد أن الملف ليس ممسوحاً ضوئياً' },
            { status: 400, headers: rateLimitHeaders }
          );
        }
        console.log('[Summary API] PDF text extracted, length:', rawContent.length);
      } catch (pdfErr) {
        console.error('[Summary API] PDF extraction error:', pdfErr);
        return NextResponse.json(
          { success: false, error: 'توجد مشكلة في قراءة ملف PDF. تأكد أن الملف ليس محمياً أو تالفاً' },
          { status: 400, headers: rateLimitHeaders }
        );
      }
    } else {
      // ─── Text mode ───
      if (!contentType.includes('application/json')) {
        return NextResponse.json(
          { success: false, error: 'يجب أن يكون نوع المحتوى application/json أو multipart/form-data' },
          { status: 415 }
        );
      }

      const body = await request.json();
      rawContent = body.content;

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

    // Generate summary using Gemini API with timeout
    console.log('[Summary API] Generating summary for user:', authResult.user.id, 'content length:', sanitizedContent.length);
    const summaryPromise = generateSummary(sanitizedContent);
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('انتهت مهلة إنشاء الملخص. يرجى المحاولة مرة أخرى')), 90000)
    );
    const summary = await Promise.race([summaryPromise, timeoutPromise]);
    console.log('[Summary API] Summary generated successfully, length:', summary.length);

    return NextResponse.json(
      { success: true, data: { summary } },
      { headers: rateLimitHeaders }
    );
  } catch (error: unknown) {
    console.error('[Summary API] Error:', error);

    const errMsg = error instanceof Error ? error.message : String(error);

    if (errMsg.includes('429') || errMsg.includes('quota') || errMsg.includes('RESOURCE_EXHAUSTED')) {
      return NextResponse.json(
        { success: false, error: 'تم تجاوز حد الطلبات للذكاء الاصطناعي. يرجى المحاولة بعد دقيقة' },
        { status: 429 }
      );
    }

    if (errMsg.includes('API_KEY') || errMsg.includes('401') || errMsg.includes('403') || errMsg.includes('API key not valid')) {
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

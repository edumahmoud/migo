import { NextRequest, NextResponse } from 'next/server';
import { generateSummary, refineTranscribedText, isAiError, type AiProviderError } from '@/lib/ai';

// IMPORTANT: On Vercel Hobby plan, maxDuration is capped at 60s.
// The AI call timeout (45s) + auth/validation (~3-5s) must fit within this.
// On Pro plan, this can be increased to 120 or 300.
export const maxDuration = 60;
// Force Node.js runtime (Edge runtime has 30s limit)
export const runtime = 'nodejs';
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
 * ARCHITECTURE NOTE:
 * Previous version had a redundant route-level timeout (55s) racing with the
 * AI call's own timeout (55s) — this was "triple-stacked" with Vercel's 60s limit,
 * leaving ZERO headroom. Now the AI call uses streaming with a 45s overall timeout
 * (15s first-token timeout), and we NO LONGER add a duplicate timeout at the route level.
 * The DB save is fire-and-forget (not awaited) to return the response faster.
 *
 * Request body: { content: string, title?: string }
 */
export async function POST(request: NextRequest) {
  const requestStartTime = Date.now();

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
    let body: { content?: string; title?: string; subject_id?: string; source_file_type?: 'pdf' | 'docx' };
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
    const subjectId = body.subject_id || null; // FIX #5: Accept optional subject_id
    const sourceFileType = body.source_file_type || null;

    if (!rawContent || typeof rawContent !== 'string' || rawContent.trim().length === 0) {
      return NextResponse.json(
        { success: false, error: 'المحتوى مطلوب' },
        { status: 400, headers: rateLimitHeaders }
      );
    }

    // FIX #4: Sanitize and limit content length (50K chars — increased from 20K
    // to allow summarizing longer academic documents). The AI model supports
    // up to 1M token input, and with streaming + 45s timeout, most complete in time.
    const sanitizedContent = sanitizeString(rawContent, 50000);
    if (sanitizedContent.length === 0) {
      return NextResponse.json(
        { success: false, error: 'المحتوى غير صالح بعد التنظيف' },
        { status: 400, headers: rateLimitHeaders }
      );
    }

    // Generate summary using AI (Gemini) with streaming and fallback chain
    // The AI layer handles its own timeout, retry, and key rotation internally.
    const authTime = Date.now() - requestStartTime;
    console.log('[Summary API] Generating summary for user:', userId, 'content length:', sanitizedContent.length, 'auth took:', authTime + 'ms');

    const summary = await generateSummary(sanitizedContent);

    const aiTime = Date.now() - requestStartTime;
    console.log('[Summary API] Summary generated successfully, length:', summary.length, 'total time so far:', aiTime + 'ms');

    // ─── SAVE SUMMARY TO DATABASE (ALWAYS await — no fire-and-forget) ───
    // PREVIOUS BUG: Using fire-and-forget (void supabaseServer.insert()) after a timeout
    // caused the save to NEVER execute on Vercel serverless, because the function
    // runtime is terminated immediately after the response is sent.
    // FIX: We ALWAYS await the DB save. If we have time remaining, we use it.
    // Only if we're dangerously close to Vercel's 60s limit do we skip the save
    // and return the summary for the client to retry.
    let savedSummaryId: string | null = null;
    let dbSaveSucceeded = false;

    const timeRemaining = 55000 - (Date.now() - requestStartTime); // Leave 5s buffer for response

    try {
      if (timeRemaining < 3000) {
        // Not enough time left — return summary without saving
        // Client will handle saving via a separate request
        console.warn('[Summary API] Only', timeRemaining, 'ms remaining — skipping DB save, client will retry');
      } else {
        const dbTimeoutMs = Math.min(timeRemaining - 2000, 10000); // Up to 10s for DB save
        console.log('[Summary API] Saving to DB with', dbTimeoutMs, 'ms budget...');

        const savePromise = supabaseServer
          .from('summaries')
          .insert({
            user_id: userId,
            title,
            original_content: rawContent,
            summary_content: summary,
            subject_id: subjectId,
            source_file_type: sourceFileType,
          })
          .select()
          .single();

        const saveTimeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('db_save_timeout')), dbTimeoutMs)
        );

        const { data: savedSummary, error: dbError } = await Promise.race([savePromise, saveTimeoutPromise]);

        if (dbError) {
          console.error('[Summary API] DB insert failed:', dbError.message, dbError.code, dbError.details);
        } else if (savedSummary) {
          savedSummaryId = savedSummary.id;
          dbSaveSucceeded = true;
          console.log('[Summary API] Summary saved successfully, id:', savedSummaryId);
        }
      }
    } catch (saveErr) {
      const errMsg = saveErr instanceof Error ? saveErr.message : String(saveErr);
      if (errMsg === 'db_save_timeout') {
        console.warn('[Summary API] DB save timed out — summary generated but not persisted');
        // DO NOT fire-and-forget — it won't work on Vercel serverless.
        // Instead, return the summary content so the client can retry saving.
      } else {
        console.error('[Summary API] DB save error:', errMsg);
      }
    }

    return NextResponse.json(
      {
        success: true,
        data: {
          summary,
          extractedText: rawContent,
          saved: dbSaveSucceeded,
          summaryId: savedSummaryId,
        },
      },
      { headers: rateLimitHeaders }
    );
  } catch (error: unknown) {
    const totalTime = Date.now() - requestStartTime;
    console.error('[Summary API] Error after', totalTime, 'ms:', error);

    // ─── Handle AiProviderError (structured errors from our AI service) ───
    // These errors have a `code` property and a `userMessage` that we can
    // return directly to the user — no need to pattern-match on messages.
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
      console.error('[Summary API] AiProviderError:', error.code, error.provider, error.userMessage);
      return NextResponse.json(
        { success: false, error: error.userMessage },
        { status }
      );
    }

    // ─── Fallback: unstructured errors (shouldn't happen normally) ───
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error('[Summary API] Unhandled error:', errMsg);
    return NextResponse.json(
      { success: false, error: 'حدث خطأ غير متوقع أثناء إنشاء الملخص. يرجى المحاولة مرة أخرى' },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/gemini/summary
 *
 * Refine/format transcribed (extracted) text.
 * Used when the user has raw OCR-extracted text that needs cleanup,
 * formatting, and error correction — NOT summarization.
 *
 * Request body: { summaryId: string }
 *
 * This endpoint:
 * 1. Fetches the summary by ID (verifies ownership)
 * 2. Uses the original_content as input for refinement
 * 3. Updates summary_content in the database with the refined text
 * 4. Returns the updated summary
 */
export async function PUT(request: NextRequest) {
  const requestStartTime = Date.now();

  try {
    const authResult = await authenticateRequest(request);
    if (!authResult.success) return authErrorResponse(authResult);

    // Rate limiting
    const rateLimit = checkRateLimit(request, authResult.user.id);
    const rateLimitHeaders = getRateLimitHeaders(rateLimit.remaining, rateLimit.retryAfterMs);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { success: false, error: 'طلبات كثيرة جداً. يرجى المحاولة لاحقاً' },
        { status: 429, headers: rateLimitHeaders }
      );
    }

    const body = await request.json();
    const { summaryId } = body;

    if (!summaryId) {
      return NextResponse.json(
        { success: false, error: 'معرف الملخص مطلوب' },
        { status: 400 }
      );
    }

    // Verify ownership
    const { data: existing, error: fetchError } = await supabaseServer
      .from('summaries')
      .select('id, user_id, original_content, summary_content, title')
      .eq('id', summaryId)
      .single();

    if (fetchError || !existing) {
      return NextResponse.json(
        { success: false, error: 'الملخص غير موجود' },
        { status: 404 }
      );
    }

    if (existing.user_id !== authResult.user.id) {
      return NextResponse.json(
        { success: false, error: 'غير مصرح بتعديل هذا الملخص' },
        { status: 403 }
      );
    }

    const originalContent = sanitizeString(existing.original_content, 50000);
    if (!originalContent || originalContent.length === 0) {
      return NextResponse.json(
        { success: false, error: 'المحتوى الأصلي فارغ، لا يمكن التنقيح' },
        { status: 400 }
      );
    }

    // Refine the transcribed text using AI
    console.log('[Summary API] Refining transcribed text for:', summaryId, 'content length:', originalContent.length);
    const refinedText = await refineTranscribedText(originalContent);

    const aiTime = Date.now() - requestStartTime;
    console.log('[Summary API] Refinement completed, length:', refinedText.length, 'total time:', aiTime + 'ms');

    // Update the summary_content in the database
    const { data: updated, error: updateError } = await supabaseServer
      .from('summaries')
      .update({ summary_content: refinedText })
      .eq('id', summaryId)
      .select()
      .single();

    if (updateError) {
      console.error('[Summary API] Refinement update error:', updateError.message);
      return NextResponse.json(
        { success: false, error: 'فشل تحديث المحتوى المنقّح' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      data: updated,
    }, { headers: rateLimitHeaders });
  } catch (error: unknown) {
    console.error('[Summary API] PUT (refine) error:', error);

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
      console.error('[Summary API] AiProviderError:', error.code, error.provider, error.userMessage);
      return NextResponse.json(
        { success: false, error: error.userMessage },
        { status }
      );
    }

    const errMsg = error instanceof Error ? error.message : String(error);
    console.error('[Summary API] Unhandled refine error:', errMsg);
    return safeErrorResponse('حدث خطأ أثناء تنقيح النص');
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { generateSummary } from '@/lib/gemini';

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
    let body: { content?: string; title?: string; subject_id?: string };
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

    // Generate summary using AI (Google Gemini) with STREAMING
    // NO duplicate route-level timeout — the AI call has its own two-tier timeout:
    //   - First-token timeout: 15s (fast feedback if AI is unreachable)
    //   - Overall timeout: 45s (leaves 15s headroom for auth + DB)
    const authTime = Date.now() - requestStartTime;
    console.log('[Summary API] Generating summary for user:', userId, 'content length:', sanitizedContent.length, 'auth took:', authTime + 'ms');

    const summary = await generateSummary(sanitizedContent);

    const aiTime = Date.now() - requestStartTime;
    console.log('[Summary API] Summary generated successfully, length:', summary.length, 'total time so far:', aiTime + 'ms');

    // ─── SAVE SUMMARY TO DATABASE (with short timeout) ───
    // Previous version awaited the DB insert without a timeout, which could
    // add 2-5s+ and push past Vercel's 60s limit if the AI call was slow.
    // Now we race the save against a 5-second timeout:
    //   - If it completes in 5s (typical), we return the saved ID
    //   - If it times out, we return without ID and the client handles it
    let savedSummaryId: string | null = null;
    let dbSaveSucceeded = false;

    const timeRemaining = 55000 - (Date.now() - requestStartTime); // Leave 5s buffer
    const dbTimeoutMs = Math.max(Math.min(timeRemaining - 2000, 5000), 2000); // 2-5s, depends on remaining time

    try {
      const savePromise = supabaseServer
        .from('summaries')
        .insert({
          user_id: userId,
          title,
          original_content: rawContent,
          summary_content: summary,
          subject_id: subjectId, // FIX #5: Include subject_id in insert
        })
        .select()
        .single();

      const saveTimeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('db_save_timeout')), dbTimeoutMs)
      );

      const { data: savedSummary, error: dbError } = await Promise.race([savePromise, saveTimeoutPromise]);

      if (dbError) {
        console.error('[Summary API] DB insert failed:', dbError.message, dbError.code, dbError.details);
        // Still return the summary — client will try to save it
      } else if (savedSummary) {
        savedSummaryId = savedSummary.id;
        dbSaveSucceeded = true;
        console.log('[Summary API] Summary saved successfully, id:', savedSummaryId);
      }
    } catch (saveErr) {
      // DB save timed out — return summary without ID
      const errMsg = saveErr instanceof Error ? saveErr.message : String(saveErr);
      if (errMsg === 'db_save_timeout') {
        console.warn('[Summary API] DB save timed out after', dbTimeoutMs, 'ms — returning without ID');
        // Fire the save in background so it still completes
        supabaseServer
          .from('summaries')
          .insert({ user_id: userId, title, original_content: rawContent, summary_content: summary, subject_id: subjectId })
          .select()
          .single()
          .then(({ data, error }) => {
            if (error) console.error('[Summary API] Background save failed:', error.message);
            else console.log('[Summary API] Background save succeeded, id:', data?.id);
          })
          .catch((err: unknown) => console.error('[Summary API] Background save error:', err));
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

    if (errMsg.includes('غير مفعلة') || errMsg.includes('not configured')) {
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

    // Check if this might be a Vercel function timeout (504 or empty response)
    if (errMsg.includes('ECONNRESET') || errMsg.includes('socket hang up') || errMsg.includes('aborted')) {
      return NextResponse.json(
        { success: false, error: 'انتهت مهلة الخادم. قد يكون المحتوى كبيراً جداً، جرب تلخيص محتوى أقصر' },
        { status: 504 }
      );
    }

    console.error('[Summary API] Unhandled error details:', errMsg);
    return NextResponse.json(
      { success: false, error: `حدث خطأ أثناء إنشاء الملخص: ${errMsg.substring(0, 200)}` },
      { status: 500 }
    );
  }
}

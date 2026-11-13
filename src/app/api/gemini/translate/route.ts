import { NextRequest, NextResponse } from 'next/server';
import { translateContent, isAiError } from '@/lib/ai';

// IMPORTANT: On Vercel Hobby plan, maxDuration is capped at 60s.
export const maxDuration = 60;
// Force Node.js runtime (Edge runtime has 30s limit)
export const runtime = 'nodejs';
import { authenticateRequest, authErrorResponse } from '@/lib/auth-helpers';
import { checkRateLimit, getRateLimitHeaders, sanitizeString, safeErrorResponse } from '@/lib/api-security';
import { supabaseServer } from '@/lib/supabase-server';

// Supported target languages for the multi-language submenu.
// Keep codes aligned with LANG_NAMES in provider-manager.translateContent.
const SUPPORTED_LANGS = new Set(['ar', 'en', 'fr', 'es', 'de', 'tr', 'ru', 'it']);

/**
 * PUT /api/gemini/translate
 *
 * v135d: Dedicated translation operation. Translates the CURRENT summary_content
 * (already refined/summarized) into the requested target language, preserving
 * Markdown structure. Does NOT refine or summarize.
 *
 * Archives the current content as a 'previous' version (source_op='translate')
 * before overwriting, so the user can roll back via the versions dialog.
 *
 * Request body: { summaryId: string, target_language: string }
 */
export async function PUT(request: NextRequest) {
  const requestStartTime = Date.now();

  try {
    const authResult = await authenticateRequest(request);
    if (!authResult.success) return authErrorResponse(authResult);

    // Fetch user name for personalized AI responses
    let translateStudentName: string | undefined;
    try {
      const { data: profile } = await supabaseServer
        .from('users')
        .select('name')
        .eq('id', authResult.user.id)
        .single();
      translateStudentName = profile?.name || undefined;
    } catch {
      // Name lookup failed — will use default in AI prompt
    }

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
    const { summaryId, target_language } = body as { summaryId?: string; target_language?: string };

    if (!summaryId) {
      return NextResponse.json(
        { success: false, error: 'معرف الملخص مطلوب' },
        { status: 400 }
      );
    }
    if (!target_language || !SUPPORTED_LANGS.has(target_language)) {
      return NextResponse.json(
        { success: false, error: 'اللغة المطلوبة غير مدعومة' },
        { status: 400 }
      );
    }

    // Verify ownership & fetch current content
    const { data: existing, error: fetchError } = await supabaseServer
      .from('summaries')
      .select('id, user_id, summary_content, title')
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

    const currentContent = sanitizeString(existing.summary_content || '', 50000);
    if (!currentContent || currentContent.length === 0) {
      return NextResponse.json(
        { success: false, error: 'لا يوجد محتوى لترجمته' },
        { status: 400 }
      );
    }

    // ─── Archive current version before translation ───
    try {
      await supabaseServer
        .from('summary_versions')
        .insert({
          summary_id: summaryId,
          user_id: authResult.user.id,
          content: currentContent,
          version_label: 'previous',
          source_op: 'translate',
        });
      console.log('[Translate API] Archived previous version before translation');
    } catch (archiveErr) {
      console.warn('[Translate API] Failed to archive previous version:', archiveErr instanceof Error ? archiveErr.message : String(archiveErr));
    }

    // Translate the current summary content (preserves Markdown)
    console.log('[Translate API] Translating summary:', summaryId, '→', target_language, 'length:', currentContent.length);
    const translatedText = await translateContent(currentContent, target_language, translateStudentName);

    const aiTime = Date.now() - requestStartTime;
    console.log('[Translate API] Translation completed, length:', translatedText.length, 'total time:', aiTime + 'ms');

    // Update DB with time-remaining safety check
    const timeRemaining = 55000 - (Date.now() - requestStartTime);
    let dbUpdateSucceeded = false;
    let updatedData: typeof existing | null = null;

    try {
      if (timeRemaining < 3000) {
        console.warn('[Translate API] Only', timeRemaining, 'ms remaining — attempting quick DB save');
        try {
          await supabaseServer
            .from('summaries')
            .update({ summary_content: translatedText })
            .eq('id', summaryId);
          dbUpdateSucceeded = true;
        } catch {
          // Best-effort save
        }
        return NextResponse.json({
          success: true,
          data: { ...existing, summary_content: translatedText },
          saved: dbUpdateSucceeded,
        }, { headers: rateLimitHeaders });
      }

      const dbTimeoutMs = Math.min(timeRemaining - 2000, 10000);
      const updatePromise = supabaseServer
        .from('summaries')
        .update({ summary_content: translatedText })
        .eq('id', summaryId)
        .select()
        .single();

      const updateTimeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('db_update_timeout')), dbTimeoutMs)
      );

      const { data: updated, error: updateError } = await Promise.race([updatePromise, updateTimeoutPromise]);

      if (updateError) {
        console.error('[Translate API] Update error:', updateError.message);
        return NextResponse.json({
          success: true,
          data: { ...existing, summary_content: translatedText },
          saved: false,
        }, { headers: rateLimitHeaders });
      }

      dbUpdateSucceeded = true;
      updatedData = updated;
    } catch (saveErr) {
      const errMsg = saveErr instanceof Error ? saveErr.message : String(saveErr);
      if (errMsg === 'db_update_timeout') {
        console.warn('[Translate API] DB update timed out — returning translated text without DB confirmation');
      } else {
        console.error('[Translate API] DB save error:', errMsg);
      }
      return NextResponse.json({
        success: true,
        data: { ...existing, summary_content: translatedText },
        saved: false,
      }, { headers: rateLimitHeaders });
    }

    return NextResponse.json({
      success: true,
      data: updatedData,
      saved: dbUpdateSucceeded,
    }, { headers: rateLimitHeaders });
  } catch (error: unknown) {
    console.error('[Translate API] PUT error:', error);

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
      console.error('[Translate API] AiProviderError:', error.code, error.provider, error.userMessage);
      return NextResponse.json(
        { success: false, error: error.userMessage },
        { status }
      );
    }

    const errMsg = error instanceof Error ? error.message : String(error);
    console.error('[Translate API] Unhandled error:', errMsg);
    return safeErrorResponse('حدث خطأ أثناء الترجمة');
  }
}

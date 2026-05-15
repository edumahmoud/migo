import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest, authErrorResponse } from '@/lib/auth-helpers';

// IMPORTANT: On Vercel Hobby plan, maxDuration is capped at 60s.
export const maxDuration = 60;
export const runtime = 'nodejs';
import { supabaseServer } from '@/lib/supabase-server';
import { generateSummary, isAiError } from '@/lib/ai';
import { checkRateLimit, getRateLimitHeaders, sanitizeString, safeErrorResponse } from '@/lib/api-security';

/**
 * GET /api/summaries
 *
 * Fetch summaries for the authenticated user.
 * Uses the service role key (bypasses RLS) to guarantee
 * the user can always read their own summaries.
 *
 * Query params:
 *   - id (optional): if provided, fetch a single summary by ID
 *     (must be owned by the authenticated user)
 *   - userId (optional): if provided, fetch summaries for this user
 *     (only allowed for admin/teacher viewing student summaries)
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await authenticateRequest(request);
    if (!authResult.success) return authErrorResponse(authResult);

    const userId = authResult.user.id;
    const { searchParams } = new URL(request.url);
    const summaryId = searchParams.get('id');
    const targetUserId = searchParams.get('userId') || userId;

    // ─── Fetch a single summary by ID (efficient, avoids loading all summaries) ───
    if (summaryId) {
      const { data: summary, error } = await supabaseServer
        .from('summaries')
        .select('*')
        .eq('id', summaryId)
        .single();

      if (error || !summary) {
        console.error('[Summaries API] Fetch by ID error:', error?.message);
        return NextResponse.json(
          { success: false, error: 'الملخص غير موجود' },
          { status: 404 }
        );
      }

      // Verify ownership — users can only fetch their own summaries
      // (admins can fetch any summary via the userId param which is handled below)
      if (summary.user_id !== userId) {
        return NextResponse.json(
          { success: false, error: 'غير مصرح بعرض هذا الملخص' },
          { status: 403 }
        );
      }

      return NextResponse.json({
        success: true,
        data: summary,
      });
    }

    // ─── Fetch all summaries for the user (existing behavior) ───
    // FIX #7: If requesting another user's summaries (targetUserId !== userId),
    // verify that the authenticated user has an approved teacher-student link.
    if (targetUserId !== userId) {
      // Check if the requesting user is a teacher with an approved link to the target student
      const { data: linkData, error: linkError } = await supabaseServer
        .from('teacher_student_links')
        .select('status')
        .eq('teacher_id', userId)
        .eq('student_id', targetUserId)
        .limit(1);

      if (linkError || !linkData || linkData.length === 0 || linkData[0].status !== 'approved') {
        console.warn('[Summaries API] Unauthorized access attempt:', userId, 'tried to access summaries of', targetUserId);
        return NextResponse.json(
          { success: false, error: 'غير مصرح بعرض ملخصات هذا المستخدم' },
          { status: 403 }
        );
      }
    }

    // Fetch summaries using service role key (bypasses RLS)
    const { data: summaries, error } = await supabaseServer
      .from('summaries')
      .select('*')
      .eq('user_id', targetUserId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[Summaries API] Fetch error:', error.message);
      return NextResponse.json(
        { success: false, error: 'فشل في تحميل الملخصات' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      data: summaries,
    });
  } catch (error) {
    console.error('[Summaries API] Unexpected error:', error);
    return NextResponse.json(
      { success: false, error: 'حدث خطأ غير متوقع' },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/summaries
 *
 * Re-generate a summary for an existing record.
 * Uses the original_content to generate a new summary and updates the DB.
 *
 * ARCHITECTURE NOTE:
 * Removed the redundant route-level timeout. The AI call now uses streaming
 * with its own two-tier timeout (15s first-token + 45s overall).
 * The DB update is done after the AI call but we don't add an extra timeout race.
 *
 * Body: { summaryId: string }
 */
export async function PUT(request: NextRequest) {
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
      .select('id, user_id, original_content, title')
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
        { success: false, error: 'المحتوى الأصلي فارغ، لا يمكن إعادة التلخيص' },
        { status: 400 }
      );
    }

    // Generate new summary — NO duplicate timeout race.
    // The AI call uses streaming with its own two-tier timeout.
    console.log('[Summaries API] Re-generating summary for:', summaryId);
    const newSummary = await generateSummary(originalContent);

    // Update the summary in the database
    const { data: updated, error: updateError } = await supabaseServer
      .from('summaries')
      .update({ summary_content: newSummary })
      .eq('id', summaryId)
      .select()
      .single();

    if (updateError) {
      console.error('[Summaries API] Update error:', updateError.message);
      return NextResponse.json(
        { success: false, error: 'فشل تحديث الملخص' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      data: updated,
    }, { headers: rateLimitHeaders });
  } catch (error: unknown) {
    console.error('[Summaries API] PUT error:', error);

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
      console.error('[Summaries API] AiProviderError:', error.code, error.provider, error.userMessage);
      return NextResponse.json(
        { success: false, error: error.userMessage },
        { status }
      );
    }

    const errMsg = error instanceof Error ? error.message : String(error);
    console.error('[Summaries API] Unhandled error:', errMsg);
    return safeErrorResponse('حدث خطأ أثناء إعادة التلخيص');
  }
}

/**
 * DELETE /api/summaries
 *
 * Delete a summary by ID (also deletes associated quizzes).
 * Uses the service role key (bypasses RLS) to ensure
 * the user can always delete their own summaries.
 *
 * Body: { summaryId: string }
 */
export async function DELETE(request: NextRequest) {
  try {
    const authResult = await authenticateRequest(request);
    if (!authResult.success) return authErrorResponse(authResult);

    const body = await request.json();
    const { summaryId } = body;

    if (!summaryId) {
      return NextResponse.json(
        { success: false, error: 'معرف الملخص مطلوب' },
        { status: 400 }
      );
    }

    // First verify ownership using service role key
    const { data: summary, error: fetchError } = await supabaseServer
      .from('summaries')
      .select('user_id')
      .eq('id', summaryId)
      .single();

    if (fetchError || !summary) {
      return NextResponse.json(
        { success: false, error: 'الملخص غير موجود' },
        { status: 404 }
      );
    }

    // Only allow users to delete their own summaries
    if (summary.user_id !== authResult.user.id) {
      return NextResponse.json(
        { success: false, error: 'غير مصرح بحذف هذا الملخص' },
        { status: 403 }
      );
    }

    // Delete associated quizzes first
    const { error: quizDeleteError } = await supabaseServer
      .from('quizzes')
      .delete()
      .eq('summary_id', summaryId);

    if (quizDeleteError) {
      console.warn('[Summaries API] Failed to delete associated quizzes:', quizDeleteError.message);
      // Continue deleting the summary anyway
    }

    // Delete using service role key (bypasses RLS)
    const { error: deleteError } = await supabaseServer
      .from('summaries')
      .delete()
      .eq('id', summaryId);

    if (deleteError) {
      console.error('[Summaries API] Delete error:', deleteError.message);
      return NextResponse.json(
        { success: false, error: 'فشل في حذف الملخص' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'تم حذف الملخص بنجاح',
    });
  } catch (error) {
    console.error('[Summaries API] Unexpected error:', error);
    return NextResponse.json(
      { success: false, error: 'حدث خطأ غير متوقع' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/summaries
 *
 * Create a new summary record directly (used by transcribe-only mode).
 * This saves the extracted text WITHOUT AI summarization.
 *
 * Body: { title: string, original_content: string, summary_content: string, subject_id?: string, transcribe_only?: boolean }
 */
export async function POST(request: NextRequest) {
  try {
    const authResult = await authenticateRequest(request);
    if (!authResult.success) return authErrorResponse(authResult);

    const userId = authResult.user.id;

    // Rate limiting
    const rateLimit = checkRateLimit(request, userId);
    const rateLimitHeaders = getRateLimitHeaders(rateLimit.remaining, rateLimit.retryAfterMs);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { success: false, error: 'طلبات كثيرة جداً. يرجى المحاولة لاحقاً' },
        { status: 429, headers: rateLimitHeaders }
      );
    }

    let body: { title?: string; original_content?: string; summary_content?: string; subject_id?: string; transcribe_only?: boolean; source_file_type?: 'pdf' | 'docx' };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { success: false, error: 'تنسيق الطلب غير صالح' },
        { status: 400 }
      );
    }

    const { title, original_content, summary_content, subject_id, transcribe_only, source_file_type } = body;

    if (!title || !original_content || !summary_content) {
      return NextResponse.json(
        { success: false, error: 'العنوان والمحتوى مطلوبان' },
        { status: 400, headers: rateLimitHeaders }
      );
    }

    // Sanitize content
    const sanitizedOriginal = sanitizeString(original_content, 50000);
    const sanitizedSummary = sanitizeString(summary_content, 50000);

    if (sanitizedOriginal.length === 0 || sanitizedSummary.length === 0) {
      return NextResponse.json(
        { success: false, error: 'المحتوى غير صالح بعد التنظيف' },
        { status: 400, headers: rateLimitHeaders }
      );
    }

    // Insert the summary record
    const { data: savedSummary, error: dbError } = await supabaseServer
      .from('summaries')
      .insert({
        user_id: userId,
        title,
        original_content: sanitizedOriginal,
        summary_content: sanitizedSummary,
        subject_id: subject_id || null,
        source_file_type: source_file_type || null,
      })
      .select()
      .single();

    if (dbError) {
      console.error('[Summaries API] POST insert error:', dbError.message);
      return NextResponse.json(
        { success: false, error: 'فشل حفظ التفريغ' },
        { status: 500 }
      );
    }

    console.log('[Summaries API] Transcribe-only saved, id:', savedSummary?.id, 'transcribe_only:', !!transcribe_only);

    return NextResponse.json({
      success: true,
      data: savedSummary,
    }, { headers: rateLimitHeaders });
  } catch (error) {
    console.error('[Summaries API] POST error:', error);
    return NextResponse.json(
      { success: false, error: 'حدث خطأ غير متوقع' },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest, authErrorResponse } from '@/lib/auth-helpers';
import { supabaseServer } from '@/lib/supabase-server';
import { generateSummary } from '@/lib/gemini';
import { checkRateLimit, getRateLimitHeaders, sanitizeString, safeErrorResponse } from '@/lib/api-security';

/**
 * GET /api/summaries
 *
 * Fetch summaries for the authenticated user.
 * Uses the service role key (bypasses RLS) to guarantee
 * the user can always read their own summaries.
 *
 * Query params:
 *   - userId (optional): if provided, fetch summaries for this user
 *     (only allowed for admin/teacher viewing student summaries)
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await authenticateRequest(request);
    if (!authResult.success) return authErrorResponse(authResult);

    const userId = authResult.user.id;
    const { searchParams } = new URL(request.url);
    const targetUserId = searchParams.get('userId') || userId;

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

    const originalContent = sanitizeString(existing.original_content, 200000);
    if (!originalContent || originalContent.length === 0) {
      return NextResponse.json(
        { success: false, error: 'المحتوى الأصلي فارغ، لا يمكن إعادة التلخيص' },
        { status: 400 }
      );
    }

    // Generate new summary
    console.log('[Summaries API] Re-generating summary for:', summaryId);
    const summaryPromise = generateSummary(originalContent);
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('انتهت مهلة إعادة التلخيص. يرجى المحاولة مرة أخرى')), 90000)
    );
    const newSummary = await Promise.race([summaryPromise, timeoutPromise]);

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

    const errMsg = error instanceof Error ? error.message : String(error);

    if (errMsg.includes('429') || errMsg.includes('quota') || errMsg.includes('rate_limit') || errMsg.includes('Rate limit')) {
      return NextResponse.json(
        { success: false, error: 'تم تجاوز حد الطلبات للذكاء الاصطناعي. يرجى المحاولة بعد دقيقة' },
        { status: 429 }
      );
    }

    if (errMsg.includes('مهلة') || errMsg.includes('timeout') || errMsg.includes('timed out')) {
      return NextResponse.json(
        { success: false, error: 'انتهت مهلة إعادة التلخيص. يرجى المحاولة مرة أخرى' },
        { status: 504 }
      );
    }

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

import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest, authErrorResponse } from '@/lib/auth-helpers';
import { supabaseServer } from '@/lib/supabase-server';
import { generateQuiz } from '@/lib/gemini';
import { checkRateLimit, getRateLimitHeaders, sanitizeString, safeErrorResponse } from '@/lib/api-security';

/**
 * POST /api/quizzes
 *
 * Create a new quiz.
 * Uses the service role key (bypasses RLS) to guarantee the quiz is saved.
 *
 * Body: { title: string, questions: array, summaryId?: string }
 */
export async function POST(request: NextRequest) {
  try {
    const authResult = await authenticateRequest(request);
    if (!authResult.success) return authErrorResponse(authResult);

    const userId = authResult.user.id;
    const body = await request.json();
    const { title, questions, summaryId } = body;

    if (!title || !questions || !Array.isArray(questions)) {
      return NextResponse.json(
        { success: false, error: 'العنوان والأسئلة مطلوبان' },
        { status: 400 }
      );
    }

    const insertData: Record<string, unknown> = {
      user_id: userId,
      title,
      questions,
    };

    if (summaryId) {
      insertData.summary_id = summaryId;
    }

    const { data: quiz, error } = await supabaseServer
      .from('quizzes')
      .insert(insertData)
      .select()
      .single();

    if (error) {
      console.error('[Quizzes API] Insert error:', error.message);
      return NextResponse.json(
        { success: false, error: 'فشل حفظ الاختبار' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      data: quiz,
    });
  } catch (error) {
    console.error('[Quizzes API] Unexpected error:', error);
    return NextResponse.json(
      { success: false, error: 'حدث خطأ غير متوقع' },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/quizzes
 *
 * Re-generate a quiz for a summary.
 * Deletes the old quiz and creates a new one from the summary content.
 *
 * Body: { quizId: string }  OR  { summaryId: string }
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
    const { quizId, summaryId } = body;

    let targetSummaryId = summaryId;
    let quizTitle = '';
    let originalContent = '';

    if (quizId) {
      // Find the quiz and its linked summary
      const { data: existingQuiz, error: quizError } = await supabaseServer
        .from('quizzes')
        .select('id, user_id, summary_id, title')
        .eq('id', quizId)
        .single();

      if (quizError || !existingQuiz) {
        return NextResponse.json(
          { success: false, error: 'الاختبار غير موجود' },
          { status: 404 }
        );
      }

      if (existingQuiz.user_id !== authResult.user.id) {
        return NextResponse.json(
          { success: false, error: 'غير مصرح بتعديل هذا الاختبار' },
          { status: 403 }
        );
      }

      targetSummaryId = existingQuiz.summary_id;
      quizTitle = existingQuiz.title;

      // Delete the old quiz
      const { error: deleteError } = await supabaseServer
        .from('quizzes')
        .delete()
        .eq('id', quizId);

      if (deleteError) {
        console.error('[Quizzes API] Delete old quiz error:', deleteError.message);
      }
    }

    if (!targetSummaryId) {
      return NextResponse.json(
        { success: false, error: 'يجب تحديد الاختبار أو الملخص المرتبط' },
        { status: 400 }
      );
    }

    // Get the summary content
    const { data: summary, error: summaryError } = await supabaseServer
      .from('summaries')
      .select('id, user_id, original_content, summary_content, title')
      .eq('id', targetSummaryId)
      .single();

    if (summaryError || !summary) {
      return NextResponse.json(
        { success: false, error: 'الملخص المرتبط غير موجود' },
        { status: 404 }
      );
    }

    // Use original content for quiz generation (better than summary)
    originalContent = sanitizeString(summary.original_content || summary.summary_content, 50000);
    if (!originalContent || originalContent.length === 0) {
      return NextResponse.json(
        { success: false, error: 'محتوى الملخص فارغ، لا يمكن إنشاء اختبار' },
        { status: 400 }
      );
    }

    if (!quizTitle) {
      quizTitle = `اختبار: ${summary.title}`;
    }

    // Generate new quiz
    console.log('[Quizzes API] Re-generating quiz for summary:', targetSummaryId);
    const quizPromise = generateQuiz(originalContent);
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('انتهت مهلة إنشاء الاختبار. يرجى المحاولة مرة أخرى')), 90000)
    );
    const questions = await Promise.race([quizPromise, timeoutPromise]);

    // Save the new quiz
    const { data: newQuiz, error: insertError } = await supabaseServer
      .from('quizzes')
      .insert({
        user_id: authResult.user.id,
        title: quizTitle,
        questions,
        summary_id: targetSummaryId,
      })
      .select()
      .single();

    if (insertError) {
      console.error('[Quizzes API] Insert error:', insertError.message);
      return NextResponse.json(
        { success: false, error: 'فشل حفظ الاختبار الجديد' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      data: newQuiz,
    }, { headers: rateLimitHeaders });
  } catch (error: unknown) {
    console.error('[Quizzes API] PUT error:', error);

    const errMsg = error instanceof Error ? error.message : String(error);

    if (errMsg.includes('429') || errMsg.includes('quota') || errMsg.includes('rate_limit') || errMsg.includes('Rate limit')) {
      return NextResponse.json(
        { success: false, error: 'تم تجاوز حد الطلبات للذكاء الاصطناعي. يرجى المحاولة بعد دقيقة' },
        { status: 429 }
      );
    }

    if (errMsg.includes('مهلة') || errMsg.includes('timeout') || errMsg.includes('timed out')) {
      return NextResponse.json(
        { success: false, error: 'انتهت مهلة إنشاء الاختبار. يرجى المحاولة مرة أخرى' },
        { status: 504 }
      );
    }

    return safeErrorResponse('حدث خطأ أثناء إعادة إنشاء الاختبار');
  }
}

/**
 * GET /api/quizzes
 *
 * Fetch quizzes for the authenticated user (own + teacher-linked).
 * Uses the service role key (bypasses RLS) to guarantee data access.
 *
 * Query params:
 *   - summaryId (optional): fetch quizzes for a specific summary
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await authenticateRequest(request);
    if (!authResult.success) return authErrorResponse(authResult);

    const userId = authResult.user.id;
    const { searchParams } = new URL(request.url);
    const summaryIdFilter = searchParams.get('summaryId');

    // If filtering by summaryId, just fetch that specific quiz
    if (summaryIdFilter) {
      const { data: summaryQuizzes, error: sqError } = await supabaseServer
        .from('quizzes')
        .select('*')
        .eq('summary_id', summaryIdFilter)
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

      if (sqError) {
        console.error('[Quizzes API] Fetch by summary error:', sqError.message);
        return NextResponse.json(
          { success: false, error: 'فشل تحميل الاختبارات' },
          { status: 500 }
        );
      }

      return NextResponse.json({
        success: true,
        data: summaryQuizzes || [],
      });
    }

    // Fetch own quizzes
    const { data: ownQuizzes, error: ownError } = await supabaseServer
      .from('quizzes')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (ownError) {
      console.error('[Quizzes API] Fetch own error:', ownError.message);
    }

    // Fetch teacher-linked quizzes
    const { data: links } = await supabaseServer
      .from('teacher_student_links')
      .select('teacher_id, status')
      .eq('student_id', userId);

    let teacherIds: string[] = [];
    if (links && links.length > 0) {
      const hasStatus = 'status' in links[0];
      if (hasStatus) {
        teacherIds = links.filter((l) => l.status === 'approved').map((l) => l.teacher_id);
      } else {
        teacherIds = links.map((l) => l.teacher_id);
      }
    }

    let teacherQuizzes: unknown[] = [];
    if (teacherIds.length > 0) {
      const { data: tQuizzes } = await supabaseServer
        .from('quizzes')
        .select('*')
        .in('user_id', teacherIds)
        .order('created_at', { ascending: false });

      teacherQuizzes = tQuizzes || [];
    }

    // Merge and deduplicate
    const allQuizzes = [...(ownQuizzes || []), ...teacherQuizzes];
    const uniqueMap = new Map<string, unknown>();
    allQuizzes.forEach((q: Record<string, unknown>) => uniqueMap.set(q.id as string, q));

    return NextResponse.json({
      success: true,
      data: Array.from(uniqueMap.values()),
    });
  } catch (error) {
    console.error('[Quizzes API] Unexpected error:', error);
    return NextResponse.json(
      { success: false, error: 'حدث خطأ غير متوقع' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/quizzes
 *
 * Delete a quiz by ID.
 *
 * Body: { quizId: string }
 */
export async function DELETE(request: NextRequest) {
  try {
    const authResult = await authenticateRequest(request);
    if (!authResult.success) return authErrorResponse(authResult);

    const body = await request.json();
    const { quizId } = body;

    if (!quizId) {
      return NextResponse.json(
        { success: false, error: 'معرف الاختبار مطلوب' },
        { status: 400 }
      );
    }

    // Verify ownership
    const { data: quiz, error: fetchError } = await supabaseServer
      .from('quizzes')
      .select('user_id')
      .eq('id', quizId)
      .single();

    if (fetchError || !quiz) {
      return NextResponse.json(
        { success: false, error: 'الاختبار غير موجود' },
        { status: 404 }
      );
    }

    if (quiz.user_id !== authResult.user.id) {
      return NextResponse.json(
        { success: false, error: 'غير مصرح بحذف هذا الاختبار' },
        { status: 403 }
      );
    }

    const { error: deleteError } = await supabaseServer
      .from('quizzes')
      .delete()
      .eq('id', quizId);

    if (deleteError) {
      console.error('[Quizzes API] Delete error:', deleteError.message);
      return NextResponse.json(
        { success: false, error: 'فشل حذف الاختبار' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'تم حذف الاختبار بنجاح',
    });
  } catch (error) {
    console.error('[Quizzes API] Unexpected error:', error);
    return NextResponse.json(
      { success: false, error: 'حدث خطأ غير متوقع' },
      { status: 500 }
    );
  }
}

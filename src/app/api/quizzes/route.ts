import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest, authErrorResponse } from '@/lib/auth-helpers';
import { supabaseServer } from '@/lib/supabase-server';

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
 * GET /api/quizzes
 *
 * Fetch quizzes for the authenticated user (own + teacher-linked).
 * Uses the service role key (bypasses RLS) to guarantee data access.
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await authenticateRequest(request);
    if (!authResult.success) return authErrorResponse(authResult);

    const userId = authResult.user.id;

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

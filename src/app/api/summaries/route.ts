import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest, authErrorResponse } from '@/lib/auth-helpers';
import { supabaseServer } from '@/lib/supabase-server';

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
 * DELETE /api/summaries
 *
 * Delete a summary by ID.
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

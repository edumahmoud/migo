import { NextResponse } from 'next/server';
import { supabaseServer, getSupabaseServerClient } from '@/lib/supabase-server';

/**
 * POST /api/link-teacher-cancel
 * Cancel a pending link request or dismiss a rejected link request.
 * Students can cancel their own pending requests or dismiss rejected ones.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { teacherId, action } = body; // action: 'cancel' | 'dismiss'

    if (!teacherId) {
      return NextResponse.json(
        { error: 'معرف المعلم مطلوب' },
        { status: 400 }
      );
    }

    // 1. Verify the user is authenticated
    // Try Authorization header first, then fall back to cookie-based auth
    let authUser = null;
    const authHeader = request.headers.get('authorization');

    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const { data: { user: headerUser }, error: headerError } = await supabaseServer.auth.getUser(token);
      if (!headerError && headerUser) {
        authUser = headerUser;
      }
    }

    if (!authUser) {
      const serverClient = await getSupabaseServerClient();
      const { data: { user: cookieUser }, error: cookieError } = await serverClient.auth.getUser();
      if (!cookieError && cookieUser) {
        authUser = cookieUser;
      }
    }

    if (!authUser) {
      return NextResponse.json(
        { error: 'يجب تسجيل الدخول أولاً' },
        { status: 401 }
      );
    }

    // 2. Find and validate the link
    const statusFilter = action === 'dismiss' ? 'rejected' : 'pending';
    const { data: link, error: linkError } = await supabaseServer
      .from('teacher_student_links')
      .select('id, status')
      .eq('teacher_id', teacherId)
      .eq('student_id', authUser.id)
      .eq('status', statusFilter)
      .single();

    if (linkError || !link) {
      return NextResponse.json(
        { error: 'لم يتم العثور على الطلب' },
        { status: 404 }
      );
    }

    // 3. Delete the link (using service role)
    const { error: deleteError } = await supabaseServer
      .from('teacher_student_links')
      .delete()
      .eq('id', link.id);

    if (deleteError) {
      console.error('[link-teacher-cancel] Error deleting link:', deleteError);
      return NextResponse.json(
        { error: 'حدث خطأ أثناء إلغاء الطلب' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: action === 'dismiss'
        ? 'تم إزالة الطلب المرفوض'
        : 'تم إلغاء طلب الارتباط',
    });
  } catch (err) {
    console.error('[link-teacher-cancel] Unexpected error:', err);
    return NextResponse.json(
      { error: 'حدث خطأ غير متوقع' },
      { status: 500 }
    );
  }
}

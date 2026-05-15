import { NextResponse } from 'next/server';
import { supabaseServer, getSupabaseServerClient } from '@/lib/supabase-server';

/**
 * POST /api/link-teacher-unlink
 * Unlink an approved teacher-student relationship.
 * Both teachers and students can initiate this.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { teacherId, studentId } = body;

    if (!teacherId && !studentId) {
      return NextResponse.json(
        { error: 'معرف المعلم أو الطالب مطلوب' },
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

    // 2. Get user profile to determine role
    const { data: profile } = await supabaseServer
      .from('users')
      .select('id, role')
      .eq('id', authUser.id)
      .single();

    if (!profile) {
      return NextResponse.json(
        { error: 'لم يتم العثور على الملف الشخصي' },
        { status: 404 }
      );
    }

    // 3. Build the query based on who is unlinking
    let query = supabaseServer
      .from('teacher_student_links')
      .delete();

    if (profile.role === 'student') {
      // Student unlinking from a teacher
      if (!teacherId) {
        return NextResponse.json(
          { error: 'معرف المعلم مطلوب' },
          { status: 400 }
        );
      }
      query = query
        .eq('teacher_id', teacherId)
        .eq('student_id', authUser.id)
        .eq('status', 'approved');
    } else if (profile.role === 'teacher') {
      // Teacher removing a student
      if (!studentId) {
        return NextResponse.json(
          { error: 'معرف الطالب مطلوب' },
          { status: 400 }
        );
      }
      query = query
        .eq('teacher_id', authUser.id)
        .eq('student_id', studentId);
    }

    const { error: deleteError } = await query;

    if (deleteError) {
      console.error('[link-teacher-unlink] Error deleting link:', deleteError);
      return NextResponse.json(
        { error: 'حدث خطأ أثناء إلغاء الارتباط' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'تم إلغاء الارتباط بنجاح',
    });
  } catch (err) {
    console.error('[link-teacher-unlink] Unexpected error:', err);
    return NextResponse.json(
      { error: 'حدث خطأ غير متوقع' },
      { status: 500 }
    );
  }
}

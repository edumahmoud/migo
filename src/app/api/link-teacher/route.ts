import { NextResponse } from 'next/server';
import { supabaseServer, getSupabaseServerClient } from '@/lib/supabase-server';
import { notifyUser } from '@/lib/notifications-service';

/**
 * POST /api/link-teacher
 * Two modes:
 * 1. action='search' — Looks up a teacher by code and returns their info for preview
 * 2. action='link' (default) — Creates a pending link request
 * Uses service role to bypass RLS issues.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { teacherCode, action } = body;

    if (!teacherCode || typeof teacherCode !== 'string') {
      return NextResponse.json(
        { error: 'يرجى إدخال رمز المعلم' },
        { status: 400 }
      );
    }

    const code = teacherCode.trim().toUpperCase();

    // 1. Verify the user is authenticated and get their profile
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

    // Get student profile
    const { data: profile, error: profileError } = await supabaseServer
      .from('users')
      .select('*')
      .eq('id', authUser.id)
      .single();

    if (profileError || !profile) {
      return NextResponse.json(
        { error: 'لم يتم العثور على الملف الشخصي' },
        { status: 404 }
      );
    }

    if (profile.role !== 'student') {
      return NextResponse.json(
        { error: 'هذه الميزة متاحة للطلاب فقط' },
        { status: 403 }
      );
    }

    // 2. Find teacher by code (using service role to bypass RLS)
    const { data: teacher, error: teacherError } = await supabaseServer
      .from('users')
      .select('id, name, email, teacher_code, role, avatar_url')
      .eq('teacher_code', code)
      .eq('role', 'teacher')
      .single();

    if (teacherError || !teacher) {
      return NextResponse.json(
        { error: 'لم يتم العثور على معلم بهذا الرمز' },
        { status: 404 }
      );
    }

    // 3. Check for existing links (all statuses)
    const { data: existingLinks, error: linksError } = await supabaseServer
      .from('teacher_student_links')
      .select('status')
      .eq('teacher_id', teacher.id)
      .eq('student_id', profile.id);

    if (linksError) {
      console.error('[link-teacher] Error checking existing links:', linksError);
      return NextResponse.json(
        { error: 'حدث خطأ أثناء التحقق من الروابط الحالية' },
        { status: 500 }
      );
    }

    if (existingLinks && existingLinks.length > 0) {
      const existingStatus = existingLinks[0].status;

      if (existingStatus === 'approved') {
        return NextResponse.json(
          { error: 'أنت مرتبط بالفعل بهذا المعلم' },
          { status: 409 }
        );
      }

      if (existingStatus === 'pending') {
        return NextResponse.json(
          { error: 'لديك طلب ارتباط معلقة بالفعل مع هذا المعلم' },
          { status: 409 }
        );
      }

      if (existingStatus === 'rejected') {
        return NextResponse.json(
          { error: 'تم رفض طلب الارتباط السابق مع هذا المعلم. يمكنك إزالة الطلب المرفوض والمحاولة مجدداً' },
          { status: 409 }
        );
      }
    }

    // SEARCH MODE: return teacher info for preview
    if (action === 'search') {
      return NextResponse.json({
        teacher: {
          id: teacher.id,
          name: teacher.name,
          email: teacher.email,
          avatar_url: teacher.avatar_url,
          teacher_code: teacher.teacher_code,
        },
      });
    }

    // LINK MODE (default): Create the link with 'pending' status
    const { data: newLink, error: insertError } = await supabaseServer
      .from('teacher_student_links')
      .insert({
        teacher_id: teacher.id,
        student_id: profile.id,
        status: 'pending',
      })
      .select()
      .single();

    if (insertError) {
      console.error('[link-teacher] Error creating link:', insertError);

      // Handle duplicate key error (race condition)
      if (insertError.code === '23505') {
        return NextResponse.json(
          { error: 'لديك طلب ارتباط بالفعل مع هذا المعلم' },
          { status: 409 }
        );
      }

      return NextResponse.json(
        { error: 'حدث خطأ أثناء إرسال طلب الارتباط' },
        { status: 500 }
      );
    }

    // 4. Send notification to the teacher about the new link request (DB + push)
    await notifyUser(
      teacher.id,
      'system',
      'طلب ارتباط جديد',
      `أرسل الطالب ${profile.name} طلب ارتباط بك. اذهب لقسم الطلاب لقبول أو رفض الطلب.`,
      'students',
    );

    return NextResponse.json({
      success: true,
      message: `تم إرسال طلب الارتباط إلى ${teacher.name} بنجاح. في انتظار موافقة المعلم.`,
      link: newLink,
      teacherName: teacher.name,
    });
  } catch (err) {
    console.error('[link-teacher] Unexpected error:', err);
    return NextResponse.json(
      { error: 'حدث خطأ غير متوقع' },
      { status: 500 }
    );
  }
}

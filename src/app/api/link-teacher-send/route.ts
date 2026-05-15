import { NextResponse } from 'next/server';
import { supabaseServer, getSupabaseServerClient } from '@/lib/supabase-server';
import { notifyUser } from '@/lib/notifications-service';

/**
 * POST /api/link-teacher-send
 * Two modes:
 * 1. action='search' — Looks up a student by email and returns their info for preview
 * 2. action='link' (default) — Sends a link request from teacher to student via notification
 *
 * Uses notification-based approach (no schema changes needed).
 * If the student already has a pending request to this teacher, auto-approve it.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { studentEmail, action } = body;

    if (!studentEmail || typeof studentEmail !== 'string') {
      return NextResponse.json(
        { error: 'يرجى إدخال بريد الطالب الإلكتروني' },
        { status: 400 }
      );
    }

    const email = studentEmail.trim().toLowerCase();

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

    // Get teacher profile
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

    if (profile.role !== 'teacher') {
      return NextResponse.json(
        { error: 'هذه الميزة متاحة للمعلمين فقط' },
        { status: 403 }
      );
    }

    // 2. Find student by email (using service role to bypass RLS)
    const { data: student, error: studentError } = await supabaseServer
      .from('users')
      .select('id, name, email, role, avatar_url')
      .eq('email', email)
      .eq('role', 'student')
      .single();

    if (studentError || !student) {
      return NextResponse.json(
        { error: 'لم يتم العثور على طالب بهذا البريد الإلكتروني' },
        { status: 404 }
      );
    }

    // 3. Check for existing links (all statuses)
    const { data: existingLinks, error: linksError } = await supabaseServer
      .from('teacher_student_links')
      .select('id, status')
      .eq('teacher_id', profile.id)
      .eq('student_id', student.id);

    if (linksError) {
      console.error('[link-teacher-send] Error checking existing links:', linksError);
      return NextResponse.json(
        { error: 'حدث خطأ أثناء التحقق من الروابط الحالية' },
        { status: 500 }
      );
    }

    if (existingLinks && existingLinks.length > 0) {
      const existingStatus = existingLinks[0].status;

      if (existingStatus === 'approved') {
        return NextResponse.json(
          { error: 'أنت مرتبط بالفعل بهذا الطالب' },
          { status: 409 }
        );
      }

      // If student already has a pending request to this teacher → auto-approve it
      if (existingStatus === 'pending') {
        const { error: approveError } = await supabaseServer
          .from('teacher_student_links')
          .update({ status: 'approved' })
          .eq('id', existingLinks[0].id);

        if (approveError) {
          console.error('[link-teacher-send] Error auto-approving:', approveError);
          return NextResponse.json(
            { error: 'حدث خطأ أثناء قبول الطلب تلقائياً' },
            { status: 500 }
          );
        }

        // Send notification to student about approval (DB + push)
        await notifyUser(
          student.id,
          'system',
          'تم قبول طلب الارتباط',
          `قبل المعلم ${profile.name} طلب الارتباط بك. يمكنك الآن الوصول إلى مقرراته.`,
          'teachers',
        );

        return NextResponse.json({
          success: true,
          autoApproved: true,
          message: `كان لدى ${student.name} طلب ارتباط معلق بالفعل. تم قبوله تلقائياً.`,
          studentName: student.name,
        });
      }

      if (existingStatus === 'rejected') {
        return NextResponse.json(
          { error: 'تم رفض طلب الارتباط السابق مع هذا الطالب' },
          { status: 409 }
        );
      }
    }

    // SEARCH MODE: return student info for preview
    if (action === 'search') {
      return NextResponse.json({
        student: {
          id: student.id,
          name: student.name,
          email: student.email,
          avatar_url: student.avatar_url,
        },
      });
    }

    // Check if there's already a pending link_request notification from this teacher to this student
    const { data: existingNotifs } = await supabaseServer
      .from('notifications')
      .select('id')
      .eq('user_id', student.id)
      .eq('type', 'link_request')
      .eq('read', false)
      .like('link', `link_request:${profile.id}`);

    if (existingNotifs && existingNotifs.length > 0) {
      return NextResponse.json(
        { error: 'لقد أرسلت بالفعل طلب ارتباط لهذا الطالب ولم يرد عليه بعد' },
        { status: 409 }
      );
    }

    // LINK MODE (default): Send a link_request notification to the student (DB + push)
    await notifyUser(
      student.id,
      'link_request',
      'طلب ارتباط من معلم',
      `أرسل المعلم ${profile.name} طلب ارتباط بك. يمكنك قبول أو رفض الطلب من قسم المعلمين.`,
      `link_request:${profile.id}`,
    );

    return NextResponse.json({
      success: true,
      message: `تم إرسال طلب الارتباط إلى ${student.name} بنجاح. في انتظار موافقة الطالب.`,
      studentName: student.name,
    });
  } catch (err) {
    console.error('[link-teacher-send] Unexpected error:', err);
    return NextResponse.json(
      { error: 'حدث خطأ غير متوقع' },
      { status: 500 }
    );
  }
}

import { NextResponse } from 'next/server';
import { supabaseServer, getSupabaseServerClient } from '@/lib/supabase-server';

/** Helper: send notification using service role (bypasses RLS) */
async function notifyUser(userId: string, type: string, title: string, message: string, link?: string) {
  try {
    await supabaseServer.from('notifications').insert({
      user_id: userId,
      type,
      title,
      message,
      link: link || null,
    });
  } catch (err) {
    console.error('[join-subject] Failed to send notification:', err);
  }
}

/** Helper: send notification to multiple users */
async function notifyUsers(userIds: string[], type: string, title: string, message: string, link?: string) {
  if (userIds.length === 0) return;
  try {
    const rows = userIds.map((userId) => ({
      user_id: userId,
      type,
      title,
      message,
      link: link || null,
    }));
    await supabaseServer.from('notifications').insert(rows);
  } catch (err) {
    console.error('[join-subject] Failed to send bulk notifications:', err);
  }
}

/**
 * POST /api/join-subject
 * Two modes:
 * 1. action='search' — Looks up a subject by join code and returns its info for preview
 * 2. action='join' (default) — Creates a pending enrollment request
 * Uses service role to bypass RLS issues.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { joinCode, action } = body;

    if (!joinCode || typeof joinCode !== 'string') {
      return NextResponse.json(
        { error: 'يرجى إدخال كود الانضمام' },
        { status: 400 }
      );
    }

    const code = joinCode.trim().toUpperCase();

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

    // 2. Find subject by join_code (using service role to bypass RLS)
    const { data: subject, error: subjectError } = await supabaseServer
      .from('subjects')
      .select('id, name, description, color, teacher_id, join_code')
      .eq('join_code', code)
      .single();

    if (subjectError || !subject) {
      return NextResponse.json(
        { error: 'لم يتم العثور على مقرر بهذا الكود' },
        { status: 404 }
      );
    }

    // 3. Check for existing enrollments (all statuses)
    const { data: existingEnrollments, error: enrollmentsError } = await supabaseServer
      .from('subject_students')
      .select('status')
      .eq('subject_id', subject.id)
      .eq('student_id', profile.id);

    if (enrollmentsError) {
      console.error('[join-subject] Error checking existing enrollments:', enrollmentsError);
      return NextResponse.json(
        { error: 'حدث خطأ أثناء التحقق من التسجيلات الحالية' },
        { status: 500 }
      );
    }

    if (existingEnrollments && existingEnrollments.length > 0) {
      const existingStatus = existingEnrollments[0].status;

      if (existingStatus === 'approved') {
        return NextResponse.json(
          { error: 'أنت مسجل بالفعل في هذا المقرر' },
          { status: 409 }
        );
      }

      if (existingStatus === 'pending') {
        return NextResponse.json(
          { error: 'لديك طلب انضمام معلق بالفعل لهذا المقرر' },
          { status: 409 }
        );
      }

      if (existingStatus === 'rejected') {
        return NextResponse.json(
          { error: 'تم رفض طلب انضمامك السابق لهذا المقرر' },
          { status: 409 }
        );
      }
    }

    // SEARCH MODE: Return subject info for preview
    if (action === 'search') {
      // Fetch teacher name for preview
      let teacherName: string | undefined;
      if (subject.teacher_id) {
        const { data: teacher } = await supabaseServer
          .from('users')
          .select('name')
          .eq('id', subject.teacher_id)
          .single();
        teacherName = teacher?.name;
      }

      return NextResponse.json({
        subject: {
          id: subject.id,
          name: subject.name,
          description: subject.description,
          color: subject.color || '#10b981',
          teacher_name: teacherName,
        },
      });
    }

    // JOIN MODE (default): Create the enrollment with 'pending' status
    const { data: newEnrollment, error: insertError } = await supabaseServer
      .from('subject_students')
      .insert({
        subject_id: subject.id,
        student_id: profile.id,
        status: 'pending',
      })
      .select()
      .single();

    if (insertError) {
      console.error('[join-subject] Error creating enrollment:', insertError);

      // Handle duplicate key error (race condition)
      if (insertError.code === '23505') {
        return NextResponse.json(
          { error: 'أنت مسجل بالفعل في هذا المقرر' },
          { status: 409 }
        );
      }

      return NextResponse.json(
        { error: 'حدث خطأ أثناء طلب الانضمام' },
        { status: 500 }
      );
    }

    // Notify the teacher about the new join request
    if (subject.teacher_id) {
      await notifyUser(
        subject.teacher_id,
        'enrollment',
        'طلب انضمام جديد',
        `طلب الطالب ${profile.name || 'طالب'} الانضمام إلى مقرر "${subject.name}"`,
        `enrollment:${subject.id}:overview`
      );
    }

    // Also notify co-teachers
    try {
      const { data: coTeachers } = await supabaseServer
        .from('subject_teachers')
        .select('teacher_id')
        .eq('subject_id', subject.id)
        .eq('role', 'co_teacher');
      if (coTeachers && coTeachers.length > 0) {
        await notifyUsers(
          coTeachers.map((ct: { teacher_id: string }) => ct.teacher_id),
          'enrollment',
          'طلب انضمام جديد',
          `طلب الطالب ${profile.name || 'طالب'} الانضمام إلى مقرر "${subject.name}"`,
          `enrollment:${subject.id}:overview`
        );
      }
    } catch {
      // subject_teachers table may not exist yet — ignore
    }

    return NextResponse.json({
      success: true,
      message: 'تم إرسال طلب الانضمام بنجاح. في انتظار موافقة المعلم.',
      enrollment: newEnrollment,
      subject: {
        name: subject.name,
        color: subject.color,
        teacher_id: subject.teacher_id,
      },
    });
  } catch (err) {
    console.error('[join-subject] Unexpected error:', err);
    return NextResponse.json(
      { error: 'حدث خطأ غير متوقع' },
      { status: 500 }
    );
  }
}

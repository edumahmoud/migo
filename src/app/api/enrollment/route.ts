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
    console.error('[enrollment] Failed to send notification:', err);
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
    console.error('[enrollment] Failed to send bulk notifications:', err);
  }
}

/**
 * POST /api/enrollment
 * Manage subject enrollment requests (approve, reject, approveAll, rejectAll, add, remove).
 * Uses service role to bypass RLS issues.
 *
 * Body: {
 *   action: 'approve' | 'reject' | 'approveAll' | 'rejectAll' | 'add' | 'remove',
 *   subjectId: string,
 *   studentId?: string,       // required for approve, reject, add, remove
 * }
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { action, subjectId, studentId } = body;

    if (!action || !['approve', 'reject', 'approveAll', 'rejectAll', 'add', 'remove'].includes(action)) {
      return NextResponse.json({ error: 'إجراء غير صالح' }, { status: 400 });
    }

    if (!subjectId) {
      return NextResponse.json({ error: 'معرف المقرر مطلوب' }, { status: 400 });
    }

    // 1. Verify the user is authenticated and is a teacher
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
      return NextResponse.json({ error: 'يجب تسجيل الدخول أولاً' }, { status: 401 });
    }

    // Get teacher profile (with name for notification messages)
    const { data: profile, error: profileError } = await supabaseServer
      .from('users')
      .select('id, role, name')
      .eq('id', authUser.id)
      .single();

    if (profileError || !profile) {
      return NextResponse.json({ error: 'لم يتم العثور على الملف الشخصي' }, { status: 404 });
    }

    if (profile.role !== 'teacher') {
      return NextResponse.json({ error: 'هذه الميزة متاحة للمعلمين فقط' }, { status: 403 });
    }

    // Verify the teacher owns this subject and get subject name
    const { data: subject, error: subjectError } = await supabaseServer
      .from('subjects')
      .select('id, teacher_id, name')
      .eq('id', subjectId)
      .single();

    if (subjectError || !subject) {
      return NextResponse.json({ error: 'المقرر غير موجود' }, { status: 404 });
    }

    if (subject.teacher_id !== profile.id) {
      // Also check if the teacher is a co-teacher in subject_teachers
      const { data: coTeacherEntry } = await supabaseServer
        .from('subject_teachers')
        .select('id')
        .eq('subject_id', subjectId)
        .eq('teacher_id', profile.id)
        .maybeSingle();

      if (!coTeacherEntry) {
        return NextResponse.json({ error: 'ليس لديك صلاحية على هذا المقرر' }, { status: 403 });
      }
    }

    const subjectName = subject.name;
    const teacherName = profile.name || 'المعلم';

    // 2. Perform the requested action
    if (action === 'approve') {
      if (!studentId) {
        return NextResponse.json({ error: 'معرف الطالب مطلوب' }, { status: 400 });
      }

      const { error } = await supabaseServer
        .from('subject_students')
        .update({ status: 'approved' })
        .eq('subject_id', subjectId)
        .eq('student_id', studentId)
        .eq('status', 'pending');

      if (error) {
        console.error('[enrollment] Error approving:', error);
        return NextResponse.json({ error: 'حدث خطأ أثناء قبول الطلب' }, { status: 500 });
      }

      // Notify the student their request was approved
      await notifyUser(
        studentId,
        'enrollment',
        'تم قبول طلب الانضمام',
        `تم قبول طلب انضمامك إلى مقرر "${subjectName}" بواسطة ${teacherName}`,
        `subject:${subjectId}:overview`
      );

      return NextResponse.json({ success: true, message: 'تم قبول الطالب بنجاح' });

    } else if (action === 'reject') {
      if (!studentId) {
        return NextResponse.json({ error: 'معرف الطالب مطلوب' }, { status: 400 });
      }

      const { error } = await supabaseServer
        .from('subject_students')
        .update({ status: 'rejected' })
        .eq('subject_id', subjectId)
        .eq('student_id', studentId)
        .eq('status', 'pending');

      if (error) {
        console.error('[enrollment] Error rejecting:', error);
        return NextResponse.json({ error: 'حدث خطأ أثناء رفض الطلب' }, { status: 500 });
      }

      // Notify the student their request was rejected
      await notifyUser(
        studentId,
        'enrollment',
        'تم رفض طلب الانضمام',
        `تم رفض طلب انضمامك إلى مقرر "${subjectName}" بواسطة ${teacherName}`,
        `subject:${subjectId}:overview`
      );

      return NextResponse.json({ success: true, message: 'تم رفض الطلب' });

    } else if (action === 'approveAll') {
      // Get pending students list first
      const { data: pendingList } = await supabaseServer
        .from('subject_students')
        .select('student_id')
        .eq('subject_id', subjectId)
        .eq('status', 'pending');

      const count = pendingList?.length || 0;

      if (count === 0) {
        return NextResponse.json({ success: true, message: 'لا توجد طلبات معلقة', count: 0 });
      }

      const { error } = await supabaseServer
        .from('subject_students')
        .update({ status: 'approved' })
        .eq('subject_id', subjectId)
        .eq('status', 'pending');

      if (error) {
        console.error('[enrollment] Error approving all:', error);
        return NextResponse.json({ error: 'حدث خطأ أثناء قبول جميع الطلبات' }, { status: 500 });
      }

      // Notify all approved students
      const studentIds = pendingList!.map((s: { student_id: string }) => s.student_id);
      await notifyUsers(
        studentIds,
        'enrollment',
        'تم قبول طلب الانضمام',
        `تم قبول طلب انضمامك إلى مقرر "${subjectName}" بواسطة ${teacherName}`,
        `subject:${subjectId}:overview`
      );

      return NextResponse.json({
        success: true,
        message: `تم قبول ${count} طلب بنجاح`,
        count,
      });

    } else if (action === 'rejectAll') {
      // Get pending students list first
      const { data: pendingList } = await supabaseServer
        .from('subject_students')
        .select('student_id')
        .eq('subject_id', subjectId)
        .eq('status', 'pending');

      const count = pendingList?.length || 0;

      if (count === 0) {
        return NextResponse.json({ success: true, message: 'لا توجد طلبات معلقة', count: 0 });
      }

      const { error } = await supabaseServer
        .from('subject_students')
        .update({ status: 'rejected' })
        .eq('subject_id', subjectId)
        .eq('status', 'pending');

      if (error) {
        console.error('[enrollment] Error rejecting all:', error);
        return NextResponse.json({ error: 'حدث خطأ أثناء رفض جميع الطلبات' }, { status: 500 });
      }

      // Notify all rejected students
      const studentIds = pendingList!.map((s: { student_id: string }) => s.student_id);
      await notifyUsers(
        studentIds,
        'enrollment',
        'تم رفض طلب الانضمام',
        `تم رفض طلب انضمامك إلى مقرر "${subjectName}" بواسطة ${teacherName}`,
        `subject:${subjectId}:overview`
      );

      return NextResponse.json({
        success: true,
        message: `تم رفض ${count} طلب`,
        count,
      });

    } else if (action === 'add') {
      if (!studentId) {
        return NextResponse.json({ error: 'معرف الطالب مطلوب' }, { status: 400 });
      }

      // Use upsert to handle existing records
      const { error } = await supabaseServer
        .from('subject_students')
        .upsert({
          subject_id: subjectId,
          student_id: studentId,
          status: 'approved',
        }, { onConflict: 'subject_id,student_id' });

      if (error) {
        console.error('[enrollment] Error adding student:', error);
        return NextResponse.json({ error: 'حدث خطأ أثناء إضافة الطالب' }, { status: 500 });
      }

      // Notify the student they were added to the course
      await notifyUser(
        studentId,
        'enrollment',
        'تم إضافتك إلى مقرر',
        `تم إضافتك إلى مقرر "${subjectName}" بواسطة ${teacherName}`,
        `subject:${subjectId}:overview`
      );

      return NextResponse.json({ success: true, message: 'تم إضافة الطالب بنجاح' });

    } else if (action === 'remove') {
      if (!studentId) {
        return NextResponse.json({ error: 'معرف الطالب مطلوب' }, { status: 400 });
      }

      const { error } = await supabaseServer
        .from('subject_students')
        .delete()
        .eq('subject_id', subjectId)
        .eq('student_id', studentId);

      if (error) {
        console.error('[enrollment] Error removing student:', error);
        return NextResponse.json({ error: 'حدث خطأ أثناء إزالة الطالب' }, { status: 500 });
      }

      // Notify the student they were removed from the course
      await notifyUser(
        studentId,
        'enrollment',
        'تم إزالتك من المقرر',
        `تم إزالتك من مقرر "${subjectName}" بواسطة ${teacherName}`,
        `subject:${subjectId}:overview`
      );

      return NextResponse.json({ success: true, message: 'تم إزالة الطالب من المقرر' });
    }

    return NextResponse.json({ error: 'إجراء غير معروف' }, { status: 400 });
  } catch (err) {
    console.error('[enrollment] Unexpected error:', err);
    return NextResponse.json({ error: 'حدث خطأ غير متوقع' }, { status: 500 });
  }
}

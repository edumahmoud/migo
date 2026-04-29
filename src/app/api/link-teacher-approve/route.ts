import { NextResponse } from 'next/server';
import { supabaseServer, getSupabaseServerClient } from '@/lib/supabase-server';
import { notifyUser, notifyUsers } from '@/lib/notifications-service';

/**
 * POST /api/link-teacher-approve
 * Approve or reject a student's link request, or perform bulk operations.
 * Uses service role to bypass RLS issues.
 *
 * Body: { action: 'approve' | 'reject' | 'approveAll' | 'rejectAll', studentId?: string }
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { action, studentId } = body;

    if (!action || !['approve', 'reject', 'approveAll', 'rejectAll'].includes(action)) {
      return NextResponse.json(
        { error: 'إجراء غير صالح' },
        { status: 400 }
      );
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
      return NextResponse.json(
        { error: 'يجب تسجيل الدخول أولاً' },
        { status: 401 }
      );
    }

    // Get teacher profile
    const { data: profile, error: profileError } = await supabaseServer
      .from('users')
      .select('id, role')
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

    // 2. Perform the requested action
    if (action === 'approve') {
      if (!studentId) {
        return NextResponse.json(
          { error: 'معرف الطالب مطلوب' },
          { status: 400 }
        );
      }

      const { error } = await supabaseServer
        .from('teacher_student_links')
        .update({ status: 'approved' })
        .eq('teacher_id', profile.id)
        .eq('student_id', studentId)
        .eq('status', 'pending');

      if (error) {
        console.error('[link-teacher-approve] Error approving:', error);
        return NextResponse.json(
          { error: 'حدث خطأ أثناء قبول الطلب' },
          { status: 500 }
        );
      }

      // Send notification to the student about approval (DB + push)
      await notifyUser(
        studentId,
        'system',
        'تم قبول طلب الارتباط',
        `قبل المعلم طلب الارتباط بك. يمكنك الآن الوصول إلى مقرراته.`,
        'teachers',
      );

      return NextResponse.json({ success: true, message: 'تم قبول الطالب بنجاح' });

    } else if (action === 'reject') {
      if (!studentId) {
        return NextResponse.json(
          { error: 'معرف الطالب مطلوب' },
          { status: 400 }
        );
      }

      const { error } = await supabaseServer
        .from('teacher_student_links')
        .update({ status: 'rejected' })
        .eq('teacher_id', profile.id)
        .eq('student_id', studentId)
        .eq('status', 'pending');

      if (error) {
        console.error('[link-teacher-approve] Error rejecting:', error);
        return NextResponse.json(
          { error: 'حدث خطأ أثناء رفض الطلب' },
          { status: 500 }
        );
      }

      // Send notification to the student about rejection (DB + push)
      await notifyUser(
        studentId,
        'system',
        'تم رفض طلب الارتباط',
        `رفض المعلم طلب الارتباط بك.`,
        'teachers',
      );

      return NextResponse.json({ success: true, message: 'تم رفض الطلب' });

    } else if (action === 'approveAll') {
      // Get pending requests first
      const { data: pendingLinks } = await supabaseServer
        .from('teacher_student_links')
        .select('student_id')
        .eq('teacher_id', profile.id)
        .eq('status', 'pending');

      const count = pendingLinks?.length || 0;

      if (count === 0) {
        return NextResponse.json({ success: true, message: 'لا توجد طلبات معلقة', count: 0 });
      }

      const { error } = await supabaseServer
        .from('teacher_student_links')
        .update({ status: 'approved' })
        .eq('teacher_id', profile.id)
        .eq('status', 'pending');

      if (error) {
        console.error('[link-teacher-approve] Error approving all:', error);
        return NextResponse.json(
          { error: 'حدث خطأ أثناء قبول جميع الطلبات' },
          { status: 500 }
        );
      }

      // Send notifications to all approved students (DB + push)
      const approvedStudentIds = pendingLinks.map((l: { student_id: string }) => l.student_id);
      await notifyUsers(
        approvedStudentIds,
        'system',
        'تم قبول طلب الارتباط',
        'قبل المعلم طلب الارتباط بك. يمكنك الآن الوصول إلى مقرراته.',
        'teachers',
      );

      return NextResponse.json({
        success: true,
        message: `تم قبول ${count} طلب بنجاح`,
        count,
      });

    } else if (action === 'rejectAll') {
      // Get pending requests first (need student_ids for notifications)
      const { data: pendingLinks } = await supabaseServer
        .from('teacher_student_links')
        .select('student_id')
        .eq('teacher_id', profile.id)
        .eq('status', 'pending');

      const count = pendingLinks?.length || 0;

      const { error } = await supabaseServer
        .from('teacher_student_links')
        .update({ status: 'rejected' })
        .eq('teacher_id', profile.id)
        .eq('status', 'pending');

      if (error) {
        console.error('[link-teacher-approve] Error rejecting all:', error);
        return NextResponse.json(
          { error: 'حدث خطأ أثناء رفض جميع الطلبات' },
          { status: 500 }
        );
      }

      // Send notifications to all rejected students (DB + push)
      const rejectedStudentIds = pendingLinks.map((l: { student_id: string }) => l.student_id);
      await notifyUsers(
        rejectedStudentIds,
        'system',
        'تم رفض طلب الارتباط',
        'رفض المعلم طلب الارتباط بك.',
        'teachers',
      );

      return NextResponse.json({
        success: true,
        message: `تم رفض ${count} طلب`,
        count,
      });
    }

    return NextResponse.json({ error: 'إجراء غير معروف' }, { status: 400 });
  } catch (err) {
    console.error('[link-teacher-approve] Unexpected error:', err);
    return NextResponse.json(
      { error: 'حدث خطأ غير متوقع' },
      { status: 500 }
    );
  }
}

import { NextResponse } from 'next/server';
import { supabaseServer, getSupabaseServerClient } from '@/lib/supabase-server';
import { notifyUser } from '@/lib/notifications-service';

/**
 * POST /api/link-student-approve
 * Students accept or reject teacher-initiated link requests.
 * Uses notification-based approach: teacher link requests are stored as
 * `link_request` notifications. Accepting creates the teacher_student_links row.
 *
 * Body: { action: 'approve' | 'reject' | 'approveAll' | 'rejectAll', teacherId?: string, notificationId?: string }
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { action, teacherId, notificationId } = body;

    if (!action || !['approve', 'reject', 'approveAll', 'rejectAll'].includes(action)) {
      return NextResponse.json(
        { error: 'إجراء غير صالح' },
        { status: 400 }
      );
    }

    // 1. Verify the user is authenticated and is a student
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
      .select('id, role, name')
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

    // Helper: accept a single teacher link request
    async function acceptTeacherRequest(tid: string) {
      // Check if link already exists
      const { data: existingLink } = await supabaseServer
        .from('teacher_student_links')
        .select('id, status')
        .eq('teacher_id', tid)
        .eq('student_id', profile.id)
        .single();

      if (existingLink) {
        if (existingLink.status === 'approved') {
          return { success: true, message: 'أنت مرتبط بالفعل بهذا المعلم' };
        }
        // Update existing pending/rejected to approved
        const { error } = await supabaseServer
          .from('teacher_student_links')
          .update({ status: 'approved' })
          .eq('id', existingLink.id);

        if (error) {
          console.error('[link-student-approve] Error updating link:', error);
          return { success: false, message: 'حدث خطأ أثناء قبول الطلب' };
        }
      } else {
        // Create new approved link
        const { error } = await supabaseServer
          .from('teacher_student_links')
          .insert({
            teacher_id: tid,
            student_id: profile.id,
            status: 'approved',
          });

        if (error) {
          console.error('[link-student-approve] Error creating link:', error);
          return { success: false, message: 'حدث خطأ أثناء قبول الطلب' };
        }
      }

      // Send notification to teacher about acceptance (DB + push)
      await notifyUser(
        tid,
        'system',
        'تم قبول طلب الارتباط',
        `قبل الطالب ${profile.name} طلب الارتباط بك.`,
        'students',
      );

      return { success: true, message: 'تم قبول المعلم بنجاح' };
    }

    // Helper: reject a single teacher link request
    async function rejectTeacherRequest(tid: string) {
      // Check if link already exists (pending from student side)
      const { data: existingLink } = await supabaseServer
        .from('teacher_student_links')
        .select('id, status')
        .eq('teacher_id', tid)
        .eq('student_id', profile.id)
        .single();

      if (existingLink && existingLink.status === 'pending') {
        // Student had also sent a request - delete it instead of rejecting
        await supabaseServer
          .from('teacher_student_links')
          .delete()
          .eq('id', existingLink.id);
      }

      // Send notification to teacher about rejection (DB + push)
      await notifyUser(
        tid,
        'system',
        'تم رفض طلب الارتباط',
        `رفض الطالب ${profile.name} طلب الارتباط بك.`,
        'students',
      );

      return { success: true, message: 'تم رفض الطلب' };
    }

    // 2. Perform the requested action
    if (action === 'approve') {
      if (!teacherId) {
        return NextResponse.json(
          { error: 'معرف المعلم مطلوب' },
          { status: 400 }
        );
      }

      const result = await acceptTeacherRequest(teacherId);

      // Mark the notification as read
      if (notificationId) {
        await supabaseServer
          .from('notifications')
          .update({ read: true })
          .eq('id', notificationId)
          .eq('user_id', profile.id);
      } else {
        // Find and mark the link_request notification for this teacher
        await supabaseServer
          .from('notifications')
          .update({ read: true })
          .eq('user_id', profile.id)
          .eq('type', 'link_request')
          .eq('read', false)
          .like('link', `link_request:${teacherId}`);
      }

      if (!result.success) {
        return NextResponse.json({ error: result.message }, { status: 500 });
      }

      return NextResponse.json({ success: true, message: result.message });

    } else if (action === 'reject') {
      if (!teacherId) {
        return NextResponse.json(
          { error: 'معرف المعلم مطلوب' },
          { status: 400 }
        );
      }

      const result = await rejectTeacherRequest(teacherId);

      // Mark the notification as read
      if (notificationId) {
        await supabaseServer
          .from('notifications')
          .update({ read: true })
          .eq('id', notificationId)
          .eq('user_id', profile.id);
      } else {
        await supabaseServer
          .from('notifications')
          .update({ read: true })
          .eq('user_id', profile.id)
          .eq('type', 'link_request')
          .eq('read', false)
          .like('link', `link_request:${teacherId}`);
      }

      if (!result.success) {
        return NextResponse.json({ error: result.message }, { status: 500 });
      }

      return NextResponse.json({ success: true, message: result.message });

    } else if (action === 'approveAll') {
      // Get all unread link_request notifications for this student
      const { data: pendingNotifs, error: notifsError } = await supabaseServer
        .from('notifications')
        .select('id, link')
        .eq('user_id', profile.id)
        .eq('type', 'link_request')
        .eq('read', false);

      if (notifsError) {
        console.error('[link-student-approve] Error fetching notifications:', notifsError);
        return NextResponse.json(
          { error: 'حدث خطأ أثناء جلب الطلبات' },
          { status: 500 }
        );
      }

      const count = pendingNotifs?.length || 0;

      if (count === 0) {
        return NextResponse.json({ success: true, message: 'لا توجد طلبات معلقة', count: 0 });
      }

      // Process each request
      const teacherIds: string[] = [];
      for (const notif of pendingNotifs) {
        // Extract teacher_id from link field (format: "link_request:TEACHER_ID")
        const tid = notif.link?.replace('link_request:', '');
        if (tid) {
          teacherIds.push(tid);
          await acceptTeacherRequest(tid);
        }
      }

      // Mark all as read
      await supabaseServer
        .from('notifications')
        .update({ read: true })
        .eq('user_id', profile.id)
        .eq('type', 'link_request')
        .eq('read', false);

      return NextResponse.json({
        success: true,
        message: `تم قبول ${count} طلب بنجاح`,
        count,
      });

    } else if (action === 'rejectAll') {
      // Get all unread link_request notifications for this student
      const { data: pendingNotifs, error: notifsError } = await supabaseServer
        .from('notifications')
        .select('id, link')
        .eq('user_id', profile.id)
        .eq('type', 'link_request')
        .eq('read', false);

      if (notifsError) {
        console.error('[link-student-approve] Error fetching notifications:', notifsError);
        return NextResponse.json(
          { error: 'حدث خطأ أثناء جلب الطلبات' },
          { status: 500 }
        );
      }

      const count = pendingNotifs?.length || 0;

      if (count === 0) {
        return NextResponse.json({ success: true, message: 'لا توجد طلبات معلقة', count: 0 });
      }

      // Process each request
      for (const notif of pendingNotifs) {
        const tid = notif.link?.replace('link_request:', '');
        if (tid) {
          await rejectTeacherRequest(tid);
        }
      }

      // Mark all as read
      await supabaseServer
        .from('notifications')
        .update({ read: true })
        .eq('user_id', profile.id)
        .eq('type', 'link_request')
        .eq('read', false);

      return NextResponse.json({
        success: true,
        message: `تم رفض ${count} طلب`,
        count,
      });
    }

    return NextResponse.json({ error: 'إجراء غير معروف' }, { status: 400 });
  } catch (err) {
    console.error('[link-student-approve] Unexpected error:', err);
    return NextResponse.json(
      { error: 'حدث خطأ غير متوقع' },
      { status: 500 }
    );
  }
}

import { NextResponse } from 'next/server';
import { supabaseServer, getSupabaseServerClient } from '@/lib/supabase-server';

/**
 * POST /api/leave-subject
 * Student actions:
 *   action='cancel'    — Cancel own pending join request
 *   action='dismiss'   — Dismiss own rejected join request
 *   action='leave'     — Leave an approved course (unenroll)
 *
 * Body: { action: 'cancel' | 'dismiss' | 'leave', subjectId: string }
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { action, subjectId } = body;

    if (!action || !['cancel', 'dismiss', 'leave'].includes(action)) {
      return NextResponse.json({ error: 'إجراء غير صالح' }, { status: 400 });
    }

    if (!subjectId) {
      return NextResponse.json({ error: 'معرف المقرر مطلوب' }, { status: 400 });
    }

    // 1. Verify the user is authenticated
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

    // 2. Get student profile
    const { data: profile, error: profileError } = await supabaseServer
      .from('users')
      .select('id, role')
      .eq('id', authUser.id)
      .single();

    if (profileError || !profile) {
      return NextResponse.json({ error: 'لم يتم العثور على الملف الشخصي' }, { status: 404 });
    }

    if (profile.role !== 'student') {
      return NextResponse.json({ error: 'هذه الميزة متاحة للطلاب فقط' }, { status: 403 });
    }

    // 3. Verify enrollment exists
    const { data: enrollment, error: enrollmentError } = await supabaseServer
      .from('subject_students')
      .select('status, subject_id')
      .eq('subject_id', subjectId)
      .eq('student_id', profile.id)
      .single();

    if (enrollmentError || !enrollment) {
      return NextResponse.json({ error: 'غير مسجل في هذا المقرر' }, { status: 404 });
    }

    // 4. Perform the action
    if (action === 'cancel') {
      if (enrollment.status !== 'pending') {
        return NextResponse.json({ error: 'لا يمكن إلغاء طلب غير معلق' }, { status: 400 });
      }

      const { error } = await supabaseServer
        .from('subject_students')
        .delete()
        .eq('subject_id', subjectId)
        .eq('student_id', profile.id);

      if (error) {
        console.error('[leave-subject] Error canceling:', error);
        return NextResponse.json({ error: 'حدث خطأ أثناء إلغاء الطلب' }, { status: 500 });
      }

      return NextResponse.json({ success: true, message: 'تم إلغاء طلب الانضمام' });

    } else if (action === 'dismiss') {
      if (enrollment.status !== 'rejected') {
        return NextResponse.json({ error: 'لا يمكن إزالة إلا الطلبات المرفوضة' }, { status: 400 });
      }

      const { error } = await supabaseServer
        .from('subject_students')
        .delete()
        .eq('subject_id', subjectId)
        .eq('student_id', profile.id);

      if (error) {
        console.error('[leave-subject] Error dismissing:', error);
        return NextResponse.json({ error: 'حدث خطأ أثناء إزالة الطلب' }, { status: 500 });
      }

      return NextResponse.json({ success: true, message: 'تم إزالة الطلب المرفوض' });

    } else if (action === 'leave') {
      if (enrollment.status !== 'approved') {
        return NextResponse.json({ error: 'لا يمكن الانسحاب من مقرر غير مسجل فيه' }, { status: 400 });
      }

      // Delete the enrollment
      const { error } = await supabaseServer
        .from('subject_students')
        .delete()
        .eq('subject_id', subjectId)
        .eq('student_id', profile.id);

      if (error) {
        console.error('[leave-subject] Error leaving:', error);
        return NextResponse.json({ error: 'حدث خطأ أثناء الانسحاب من المقرر' }, { status: 500 });
      }

      // Optionally clean up related data: quiz attempts, attendance, etc.
      // Note: We keep the data for the teacher's records but remove the student's enrollment

      return NextResponse.json({ success: true, message: 'تم الانسحاب من المقرر بنجاح' });
    }

    return NextResponse.json({ error: 'إجراء غير معروف' }, { status: 400 });
  } catch (err) {
    console.error('[leave-subject] Unexpected error:', err);
    return NextResponse.json({ error: 'حدث خطأ غير متوقع' }, { status: 500 });
  }
}

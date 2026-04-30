import { NextResponse } from 'next/server';
import { supabaseServer, getSupabaseServerClient } from '@/lib/supabase-server';
import { notifyUser } from '@/lib/notifications-service';

/**
 * GET /api/subject-teachers?subjectId=xxx
 * List co-teachers for a subject.
 * Returns all teachers associated with the subject (owner + co-teachers).
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const subjectId = searchParams.get('subjectId');

    if (!subjectId) {
      return NextResponse.json({ error: 'معرف المقرر مطلوب' }, { status: 400 });
    }

    // Authenticate user
    let authUser = null;
    const authHeader = request.headers.get('authorization');
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const { data: { user: headerUser }, error: headerError } = await supabaseServer.auth.getUser(token);
      if (!headerError && headerUser) authUser = headerUser;
    }
    if (!authUser) {
      const serverClient = await getSupabaseServerClient();
      const { data: { user: cookieUser }, error: cookieError } = await serverClient.auth.getUser();
      if (!cookieError && cookieUser) authUser = cookieUser;
    }
    if (!authUser) {
      return NextResponse.json({ error: 'يجب تسجيل الدخول أولاً' }, { status: 401 });
    }

    // Fetch co-teachers with teacher profile info
    const { data: coTeachers, error } = await supabaseServer
      .from('subject_teachers')
      .select(`
        id,
        subject_id,
        teacher_id,
        role,
        added_by,
        created_at,
        users:teacher_id (name, avatar_url, title_id, gender)
      `)
      .eq('subject_id', subjectId)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('[subject-teachers] Error fetching co-teachers:', error);
      return NextResponse.json({ error: 'حدث خطأ أثناء جلب بيانات المعلمين' }, { status: 500 });
    }

    // Transform data to flatten user info
    const transformed = (coTeachers || []).map((ct: Record<string, unknown>) => {
      const user = ct.users as Record<string, unknown> | null;
      return {
        id: ct.id,
        subject_id: ct.subject_id,
        teacher_id: ct.teacher_id,
        role: ct.role,
        added_by: ct.added_by,
        created_at: ct.created_at,
        teacher_name: user?.name as string || 'معلم',
        teacher_avatar_url: user?.avatar_url as string | null || null,
        teacher_title_id: user?.title_id as string | null || null,
        teacher_gender: user?.gender as string | null || null,
      };
    });

    return NextResponse.json({ success: true, coTeachers: transformed });
  } catch (err) {
    console.error('[subject-teachers] Unexpected error:', err);
    return NextResponse.json({ error: 'حدث خطأ غير متوقع' }, { status: 500 });
  }
}

/**
 * POST /api/subject-teachers
 * Add a co-teacher to a subject (only owner can add).
 * Body: { subjectId, teacherCode }
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { subjectId, teacherCode } = body;

    if (!subjectId) {
      return NextResponse.json({ error: 'معرف المقرر مطلوب' }, { status: 400 });
    }

    if (!teacherCode) {
      return NextResponse.json({ error: 'كود المعلم مطلوب' }, { status: 400 });
    }

    // 1. Authenticate user
    let authUser = null;
    const authHeader = request.headers.get('authorization');
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const { data: { user: headerUser }, error: headerError } = await supabaseServer.auth.getUser(token);
      if (!headerError && headerUser) authUser = headerUser;
    }
    if (!authUser) {
      const serverClient = await getSupabaseServerClient();
      const { data: { user: cookieUser }, error: cookieError } = await serverClient.auth.getUser();
      if (!cookieError && cookieUser) authUser = cookieUser;
    }
    if (!authUser) {
      return NextResponse.json({ error: 'يجب تسجيل الدخول أولاً' }, { status: 401 });
    }

    // 2. Get requester profile
    const { data: profile, error: profileError } = await supabaseServer
      .from('users')
      .select('id, role, name')
      .eq('id', authUser.id)
      .single();

    if (profileError || !profile) {
      return NextResponse.json({ error: 'لم يتم العثور على الملف الشخصي' }, { status: 404 });
    }

    // 3. Verify the requester is the owner of the subject
    const { data: subject, error: subjectError } = await supabaseServer
      .from('subjects')
      .select('id, teacher_id, name')
      .eq('id', subjectId)
      .single();

    if (subjectError || !subject) {
      return NextResponse.json({ error: 'المقرر غير موجود' }, { status: 404 });
    }

    if (subject.teacher_id !== profile.id) {
      return NextResponse.json({ error: 'فقط مالك المقرر يمكنه إضافة معلمين مشاركين' }, { status: 403 });
    }

    // 4. Find the teacher by teacher_code
    const { data: targetTeacher, error: targetError } = await supabaseServer
      .from('users')
      .select('id, name, role, teacher_code')
      .eq('teacher_code', teacherCode.trim().toUpperCase())
      .single();

    if (targetError || !targetTeacher) {
      return NextResponse.json({ error: 'لم يتم العثور على معلم بهذا الكود' }, { status: 404 });
    }

    if (targetTeacher.role !== 'teacher') {
      return NextResponse.json({ error: 'الكود المحدد لا ينتمي لمعلم' }, { status: 400 });
    }

    // Can't add yourself
    if (targetTeacher.id === profile.id) {
      return NextResponse.json({ error: 'لا يمكنك إضافة نفسك كمعلم مشارك' }, { status: 400 });
    }

    // 5. Check if teacher is already added
    const { data: existing, error: existingError } = await supabaseServer
      .from('subject_teachers')
      .select('id, role')
      .eq('subject_id', subjectId)
      .eq('teacher_id', targetTeacher.id)
      .maybeSingle();

    if (existingError) {
      console.error('[subject-teachers] Error checking existing:', existingError);
      return NextResponse.json({ error: 'حدث خطأ أثناء التحقق' }, { status: 500 });
    }

    if (existing) {
      if (existing.role === 'owner') {
        return NextResponse.json({ error: 'هذا المعلم هو مالك المقرر بالفعل' }, { status: 400 });
      }
      return NextResponse.json({ error: 'هذا المعلم مضاف بالفعل كمعلم مشارك' }, { status: 400 });
    }

    // 6. Add the co-teacher
    const { data: newEntry, error: insertError } = await supabaseServer
      .from('subject_teachers')
      .insert({
        subject_id: subjectId,
        teacher_id: targetTeacher.id,
        role: 'co_teacher',
        added_by: profile.id,
      })
      .select('id, subject_id, teacher_id, role, added_by, created_at')
      .single();

    if (insertError) {
      console.error('[subject-teachers] Error adding co-teacher:', insertError);
      return NextResponse.json({ error: 'حدث خطأ أثناء إضافة المعلم المشارك' }, { status: 500 });
    }

    // 7. Send notification to the added teacher
    await notifyUser(
      targetTeacher.id,
      'enrollment',
      'تمت إضافتك كمعلم مشارك',
      `تمت إضافتك كمعلم مشارك في مقرر "${subject.name}" بواسطة ${profile.name}`,
      `subject:${subjectId}:students`
    );

    return NextResponse.json({
      success: true,
      message: `تمت إضافة ${targetTeacher.name} كمعلم مشارك`,
      coTeacher: {
        ...newEntry,
        teacher_name: targetTeacher.name,
        teacher_avatar_url: null,
        teacher_title_id: null,
        teacher_gender: null,
      },
    });
  } catch (err) {
    console.error('[subject-teachers] Unexpected error:', err);
    return NextResponse.json({ error: 'حدث خطأ غير متوقع' }, { status: 500 });
  }
}

/**
 * DELETE /api/subject-teachers
 * Remove a co-teacher from a subject.
 * - Owner can remove any co-teacher
 * - Co-teacher can remove themselves (selfLeave: true)
 * Body: { subjectId, teacherId, selfLeave? }
 */
export async function DELETE(request: Request) {
  try {
    const body = await request.json();
    const { subjectId, teacherId, selfLeave } = body;

    if (!subjectId || !teacherId) {
      return NextResponse.json({ error: 'معرف المقرر والمعلم مطلوبان' }, { status: 400 });
    }

    // 1. Authenticate user
    let authUser = null;
    const authHeader = request.headers.get('authorization');
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const { data: { user: headerUser }, error: headerError } = await supabaseServer.auth.getUser(token);
      if (!headerError && headerUser) authUser = headerUser;
    }
    if (!authUser) {
      const serverClient = await getSupabaseServerClient();
      const { data: { user: cookieUser }, error: cookieError } = await serverClient.auth.getUser();
      if (!cookieError && cookieUser) authUser = cookieUser;
    }
    if (!authUser) {
      return NextResponse.json({ error: 'يجب تسجيل الدخول أولاً' }, { status: 401 });
    }

    // 2. Get requester profile
    const { data: profile, error: profileError } = await supabaseServer
      .from('users')
      .select('id, role, name')
      .eq('id', authUser.id)
      .single();

    if (profileError || !profile) {
      return NextResponse.json({ error: 'لم يتم العثور على الملف الشخصي' }, { status: 404 });
    }

    // 3. Verify the subject exists
    const { data: subject, error: subjectError } = await supabaseServer
      .from('subjects')
      .select('id, teacher_id, name')
      .eq('id', subjectId)
      .single();

    if (subjectError || !subject) {
      return NextResponse.json({ error: 'المقرر غير موجود' }, { status: 404 });
    }

    const isOwner = subject.teacher_id === profile.id;
    const isSelfLeaving = selfLeave === true && teacherId === profile.id;

    // Only owner or self-leaving co-teacher can remove
    if (!isOwner && !isSelfLeaving) {
      return NextResponse.json({ error: 'فقط مالك المقرر أو المعلم المشارك نفسه يمكنه الإزالة' }, { status: 403 });
    }

    // 4. Check the entry exists and is not the owner
    const { data: entry, error: entryError } = await supabaseServer
      .from('subject_teachers')
      .select('id, role, teacher_id')
      .eq('subject_id', subjectId)
      .eq('teacher_id', teacherId)
      .single();

    if (entryError || !entry) {
      return NextResponse.json({ error: 'هذا المعلم غير مضاف لهذا المقرر' }, { status: 404 });
    }

    if (entry.role === 'owner') {
      return NextResponse.json({ error: 'لا يمكنك إزالة مالك المقرر' }, { status: 400 });
    }

    // 5. Get the teacher's name for notification/response
    const { data: targetTeacher } = await supabaseServer
      .from('users')
      .select('name')
      .eq('id', teacherId)
      .single();

    // 6. Remove the co-teacher
    const { error: deleteError } = await supabaseServer
      .from('subject_teachers')
      .delete()
      .eq('id', entry.id);

    if (deleteError) {
      console.error('[subject-teachers] Error removing co-teacher:', deleteError);
      return NextResponse.json({ error: 'حدث خطأ أثناء إزالة المعلم المشارك' }, { status: 500 });
    }

    // 7. Send notification
    if (isSelfLeaving) {
      // Notify the owner that a co-teacher left
      await notifyUser(
        subject.teacher_id,
        'system',
        'غادر معلم مشارك المقرر',
        `غادر ${profile.name} مقرر "${subject.name}" كمعلم مشارك`,
        `subject:${subjectId}`
      );
    } else {
      // Notify the removed teacher
      await notifyUser(
        teacherId,
        'enrollment',
        'تمت إزالتك من مقرر',
        `تمت إزالتك كمعلم مشارك من مقرر "${subject.name}" بواسطة ${profile.name}`,
        `subject:${subjectId}:students`
      );
    }

    return NextResponse.json({
      success: true,
      message: isSelfLeaving
        ? `تمت مغادرة مقرر "${subject.name}" بنجاح`
        : `تمت إزالة ${targetTeacher?.name || 'المعلم'} من المعلمين المشاركين`,
    });
  } catch (err) {
    console.error('[subject-teachers] Unexpected error:', err);
    return NextResponse.json({ error: 'حدث خطأ غير متوقع' }, { status: 500 });
  }
}

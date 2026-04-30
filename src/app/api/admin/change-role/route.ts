import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer, getSupabaseServerClient } from '@/lib/supabase-server';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { userId, newRole } = body;

    if (!userId || !newRole) {
      return NextResponse.json(
        { success: false, error: 'معرف المستخدم والدور الجديد مطلوبان' },
        { status: 400 }
      );
    }

    if (!['student', 'teacher', 'admin', 'superadmin'].includes(newRole)) {
      return NextResponse.json(
        { success: false, error: 'دور غير صالح' },
        { status: 400 }
      );
    }

    // 1. Verify the requester is authenticated - try Bearer token first, then cookie auth
    let authUser = null;
    const authHeader = request.headers.get('authorization');
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const { data: { user }, error } = await supabaseServer.auth.getUser(token);
      if (!error && user) authUser = user;
    }

    if (!authUser) {
      try {
        const serverClient = await getSupabaseServerClient();
        const { data: { user }, error } = await serverClient.auth.getUser();
        if (!error && user) authUser = user;
      } catch {
        // Cookie auth failed
      }
    }

    if (!authUser) {
      return NextResponse.json(
        { success: false, error: 'يجب تسجيل الدخول أولاً' },
        { status: 401 }
      );
    }

    // 2. Get the requester's profile to verify they are admin or superadmin
    const { data: requesterProfile, error: requesterError } = await supabaseServer
      .from('users')
      .select('role')
      .eq('id', authUser.id)
      .single();

    if (requesterError || !requesterProfile) {
      return NextResponse.json(
        { success: false, error: 'لم يتم العثور على الملف الشخصي' },
        { status: 404 }
      );
    }

    if (requesterProfile.role !== 'admin' && requesterProfile.role !== 'superadmin') {
      return NextResponse.json(
        { success: false, error: 'غير مصرح بتغيير الأدوار' },
        { status: 403 }
      );
    }

    // 3. Only superadmin can assign superadmin role
    if (newRole === 'superadmin' && requesterProfile.role !== 'superadmin') {
      return NextResponse.json(
        { success: false, error: 'فقط مدير المنصة يمكنه تعيين دور مدير المنصة' },
        { status: 403 }
      );
    }

    // 4. Only superadmin can change another superadmin's role
    const { data: targetUser } = await supabaseServer
      .from('users')
      .select('role')
      .eq('id', userId)
      .single();

    if (targetUser?.role === 'superadmin' && requesterProfile.role !== 'superadmin') {
      return NextResponse.json(
        { success: false, error: 'فقط مدير المنصة يمكنه تغيير دور مدير المنصة' },
        { status: 403 }
      );
    }

    // 5. Admin cannot change other admin's roles (only superadmin can)
    if (targetUser?.role === 'admin' && requesterProfile.role === 'admin') {
      return NextResponse.json(
        { success: false, error: 'غير مصرح بتغيير دور مشرف آخر' },
        { status: 403 }
      );
    }

    // 6. Admin cannot assign admin role (only superadmin can)
    if (newRole === 'admin' && requesterProfile.role !== 'superadmin') {
      return NextResponse.json(
        { success: false, error: 'فقط مدير المنصة يمكنه تعيين دور المشرف' },
        { status: 403 }
      );
    }

    // 7. Update user role using service role (bypasses RLS)
    const { data, error } = await supabaseServer
      .from('users')
      .update({ role: newRole, updated_at: new Date().toISOString() })
      .eq('id', userId)
      .select()
      .single();

    if (error) {
      console.error('Error changing user role:', error);
      return NextResponse.json(
        { success: false, error: 'حدث خطأ أثناء تغيير الدور' },
        { status: 500 }
      );
    }

    // 8. If changing to teacher, make sure they have a teacher_code
    if (newRole === 'teacher') {
      const existing = data as Record<string, unknown>;
      if (!existing.teacher_code) {
        // Generate a teacher code (6 alphanumeric characters)
        const teacherCode = Math.random().toString(36).substring(2, 8).toUpperCase();
        await supabaseServer
          .from('users')
          .update({ teacher_code: teacherCode })
          .eq('id', userId);
      }
    }

    // 9. If changing from teacher to something else, clean up teacher_code
    if (newRole !== 'teacher') {
      await supabaseServer
        .from('users')
        .update({ teacher_code: null })
        .eq('id', userId);
    }

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('Change role error:', error);
    return NextResponse.json(
      { success: false, error: 'حدث خطأ غير متوقع' },
      { status: 500 }
    );
  }
}

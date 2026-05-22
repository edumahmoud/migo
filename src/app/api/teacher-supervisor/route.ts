// =====================================================
// Teacher-Supervisor Links API
// =====================================================
import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateRequest, getUserRole } from '@/lib/auth-helpers';

// GET /api/teacher-supervisor — Get links (teachers for a supervisor, or supervisors for a teacher)
export async function GET(request: NextRequest) {
  try {
    const authResult = await authenticateRequest(request);
    if (!authResult.success) {
      return NextResponse.json({ success: false, error: authResult.error }, { status: authResult.status });
    }

    const userId = authResult.user.id;
    const role = await getUserRole(userId);

    const url = new URL(request.url);
    const teacherId = url.searchParams.get('teacher_id');
    const supervisorId = url.searchParams.get('supervisor_id');

    let query = supabaseServer
      .from('teacher_supervisor_links')
      .select(`
        *,
        teacher:users!teacher_supervisor_links_teacher_id_fkey(id, name, email, avatar_url, role),
        supervisor:users!teacher_supervisor_links_supervisor_id_fkey(id, name, email, avatar_url, role)
      `);

    if (role === 'admin' || role === 'superadmin') {
      // Admin can query by teacher or supervisor
      if (supervisorId) {
        query = query.eq('supervisor_id', supervisorId);
      } else if (teacherId) {
        query = query.eq('teacher_id', teacherId);
      } else {
        // Default: show links for this admin
        query = query.eq('supervisor_id', userId);
      }
    } else if (role === 'teacher') {
      // Teacher can only see their own supervisors
      query = query.eq('teacher_id', userId);
    } else {
      return NextResponse.json(
        { success: false, error: 'غير مصرح بالوصول' },
        { status: 403 }
      );
    }

    const { data, error } = await query;

    if (error) {
      console.error('[TeacherSupervisor] GET error:', error.message);
      return NextResponse.json(
        { success: false, error: 'فشل جلب الروابط' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('[TeacherSupervisor] GET error:', error);
    return NextResponse.json(
      { success: false, error: 'حدث خطأ غير متوقع' },
      { status: 500 }
    );
  }
}

// POST /api/teacher-supervisor — Create a link (admin only)
export async function POST(request: NextRequest) {
  try {
    const authResult = await authenticateRequest(request);
    if (!authResult.success) {
      return NextResponse.json({ success: false, error: authResult.error }, { status: authResult.status });
    }

    const role = await getUserRole(authResult.user.id);
    if (role !== 'admin' && role !== 'superadmin') {
      return NextResponse.json(
        { success: false, error: 'فقط المشرف أو المدير يمكنه ربط المعلمين' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { teacher_id, supervisor_id, is_primary } = body;

    if (!teacher_id || !supervisor_id) {
      return NextResponse.json(
        { success: false, error: 'معرف المعلم والمشرف مطلوبان' },
        { status: 400 }
      );
    }

    // Verify the teacher is actually a teacher
    const { data: teacherProfile } = await supabaseServer
      .from('users')
      .select('role')
      .eq('id', teacher_id)
      .single();

    if (!teacherProfile || teacherProfile.role !== 'teacher') {
      return NextResponse.json(
        { success: false, error: 'المستخدم المحدد ليس معلماً' },
        { status: 400 }
      );
    }

    // Verify the supervisor is an admin
    const { data: supervisorProfile } = await supabaseServer
      .from('users')
      .select('role')
      .eq('id', supervisor_id)
      .single();

    if (!supervisorProfile || (supervisorProfile.role !== 'admin' && supervisorProfile.role !== 'superadmin')) {
      return NextResponse.json(
        { success: false, error: 'المستخدم المحدد ليس مشرفاً' },
        { status: 400 }
      );
    }

    // If is_primary, remove primary from other links for this teacher
    if (is_primary) {
      await supabaseServer
        .from('teacher_supervisor_links')
        .update({ is_primary: false })
        .eq('teacher_id', teacher_id)
        .eq('is_primary', true);
    }

    const { data, error } = await supabaseServer
      .from('teacher_supervisor_links')
      .insert({
        teacher_id,
        supervisor_id,
        is_primary: is_primary || false,
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json(
          { success: false, error: 'الرابط موجود بالفعل' },
          { status: 409 }
        );
      }
      console.error('[TeacherSupervisor] POST error:', error.message);
      return NextResponse.json(
        { success: false, error: 'فشل إنشاء الرابط' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('[TeacherSupervisor] POST error:', error);
    return NextResponse.json(
      { success: false, error: 'حدث خطأ غير متوقع' },
      { status: 500 }
    );
  }
}

// DELETE /api/teacher-supervisor — Remove a link (admin only)
export async function DELETE(request: NextRequest) {
  try {
    const authResult = await authenticateRequest(request);
    if (!authResult.success) {
      return NextResponse.json({ success: false, error: authResult.error }, { status: authResult.status });
    }

    const role = await getUserRole(authResult.user.id);
    if (role !== 'admin' && role !== 'superadmin') {
      return NextResponse.json(
        { success: false, error: 'فقط المشرف أو المدير يمكنه إزالة الروابط' },
        { status: 403 }
      );
    }

    const url = new URL(request.url);
    const linkId = url.searchParams.get('id');

    if (!linkId) {
      return NextResponse.json(
        { success: false, error: 'معرف الرابط مطلوب' },
        { status: 400 }
      );
    }

    const { error } = await supabaseServer
      .from('teacher_supervisor_links')
      .delete()
      .eq('id', linkId);

    if (error) {
      console.error('[TeacherSupervisor] DELETE error:', error.message);
      return NextResponse.json(
        { success: false, error: 'فشل حذف الرابط' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[TeacherSupervisor] DELETE error:', error);
    return NextResponse.json(
      { success: false, error: 'حدث خطأ غير متوقع' },
      { status: 500 }
    );
  }
}

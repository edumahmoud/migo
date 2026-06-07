import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { requireAdmin, authErrorResponse, getUserRole } from '@/lib/auth-helpers';

export async function POST(request: NextRequest) {
  try {
    // ─── Auth: Require admin or superadmin ───
    const adminResult = await requireAdmin(request);
    if (!adminResult.success) {
      return authErrorResponse(adminResult);
    }

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

    const requesterRole = adminResult.role;

    // 2. Only superadmin can assign superadmin role
    if (newRole === 'superadmin' && requesterRole !== 'superadmin') {
      return NextResponse.json(
        { success: false, error: 'فقط مدير المنصة يمكنه تعيين دور مدير المنصة' },
        { status: 403 }
      );
    }

    // 3. Only superadmin can change another superadmin's role
    const { data: targetUser } = await supabaseServer
      .from('users')
      .select('role')
      .eq('id', userId)
      .single();

    if (targetUser?.role === 'superadmin' && requesterRole !== 'superadmin') {
      return NextResponse.json(
        { success: false, error: 'فقط مدير المنصة يمكنه تغيير دور مدير المنصة' },
        { status: 403 }
      );
    }

    // 4. Admin cannot change other admin's roles (only superadmin can)
    if (targetUser?.role === 'admin' && requesterRole === 'admin') {
      return NextResponse.json(
        { success: false, error: 'غير مصرح بتغيير دور مشرف آخر' },
        { status: 403 }
      );
    }

    // 5. Admin cannot assign admin role (only superadmin can)
    if (newRole === 'admin' && requesterRole !== 'superadmin') {
      return NextResponse.json(
        { success: false, error: 'فقط مدير المنصة يمكنه تعيين دور المشرف' },
        { status: 403 }
      );
    }

    // 6. Update user role using service role (bypasses RLS)
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

    // 7. If changing to teacher, make sure they have a teacher_code
    // AND auto-link them to the admin who promoted them
    if (newRole === 'teacher') {
      const existing = data as Record<string, unknown>;
      if (!existing.teacher_code) {
        // Use crypto.randomUUID() for cryptographically secure random code
        // Take first 6 chars of a UUID (without dashes) for a short, unique code
        const teacherCode = crypto.randomUUID().replace(/-/g, '').substring(0, 6).toUpperCase();
        await supabaseServer
          .from('users')
          .update({ teacher_code: teacherCode })
          .eq('id', userId);
      }

      // Auto-link teacher to the admin who promoted them (is_primary = true)
      // Only if no primary link already exists
      const { data: existingPrimaryLink } = await supabaseServer
        .from('teacher_supervisor_links')
        .select('id')
        .eq('teacher_id', userId)
        .eq('is_primary', true)
        .maybeSingle();

      if (!existingPrimaryLink && requesterRole !== 'superadmin') {
        // Link to the promoting admin (not superadmin — superadmin doesn't supervise directly)
        await supabaseServer
          .from('teacher_supervisor_links')
          .upsert(
            {
              teacher_id: userId,
              supervisor_id: adminResult.user.id,
              is_primary: true,
            },
            { onConflict: 'teacher_id,supervisor_id' }
          );
      }
    }

    // 8. If changing from teacher to something else, clean up teacher_code
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

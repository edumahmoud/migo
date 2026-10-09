import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helpers';

// =====================================================
// POST /api/admin/change-role
// Changes a user's role with the following v130 enhancements:
//
// 1. Code preservation: when changing AWAY from teacher/student/agent,
//    save the current code to previous_*_code so it can be restored
//    if the user returns to that role later.
//
// 2. Code restoration: when changing TO teacher/student/agent, if a
//    previous_*_code exists, restore it (the DB trigger handles this
//    automatically via UPDATE OF role). If no preserved code exists,
//    the trigger generates a new sequential code (T-1, S-1, A-1, ...).
//
// 3. Cascade suspension (Request 6): when a TEACHER is promoted to
//    a different role (away from teacher), automatically:
//    - Deactivate all their registration_agents (is_active = false)
//    - Pause all subjects they own (is_paused = true)
//    - Do NOT touch subjects where they are only a co_teacher
//      (those belong to other teachers and should not be affected)
//
// Note: actual user deletion (which cascades via FK) is handled by
// the delete-user API, not here.
// =====================================================

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

    if (!['student', 'teacher', 'admin', 'superadmin', 'registration_agent'].includes(newRole)) {
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

    // 3. Fetch the target user's CURRENT role + code columns
    //    (needed to determine what to preserve)
    const { data: targetUser } = await supabaseServer
      .from('users')
      .select('role, teacher_code, student_code, registration_code, previous_teacher_code, previous_student_code, previous_registration_code')
      .eq('id', userId)
      .single();

    if (!targetUser) {
      return NextResponse.json(
        { success: false, error: 'المستخدم غير موجود' },
        { status: 404 }
      );
    }

    const oldRole = targetUser.role as string;

    if (oldRole === 'superadmin' && requesterRole !== 'superadmin') {
      return NextResponse.json(
        { success: false, error: 'فقط مدير المنصة يمكنه تغيير دور مدير المنصة' },
        { status: 403 }
      );
    }

    // 4. Admin cannot change other admin's roles (only superadmin can)
    if (oldRole === 'admin' && requesterRole === 'admin') {
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

    // If no actual role change, return early
    if (oldRole === newRole) {
      return NextResponse.json({ success: true, data: targetUser });
    }

    // ═══════════════════════════════════════════════════════════
    // 6. v130: Build the update payload with code preservation
    // ═══════════════════════════════════════════════════════════

    const updatePayload: Record<string, unknown> = {
      role: newRole,
      updated_at: new Date().toISOString(),
    };

    // ── 6a. Preserve teacher_code when leaving teacher role ──
    if (oldRole === 'teacher' && newRole !== 'teacher') {
      // Save current teacher_code to previous_teacher_code, null the active one
      if (targetUser.teacher_code) {
        updatePayload.previous_teacher_code = targetUser.teacher_code;
        updatePayload.teacher_code = null;
      }
    }

    // ── 6b. Restore teacher_code when returning to teacher role ──
    // The DB trigger (generate_teacher_code) handles this automatically:
    // if previous_teacher_code is set and teacher_code is null + role=teacher,
    // the trigger restores previous_teacher_code → teacher_code.
    // So we just need to NOT set teacher_code manually here.
    // The trigger fires on UPDATE OF role.

    // ── 6c. Preserve registration_code when leaving agent role ──
    if (oldRole === 'registration_agent' && newRole !== 'registration_agent') {
      if (targetUser.registration_code) {
        updatePayload.previous_registration_code = targetUser.registration_code;
        updatePayload.registration_code = null;
      }
    }

    // ── 6d. Restore registration_code when returning to agent role ──
    // The DB trigger (generate_registration_code) handles this automatically.

    // ── 6e. student_code is universal login (v110) — do NOT null it on role change.
    //    The previous_student_code column exists for audit/future use but we
    //    don't null student_code because it's used for login by ALL roles.
    //    Only preserve if explicitly leaving student role AND we want to
    //    generate a new student_code later (which we don't — it's universal).
    //    So: NO preservation logic for student_code here.

    // ═══════════════════════════════════════════════════════════
    // 7. Update user role + code columns (triggers fire on UPDATE OF role)
    // ═══════════════════════════════════════════════════════════
    const { data, error } = await supabaseServer
      .from('users')
      .update(updatePayload)
      .eq('id', userId)
      .select()
      .single();

    if (error) {
      console.error('Error changing user role:', error);
      return NextResponse.json(
        { success: false, error: 'حدث خطأ أثناء تغيير الدور: ' + (error.message || 'unknown') },
        { status: 500 }
      );
    }

    // ═══════════════════════════════════════════════════════════
    // 8. If changing TO teacher, auto-link to promoting admin
    //    (only if no primary link exists + promoter is admin not superadmin)
    // ═══════════════════════════════════════════════════════════
    if (newRole === 'teacher') {
      const { data: existingPrimaryLink } = await supabaseServer
        .from('teacher_supervisor_links')
        .select('id')
        .eq('teacher_id', userId)
        .eq('is_primary', true)
        .maybeSingle();

      if (!existingPrimaryLink && requesterRole !== 'superadmin') {
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

    // ═══════════════════════════════════════════════════════════
    // 9. v130 Request 6: Cascade suspension when LEAVING teacher role
    //    (promotion to admin/superadmin, or demotion to student/agent)
    //    - Deactivate all registration_agents owned by this teacher
    //    - Pause all subjects owned by this teacher
    //    - Do NOT touch subjects where they are only a co_teacher
    // ═══════════════════════════════════════════════════════════
    if (oldRole === 'teacher' && newRole !== 'teacher') {
      // 9a. Deactivate all agents belonging to this (former) teacher
      const { error: agentUpdateError } = await supabaseServer
        .from('registration_agents')
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq('teacher_id', userId)
        .eq('is_active', true);

      if (agentUpdateError) {
        console.error('[change-role] Failed to deactivate agents for former teacher:', agentUpdateError.message);
        // Non-fatal — role change already succeeded
      }

      // 9b. Pause all subjects OWNED by this teacher (teacher_id = userId)
      //     Do NOT touch subject_teachers entries (co_teacher relationships)
      //     — those subjects belong to OTHER teachers and should not be affected.
      const { error: subjectUpdateError } = await supabaseServer
        .from('subjects')
        .update({ is_paused: true, updated_at: new Date().toISOString() })
        .eq('teacher_id', userId)
        .eq('is_paused', false);

      if (subjectUpdateError) {
        console.error('[change-role] Failed to pause subjects for former teacher:', subjectUpdateError.message);
        // Non-fatal — role change already succeeded
      }
    }

    // ═══════════════════════════════════════════════════════════
    // 10. v130 Request 6: Cascade suspension when LEAVING agent role
    //     (promotion to teacher/admin/superadmin, or demotion to student)
    //     - The agent's own account is NOT suspended (role change != ban)
    //     - No subjects to pause (agents don't own subjects)
    //     - Nothing to do here — the agent simply loses agent privileges
    // ═══════════════════════════════════════════════════════════

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('Change role error:', error);
    return NextResponse.json(
      { success: false, error: 'حدث خطأ غير متوقع' },
      { status: 500 }
    );
  }
}

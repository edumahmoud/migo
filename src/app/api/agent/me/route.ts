import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateRequest, authErrorResponse, getUserRole } from '@/lib/auth-helpers';

/**
 * GET /api/agent/me
 *
 * Returns the calling agent's own profile + their teacher's name + whether
 * the teacher is currently banned (suspended).
 *
 * v130 FIX: This endpoint does NOT use requireAgent() (which filters by
 * is_active=true). Instead, it authenticates the user + checks their role
 * is registration_agent, then fetches the agent row WITHOUT the is_active
 * filter. This allows inactive agents (whose teacher was banned/promoted)
 * to still get their profile + teacher ban status — so the agent portal
 * can show the "teacher suspended" modal.
 *
 * Used by:
 *   - Agent portal header: "وكيل: <display_name> · المعلم: <teacher_name>"
 *   - Agent portal mount: shows a non-dismissible modal if teacher is banned
 *     so the agent knows they can't perform tasks until the ban is lifted.
 */
export async function GET(request: NextRequest) {
  // Authenticate the user (does not check is_active)
  const authResult = await authenticateRequest(request);
  if (!authResult.success) return authErrorResponse(authResult);

  const userId = authResult.user.id;
  const role = await getUserRole(userId);

  if (role !== 'registration_agent') {
    return NextResponse.json(
      { success: false, error: 'هذا الإجراء متاح لوكلاء التسجيل فقط' },
      { status: 403 }
    );
  }

  // Fetch the agent's row WITHOUT is_active=true filter.
  // This allows inactive agents (teacher banned/promoted) to still get
  // their profile + teacher ban status for the suspended-teacher modal.
  const { data: agentRow, error } = await supabaseServer
    .from('registration_agents')
    .select('id, display_name, kind, contact_email, contact_phone, source_id, allowed_sections, is_active, teacher_id')
    .eq('user_id', userId)
    .maybeSingle();

  if (error || !agentRow) {
    return NextResponse.json(
      { success: false, error: 'تعذّر تحميل بيانات الوكيل' },
      { status: 500 }
    );
  }

  const agentData = agentRow as {
    id: string;
    display_name: string | null;
    kind: string | null;
    contact_email: string | null;
    contact_phone: string | null;
    source_id: string | null;
    allowed_sections: string[] | null;
    is_active: boolean;
    teacher_id: string | null;
  };

  const sourceTeacherId = agentData.teacher_id;
  if (!sourceTeacherId) {
    return NextResponse.json(
      { success: false, error: 'تعذر الوصول إلى بيانات المعلم المرتبط بحسابك' },
      { status: 403 }
    );
  }

  // Fetch the teacher's profile.
  const { data: teacherRow } = await supabaseServer
    .from('users')
    .select('id, name, email')
    .eq('id', sourceTeacherId)
    .maybeSingle();

  // v130: Check if the teacher is currently banned (active ban, not expired).
  // The agent portal uses this to show a non-dismissible modal explaining
  // that the teacher's account is suspended and the agent cannot perform tasks.
  let teacherBanned = false;
  let teacherBanReason: string | null = null;
  if (teacherRow) {
    const { data: activeBan } = await supabaseServer
      .from('banned_users')
      .select('reason, ban_until')
      .eq('user_id', sourceTeacherId)
      .eq('is_active', true)
      .maybeSingle();

    if (activeBan) {
      // Check if the ban has expired (ban_until is in the past)
      const banUntil = (activeBan as { ban_until: string | null }).ban_until;
      if (!banUntil || new Date(banUntil) > new Date()) {
        teacherBanned = true;
        teacherBanReason = (activeBan as { reason: string | null }).reason;
      }
    }
  }

  return NextResponse.json({
    success: true,
    agent: {
      id: agentData.id,
      display_name: agentData.display_name,
      kind: agentData.kind,
      contact_email: agentData.contact_email,
      contact_phone: agentData.contact_phone,
      source_id: agentData.source_id,
      // v114: per-agent allowed teacher-sections. null = all allowed.
      allowed_sections: agentData.allowed_sections,
      // v130: agent's own active status (deactivated when teacher is banned/promoted)
      is_active: agentData.is_active,
    },
    teacher: teacherRow
      ? {
          id: (teacherRow as { id: string }).id,
          name: (teacherRow as { name: string | null }).name,
          email: (teacherRow as { email: string | null }).email,
          // v130: ban status — used by agent portal to show suspended-teacher modal
          is_banned: teacherBanned,
          ban_reason: teacherBanReason,
        }
      : null,
  });
}

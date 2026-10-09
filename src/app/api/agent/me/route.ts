import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { requireAgent, authErrorResponse } from '@/lib/auth-helpers';

/**
 * GET /api/agent/me
 *
 * Returns the calling agent's own profile + their teacher's name + whether
 * the teacher is currently banned (suspended).
 *
 * Used by:
 *   - Agent portal header: "وكيل: <display_name> · المعلم: <teacher_name>"
 *   - Agent portal mount: shows a non-dismissible modal if teacher is banned
 *     so the agent knows they can't perform tasks until the ban is lifted.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAgent(request);
  if (!auth.success) return authErrorResponse(auth);

  const { agent, sourceTeacherId } = auth;

  // Fetch the agent's own display_name + kind + the teacher's name.
  const { data: agentRow, error } = await supabaseServer
    .from('registration_agents')
    .select('id, display_name, kind, contact_email, contact_phone, source_id, allowed_sections, is_active')
    .eq('id', agent.id)
    .single();

  if (error || !agentRow) {
    return NextResponse.json(
      { success: false, error: 'تعذّر تحميل بيانات الوكيل' },
      { status: 500 }
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
      id: agentRow.id,
      display_name: (agentRow as { display_name: string | null }).display_name,
      kind: (agentRow as { kind: string | null }).kind,
      contact_email: (agentRow as { contact_email: string | null }).contact_email,
      contact_phone: (agentRow as { contact_phone: string | null }).contact_phone,
      source_id: (agentRow as { source_id: string | null }).source_id,
      // v114: per-agent allowed teacher-sections. null = all allowed.
      allowed_sections: (agentRow as { allowed_sections: string[] | null }).allowed_sections,
      // v130: agent's own active status (deactivated when teacher is banned/promoted)
      is_active: (agentRow as { is_active: boolean }).is_active,
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

import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { requireAgent, authErrorResponse } from '@/lib/auth-helpers';

/**
 * GET /api/agent/me
 *
 * Returns the calling agent's own profile + their teacher's name.
 * Used by the agent portal header to show:
 *   "وكيل: <display_name> · المعلم: <teacher_name>"
 */
export async function GET(request: NextRequest) {
  const auth = await requireAgent(request);
  if (!auth.success) return authErrorResponse(auth);

  const { agent, sourceTeacherId } = auth;

  // Fetch the agent's own display_name + kind + the teacher's name.
  const { data: agentRow, error } = await supabaseServer
    .from('registration_agents')
    .select('id, display_name, kind, contact_email, contact_phone, source_id')
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

  return NextResponse.json({
    success: true,
    agent: {
      id: agentRow.id,
      display_name: (agentRow as { display_name: string | null }).display_name,
      kind: (agentRow as { kind: string | null }).kind,
      contact_email: (agentRow as { contact_email: string | null }).contact_email,
      contact_phone: (agentRow as { contact_phone: string | null }).contact_phone,
      source_id: (agentRow as { source_id: string | null }).source_id,
    },
    teacher: teacherRow
      ? {
          id: (teacherRow as { id: string }).id,
          name: (teacherRow as { name: string | null }).name,
          email: (teacherRow as { email: string | null }).email,
        }
      : null,
  });
}

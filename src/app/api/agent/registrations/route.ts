import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { requireAgent, authErrorResponse } from '@/lib/auth-helpers';

/**
 * GET /api/agent/registrations
 *
 * Lists the enrollment rows created by THIS agent (via the
 * enrollment_agent_id foreign key). The agent cannot see enrollments
 * made by other agents or by students themselves.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAgent(request);
  if (!auth.success) return authErrorResponse(auth);

  const { agent } = auth;

  // `student:users!student_id(...)` hint is REQUIRED because subject_students
  // has multiple FKs to users (student_id, enrolled_by).
  const { data, error } = await supabaseServer
    .from('subject_students')
    .select(
      'id, subject_id, student_id, status, enrollment_method, enrolled_at, ' +
        'subject:subjects(id, name, join_code), ' +
        'student:users!student_id(id, email, name, student_code)'
    )
    .eq('enrollment_agent_id', agent.id)
    .order('enrolled_at', { ascending: false })
    .limit(200);

  if (error) {
    return NextResponse.json(
      { success: false, error: 'فشل تحميل سجل التسجيلات' },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true, registrations: data ?? [] });
}

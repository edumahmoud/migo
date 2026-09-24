import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { requireAgent, authErrorResponse } from '@/lib/auth-helpers';

/**
 * GET /api/agent/courses
 *
 * Lists all subjects (courses) owned by the agent's teacher.
 * Used to populate the course dropdown in the agent portal.
 *
 * The agent's teacher_id is resolved via requireAgent → source.teacher_id,
 * so the agent CANNOT see courses owned by other teachers.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAgent(request);
  if (!auth.success) return authErrorResponse(auth);

  const { sourceTeacherId } = auth;

  const { data, error } = await supabaseServer
    .from('subjects')
    .select('id, name, description, color, join_code, level, sub_level, is_paused, created_at')
    .eq('teacher_id', sourceTeacherId)
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json(
      { success: false, error: 'فشل تحميل قائمة الدورات' },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true, courses: data ?? [] });
}

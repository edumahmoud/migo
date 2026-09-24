import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { requireAgent, authErrorResponse } from '@/lib/auth-helpers';

/**
 * GET /api/agent/courses
 *
 * Lists all subjects (courses) owned by the agent's teacher.
 * Returns `subscription_open` so the portal can disable closed courses.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAgent(request);
  if (!auth.success) return authErrorResponse(auth);

  const { sourceTeacherId } = auth;

  const { data, error } = await supabaseServer
    .from('subjects')
    .select(
      'id, name, description, color, join_code, level, sub_level, is_paused, subscription_open, created_at'
    )
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

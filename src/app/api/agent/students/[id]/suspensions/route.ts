import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { requireAgent, authErrorResponse } from '@/lib/auth-helpers';

/**
 * GET /api/agent/students/[id]/suspensions
 *
 * Returns the student's currently-active course-scoped suspensions,
 * filtered to ONLY those whose subject belongs to the agent's source
 * teacher. Each suspension is returned WITH the subject name resolved
 * server-side.
 *
 * Why this endpoint exists (v131 fix):
 *   The browser-side supabase client is subject to RLS. The RLS policy
 *   on `subjects` requires `teacher_id = auth.uid()`, but the agent's
 *   `auth.uid()` is their OWN user id — not the teacher's. So when the
 *   client tried to `select id,name from subjects in (...)` for the
 *   suspended subject_ids, it got back an empty list, and the UI fell
 *   back to "مقرر غير معروف".
 *
 *   This endpoint uses the service role (supabaseServer) which bypasses
 *   RLS, then filters server-side by `subject.teacher_id === teacherId`
 *   so the agent still only sees suspensions for their own teacher's
 *   courses.
 *
 * Response:
 *   { success: true, suspensions: ActiveSuspension[] }
 *   { success: false, error: string }
 */
interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, ctx: RouteContext) {
  const auth = await requireAgent(request);
  if (!auth.success) return authErrorResponse(auth);

  const { id: studentId } = await ctx.params;
  const teacherId = auth.sourceTeacherId;

  const nowIso = new Date().toISOString();

  // Use supabaseServer (service role) — bypasses RLS on both
  // `student_suspensions` and `subjects`, so we can resolve the
  // subject name even when the agent's own session can't see it.
  const { data: rows, error } = await supabaseServer
    .from('student_suspensions')
    .select(`
      id,
      subject_id,
      reason,
      suspended_at,
      expires_at,
      is_active,
      subject:subjects(id, name, teacher_id)
    `)
    .eq('student_id', studentId)
    .eq('scope', 'course')
    .eq('is_active', true);

  if (error) {
    console.error('[GET /api/agent/students/[id]/suspensions] query error:', error);
    return NextResponse.json(
      { success: false, error: 'فشل جلب الإيقافات النشطة' },
      { status: 500 },
    );
  }

  type SubjectJoin = { id: string; name: string; teacher_id: string } | null;
  type Row = {
    id: string;
    subject_id: string;
    reason: string | null;
    suspended_at: string;
    expires_at: string | null;
    is_active: boolean;
    subject: SubjectJoin;
  };

  const allRows = ((rows ?? []) as unknown) as Row[];

  // Filter: only suspensions for subjects owned by THIS agent's teacher,
  // and only currently-active (not expired) ones.
  const active = allRows.filter(
    (r) =>
      r.is_active &&
      (r.expires_at === null || r.expires_at > nowIso) &&
      r.subject?.teacher_id === teacherId,
  );

  const result = active.map((r) => ({
    id: r.id,
    subject_id: r.subject_id,
    subject_name: r.subject?.name ?? 'مقرر محذوف',
    reason: r.reason,
    suspended_at: r.suspended_at,
    expires_at: r.expires_at,
  }));

  return NextResponse.json({ success: true, suspensions: result });
}

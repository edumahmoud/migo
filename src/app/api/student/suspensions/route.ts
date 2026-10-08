import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateRequest, authErrorResponse } from '@/lib/auth-helpers';

/**
 * GET /api/student/suspensions
 *
 * Returns the calling student's own suspensions (active + recently lifted).
 * Used by the student dashboard to:
 *   - Show a global overlay when a global suspension is active.
 *   - Show a per-course banner when a course-scoped suspension is active.
 *
 * Only the calling student can read their own suspensions (RLS enforces).
 *
 * Response:
 *   {
 *     success: true,
 *     global: SuspensionSummary | null,
 *     by_course: Array<{ subject_id, subject_name, suspension }>,
 *     history: Array<Suspension>
 *   }
 */
export async function GET(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if (!auth.success) return authErrorResponse(auth);

  const nowIso = new Date().toISOString();

  // Active suspensions = is_active=true AND (expires_at IS NULL OR expires_at > now()).
  // We fetch active + recently lifted (lifted_at > now - 24h) so the
  // student UI can show "recently lifted" banners if desired.
  const since24h = new Date(Date.now() - 24 * 3600 * 1000).toISOString();

  const { data: rows, error } = await supabaseServer
    .from('student_suspensions')
    .select(
      'id, student_id, subject_id, scope, reason, suspended_by, suspended_at, expires_at, lifted_at, lifted_by, is_active, ' +
        'subject:subjects(id, name)'
    )
    .eq('student_id', auth.user.id)
    .or(`is_active.eq.true, and(is_active.eq.false, lifted_at.gte.${since24h})`)
    .order('suspended_at', { ascending: false });

  if (error) {
    console.error('[GET /api/student/suspensions] error:', error);
    return NextResponse.json(
      { success: false, error: 'تعذّر تحميل بيانات الإيقاف' },
      { status: 500 }
    );
  }

  type Row = {
    id: string;
    student_id: string;
    subject_id: string | null;
    scope: string;
    reason: string | null;
    suspended_by: string | null;
    suspended_at: string;
    expires_at: string | null;
    lifted_at: string | null;
    lifted_by: string | null;
    is_active: boolean;
    subject: { id: string; name: string } | null;
  };

  const list = (rows ?? []) as unknown as Row[];

  const isActive = (r: Row): boolean => {
    if (!r.is_active) return false;
    if (r.expires_at && r.expires_at <= nowIso) return false;
    return true;
  };

  const active = list.filter(isActive);
  const history = list.filter(r => !isActive(r));

  const globalActive = active.find(r => r.scope === 'global') ?? null;
  const courseActive = active.filter(r => r.scope === 'course');

  return NextResponse.json({
    success: true,
    global: globalActive
      ? {
          id: globalActive.id,
          reason: globalActive.reason,
          suspended_at: globalActive.suspended_at,
          expires_at: globalActive.expires_at,
        }
      : null,
    by_course: courseActive.map(r => ({
      subject_id: r.subject_id,
      subject_name: r.subject?.name ?? null,
      suspension: {
        id: r.id,
        reason: r.reason,
        suspended_at: r.suspended_at,
        expires_at: r.expires_at,
      },
    })),
    history: history.map(r => ({
      id: r.id,
      scope: r.scope,
      subject_id: r.subject_id,
      subject_name: r.subject?.name ?? null,
      reason: r.reason,
      suspended_at: r.suspended_at,
      expires_at: r.expires_at,
      lifted_at: r.lifted_at,
    })),
  });
}

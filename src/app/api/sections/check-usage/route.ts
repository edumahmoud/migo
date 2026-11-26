import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest, authErrorResponse, getUserRole } from '@/lib/auth-helpers';
import { computeSectionUsage } from '@/lib/section-usage';

/**
 * GET /api/sections/check-usage?sectionKey=summaries
 *
 * Returns the current usage count + the limit for the given section.
 *
 * v134e: ALWAYS returns limit + used (even when unlocked) so the UI
 * can show a usage counter inside the section. Previously, when the
 * user had an active unlock, the API returned limit=null which made
 * the counter show "غير محدود" even though the admin set a limit.
 *
 * v134e: supports 'storage' metric for files — counts total file
 * size in MB instead of row count.
 *
 * Response:
 *   {
 *     success: true,
 *     sectionKey, metric, used, limit, remaining,
 *     periodDays, periodStart, locked, canUse, isUnlocked
 *   }
 */
export async function GET(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if (!auth.success) return authErrorResponse(auth);

  const role = await getUserRole(auth.user.id);
  if (role !== 'student' && role !== 'teacher') {
    return NextResponse.json({ success: true, canUse: true, used: 0, limit: null });
  }

  const { searchParams } = new URL(request.url);
  const sectionKey = searchParams.get('sectionKey');
  if (!sectionKey) {
    return NextResponse.json({ error: 'sectionKey مطلوب' }, { status: 400 });
  }

  return NextResponse.json(await computeSectionUsage(auth.user.id, role, sectionKey));
}

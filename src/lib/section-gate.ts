import { NextResponse } from 'next/server';
import { getUserRole } from '@/lib/auth-helpers';
import { computeSectionUsage, type UsageResult } from '@/lib/section-usage';

/**
 * Server-side limit gate. Returns a 403 response when the user may not use the
 * section (still locked, or the plan limit is used up); null when allowed.
 * Admins and other roles are never gated. A failed check does not block.
 */
export async function gateSection(userId: string, sectionKey: string): Promise<{ block: NextResponse | null; usage: UsageResult | null }> {
  try {
    const role = await getUserRole(userId);
    if (role !== 'student' && role !== 'teacher') return { block: null, usage: null };
    const usage = await computeSectionUsage(userId, role, sectionKey);
    if (usage.locked) {
      return { block: NextResponse.json({ success: false, error: 'هذا القسم مقفول. اطلب تفعيله أولاً', code: 'SECTION_LOCKED' }, { status: 403 }), usage };
    }
    if (!usage.canUse) {
      return { block: NextResponse.json({ success: false, error: 'وصلت للحد المسموح في باقتك', code: 'LIMIT_REACHED' }, { status: 403 }), usage };
    }
    return { block: null, usage };
  } catch {
    return { block: null, usage: null };
  }
}

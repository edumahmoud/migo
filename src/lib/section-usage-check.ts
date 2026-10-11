import { getCachedAuthHeaders } from '@/lib/client-auth';

/**
 * checkSectionUsage — v134
 *
 * Checks whether the current user can create a new summary/quiz in a
 * locked section. Returns true if allowed, false if the limit is
 * reached. Shows a toast error when blocked.
 *
 * Usage:
 *   const canProceed = await checkSectionUsage('summaries');
 *   if (!canProceed) return; // blocked — limit reached
 *   // ... proceed with creation
 */

export interface UsageCheckResult {
  canUse: boolean;
  used: number;
  limit: number | null;
  remaining: number | null;
  locked: boolean;
}

export async function checkSectionUsage(sectionKey: string): Promise<UsageCheckResult> {
  try {
    const res = await fetch(
      `/api/sections/check-usage?sectionKey=${encodeURIComponent(sectionKey)}`,
      { headers: await getCachedAuthHeaders() },
    );
    const json = await res.json();
    if (json.success) {
      return {
        canUse: json.canUse,
        used: json.used ?? 0,
        limit: json.limit ?? null,
        remaining: json.remaining ?? null,
        locked: json.locked ?? false,
      };
    }
    // On error, allow the operation (don't block the user due to a
    // server-side check failure).
    return { canUse: true, used: 0, limit: null, remaining: null, locked: false };
  } catch {
    return { canUse: true, used: 0, limit: null, remaining: null, locked: false };
  }
}

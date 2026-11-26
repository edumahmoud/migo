import { supabaseServer } from '@/lib/supabase-server';
import { getStorageUsage } from '@/lib/storage-usage';

export interface UsageResult {
  success: boolean;
  sectionKey: string;
  metric: string | null;
  used: number;
  limit: number | null;
  remaining: number | null;
  locked: boolean;
  canUse: boolean;
  isUnlocked: boolean;
  periodDays?: number;
  periodStart?: string;
  expiresAt?: string | null;
}

/** Shared by /api/sections/check-usage and the server-side gates. */
export async function computeSectionUsage(userId: string, role: 'student' | 'teacher', sectionKey: string): Promise<UsageResult> {
  // 1. Fetch the section config.
  const { data: configRow } = await supabaseServer
    .from('locked_sections_config')
    .select('*')
    .eq('section_key', sectionKey)
    .maybeSingle();

  const config = configRow as Record<string, unknown> | null;
  if (!config || !config.is_active) {
    return ({
      success: true, sectionKey, metric: null, used: 0, limit: null,
      remaining: null, locked: false, canUse: true, isUnlocked: false,
    });
  }

  const roleLockedField = role === 'student' ? 'student_locked' : 'teacher_locked';
  const isLocked = config[roleLockedField] === true;
  const metric = config.usage_metric as string | null;
  const periodDays = (config.usage_period_days as number) ?? 30;
  const teacherOnly = config.teacher_only === true;

  // v134g: per-plan limits. The correct limit depends on the user's
  // active unlock plan_type (monthly or yearly). For storage, we always
  // use the monthly limit (storage is cumulative, not per-period).
  //
  // We'll determine the limit AFTER checking if the user has an unlock
  // (because we need to know the plan_type). For now, set a default.
  let limit: number | null = null;

  // v134f: if this is a teacher-only section and the user is a student,
  // return "not locked, no limit" — students should never see this section
  // as locked.
  if (teacherOnly && role === 'student') {
    return ({
      success: true, sectionKey, metric: null, used: 0, limit: null,
      remaining: null, locked: false, canUse: true, isUnlocked: false,
    });
  }

  // v134f: for storage metric (files), the limit ALWAYS applies — even
  // when the section is NOT locked. The lock only controls whether the
  // section requires a paid subscription to ACCESS; the storage quota
  // is enforced regardless.
  //
  // v134g: for storage, use the monthly limit as the total quota
  // (storage is cumulative, not per-period).
  //
  // For other metrics (combined, summaries), the limit only applies
  // when the section IS locked (because without a lock, the feature
  // is free and unlimited).

  // If the section is NOT locked for this role:
  //   - storage metric → still enforce the limit (return it)
  //   - other metrics → no limit (return null)
  if (!isLocked) {
    if (metric === 'storage') {
      const st = await getStorageUsage(userId, role);
      return ({
        success: true, sectionKey, metric, used: st.usedMb, limit: st.totalQuota,
        remaining: st.remainingMb, periodDays,
        locked: false, canUse: st.remainingMb > 0, isUnlocked: false,
      });
    }
    return ({
      success: true, sectionKey, metric: null, used: 0, limit: null,
      remaining: null, locked: false, canUse: true, isUnlocked: false,
    });
  }

  // v134f: check if the user has an active unlock (for locked sections).
  // v134g: also fetch plan_type to determine the correct per-plan limit.
  const now = new Date().toISOString();
  const { data: personalUnlock } = await supabaseServer
    .from('user_section_unlocks')
    .select('id, expires_at, plan_type, started_at')
    .eq('user_id', userId)
    .eq('section_key', sectionKey)
    .eq('is_active', true)
    .gte('expires_at', now)
    .maybeSingle();

  // There can be one active "all" trial and one "new_users" trial at the same time, so read the list.
  const { data: globalUnlocks } = await supabaseServer
    .from('global_section_unlocks')
    .select('scope, started_at, expires_at')
    .eq('section_key', sectionKey)
    .eq('is_active', true)
    .gte('expires_at', now);

  let isUnlocked = !!personalUnlock;
  if (!isUnlocked && (globalUnlocks ?? []).some((g: { scope: string }) => g.scope === 'all')) {
    isUnlocked = true;
  }
  const newUsersTrial = (globalUnlocks ?? []).find((g: { scope: string }) => g.scope === 'new_users');
  if (!isUnlocked && newUsersTrial) {
    const { data: userRow } = await supabaseServer
      .from('users')
      .select('created_at')
      .eq('id', userId)
      .maybeSingle();
    if (userRow?.created_at && new Date(userRow.created_at as string) >= new Date(newUsersTrial.started_at as string)) {
      isUnlocked = true;
    }
  }

  const userPlanType = (personalUnlock as Record<string, unknown> | null)?.plan_type as string | null;
  const isYearlyPlan = userPlanType === 'yearly';

  if (metric === 'storage') {
    // Storage uses monthly limit as total quota regardless of plan.
    limit = role === 'student'
      ? (config.student_monthly_limit as number | null) ?? null
      : (config.teacher_monthly_limit as number | null) ?? null;
  } else {
    // For count-based metrics, use the per-plan limit.
    limit = role === 'student'
      ? (isYearlyPlan
          ? (config.student_yearly_limit as number | null)
          : (config.student_monthly_limit as number | null)) ?? null
      : (isYearlyPlan
          ? (config.teacher_yearly_limit as number | null)
          : (config.teacher_monthly_limit as number | null)) ?? null;
  }

  // v134g: for unlocked users with non-storage metrics, the usage period
  // is the subscription period (30 days for monthly, 365 for yearly).
  // For locked-but-trialing users, use the global trial period.
  // For locked non-unlocked users, use the admin's configured period.
  let effectivePeriodDays = periodDays;
  if (isUnlocked && personalUnlock && metric !== 'storage') {
    const unlockPlanType = (personalUnlock as Record<string, unknown>).plan_type as string;
    effectivePeriodDays = unlockPlanType === 'yearly' ? 365 : 30;
  }

  // 3. Count usage (ALWAYS, even if unlocked — for the counter display).
  const periodStart = new Date(Date.now() - effectivePeriodDays * 24 * 60 * 60 * 1000).toISOString();
  let used = 0;

  // Counted from the usage ledger (v153), so deleting an item does not free a slot.
  const countEvents = async (sources: string[]) => {
    const { count } = await supabaseServer
      .from('usage_events')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .in('source', sources)
      .gte('created_at', periodStart);
    return count ?? 0;
  };
  if (metric === 'summaries') used = await countEvents(['summary']);
  else if (metric === 'quiz_attempts') used = await countEvents(['quiz_attempt']);
  else if (metric === 'combined') used = await countEvents(sectionKey === 'questionBankAI' ? ['ai_question'] : ['summary', 'summary_quiz']);

  if (metric === 'storage') {
    // Only what is uploaded right now: adding lowers the space left, deleting gives it back.
    const st = await getStorageUsage(userId, role);
    used = st.usedMb;
    limit = st.totalQuota;
  }

  const remaining = limit !== null ? Math.max(0, limit - used) : null;
  // canUse: if unlocked → always true (but counter still shows).
  // If not unlocked → depends on remaining.
  // The plan's limit applies to paid users too (a fair-use cap), not only to locked ones.
  const canUse = limit === null ? true : (remaining !== null && remaining > 0);

  return ({
    success: true,
    sectionKey,
    metric,
    used,
    limit,
    remaining,
    periodDays,
    periodStart,
    locked: !isUnlocked,
    canUse,
    isUnlocked,
    expiresAt: (personalUnlock as Record<string, unknown> | null)?.expires_at ?? null,
  });
}

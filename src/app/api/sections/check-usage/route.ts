import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateRequest, authErrorResponse, getUserRole } from '@/lib/auth-helpers';

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

  // 1. Fetch the section config.
  const { data: configRow } = await supabaseServer
    .from('locked_sections_config')
    .select('*')
    .eq('section_key', sectionKey)
    .maybeSingle();

  const config = configRow as Record<string, unknown> | null;
  if (!config || !config.is_active) {
    return NextResponse.json({
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
    return NextResponse.json({
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
      // v134g: for storage, use monthly limit as the total quota.
      const storageLimit = role === 'student'
        ? (config.student_monthly_limit as number | null) ?? null
        : (config.teacher_monthly_limit as number | null) ?? null;
      if (storageLimit !== null) {
        const periodStart2 = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000).toISOString();
        const { data: files } = await supabaseServer
          .from('user_files')
          .select('file_size')
          .eq('user_id', auth.user.id);
        const totalBytes = (files ?? []).reduce((sum: number, f: { file_size: number | null }) => {
          return sum + (f.file_size ?? 0);
        }, 0);
        const usedForStorage = Math.round(totalBytes / (1024 * 1024));
        const remainingForStorage = Math.max(0, storageLimit - usedForStorage);
        return NextResponse.json({
          success: true, sectionKey, metric, used: usedForStorage, limit: storageLimit,
          remaining: remainingForStorage, periodDays,
          periodStart: periodStart2,
          locked: false, canUse: remainingForStorage > 0, isUnlocked: false,
        });
      }
    }
    return NextResponse.json({
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
    .eq('user_id', auth.user.id)
    .eq('section_key', sectionKey)
    .eq('is_active', true)
    .gte('expires_at', now)
    .maybeSingle();

  const { data: globalUnlock } = await supabaseServer
    .from('global_section_unlocks')
    .select('scope, started_at, expires_at')
    .eq('section_key', sectionKey)
    .eq('is_active', true)
    .gte('expires_at', now)
    .maybeSingle();

  let isUnlocked = !!personalUnlock;
  if (!isUnlocked && globalUnlock) {
    if (globalUnlock.scope === 'all') {
      isUnlocked = true;
    } else if (globalUnlock.scope === 'new_users') {
      const { data: userRow } = await supabaseServer
        .from('users')
        .select('created_at')
        .eq('id', auth.user.id)
        .maybeSingle();
      if (userRow?.created_at) {
        const trialStart = new Date(globalUnlock.started_at as string);
        const userCreated = new Date(userRow.created_at as string);
        if (userCreated >= trialStart) isUnlocked = true;
      }
    }
  }

  // v134g: determine the correct limit based on the user's plan_type.
  // If the user has a personal unlock with plan_type='yearly' → use the yearly limit.
  // If plan_type='monthly' → use the monthly limit.
  // If unlocked via global trial → use the monthly limit (trials are short).
  // If not unlocked → use the monthly limit (the free-tier default).
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

  if (metric === 'summaries' || metric === 'combined') {
    const { count } = await supabaseServer
      .from('summaries')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', auth.user.id)
      .gte('created_at', periodStart);
    used += count ?? 0;
  }

  if (metric === 'quiz_attempts') {
    const { count } = await supabaseServer
      .from('scores')
      .select('*', { count: 'exact', head: true })
      .eq('student_id', auth.user.id)
      .gte('completed_at', periodStart);
    used += count ?? 0;
  }

  if (metric === 'combined') {
    const { count } = await supabaseServer
      .from('quizzes')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', auth.user.id)
      .not('summary_id', 'is', null)
      .gte('created_at', periodStart);
    used += count ?? 0;
  }

  // v134e: storage metric — count total file size in bytes, convert to MB.
  if (metric === 'storage') {
    const { data: files } = await supabaseServer
      .from('user_files')
      .select('file_size')
      .eq('user_id', auth.user.id);
    const totalBytes = (files ?? []).reduce((sum: number, f: { file_size: number | null }) => {
      return sum + (f.file_size ?? 0);
    }, 0);
    used = Math.round(totalBytes / (1024 * 1024)); // convert to MB
  }

  // v134e: questionBankAI metric — count AI-generated question bank
  // questions (bank_questions where is_ai_generated=true).
  if (metric === 'combined' && sectionKey === 'questionBankAI') {
    // Count AI-generated bank questions by this user.
    const { count: aiQuestions } = await supabaseServer
      .from('bank_questions')
      .select('*', { count: 'exact', head: true })
      .eq('created_by', auth.user.id)
      .eq('is_ai_generated', true)
      .gte('created_at', periodStart);
    used = aiQuestions ?? 0;
  }

  const remaining = limit !== null ? Math.max(0, limit - used) : null;
  // canUse: if unlocked → always true (but counter still shows).
  // If not unlocked → depends on remaining.
  const canUse = isUnlocked ? true : (limit === null ? true : (remaining !== null && remaining > 0));

  return NextResponse.json({
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

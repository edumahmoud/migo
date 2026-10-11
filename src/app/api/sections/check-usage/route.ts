import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateRequest, authErrorResponse, getUserRole } from '@/lib/auth-helpers';

/**
 * GET /api/sections/check-usage?sectionKey=summaries
 *
 * Returns the current usage count + the limit for the given section.
 * Used by the frontend to block summary/quiz creation when the limit
 * is reached.
 *
 * The usage metric is defined in locked_sections_config.usage_metric:
 *   - 'summaries'     → COUNT(summaries WHERE user_id = me AND created_at >= periodStart)
 *   - 'quiz_attempts' → COUNT(scores WHERE student_id = me AND completed_at >= periodStart)
 *   - 'combined'      → COUNT(summaries) + COUNT(quizzes WHERE user_id = me AND summary_id IS NOT NULL)
 *
 * NOTE: Deleted items ARE counted (we use created_at, not deleted_at).
 * The user's quota is consumed permanently for the period.
 *
 * Response:
 *   {
 *     success: true,
 *     sectionKey: 'summaries',
 *     metric: 'combined',
 *     used: 7,
 *     limit: 10,
 *     remaining: 3,
 *     periodDays: 30,
 *     periodStart: '2024-...',
 *     locked: true,        // is the section locked for this user?
 *     canUse: true         // remaining > 0 (or no limit)
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
    // Section not locked → unlimited.
    return NextResponse.json({
      success: true,
      sectionKey,
      metric: null,
      used: 0,
      limit: null,
      remaining: null,
      locked: false,
      canUse: true,
    });
  }

  const roleLockedField = role === 'student' ? 'student_locked' : 'teacher_locked';
  const roleMaxField = role === 'student' ? 'student_max_usage' : 'teacher_max_usage';
  const isLocked = config[roleLockedField] === true;
  const limit = (config[roleMaxField] as number | null) ?? null;
  const metric = config.usage_metric as string | null;
  const periodDays = (config.usage_period_days as number) ?? 30;

  // If the section is NOT locked for this role, no limit applies.
  if (!isLocked) {
    return NextResponse.json({
      success: true,
      sectionKey,
      metric,
      used: 0,
      limit: null,
      remaining: null,
      locked: false,
      canUse: true,
    });
  }

  // 2. Check if the user has an active unlock (personal or global).
  //    If unlocked → no limit applies during the unlock period.
  const now = new Date().toISOString();
  const { data: personalUnlock } = await supabaseServer
    .from('user_section_unlocks')
    .select('id')
    .eq('user_id', auth.user.id)
    .eq('section_key', sectionKey)
    .eq('is_active', true)
    .gte('expires_at', now)
    .maybeSingle();

  const { data: globalUnlock } = await supabaseServer
    .from('global_section_unlocks')
    .select('scope, started_at')
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
        const trialStart = new Date(globalUnlock.started_at);
        const userCreated = new Date(userRow.created_at);
        if (userCreated >= trialStart) isUnlocked = true;
      }
    }
  }

  if (isUnlocked) {
    return NextResponse.json({
      success: true,
      sectionKey,
      metric,
      used: 0,
      limit: null,
      remaining: null,
      locked: false,
      canUse: true,
    });
  }

  // 3. Count usage in the current period.
  const periodStart = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000).toISOString();
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
    // Count student quiz attempts (scores).
    const { count } = await supabaseServer
      .from('scores')
      .select('*', { count: 'exact', head: true })
      .eq('student_id', auth.user.id)
      .gte('completed_at', periodStart);
    used += count ?? 0;
  }

  if (metric === 'combined') {
    // Also count AI-generated quizzes (quizzes with summary_id IS NOT NULL,
    // owned by this user).
    const { count } = await supabaseServer
      .from('quizzes')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', auth.user.id)
      .not('summary_id', 'is', null)
      .gte('created_at', periodStart);
    used += count ?? 0;
  }

  const remaining = limit !== null ? Math.max(0, limit - used) : null;
  const canUse = limit === null ? true : (remaining !== null && remaining > 0);

  return NextResponse.json({
    success: true,
    sectionKey,
    metric,
    used,
    limit,
    remaining,
    periodDays,
    periodStart,
    locked: true,
    canUse,
  });
}

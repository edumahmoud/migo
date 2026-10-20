import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateRequest, authErrorResponse, getUserRole } from '@/lib/auth-helpers';

/**
 * GET /api/sections/locked-status
 *
 * Returns the lock status of ALL sections for the current user.
 * The frontend uses this to:
 *   - Show a lock icon on locked sections in the sidebar
 *   - Intercept clicks on locked sections
 *   - Show the activation-request page when a locked section is clicked
 *
 * Response:
 *   {
 *     success: true,
 *     sections: {
 *       summaries: { locked: true, unlocked: false, expiresAt: null, config: {...} },
 *       questionBank: { locked: false, unlocked: false, ... },
 *       ...
 *     }
 *   }
 *
 * A section is "locked" for the user if:
 *   1. The section's config has is_active=true AND the role-specific
 *      lock flag is true (student_locked / teacher_locked).
 *   2. AND there is no active global unlock (all / new_users) covering
 *      this section for the current time.
 *   3. AND there is no active user_section_unlock for this user +
 *      section (not expired).
 *
 * "unlocked" = the user has an active unlock (either personal or global).
 * "locked" = the section is locked AND the user has no active unlock.
 */
export async function GET(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if (!auth.success) return authErrorResponse(auth);

  const userId = auth.user.id;
  const role = await getUserRole(userId);
  // Only students and teachers have lockable sections.
  if (role !== 'student' && role !== 'teacher') {
    return NextResponse.json({ success: true, sections: {} });
  }

  // 1. Fetch all lock configs.
  const { data: configs, error: configErr } = await supabaseServer
    .from('locked_sections_config')
    .select('*')
    .eq('is_active', true);
  if (configErr) {
    console.error('[locked-status] config error:', configErr);
    return NextResponse.json({ error: 'فشل جلب إعدادات الأقسام' }, { status: 500 });
  }

  // Filter to only sections locked for this role.
  const roleLockedField = role === 'student' ? 'student_locked' : 'teacher_locked';
  const lockedForRole = (configs ?? []).filter(
    (c: Record<string, unknown>) => c[roleLockedField] === true
  );

  if (lockedForRole.length === 0) {
    return NextResponse.json({ success: true, sections: {} });
  }

  const lockedKeys = lockedForRole.map((c: Record<string, unknown>) => c.section_key as string);
  const now = new Date().toISOString();

  // 2. Fetch active global unlocks for these sections.
  const { data: globalUnlocks } = await supabaseServer
    .from('global_section_unlocks')
    .select('section_key, scope, expires_at')
    .in('section_key', lockedKeys)
    .eq('is_active', true)
    .gte('expires_at', now);

  // 3. Fetch active personal unlocks for this user.
  const { data: personalUnlocks } = await supabaseServer
    .from('user_section_unlocks')
    .select('section_key, expires_at, plan_type')
    .eq('user_id', userId)
    .eq('is_active', true)
    .in('section_key', lockedKeys)
    .gte('expires_at', now);

  // 4. Fetch user's created_at (for new_users trial scope).
  let userCreatedAt: string | null = null;
  if ((globalUnlocks ?? []).some((u: Record<string, unknown>) => u.scope === 'new_users')) {
    const { data: userRow } = await supabaseServer
      .from('users')
      .select('created_at')
      .eq('id', userId)
      .maybeSingle();
    userCreatedAt = userRow?.created_at ?? null;
  }

  // 5. Build the response.
  const sections: Record<string, {
    locked: boolean;
    unlocked: boolean;
    expiresAt: string | null;
    unlockSource: 'personal' | 'global_all' | 'global_new_users' | null;
    config: Record<string, unknown>;
  }> = {};

  for (const cfg of lockedForRole as Array<Record<string, unknown>>) {
    const key = cfg.section_key as string;
    const config = {
      section_label: cfg.section_label,
      student_monthly_price: cfg.student_monthly_price,
      student_yearly_price: cfg.student_yearly_price,
      teacher_monthly_price: cfg.teacher_monthly_price,
      teacher_yearly_price: cfg.teacher_yearly_price,
      currency: cfg.currency,
      student_monthly_limit: cfg.student_monthly_limit,
      student_yearly_limit: cfg.student_yearly_limit,
      teacher_monthly_limit: cfg.teacher_monthly_limit,
      teacher_yearly_limit: cfg.teacher_yearly_limit,
      usage_period_days: cfg.usage_period_days,
      usage_metric: cfg.usage_metric,
    };

    // Check personal unlock.
    const personal = (personalUnlocks ?? []).find(
      (u: Record<string, unknown>) => u.section_key === key
    );
    // Check global unlock (all).
    const globalAll = (globalUnlocks ?? []).find(
      (u: Record<string, unknown>) => u.section_key === key && u.scope === 'all'
    );
    // Check global unlock (new_users).
    const globalNew = (globalUnlocks ?? []).find(
      (u: Record<string, unknown>) => u.section_key === key && u.scope === 'new_users'
    );
    let newUserUnlocked = false;
    if (globalNew && userCreatedAt) {
      // The new-user trial covers users whose account was created after
      // the trial started.
      const trialStart = new Date((globalNew as Record<string, unknown>).started_at as string);
      const userCreated = new Date(userCreatedAt);
      if (userCreated >= trialStart) {
        newUserUnlocked = true;
      }
    }

    const unlocked = !!personal || !!globalAll || newUserUnlocked;
    let unlockSource: 'personal' | 'global_all' | 'global_new_users' | null = null;
    let expiresAt: string | null = null;
    if (personal) {
      unlockSource = 'personal';
      expiresAt = (personal as Record<string, unknown>).expires_at as string;
    } else if (globalAll) {
      unlockSource = 'global_all';
      expiresAt = (globalAll as Record<string, unknown>).expires_at as string;
    } else if (newUserUnlocked) {
      unlockSource = 'global_new_users';
      expiresAt = (globalNew as Record<string, unknown>).expires_at as string;
    }

    sections[key] = {
      locked: !unlocked,
      unlocked,
      expiresAt,
      unlockSource,
      config,
    };
  }

  return NextResponse.json({ success: true, sections });
}

import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateRequest, authErrorResponse, getUserRole } from '@/lib/auth-helpers';

/**
 * GET /api/storage/check
 *
 * Returns the user's current storage status:
 *   - default_quota: the free quota (from locked_sections_config)
 *   - upgrade_size: extra MB from purchased plans (0 if none)
 *   - total_quota: default_quota + upgrade_size
 *   - used_mb: total file size in MB
 *   - remaining_mb: total_quota - used_mb
 *   - pct: percentage used
 *   - is_full: used_mb >= total_quota
 *   - active_upgrade: the user's active upgrade plan (or null)
 *
 * Also returns the available upgrade plans.
 */
export async function GET(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if (!auth.success) return authErrorResponse(auth);

  const role = await getUserRole(auth.user.id);
  const userId = auth.user.id;

  // 1. Get default quota from locked_sections_config.
  const { data: config } = await supabaseServer
    .from('locked_sections_config')
    .select('student_monthly_limit, teacher_monthly_limit')
    .eq('section_key', 'files')
    .maybeSingle();

  const cfg = config as Record<string, unknown> | null;
  const defaultQuota = role === 'student'
    ? (cfg?.student_monthly_limit as number) ?? 100
    : (cfg?.teacher_monthly_limit as number) ?? 500;

  // 2. Get active upgrade.
  const { data: upgrade } = await supabaseServer
    .from('user_storage_upgrades')
    .select('id, plan_id, size_mb, price, currency')
    .eq('user_id', userId)
    .eq('is_active', true)
    .maybeSingle();

  const upgradeSize = (upgrade as Record<string, unknown> | null)?.size_mb as number ?? 0;

  // 3. Count total file size.
  const { data: files } = await supabaseServer
    .from('user_files')
    .select('file_size')
    .eq('user_id', userId);

  const totalBytes = (files ?? []).reduce((sum: number, f: { file_size: number | null }) => {
    return sum + (f.file_size ?? 0);
  }, 0);
  const usedMb = Math.round(totalBytes / (1024 * 1024));

  // 4. Calculate totals.
  const totalQuota = defaultQuota + upgradeSize;
  const remainingMb = Math.max(0, totalQuota - usedMb);
  const pct = totalQuota > 0 ? Math.min(100, (usedMb / totalQuota) * 100) : 0;
  const isFull = usedMb >= totalQuota;

  // 5. Get available upgrade plans.
  const { data: plans } = await supabaseServer
    .from('storage_plans')
    .select('*')
    .eq('is_active', true)
    .order('sort_order', { ascending: true });

  return NextResponse.json({
    success: true,
    default_quota: defaultQuota,
    upgrade_size: upgradeSize,
    total_quota: totalQuota,
    used_mb: usedMb,
    remaining_mb: remainingMb,
    pct: Math.round(pct),
    is_full: isFull,
    active_upgrade: upgrade ?? null,
    plans: plans ?? [],
  });
}

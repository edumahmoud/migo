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
  // v134l: storage quota is ROLE-AWARE. The admin sets two separate values:
  //   free_quota_mb_student — for students
  //   free_quota_mb_teacher — for teachers
  // The old single `free_quota_mb` column is no longer read (kept for
  // backward compat only). Falls back to monthly_limit columns if the
  // role-aware columns are missing (pre-v134l databases).
  const { data: config } = await supabaseServer
    .from('locked_sections_config')
    .select(
      'free_quota_mb_student, free_quota_mb_teacher, '
      + 'free_quota_mb, student_monthly_limit, teacher_monthly_limit'
    )
    .eq('section_key', 'files')
    .maybeSingle();

  const cfg = config as Record<string, unknown> | null;
  // v134l: pick the role-specific column first.
  const roleQuota = role === 'student'
    ? (cfg?.free_quota_mb_student as number | null)
    : (cfg?.free_quota_mb_teacher as number | null);

  const freeQuota = roleQuota ??
    (cfg?.free_quota_mb as number | null) ??
    (role === 'student'
      ? (cfg?.student_monthly_limit as number) ?? 100
      : (cfg?.teacher_monthly_limit as number) ?? 500);

  // 2. Get active upgrade.
  //    v134q: subscriptions are time-limited (monthly/yearly). If the
  //    active upgrade has an expires_at in the past, auto-deactivate it
  //    right here — the quota add-on stops applying immediately (this
  //    IS the "restriction when the month ends"). Legacy 'permanent'
  //    upgrades have expires_at = NULL and never expire.
  const { data: upgrade } = await supabaseServer
    .from('user_storage_upgrades')
    .select('id, plan_id, size_mb, price, currency, duration_type, expires_at')
    .eq('user_id', userId)
    .eq('is_active', true)
    .maybeSingle();

  let activeUpgrade = upgrade as Record<string, unknown> | null ?? null;
  if (activeUpgrade && activeUpgrade.expires_at) {
    const expiry = new Date(activeUpgrade.expires_at as string);
    if (expiry.getTime() <= Date.now()) {
      // Subscription expired → deactivate + treat as no upgrade.
      await supabaseServer
        .from('user_storage_upgrades')
        .update({ is_active: false })
        .eq('id', activeUpgrade.id as string);
      console.log(`[storage/check] upgrade ${activeUpgrade.id} expired for user ${userId} — deactivated`);
      activeUpgrade = null;
    }
  }

  const upgradeSize = activeUpgrade?.size_mb as number ?? 0;

  // 3. Count total file size (user_files + subject_videos).
  const { data: files } = await supabaseServer
    .from('user_files')
    .select('file_size')
    .eq('user_id', userId);

  // v134k: also count subject_videos uploaded by this user.
  const { data: videos } = await supabaseServer
    .from('subject_videos')
    .select('video_size')
    .eq('uploaded_by', userId);

  const filesBytes = (files ?? []).reduce((sum: number, f: { file_size: number | null }) => {
    return sum + (f.file_size ?? 0);
  }, 0);
  const videosBytes = (videos ?? []).reduce((sum: number, v: { video_size: number | null }) => {
    return sum + (v.video_size ?? 0);
  }, 0);
  const totalBytes = filesBytes + videosBytes;

  // 4. Calculate totals.
  // v134k: total = free_quota (free tier) + upgrade_size (commercial).
  const totalQuota = freeQuota + upgradeSize;
  const usedMb = Math.round(totalBytes / (1024 * 1024));
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
    free_quota: freeQuota,           // v134k: free tier (admin-controlled)
    upgrade_size: upgradeSize,        // v134k: purchased commercial storage
    total_quota: totalQuota,          // free + purchased
    used_mb: usedMb,
    remaining_mb: remainingMb,
    pct: Math.round(pct),
    is_full: isFull,
    active_upgrade: activeUpgrade ?? null,
    plans: plans ?? [],
  });
}

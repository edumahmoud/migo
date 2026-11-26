import { supabaseServer } from '@/lib/supabase-server';

/**
 * Storage usage for one account: only what is uploaded right now (personal files + videos).
 * Adding a file lowers the remaining space; deleting one gives it back.
 * Quota = free quota for the role (admin setting) + the active, unexpired purchased plan.
 */
/** Base (free) quota for a role in MB, from the admin setting. */
export async function getFreeQuota(role: 'student' | 'teacher'): Promise<number> {
  const { data: config } = await supabaseServer
    .from('locked_sections_config')
    .select('free_quota_mb_student, free_quota_mb_teacher, free_quota_mb, student_monthly_limit, teacher_monthly_limit')
    .eq('section_key', 'files')
    .maybeSingle();
  const cfg = config as Record<string, number | null> | null;
  const freeQuota = (role === 'student' ? cfg?.free_quota_mb_student : cfg?.free_quota_mb_teacher)
    ?? cfg?.free_quota_mb
    ?? (role === 'student' ? cfg?.student_monthly_limit ?? 100 : cfg?.teacher_monthly_limit ?? 500);

  return freeQuota as number;
}

export async function getStorageUsage(userId: string, role: 'student' | 'teacher') {
  const freeQuota = await getFreeQuota(role);

  const { data: upgrade } = await supabaseServer
    .from('user_storage_upgrades')
    .select('size_mb, expires_at')
    .eq('user_id', userId)
    .eq('is_active', true)
    .maybeSingle();
  const up = upgrade as { size_mb: number; expires_at: string | null } | null;
  const upgradeSize = up && (!up.expires_at || new Date(up.expires_at).getTime() > Date.now()) ? up.size_mb : 0;

  const [{ data: files }, { data: videos }] = await Promise.all([
    supabaseServer.from('user_files').select('file_size').eq('user_id', userId),
    supabaseServer.from('subject_videos').select('video_size').eq('uploaded_by', userId),
  ]);
  const bytes = (files ?? []).reduce((n: number, f: { file_size: number | null }) => n + (f.file_size ?? 0), 0)
    + (videos ?? []).reduce((n: number, v: { video_size: number | null }) => n + (v.video_size ?? 0), 0);
  const usedMb = Math.round(bytes / (1024 * 1024));
  const totalQuota = (freeQuota as number) + upgradeSize;
  return { usedMb, totalQuota, remainingMb: Math.max(0, totalQuota - usedMb) };
}

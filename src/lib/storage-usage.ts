import { supabaseServer } from '@/lib/supabase-server';
import { notifyUsers } from '@/lib/notifications-service';

/**
 * Like Google One: when a paid plan ends the extra space stays for a short grace
 * period (time to renew), then the account goes back to its base quota. Files are
 * never deleted. Over the quota the user can still open, download and delete files
 * but cannot upload new ones.
 */
export const STORAGE_GRACE_DAYS = 7;
const DAY = 24 * 60 * 60 * 1000;

export function upgradeStillApplies(expiresAt: string | null | undefined): boolean {
  if (!expiresAt) return true;
  return new Date(expiresAt).getTime() + STORAGE_GRACE_DAYS * DAY > Date.now();
}

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
  const upgradeSize = up && upgradeStillApplies(up.expires_at) ? up.size_mb : 0;

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

type UpgradeRow = {
  id: string; size_mb: number; expires_at: string | null;
  notified_7d_at: string | null; notified_1d_at: string | null; notified_end_at: string | null; notified_back_at: string | null;
};

/**
 * In-app notices about a storage plan, sent once each (markers on the upgrade row):
 * 7 days before the end, 1 day before, when it ends (grace starts), and when the grace is over.
 * Runs when the user's storage is read, so it reaches the user the next time they open the app.
 */
export async function syncStorageNotices(userId: string, baseMb: number, usedMb: number): Promise<void> {
  try {
    const { data } = await supabaseServer
      .from('user_storage_upgrades')
      .select('id, size_mb, expires_at, notified_7d_at, notified_1d_at, notified_end_at, notified_back_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    const up = data as UpgradeRow | null;
    if (!up || !up.expires_at) return;
    const now = Date.now();
    const exp = new Date(up.expires_at).getTime();
    const graceEnd = exp + STORAGE_GRACE_DAYS * DAY;
    const stamp = new Date().toISOString();
    const mark = async (col: string) => {
      await supabaseServer.from('user_storage_upgrades').update({ [col]: stamp }).eq('id', up.id);
    };
    const total = baseMb + up.size_mb;
    if (now >= graceEnd) {
      if (!up.notified_back_at) {
        await mark('notified_back_at');
        const over = usedMb > baseMb;
        await notifyUsers([userId], 'system', 'رجعت مساحة التخزين للأساسية',
          `انتهت مهلة التجديد ورجعت مساحتك إلى ${baseMb} ميجا. ملفاتك كلها محفوظة وتقدر تفتحها وتنزلها وتمسحها.` +
          (over ? ' بما إنك مستخدم أكتر من المساحة، مش هتقدر ترفع ملفات جديدة لحد ما تمسح لتحت الحد أو تجدد الاشتراك.' : ''));
      }
    } else if (now >= exp) {
      if (!up.notified_end_at) {
        await mark('notified_end_at');
        await notifyUsers([userId], 'system', 'انتهى اشتراك مساحة التخزين',
          `انتهى اشتراك التخزين. مساحتك (${total} ميجا) فاضلة ${STORAGE_GRACE_DAYS} أيام للتجديد، وبعدها بترجع ${baseMb} ميجا. ملفاتك مش هتتمسح.`);
      }
    } else if (exp - now <= DAY) {
      if (!up.notified_1d_at) {
        await mark('notified_1d_at');
        await notifyUsers([userId], 'system', 'اشتراك التخزين ينتهي غداً',
          `اشتراك مساحة التخزين ينتهي خلال يوم. جدد الاشتراك لتحتفظ بمساحة ${total} ميجا. ملفاتك مش هتتمسح في كل الأحوال.`);
      }
    } else if (exp - now <= 7 * DAY) {
      if (!up.notified_7d_at) {
        await mark('notified_7d_at');
        await notifyUsers([userId], 'system', 'اشتراك التخزين قرب ينتهي',
          `اشتراك مساحة التخزين ينتهي خلال 7 أيام. جدد الاشتراك لتحتفظ بمساحة ${total} ميجا.`);
      }
    }
  } catch (err) {
    console.error('[storage notices] failed:', err);
  }
}

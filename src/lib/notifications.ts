import { supabase } from '@/lib/supabase';
import type { NotificationType } from '@/lib/types';

/**
 * Send a push notification via the server-side /api/push/send endpoint.
 * This is non-blocking — if the push fails, the in-app notification
 * (already inserted into the DB) is still delivered via Realtime.
 */
async function sendPushViaServer(
  userId: string,
  title: string,
  message: string,
  link?: string,
  type?: string
) {
  try {
    await fetch('/api/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, title, message, url: link, type }),
    });
  } catch {
    // Non-blocking — don't fail the notification if push fails
  }
}

/**
 * Send a notification to a user.
 *
 * This inserts a row into the `notifications` Supabase table.
 * If a real-time subscription is active for the target user,
 * the notification will appear in their bell dropdown automatically.
 *
 * @example
 * ```ts
 * await sendNotification({
 *   userId: studentId,
 *   type: 'grade',
 *   title: 'تم تصحيح الواجب',
 *   message: 'حصلت على 85/100 في واجب الرياضيات',
 *   link: 'assignments',
 * });
 * ```
 */
export async function sendNotification({
  userId,
  type,
  title,
  message,
  link,
}: {
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  link?: string;
}) {
  try {
    const { error } = await supabase.from('notifications').insert({
      user_id: userId,
      type,
      title,
      message,
      link: link || null,
    });

    if (error) {
      console.error('Failed to send notification:', error);
    } else {
      // Also send as external push notification (non-blocking)
      sendPushViaServer(userId, title, message, link, type).catch(() => {});
    }
  } catch (err) {
    console.error('Failed to send notification:', err);
  }
}

/**
 * Send a notification to multiple users at once.
 *
 * Optimizations:
 * - Deduplicates userIds to avoid duplicate notifications
 * - Uses Promise.allSettled for parallel push delivery
 * - Limits concurrent push requests to avoid overwhelming the server
 *
 * @example
 * ```ts
 * await sendBulkNotification({
 *   userIds: ['id1', 'id2', 'id3'],
 *   type: 'attendance',
 *   title: 'تم تسجيل الحضور',
 *   message: 'تم فتح جلسة حضور لمقرر الفيزياء',
 *   link: 'attendance',
 * });
 * ```
 */
export async function sendBulkNotification({
  userIds,
  type,
  title,
  message,
  link,
}: {
  userIds: string[];
  type: NotificationType;
  title: string;
  message: string;
  link?: string;
}) {
  if (userIds.length === 0) return;

  // Deduplicate userIds to prevent duplicate notifications
  const uniqueUserIds = [...new Set(userIds)];

  try {
    const rows = uniqueUserIds.map((userId) => ({
      user_id: userId,
      type,
      title,
      message,
      link: link || null,
    }));

    const { error } = await supabase.from('notifications').insert(rows);

    if (error) {
      console.error('Failed to send bulk notifications:', error);
      return;
    }

    // Send external push notifications in parallel batches
    // to avoid overwhelming the server with too many concurrent requests
    const BATCH_SIZE = 5;
    for (let i = 0; i < uniqueUserIds.length; i += BATCH_SIZE) {
      const batch = uniqueUserIds.slice(i, i + BATCH_SIZE);
      await Promise.allSettled(
        batch.map((uid) => sendPushViaServer(uid, title, message, link, type))
      );
    }
  } catch (err) {
    console.error('Failed to send bulk notifications:', err);
  }
}

/**
 * Send a notification to all users with a specific role.
 *
 * @example
 * ```ts
 * await sendNotificationToRole({
 *   role: 'student',
 *   type: 'announcement',
 *   title: 'إعلان هام',
 *   message: 'سيتم إجراء صيانة للنظام غداً',
 * });
 * ```
 */
export async function sendNotificationToRole({
  role,
  type,
  title,
  message,
  link,
}: {
  role: string;
  type: NotificationType;
  title: string;
  message: string;
  link?: string;
}) {
  try {
    const { data: users, error } = await supabase
      .from('users')
      .select('id')
      .eq('role', role);

    if (error || !users || users.length === 0) {
      console.error('Failed to fetch users for role notification:', error);
      return;
    }

    const userIds = users.map((u) => u.id);
    await sendBulkNotification({ userIds, type, title, message, link });
  } catch (err) {
    console.error('Failed to send role notification:', err);
  }
}


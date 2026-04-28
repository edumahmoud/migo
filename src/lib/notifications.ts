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

  try {
    const rows = userIds.map((userId) => ({
      user_id: userId,
      type,
      title,
      message,
      link: link || null,
    }));

    const { error } = await supabase.from('notifications').insert(rows);

    if (error) {
      console.error('Failed to send bulk notifications:', error);
    } else {
      // Also send as external push notifications (non-blocking, one per user)
      for (const uid of userIds) {
        sendPushViaServer(uid, title, message, link, type).catch(() => {});
      }
    }
  } catch (err) {
    console.error('Failed to send bulk notifications:', err);
  }
}

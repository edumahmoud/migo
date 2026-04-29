/**
 * AttenDo — Consolidated Notification Service
 *
 * Single source of truth for sending notifications.
 * Every call atomically:
 *   1. Inserts the notification into the `notifications` table (via Supabase service role — bypasses RLS)
 *   2. Sends a push notification to every registered push subscription for that user
 *   3. Cleans up expired push subscriptions (410 / 404)
 *
 * ALL routes must use this module instead of copy-pasting their own notifyUser / notifyUsers.
 */

import { supabaseServer } from '@/lib/supabase-server';
import { sendPushNotification, type PushSubscriptionLike } from '@/lib/web-push';
import type { NotificationType } from '@/lib/types';

// ─── Push delivery ────────────────────────────────────────────────

interface PushSubRow {
  endpoint: string;
  p256dh: string;
  auth_key: string;
}

/**
 * Send a push notification to a single user.
 * Fetches their push subscriptions from DB, sends to all, and cleans up expired ones.
 */
async function pushToUser(
  userId: string,
  title: string,
  message: string,
  url?: string,
  type?: string,
): Promise<void> {
  try {
    const { data: subs } = await supabaseServer
      .from('push_subscriptions')
      .select('endpoint, p256dh, auth_key')
      .eq('user_id', userId);

    if (!subs || subs.length === 0) return;

    // Generate a unique ID for this push notification so the SW can use it for the tag
    const notifId = `${type || 'system'}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const payload = { title, message, url: url || '/', type, id: notifId };
    const expiredEndpoints: string[] = [];

    // Parallel delivery with concurrency limit
    const CONCURRENT_PUSH_LIMIT = 10;
    const subList = subs as PushSubRow[];
    for (let i = 0; i < subList.length; i += CONCURRENT_PUSH_LIMIT) {
      const batch = subList.slice(i, i + CONCURRENT_PUSH_LIMIT);
      const results = await Promise.allSettled(
        batch.map(async (sub) => {
          const subscription: PushSubscriptionLike = {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth_key },
          };
          const result = await sendPushNotification(subscription, payload);
          return { endpoint: sub.endpoint, ...result };
        })
      );
      for (const result of results) {
        if (result.status === 'fulfilled') {
          const { endpoint, success, expired } = result.value;
          if (!success && expired) {
            expiredEndpoints.push(endpoint);
          }
        }
      }
    }

    // Clean up expired subscriptions
    if (expiredEndpoints.length > 0) {
      for (const endpoint of expiredEndpoints) {
        await supabaseServer
          .from('push_subscriptions')
          .delete()
          .eq('endpoint', endpoint);
      }
      console.log(`[notify] Cleaned up ${expiredEndpoints.length} expired push subscription(s) for user ${userId}`);
    }
  } catch (err) {
    console.error('[notify] pushToUser failed:', err);
  }
}

/**
 * Send push notifications to multiple users.
 */
async function pushToUsers(
  userIds: string[],
  title: string,
  message: string,
  url?: string,
  type?: string,
): Promise<void> {
  if (userIds.length === 0) return;

  try {
    const { data: subs } = await supabaseServer
      .from('push_subscriptions')
      .select('user_id, endpoint, p256dh, auth_key')
      .in('user_id', userIds);

    if (!subs || subs.length === 0) return;

    // Generate a unique ID for this push notification so the SW can use it for the tag
    const notifId = `${type || 'system'}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const payload = { title, message, url: url || '/', type, id: notifId };
    const expiredEndpoints: string[] = [];

    // Parallel delivery with concurrency limit
    const CONCURRENT_PUSH_LIMIT = 10;
    const subList = subs as (PushSubRow & { user_id: string })[];
    for (let i = 0; i < subList.length; i += CONCURRENT_PUSH_LIMIT) {
      const batch = subList.slice(i, i + CONCURRENT_PUSH_LIMIT);
      const results = await Promise.allSettled(
        batch.map(async (sub) => {
          const subscription: PushSubscriptionLike = {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth_key },
          };
          const result = await sendPushNotification(subscription, payload);
          return { endpoint: sub.endpoint, ...result };
        })
      );
      for (const result of results) {
        if (result.status === 'fulfilled') {
          const { endpoint, success, expired } = result.value;
          if (!success && expired) {
            expiredEndpoints.push(endpoint);
          }
        }
      }
    }

    // Clean up expired subscriptions
    if (expiredEndpoints.length > 0) {
      for (const endpoint of expiredEndpoints) {
        await supabaseServer
          .from('push_subscriptions')
          .delete()
          .eq('endpoint', endpoint);
      }
      console.log(`[notify] Cleaned up ${expiredEndpoints.length} expired push subscription(s)`);
    }
  } catch (err) {
    console.error('[notify] pushToUsers failed:', err);
  }
}

// ─── DB + Push atomic operations ───────────────────────────────────

/**
 * Send a notification to a single user:
 *  1. Insert into `notifications` table (service role, bypasses RLS)
 *  2. Send push notification to all their registered devices
 *
 * Push is non-blocking — if it fails, the in-app notification is still delivered
 * via Supabase Realtime.
 */
export async function notifyUser(
  userId: string,
  type: NotificationType | string,
  title: string,
  message: string,
  link?: string,
): Promise<void> {
  try {
    const { error } = await supabaseServer.from('notifications').insert({
      user_id: userId,
      type,
      title,
      message,
      link: link || null,
    });

    if (error) {
      console.error('[notify] DB insert failed:', error.message, error.details);
      return;
    }

    // DB insert succeeded — also send push (non-blocking)
    pushToUser(userId, title, message, link, type).catch(() => {});
  } catch (err) {
    console.error('[notify] notifyUser exception:', err);
  }
}

/**
 * Send a notification to multiple users at once:
 *  1. Bulk-insert into `notifications` table (service role, bypasses RLS)
 *  2. Send push notifications to all registered devices for those users
 *
 * If bulk insert fails, falls back to inserting one-by-one.
 */
export async function notifyUsers(
  userIds: string[],
  type: NotificationType | string,
  title: string,
  message: string,
  link?: string,
): Promise<void> {
  if (userIds.length === 0) return;

  // Deduplicate
  const uniqueIds = [...new Set(userIds)];

  try {
    const rows = uniqueIds.map((userId) => ({
      user_id: userId,
      type,
      title,
      message,
      link: link || null,
    }));

    const { error } = await supabaseServer.from('notifications').insert(rows);

    if (error) {
      console.error('[notify] Bulk DB insert failed:', error.message, error.details);
      // Fallback: try inserting one by one
      for (const row of rows) {
        const { error: singleError } = await supabaseServer.from('notifications').insert(row);
        if (singleError) {
          console.error('[notify] Single insert also failed for user', row.user_id, ':', singleError.message);
        } else {
          // Individual insert succeeded — push for this user
          pushToUser(row.user_id, title, message, link, type).catch(() => {});
        }
      }
    } else {
      // Bulk insert succeeded — send push to all
      pushToUsers(uniqueIds, title, message, link, type).catch(() => {});
    }
  } catch (err) {
    console.error('[notify] notifyUsers exception:', err);
  }
}

/**
 * Get all approved student IDs for a subject.
 * Utility used by multiple notification-sending routes.
 */
export async function getStudentIds(subjectId: string): Promise<string[]> {
  const { data, error } = await supabaseServer
    .from('subject_students')
    .select('student_id')
    .eq('subject_id', subjectId)
    .eq('status', 'approved');

  if (error) {
    console.error('[notify] Failed to fetch student IDs:', error.message);
    // Fallback: try without status filter (in case status column doesn't exist)
    const { data: fallbackData } = await supabaseServer
      .from('subject_students')
      .select('student_id')
      .eq('subject_id', subjectId);
    return (fallbackData || []).map((e: { student_id: string }) => e.student_id);
  }

  return (data || []).map((e: { student_id: string }) => e.student_id);
}

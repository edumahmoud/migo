/**
 * AttenDo — Client-side notification helpers
 *
 * ⚠️ DEPRECATED: This file is kept for backward compatibility.
 * The canonical notification service is now `@/lib/notifications-service.ts`
 * which runs server-side and handles BOTH DB insert + push delivery atomically.
 *
 * The functions below are client-side helpers that call the `/api/notify` route.
 * Use these ONLY from client components. For server-side API routes, import from
 * `@/lib/notifications-service.ts` instead.
 */

import type { NotificationType } from '@/lib/types';

/**
 * Send a notification to a user via the /api/notify endpoint.
 * This is for client-side use only (e.g., from React components).
 * Server-side code should use `notifyUser` from `@/lib/notifications-service.ts`.
 */
export async function sendNotification({
  userId,
  type,
  title,
  message,
  link,
  action = 'chat_message',
  extraData = {},
}: {
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  link?: string;
  action?: string;
  extraData?: Record<string, unknown>;
}) {
  try {
    const { data: { session } } = await (await import('@/lib/supabase')).supabase.auth.getSession();
    const token = session?.access_token || '';

    await fetch('/api/notify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        action,
        recipientId: userId,
        type,
        title,
        message,
        link,
        ...extraData,
      }),
    });
  } catch (err) {
    console.error('[notifications] sendNotification failed:', err);
  }
}

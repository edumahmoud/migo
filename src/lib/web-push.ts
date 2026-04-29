import webpush from 'web-push';

/**
 * Web Push — Lazy Initialization
 *
 * VAPID keys are validated and setVapidDetails() is called lazily
 * on first use (not at module load time). This prevents build failures
 * when keys are missing or invalid (e.g. wrong length) during
 * Vercel's static page generation step.
 */

let vapidInitialized = false;
let vapidInitError: string | null = null;

/**
 * Lazily initialize web-push with VAPID keys.
 * Returns true if initialization succeeded, false otherwise.
 */
function ensureVapidInitialized(): boolean {
  if (vapidInitialized) return !vapidInitError;
  if (vapidInitError) return false;

  const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;

  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    vapidInitError = 'VAPID keys not configured';
    console.warn(
      '⚠️ [Push] VAPID keys not configured. Push notifications will not work. ' +
      'Set NEXT_PUBLIC_VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY in .env'
    );
    return false;
  }

  try {
    webpush.setVapidDetails(
      'mailto:support@attendo.app',
      VAPID_PUBLIC_KEY,
      VAPID_PRIVATE_KEY
    );
    vapidInitialized = true;
    return true;
  } catch (err) {
    vapidInitError = (err instanceof Error ? err.message : String(err));
    console.warn(
      '⚠️ [Push] VAPID key validation failed:', vapidInitError,
      '— Push notifications will not work until valid keys are provided.'
    );
    return false;
  }
}

export { webpush };

/**
 * Result of sending a push notification.
 */
export type PushSendResult =
  | { success: true; expired: false }
  | { success: false; expired: true }    // 410/404 — subscription should be removed
  | { success: false; expired: false };  // Other error (VAPID missing, network, etc.)

/**
 * Send a push notification to a specific subscription.
 * Returns detailed result to distinguish expired subscriptions from config errors.
 */
export async function sendPushNotification(
  subscription: PushSubscriptionLike,
  payload: {
    title: string;
    message: string;
    url?: string;
    type?: string;
    actions?: Array<{ action: string; title: string; icon?: string }>;
  }
): Promise<PushSendResult> {
  if (!ensureVapidInitialized()) {
    console.warn('[Push] VAPID not configured — skipping push send');
    return { success: false, expired: false };
  }

  try {
    await webpush.sendNotification(subscription, JSON.stringify(payload));
    return { success: true, expired: false };
  } catch (error: unknown) {
    const err = error as { statusCode?: number };
    // 410 = subscription expired, 404 = subscription invalid
    if (err.statusCode === 410 || err.statusCode === 404) {
      console.log('[Push] Subscription expired or invalid (status %d), removing', err.statusCode);
      return { success: false, expired: true };
    }
    console.error('Push notification send error:', error);
    return { success: false, expired: false };
  }
}

/**
 * Send push notifications to multiple subscriptions.
 * Returns the number of successful sends.
 */
export async function sendPushNotificationBulk(
  subscriptions: PushSubscriptionLike[],
  payload: {
    title: string;
    message: string;
    url?: string;
    type?: string;
    actions?: Array<{ action: string; title: string; icon?: string }>;
  }
): Promise<{ sent: number; failed: number; expiredSubscriptions: number[] }> {
  if (!ensureVapidInitialized()) {
    console.warn('[Push] VAPID not configured — skipping bulk push send');
    return { sent: 0, failed: subscriptions.length, expiredSubscriptions: [] };
  }

  let sent = 0;
  let failed = 0;
  const expiredSubscriptions: number[] = [];

  for (let i = 0; i < subscriptions.length; i++) {
    try {
      await webpush.sendNotification(subscriptions[i], JSON.stringify(payload));
      sent++;
    } catch (error: unknown) {
      const err = error as { statusCode?: number };
      if (err.statusCode === 410 || err.statusCode === 404) {
        expiredSubscriptions.push(i);
      }
      failed++;
    }
  }

  return { sent, failed, expiredSubscriptions };
}

export interface PushSubscriptionLike {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}

import webpush from 'web-push';

/**
 * Initialize web-push with VAPID keys.
 * This must be called before any push notification sending.
 */

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;

if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
  console.warn(
    '⚠️ VAPID keys not configured. Push notifications will not work. ' +
    'Set NEXT_PUBLIC_VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY in .env'
  );
} else {
  webpush.setVapidDetails(
    'mailto:support@attendo.app',
    VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY
  );
}

export { webpush };

/**
 * Send a push notification to a specific subscription.
 * Returns true if sent successfully, false otherwise.
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
): Promise<boolean> {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    return false;
  }

  try {
    await webpush.sendNotification(subscription, JSON.stringify(payload));
    return true;
  } catch (error: unknown) {
    const err = error as { statusCode?: number };
    // 410 = subscription expired, 404 = subscription invalid
    if (err.statusCode === 410 || err.statusCode === 404) {
      console.log('Push subscription expired or invalid, should be removed');
      return false;
    }
    console.error('Push notification send error:', error);
    return false;
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

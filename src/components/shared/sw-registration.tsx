'use client';

import { useEffect } from 'react';

/**
 * ServiceWorkerRegistration
 *
 * Registers the service worker and sets up push notification subscription.
 * - On first visit: registers SW only (no push yet)
 * - On login/notification permission: subscribes to push notifications
 * - Stores subscription in Supabase for server-side push delivery
 */

// VAPID public key from environment
const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

/**
 * Convert a base64 string to Uint8Array for the push subscription.
 */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

/**
 * Subscribe to push notifications and send subscription to server.
 */
async function subscribeToPush(
  registration: ServiceWorkerRegistration,
  userId: string
) {
  if (!VAPID_PUBLIC_KEY) {
    console.warn('[Push] VAPID public key not configured');
    return false;
  }

  try {
    // Check if already subscribed
    const existingSubscription = await registration.pushManager.getSubscription();
    if (existingSubscription) {
      // Already subscribed — sync with server
      await syncSubscriptionToServer(existingSubscription, userId);
      return true;
    }

    // Request notification permission
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      console.log('[Push] Notification permission denied');
      return false;
    }

    // Subscribe to push
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });

    // Sync subscription to server
    await syncSubscriptionToServer(subscription, userId);
    console.log('[Push] Successfully subscribed to push notifications');
    return true;
  } catch (error) {
    console.error('[Push] Subscription failed:', error);
    return false;
  }
}

/**
 * Send the push subscription to our server for storage.
 */
async function syncSubscriptionToServer(
  subscription: PushSubscription,
  userId: string
) {
  try {
    const subJSON = subscription.toJSON();
    await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId,
        subscription: {
          endpoint: subJSON.endpoint,
          keys: {
            p256dh: subJSON.keys?.p256dh,
            auth: subJSON.keys?.auth,
          },
        },
      }),
    });
  } catch (error) {
    console.error('[Push] Failed to sync subscription to server:', error);
  }
}

export default function ServiceWorkerRegistration() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;

    const registerSW = async () => {
      try {
        const registration = await navigator.serviceWorker.register('/sw.js', {
          scope: '/',
        });

        // Check for updates periodically
        setInterval(() => {
          registration.update();
        }, 60 * 60 * 1000); // Every hour

        // Handle updates
        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          if (!newWorker) return;

          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'activated') {
              console.log('[PWA] New service worker activated');
            }
          });
        });

        console.log('[PWA] Service Worker registered successfully');

        // Try to subscribe to push if user is logged in
        await tryAutoSubscribe(registration);
      } catch (error) {
        console.error('[PWA] Service Worker registration failed:', error);
      }
    };

    // Try auto-subscribe if user has already granted permission
    const tryAutoSubscribe = async (registration: ServiceWorkerRegistration) => {
      // Only subscribe if permission already granted (don't prompt on every visit)
      if (Notification.permission !== 'granted') return;

      // Get current user from Supabase auth
      try {
        const { createClient } = await import('@supabase/supabase-js');
        const supabase = createClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
        );
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user?.id) {
          await subscribeToPush(registration, session.user.id);
        }
      } catch {
        // Not logged in or Supabase not ready — that's fine
      }
    };

    // Register after page load for better performance
    if (document.readyState === 'complete') {
      registerSW();
    } else {
      window.addEventListener('load', registerSW);
    }

    // Listen for custom event to subscribe to push (triggered by notification permission UI)
    const handleSubscribePush = async (event: Event) => {
      const customEvent = event as CustomEvent;
      const userId = customEvent.detail?.userId;
      if (!userId) return;

      try {
        const registration = await navigator.serviceWorker.ready;
        await subscribeToPush(registration, userId);
      } catch (error) {
        console.error('[Push] Manual subscription failed:', error);
      }
    };

    window.addEventListener('subscribe-push', handleSubscribePush);

    return () => {
      window.removeEventListener('subscribe-push', handleSubscribePush);
    };
  }, []);

  return null;
}

// Export the subscribe function for use in other components
export { subscribeToPush };

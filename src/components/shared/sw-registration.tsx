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

// Global promise so other components can wait for SW registration
let swRegistrationPromise: Promise<ServiceWorkerRegistration | null> | null = null;

export function getSWRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (swRegistrationPromise) return swRegistrationPromise;
  if (!('serviceWorker' in navigator)) return Promise.resolve(null);
  // Fallback: wait for ready state
  return navigator.serviceWorker.ready.then(r => r as ServiceWorkerRegistration).catch(() => null);
}

// ─── PWA Busy Operation Flag ───
// When the user is in the middle of a critical operation (modal open, file upload,
// form filling), components set this flag to TRUE. The controllerchange handler
// checks this flag before reloading — if busy, the reload is deferred until the
// operation completes. This prevents the page from reloading while the user is
// picking a file from the native file picker on mobile PWA.
let _busyOperation = false;

export function setPWABusyOperation(busy: boolean): void {
  _busyOperation = busy;
  // Also set on window for the inline white-screen detection script in layout.tsx
  if (typeof window !== 'undefined') {
    (window as any).__attendoBusyOperation = busy;
  }
}

export function isPWABusyOperation(): boolean {
  return _busyOperation || (typeof window !== 'undefined' && !!(window as any).__attendoBusyOperation);
}

/**
 * Perform a safe SW reload — checks for pending deferred reloads.
 * Called by components when they close modals / finish operations.
 */
export function checkAndApplyPendingSWReload(): void {
  if (sessionStorage.getItem('_sw_reload_pending') && !isPWABusyOperation()) {
    sessionStorage.removeItem('_sw_reload_pending');
    console.log('[PWA] Applying deferred SW reload now');
    window.location.reload();
  }
}

/** Internal: do the reload (immediate or from deferred check) */
function _doSWReload(): void {
  sessionStorage.removeItem('_sw_reload_pending');
  window.location.reload();
}

// VAPID public key from environment (with fallback hardcoded key)
const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || 'BEmz0poQ1JXb7aq39ZTW6t1OUSRMgFxaONIgKlUDYxEgW9P_pT-_etTSj9YV-gLOgFnqSEnPqjUuhLLJLAf5qEE';

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
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as unknown as BufferSource,
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
 *
 * CRITICAL FIX: This function MUST include the Authorization header.
 * Without it, the /api/push/subscribe endpoint rejects the request with 401,
 * and push subscriptions are never stored in the database.
 * This was the root cause of push notifications not working outside the app.
 */
async function syncSubscriptionToServer(
  subscription: PushSubscription,
  userId: string
) {
  try {
    // Get a valid auth token — use waitForSession for mobile PWA reliability
    const { waitForSession } = await import('@/lib/client-auth');
    const token = await waitForSession(10000);

    const subJSON = subscription.toJSON();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const res = await fetch('/api/push/subscribe', {
      method: 'POST',
      headers,
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

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      console.error('[Push] syncSubscriptionToServer failed:', res.status, data);
    } else {
      console.log('[Push] Subscription synced to server successfully');
    }
  } catch (error) {
    console.error('[Push] Failed to sync subscription to server:', error);
  }
}

export default function ServiceWorkerRegistration() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;

    let updateIntervalId: ReturnType<typeof setInterval> | null = null;

    const registerSW = async () => {
      try {
        const registration = await navigator.serviceWorker.register('/sw.js', {
          scope: '/',
        });

        // Store globally so other components can await it
        swRegistrationPromise = Promise.resolve(registration);

        // Check for updates periodically (store interval ID for cleanup)
        updateIntervalId = setInterval(() => {
          registration.update();
        }, 60 * 60 * 1000); // Every hour

        // Handle updates — send SKIP_WAITING and reload when new SW is installed
        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          if (!newWorker) return;

          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              // New version available — tell it to activate immediately
              newWorker.postMessage({ type: 'SKIP_WAITING' });
            }
          });
        });

        // When the controlling SW changes (after SKIP_WAITING), reload the page
        // CRITICAL FIX: Do NOT reload unconditionally. On mobile PWA, when the user opens
        // the native file picker and returns, a pending SW update can trigger controllerchange.
        // Reloading here destroys the modal, file selection, and all form state.
        // Instead: defer the reload if a busy operation is in progress.
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          if (isPWABusyOperation()) {
            console.log('[PWA] SW controller changed but user is busy — deferring reload');
            sessionStorage.setItem('_sw_reload_pending', '1');
            return;
          }
          // Check for a pending reload that was deferred
          _doSWReload();
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

      // Ensure push_subscriptions table exists before subscribing
      try {
        await fetch('/api/push/setup', { method: 'POST' });
      } catch {
        // Non-critical — table might already exist
      }

      // Get current user from Supabase auth using the existing client
      try {
        const { supabase } = await import('@/lib/supabase');
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user?.id) {
          await subscribeToPush(registration, session.user.id);
        }
      } catch {
        // Not logged in or Supabase not ready — that's fine
      }
    };

    // Handle deeplink from ?deeplink= query param on initial page load
    // Also reads ¬ifType= to pass the notification type through
    // Stores the deeplink on window.__attendoDeeplinkQueue as a fallback
    // in case notification-bell.tsx hasn't loaded yet when the event fires.
    const handleInitialDeeplink = () => {
      try {
        const params = new URLSearchParams(window.location.search);
        const deeplink = params.get('deeplink');
        const notifType = params.get('notifType') || 'system';
        if (deeplink) {
          const url = decodeURIComponent(deeplink);
          const entry = { url, notifType };

          // Store on window global as a fallback (survives module load order)
          if (!Array.isArray((window as any).__attendoDeeplinkQueue)) {
            (window as any).__attendoDeeplinkQueue = [];
          }
          (window as any).__attendoDeeplinkQueue.push(entry);

          // Also dispatch the custom event (for when notification-bell is already loaded)
          window.dispatchEvent(new CustomEvent('notification-deeplink', {
            detail: entry,
          }));

          // Clean up the URL without reloading
          const cleanUrl = new URL(window.location.href);
          cleanUrl.searchParams.delete('deeplink');
          cleanUrl.searchParams.delete('notifType');
          window.history.replaceState({}, '', cleanUrl.pathname);
        }
      } catch {
        // Ignore malformed deeplink
      }
    };

    // Register after page load for better performance
    if (document.readyState === 'complete') {
      registerSW();
      handleInitialDeeplink();
    } else {
      window.addEventListener('load', () => {
        registerSW();
        handleInitialDeeplink();
      });
    }

    // Listen for messages from the service worker (notification click deeplinks)
    const handleSWMessage = (event: MessageEvent) => {
      if (event.data?.type === 'NOTIFICATION_CLICK') {
        const { url, notifType } = event.data;
        const entry = { url, notifType };

        // Store on window global as a fallback
        if (!Array.isArray((window as any).__attendoDeeplinkQueue)) {
          (window as any).__attendoDeeplinkQueue = [];
        }
        (window as any).__attendoDeeplinkQueue.push(entry);

        // Also dispatch the custom event (for when notification-bell is already loaded)
        window.dispatchEvent(new CustomEvent('notification-deeplink', {
          detail: entry,
        }));
      }
    };

    navigator.serviceWorker.addEventListener('message', handleSWMessage);

    // Listen for custom event to subscribe to push (triggered by notification permission UI)
    const handleSubscribePush = async (event: Event) => {
      const customEvent = event as CustomEvent;
      const userId = customEvent.detail?.userId;
      if (!userId) return;

      try {
        // Wait for SW with timeout to avoid hanging
        const registration = await Promise.race([
          navigator.serviceWorker.ready,
          new Promise<null>((_, reject) => setTimeout(() => reject(new Error('SW timeout')), 4000)),
        ]);
        if (registration) {
          await subscribeToPush(registration as ServiceWorkerRegistration, userId);
        }
      } catch (error) {
        console.error('[Push] Manual subscription failed:', error);
      }
    };

    window.addEventListener('subscribe-push', handleSubscribePush);

    return () => {
      if (updateIntervalId) clearInterval(updateIntervalId);
      navigator.serviceWorker.removeEventListener('message', handleSWMessage);
      window.removeEventListener('subscribe-push', handleSubscribePush);
    };
  }, []);

  return null;
}

// Export the subscribe function for use in other components
export { subscribeToPush };

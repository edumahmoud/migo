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
//
// CRITICAL: We use BOTH a module-level variable AND localStorage.
// - Module-level var: Fast, synchronous, works within the same process
// - localStorage: Survives Android process kills! When Android kills the WebView
//   and restores it, the module-level var is gone, but localStorage persists.
//   The restored page reads localStorage to know the user was busy.
const BUSY_FLAG_KEY = '_attendo_busy';

let _busyOperation = false;

export function setPWABusyOperation(busy: boolean): void {
  _busyOperation = busy;
  // Also set on window for the inline white-screen detection script in layout.tsx
  if (typeof window !== 'undefined') {
    (window as any).__attendoBusyOperation = busy;
    // CRITICAL: Also persist to localStorage so it survives Android process kills.
    // When Android kills the PWA process while the native file picker is open,
    // sessionStorage is lost but localStorage persists.
    try {
      if (busy) {
        localStorage.setItem(BUSY_FLAG_KEY, JSON.stringify({ busy: true, ts: Date.now() }));
      } else {
        localStorage.removeItem(BUSY_FLAG_KEY);
      }
    } catch { /* localStorage might be full or unavailable */ }
  }
}

export function isPWABusyOperation(): boolean {
  if (_busyOperation || (typeof window !== 'undefined' && !!(window as any).__attendoBusyOperation)) {
    return true;
  }
  // Check localStorage (survives process kills)
  if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
    try {
      const raw = localStorage.getItem(BUSY_FLAG_KEY);
      if (raw) {
        const entry = JSON.parse(raw);
        // Only consider it busy if less than 5 minutes old (prevent stale flags)
        if (entry.busy && Date.now() - entry.ts < 5 * 60 * 1000) {
          return true;
        }
        // Stale flag — clean it up
        localStorage.removeItem(BUSY_FLAG_KEY);
      }
    } catch { /* ignore */ }
  }
  return false;
}

// Timestamp of the last page load (used to prevent reload loops)
let _lastLoadTime = typeof window !== 'undefined' ? Date.now() : 0;
// Minimum time between SW-triggered reloads (prevents rapid reload loops)
const MIN_RELOAD_INTERVAL_MS = 60_000; // 60 seconds — generous to prevent infinity loading

/**
 * Check if there's a pending SW reload and apply it safely.
 *
 * CRITICAL: Uses localStorage instead of sessionStorage because sessionStorage
 * is LOST when Android kills the PWA process. This prevents the "infinity loading"
 * loop where:
 *   1. Android kills the PWA process while file picker is open
 *   2. User returns → page loads from scratch
 *   3. _sw_reload_pending was in sessionStorage (now lost)
 *   4. No reload happens — good! No infinity loading.
 *
 * Also includes a time-based guard: if the page was loaded recently
 * (within 60 seconds), we DON'T reload again.
 */
export function checkAndApplyPendingSWReload(): void {
  try {
    const raw = localStorage.getItem('_sw_reload_pending');
    if (!raw) return;
    if (isPWABusyOperation()) {
      console.log('[PWA] SW reload pending but user is busy — keeping pending flag');
      return;
    }
    const timeSinceLoad = Date.now() - _lastLoadTime;
    if (timeSinceLoad < MIN_RELOAD_INTERVAL_MS) {
      console.log(`[PWA] Deferring SW reload (page loaded ${Math.round(timeSinceLoad / 1000)}s ago, need ${MIN_RELOAD_INTERVAL_MS / 1000}s)`);
      setTimeout(() => {
        checkAndApplyPendingSWReload();
      }, MIN_RELOAD_INTERVAL_MS - timeSinceLoad + 2000);
      return;
    }
    localStorage.removeItem('_sw_reload_pending');
    console.log('[PWA] Applying deferred SW reload now');
    window.location.reload();
  } catch { /* ignore localStorage errors */ }
}

/** Internal: defer the reload instead of doing it immediately */
function _deferSWReload(): void {
  try {
    localStorage.setItem('_sw_reload_pending', JSON.stringify({ ts: Date.now() }));
  } catch { /* ignore */ }
  console.log('[PWA] SW reload deferred (user is busy or page just loaded)');
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

    // Record the page load time for reload-loop prevention
    _lastLoadTime = Date.now();

    // CRITICAL: Clear any stale _sw_reload_pending flag from localStorage.
    // When Android kills the PWA process (e.g., while the native file picker is open)
    // and the user returns, the page loads from scratch. If there's a pending SW reload
    // flag from before the kill, it could trigger an immediate reload → infinity loading.
    // We clear it if the page just loaded (likely a process restore), preventing the loop.
    try {
      const raw = localStorage.getItem('_sw_reload_pending');
      if (raw) {
        const entry = JSON.parse(raw);
        // If the pending flag is older than 10 seconds, it's from a previous session
        // (before the process was killed) — clear it to prevent infinity loading
        if (Date.now() - entry.ts > 10_000) {
          localStorage.removeItem('_sw_reload_pending');
          console.log('[PWA] Cleared stale _sw_reload_pending (from killed process)');
        }
      }
    } catch { /* ignore */ }

    // Also clear stale busy flag from localStorage if it's from a killed process
    // (older than 5 minutes = definitely stale)
    try {
      const raw = localStorage.getItem('_attendo_busy');
      if (raw) {
        const entry = JSON.parse(raw);
        if (Date.now() - entry.ts > 5 * 60 * 1000) {
          localStorage.removeItem('_attendo_busy');
          console.log('[PWA] Cleared stale busy flag from killed process');
        }
      }
    } catch { /* ignore */ }

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

        // When the controlling SW changes (after SKIP_WAITING), NEVER reload immediately.
        // CRITICAL FIX: On mobile PWA, when the user opens the native file picker and
        // returns, a pending SW update can trigger controllerchange. Reloading here
        // destroys the modal, file selection, and all form state, causing the bug
        // where the page collapses to infinity loading.
        //
        // SOLUTION: Always defer the reload. Store the pending flag in localStorage
        // (survives process kills). The checkAndApplyPendingSWReload() function is
        // called when modals close / operations finish, and it has a time-based guard
        // to prevent reload loops.
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          console.log('[PWA] SW controller changed — deferring reload (never auto-reload on mobile)');
          _deferSWReload();
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

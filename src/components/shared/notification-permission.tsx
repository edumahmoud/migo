'use client';

import { useState, useEffect } from 'react';
import { Bell, BellOff, BellRing } from 'lucide-react';
import { toast } from 'sonner';
import { useAuthStore } from '@/stores/auth-store';

// VAPID key hardcoded as fallback (must match web-push.ts fallback pair)
const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || 'BJVI5gJTr0mRDS4ZcO63JtuPFcKQb-sEghvtV9NBV970s9D0weFCnxcbKrpUL8IBXY1g2sdxP74bM2cdOYrRZYI';

/**
 * Helper: wait for service worker to be ready with a timeout.
 * Returns the registration or null if timed out / not available.
 */
async function waitForServiceWorker(timeoutMs = 4000): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;

  try {
    const registration = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<null>((_, reject) => setTimeout(() => reject(new Error('SW timeout')), timeoutMs)),
    ]);
    return registration as ServiceWorkerRegistration;
  } catch {
    return null;
  }
}

/**
 * NotificationPermission — shows a button to enable/disable push notifications.
 * Works in two modes:
 * 1. Full Web Push (PWA installed / standalone browser) — subscribes to push, notifications arrive outside app
 * 2. In-app notifications fallback (iframe/embedded) — just requests Notification permission for in-app alerts
 */
export default function NotificationPermission() {
  const [permission, setPermission] = useState<NotificationPermission>('default');
  const [pushDisabled, setPushDisabled] = useState(false); // Tracks user preference (separate from browser permission)
  const [loading, setLoading] = useState(false);
  const { user } = useAuthStore();

  useEffect(() => {
    if (typeof window === 'undefined') return;

    // Check current notification permission
    if ('Notification' in window) {
      setPermission(Notification.permission);
    }

    // Check if user previously disabled push (stored in localStorage)
    try {
      const disabled = localStorage.getItem('push_disabled');
      if (disabled === '1') {
        setPushDisabled(true);
      }
    } catch {
      // localStorage not available
    }
  }, []);

  // Don't render if not logged in
  if (!user) return null;

  const handleEnable = async () => {
    if (!user?.id) return;
    setLoading(true);

    try {
      // Step 1: Request notification permission
      if ('Notification' in window) {
        const result = await Notification.requestPermission();
        setPermission(result);

        if (result !== 'granted') {
          toast.error('تم رفض إذن الإشعارات. يمكنك تفعيله من إعدادات المتصفح.');
          return;
        }
      }

      // Step 2: Try Web Push subscription (only works in standalone/secure context)
      const registration = await waitForServiceWorker(4000);

      if (registration?.pushManager) {
        try {
          // Ensure push_subscriptions table exists
          await fetch('/api/push/setup', { method: 'POST' }).catch(() => {});

          // Subscribe to push
          const subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as unknown as BufferSource,
          });

          // Send subscription to server
          // CRITICAL: Must include Authorization header, otherwise /api/push/subscribe
          // rejects with 401 and push subscriptions are never stored.
          const subJSON = subscription.toJSON();
          const { waitForSession } = await import('@/lib/client-auth');
          const token = await waitForSession(10000);
          const subHeaders: Record<string, string> = {
            'Content-Type': 'application/json',
          };
          if (token) {
            subHeaders['Authorization'] = `Bearer ${token}`;
          }
          const res = await fetch('/api/push/subscribe', {
            method: 'POST',
            headers: subHeaders,
            body: JSON.stringify({
              userId: user.id,
              subscription: {
                endpoint: subJSON.endpoint,
                keys: {
                  p256dh: subJSON.keys?.p256dh,
                  auth: subJSON.keys?.auth,
                },
              },
            }),
          });

          if (res.ok) {
            setPushDisabled(false);
            try { localStorage.removeItem('push_disabled'); } catch {}
            toast.success('تم تفعيل الإشعارات بنجاح! ستصلك حتى عند إغلاق المتصفح.');
          }
        } catch (pushError) {
          // Push subscription failed (common in iframe/sandbox) — in-app notifications still work
          console.warn('[Push] Web Push subscription failed:', pushError);
          toast.info('الإشعارات تعمل داخل التطبيق. لتلقي إشعارات خارجية، افتح التطبيق كـ PWA من المتصفح.');
        }
      } else {
        // Service Worker not available or timed out
        toast.info('الإشعارات تعمل داخل التطبيق. لتلقي إشعارات خارجية، افتح التطبيق كـ PWA.');
      }
    } catch (error) {
      console.error('Notification permission error:', error);
      toast.error('حدث خطأ في تفعيل الإشعارات');
    } finally {
      setLoading(false);
    }
  };

  const handleDisable = async () => {
    setLoading(true);
    try {
      // Try to unsubscribe from push
      const registration = await waitForServiceWorker(3000);
      if (registration) {
        try {
          const subscription = await registration.pushManager.getSubscription();
          if (subscription) {
            await subscription.unsubscribe();
            // Include Authorization header for /api/push/unsubscribe
            const { waitForSession: waitForSession2 } = await import('@/lib/client-auth');
            const unsubToken = await waitForSession2(5000);
            const unsubHeaders: Record<string, string> = {
              'Content-Type': 'application/json',
            };
            if (unsubToken) {
              unsubHeaders['Authorization'] = `Bearer ${unsubToken}`;
            }
            await fetch('/api/push/unsubscribe', {
              method: 'POST',
              headers: unsubHeaders,
              body: JSON.stringify({ endpoint: subscription.endpoint }),
            });
          }
        } catch {
          // Push not available, just update preference state
        }
      }

      // Store user preference (browser permission can't be changed programmatically)
      setPushDisabled(true);
      try { localStorage.setItem('push_disabled', '1'); } catch {}
      toast.success('تم إيقاف الإشعارات الخارجية');
    } catch (error) {
      console.error('Push unsubscribe error:', error);
      toast.error('حدث خطأ في إيقاف الإشعارات');
    } finally {
      setLoading(false);
    }
  };

  // User explicitly disabled push OR browser permission denied — show as disabled
  if (pushDisabled || permission === 'denied') {
    const isDenied = permission === 'denied';
    return (
      <button
        onClick={isDenied ? () => {
          toast.info('يرجى تفعيل الإشعارات من إعدادات المتصفح: المزيد ⚙️ > الإعدادات > الإشعارات > السماح');
        } : handleEnable}
        disabled={loading}
        className="relative flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground/40 hover:bg-muted/30 transition-colors touch-manipulation"
        aria-label={isDenied ? 'الإشعارات محظورة' : 'الإشعارات متوقفة - اضغط للتفعيل'}
        title={isDenied ? 'الإشعارات محظورة - فعّلها من إعدادات المتصفح' : 'الإشعارات متوقفة'}
      >
        {loading ? (
          <span className="h-4 w-4 border-2 border-muted-foreground border-t-transparent rounded-full animate-spin" />
        ) : (
          <BellOff className="h-5 w-5" />
        )}
      </button>
    );
  }

  // Permission granted and not disabled — show as enabled
  if (permission === 'granted' && !pushDisabled) {
    return (
      <button
        onClick={handleDisable}
        disabled={loading}
        className="relative flex h-9 w-9 items-center justify-center rounded-lg text-sky-700 dark:text-sky-300 hover:bg-sky-50 active:bg-sky-100 transition-colors touch-manipulation"
        aria-label="الإشعارات مفعّلة - اضغط لإيقافها"
        title="الإشعارات مفعّلة"
      >
        {loading ? <span className="h-4 w-4 border-2 border-sky-700 border-t-transparent rounded-full animate-spin" /> : <BellRing className="h-5 w-5" />}
      </button>
    );
  }

  // Default — show prompt to enable
  return (
    <button
      onClick={handleEnable}
      disabled={loading}
      className="relative flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted/50 active:bg-muted/80 hover:text-foreground transition-colors touch-manipulation"
      aria-label="تفعيل الإشعارات"
      title="فعّل الإشعارات لتصلك حتى عند إغلاق المتصفح"
    >
      {loading ? (
        <span className="h-4 w-4 border-2 border-muted-foreground border-t-transparent rounded-full animate-spin" />
      ) : (
        <>
          <Bell className="h-5 w-5" />
          <span className="absolute -top-0.5 -right-0.5 flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-3 w-3 bg-amber-500"></span>
          </span>
        </>
      )}
    </button>
  );
}

/** Convert base64 VAPID key to Uint8Array */
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


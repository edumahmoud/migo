'use client';

import { useState, useEffect } from 'react';
import { Bell, BellOff, BellRing } from 'lucide-react';
import { toast } from 'sonner';
import { useAuthStore } from '@/stores/auth-store';

/**
 * NotificationPermission — shows a button to enable/disable push notifications.
 * Displays the current permission state and allows the user to toggle it.
 */
export default function NotificationPermission() {
  const [permission, setPermission] = useState<NotificationPermissionState>('default');
  const [loading, setLoading] = useState(false);
  const { user } = useAuthStore();

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('Notification' in window)) return;

    setPermission(Notification.permission);
  }, []);

  // Don't render if not supported or not logged in
  if (typeof window !== 'undefined' && (!('Notification' in window) || !('serviceWorker' in navigator))) {
    return null;
  }

  if (!user) return null;

  const handleEnable = async () => {
    if (!user?.id) return;
    setLoading(true);

    try {
      // Request notification permission
      const result = await Notification.requestPermission();
      setPermission(result);

      if (result !== 'granted') {
        toast.error('تم رفض إذن الإشعارات. يمكنك تفعيله من إعدادات المتصفح.');
        return;
      }

      // Ensure push_subscriptions table exists before subscribing
      try {
        await fetch('/api/push/setup', { method: 'POST' });
      } catch {
        // Non-critical — table might already exist
      }

      // Register service worker if not already
      const registration = await navigator.serviceWorker.ready;

      // Get VAPID key
      const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!vapidKey) {
        toast.error('إشعارات Push غير مهيأة حالياً');
        return;
      }

      // Subscribe to push
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey),
      });

      // Send subscription to server
      const subJSON = subscription.toJSON();
      const res = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
        toast.success('تم تفعيل الإشعارات بنجاح! ستصلك الإشعارات حتى عند إغلاق المتصفح.');
      } else {
        toast.error('حدث خطأ في حفظ إعدادات الإشعارات');
      }
    } catch (error) {
      console.error('Push subscription error:', error);
      toast.error('حدث خطأ في تفعيل الإشعارات');
    } finally {
      setLoading(false);
    }
  };

  const handleDisable = async () => {
    setLoading(true);
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();

      if (subscription) {
        const endpoint = subscription.endpoint;

        // Unsubscribe from push
        await subscription.unsubscribe();

        // Remove from server
        await fetch('/api/push/unsubscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint }),
        });
      }

      setPermission('default');
      toast.success('تم إيقاف الإشعارات');
    } catch (error) {
      console.error('Push unsubscribe error:', error);
      toast.error('حدث خطأ في إيقاف الإشعارات');
    } finally {
      setLoading(false);
    }
  };

  // Permission granted — show as enabled
  if (permission === 'granted') {
    return (
      <button
        onClick={handleDisable}
        disabled={loading}
        className="relative flex h-9 w-9 items-center justify-center rounded-lg text-emerald-600 hover:bg-emerald-50 active:bg-emerald-100 transition-colors touch-manipulation"
        aria-label="الإشعارات مفعّلة - اضغط لإيقافها"
        title="الإشعارات مفعّلة"
      >
        <BellRing className="h-5 w-5" />
      </button>
    );
  }

  // Permission denied — show as blocked
  if (permission === 'denied') {
    return (
      <button
        onClick={() => {
          toast.info('يرجى تفعيل الإشعارات من إعدادات المتصفح (المزيد > الإعدادات > الإشعارات)');
        }}
        className="relative flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground/40 hover:bg-muted/30 transition-colors touch-manipulation"
        aria-label="الإشعارات محظورة"
        title="الإشعارات محظورة - فعّلها من إعدادات المتصفح"
      >
        <BellOff className="h-5 w-5" />
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
      <Bell className="h-5 w-5" />
      <span className="absolute -top-0.5 -right-0.5 flex h-3 w-3">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
        <span className="relative inline-flex rounded-full h-3 w-3 bg-amber-500"></span>
      </span>
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

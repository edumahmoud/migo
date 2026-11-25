'use client';

import { useEffect } from 'react';
import { useAuthStore } from '@/stores/auth-store';
import { getNativeFcmToken, FCM_REGISTERED_KEY } from '@/lib/native-push';

/**
 * Inside the Android app: link this phone's FCM token to the signed-in user so every
 * notification (and announcement) also arrives as an Android system notification.
 * Renders nothing. Does nothing in a normal browser.
 */
export default function NativePushRegistrar() {
  const userId = useAuthStore((s) => s.user?.id);

  useEffect(() => {
    if (!userId || typeof window === 'undefined') return;
    if (!(window as unknown as { AttendoNative?: unknown }).AttendoNative) return;

    let cancelled = false;

    const register = async () => {
      const token = getNativeFcmToken();
      if (!token || cancelled) return false;
      const marker = `${userId}:${token}`;
      try { if (localStorage.getItem(FCM_REGISTERED_KEY) === marker) return true; } catch { /* ignore */ }
      try {
        const { getCachedAuthHeaders } = await import('@/lib/client-auth');
        const headers = await getCachedAuthHeaders();
        const res = await fetch('/api/push/register-device', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...headers },
          body: JSON.stringify({ token, platform: 'android' }),
        });
        if (res.ok) {
          try { localStorage.setItem(FCM_REGISTERED_KEY, marker); } catch { /* ignore */ }
          return true;
        }
      } catch { /* retry below */ }
      return false;
    };

    // The token may not be ready right at launch: retry for a while, and re-register on refresh.
    let tries = 0;
    const timer = setInterval(async () => {
      tries++;
      if ((await register()) || tries >= 20) clearInterval(timer);
    }, 3000);
    register();
    const onToken = () => { try { localStorage.removeItem(FCM_REGISTERED_KEY); } catch { /* ignore */ } register(); };
    window.addEventListener('attendo-fcm-token', onToken);

    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener('attendo-fcm-token', onToken);
    };
  }, [userId]);

  return null;
}

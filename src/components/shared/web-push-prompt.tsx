'use client';

/**
 * Desktop / mobile browser notifications.
 * - Asks (with a button, as browsers require a click) to allow notifications for logged-in users.
 * - When permission is already granted, links this browser to the account that is logged in now
 *   (so switching accounts on the same browser moves the notifications to the new account).
 * Not used inside the Android app, which has its own push (FCM).
 */

import { useEffect, useState } from 'react';
import { Bell } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuthStore } from '@/stores/auth-store';
import { useTranslations } from '@/i18n/use-translations';

const DISMISS_KEY = 'web_push_prompt_dismissed_at';
const DISMISS_DAYS = 7;

export default function WebPushPrompt() {
  const { locale } = useTranslations();
  const userId = useAuthStore((s) => s.user?.id);
  const [show, setShow] = useState(false);

  const supported = () =>
    typeof window !== 'undefined' &&
    'Notification' in window &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    !(window as unknown as { AttendoNative?: unknown }).AttendoNative;

  useEffect(() => {
    if (!userId || !supported()) { setShow(false); return; }
    if (Notification.permission === 'granted') {
      // Already allowed: (re)link this browser to the current account.
      window.dispatchEvent(new CustomEvent('subscribe-push', { detail: { userId } }));
      setShow(false);
      return;
    }
    if (Notification.permission === 'denied') { setShow(false); return; }
    try {
      const at = Number(localStorage.getItem(DISMISS_KEY) || 0);
      if (at && Date.now() - at < DISMISS_DAYS * 86400000) { setShow(false); return; }
    } catch { /* show anyway */ }
    setShow(true);
  }, [userId]);

  if (!show || !userId) return null;

  const ar = locale !== 'en';
  const enable = async () => {
    try {
      const result = await Notification.requestPermission();
      if (result === 'granted') {
        window.dispatchEvent(new CustomEvent('subscribe-push', { detail: { userId } }));
      }
    } catch { /* ignore */ }
    setShow(false);
  };
  const later = () => {
    try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch { /* ignore */ }
    setShow(false);
  };

  return (
    <div className="fixed bottom-4 start-4 z-[60] max-w-sm rounded-lg border bg-background p-4 shadow-lg" dir={ar ? 'rtl' : 'ltr'}>
      <div className="flex items-start gap-3">
        <Bell className="h-5 w-5 mt-0.5 text-sky-600" />
        <div className="space-y-2">
          <p className="text-sm font-medium">{ar ? 'فعّل إشعارات المتصفح' : 'Turn on browser notifications'}</p>
          <p className="text-xs text-muted-foreground">
            {ar ? 'استقبل الإشعارات حتى لو الموقع مش مفتوح.' : 'Get notifications even when the site is not open.'}
          </p>
          <div className="flex gap-2">
            <Button size="sm" onClick={enable}>{ar ? 'تفعيل' : 'Enable'}</Button>
            <Button size="sm" variant="outline" onClick={later}>{ar ? 'لاحقاً' : 'Later'}</Button>
          </div>
        </div>
      </div>
    </div>
  );
}

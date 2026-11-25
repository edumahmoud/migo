/**
 * Bridge to the Android app (Capacitor shell). `window.AttendoNative` is injected by the app only.
 * In a normal browser everything here is a no-op.
 */
interface AttendoNativeBridge { getFcmToken?: () => string }

function bridge(): AttendoNativeBridge | null {
  if (typeof window === 'undefined') return null;
  return (window as unknown as { AttendoNative?: AttendoNativeBridge }).AttendoNative ?? null;
}

export function getNativeFcmToken(): string {
  try { return bridge()?.getFcmToken?.() || ''; } catch { return ''; }
}

export const FCM_REGISTERED_KEY = 'attendo_fcm_registered';

/** Unlink this phone from the current user. Call before sign-out, while the session still exists. */
export async function unregisterNativeDevice(accessToken?: string | null): Promise<void> {
  const token = getNativeFcmToken();
  if (!token) return;
  try {
    let headers: Record<string, string> = {};
    if (accessToken) headers = { Authorization: `Bearer ${accessToken}` };
    else { const { getCachedAuthHeaders } = await import('@/lib/client-auth'); headers = await getCachedAuthHeaders(); }
    await fetch('/api/push/register-device', {
      method: 'DELETE',
      keepalive: true,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ token }),
    });
  } catch { /* best effort */ }
  try { localStorage.removeItem(FCM_REGISTERED_KEY); } catch { /* ignore */ }
}

/** Unlink this browser's web-push subscription from the current user. Call before sign-out, while the session still exists.
 *  The browser subscription itself is kept, so the next account that logs in here re-links it (see WebPushPrompt). */
export async function unregisterWebPush(accessToken?: string | null): Promise<void> {
  try {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager?.getSubscription();
    if (!sub) return;
    let headers: Record<string, string> = {};
    if (accessToken) headers = { Authorization: `Bearer ${accessToken}` };
    else { const { getCachedAuthHeaders } = await import('@/lib/client-auth'); headers = await getCachedAuthHeaders(); }
    await fetch('/api/push/unsubscribe', {
      method: 'POST',
      keepalive: true,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ endpoint: sub.endpoint }),
    });
  } catch { /* best effort */ }
}

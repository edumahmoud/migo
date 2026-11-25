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
export async function unregisterNativeDevice(): Promise<void> {
  const token = getNativeFcmToken();
  if (!token) return;
  try {
    const { getCachedAuthHeaders } = await import('@/lib/client-auth');
    const headers = await getCachedAuthHeaders();
    await fetch('/api/push/register-device', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ token }),
    });
  } catch { /* best effort */ }
  try { localStorage.removeItem(FCM_REGISTERED_KEY); } catch { /* ignore */ }
}

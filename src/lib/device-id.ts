// Stable per-install device identifier, used by the audit log and device-based alerts.
// A browser/app cannot read a MAC address, so we create a random id once and keep it in a long-lived cookie
// (attendo_did). The server reads it from every request. attendo_client says whether it is the web site or the app.
// Clearing site data creates a new id; that is expected and is why alerts never block anyone.

const DID = 'attendo_did';
const CLIENT = 'attendo_client';

function readCookie(name: string): string {
  if (typeof document === 'undefined') return '';
  const m = document.cookie.split(';').map((p) => p.trim()).find((p) => p.startsWith(name + '='));
  return m ? decodeURIComponent(m.slice(name.length + 1)) : '';
}

function writeCookie(name: string, value: string) {
  const secure = typeof location !== 'undefined' && location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${name}=${encodeURIComponent(value)}; Max-Age=${60 * 60 * 24 * 730}; Path=/; SameSite=Lax${secure}`;
}

function newId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  } catch {}
  return 'd-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
}

export function ensureDeviceId(): string {
  if (typeof document === 'undefined') return '';
  let id = readCookie(DID);
  if (!id) {
    id = newId();
    writeCookie(DID, id);
  } else {
    writeCookie(DID, id); // refresh expiry
  }
  const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  const isApp = !!cap?.isNativePlatform?.();
  writeCookie(CLIENT, isApp ? 'android' : 'web');
  return id;
}

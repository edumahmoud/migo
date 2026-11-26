// =====================================================
// Audit context: who/where/which device did a request
// =====================================================
// The database triggers that write audit_events read request context from the HTTP headers PostgREST receives
// (x-audit-*). supabaseServer attaches them to every call (see supabase-server.ts).
// The actor is only attached after authenticateRequest verified the caller, so a forged token or header from a
// public/webhook request can never put a made-up actor in the log.
//
// MAC address: neither a browser nor our server can read a client MAC (and Android 10+ randomises it), so it is
// never recorded. Device identity = device_id (random id per browser/app install, sent as the attendo_did cookie)
// + IP + user agent.

import { headers } from 'next/headers';

interface VerifiedActor { id: string; email?: string; t: number }
const verified = new Map<string, VerifiedActor>();
const TTL_MS = 2 * 60 * 1000;

type HeaderReader = { get(name: string): string | null };

function requestKey(h: HeaderReader): string {
  return (
    h.get('x-vercel-id') ||
    h.get('x-request-id') ||
    (h.get('authorization') || '').slice(-48) ||
    (h.get('cookie') || '').slice(-48) ||
    ''
  );
}

export function rememberVerifiedActor(request: { headers: HeaderReader }, user: { id: string; email?: string }): void {
  const key = requestKey(request.headers);
  if (!key) return;
  verified.set(key, { id: user.id, email: user.email, t: Date.now() });
  if (verified.size > 500) {
    const now = Date.now();
    for (const [k, v] of verified) if (now - v.t > TTL_MS) verified.delete(k);
  }
}

const ascii = (s: string | null | undefined, max: number): string =>
  (s || '').replace(/[^\x20-\x7E]/g, '').slice(0, max);

export function readCookie(cookieHeader: string | null, name: string): string {
  if (!cookieHeader) return '';
  const m = cookieHeader.split(';').map((p) => p.trim()).find((p) => p.startsWith(name + '='));
  return m ? decodeURIComponent(m.slice(name.length + 1)) : '';
}

export function clientIp(h: HeaderReader): string {
  const xff = h.get('x-forwarded-for');
  const first = xff ? xff.split(',')[0].trim() : '';
  return ascii(first || h.get('x-real-ip') || '', 64);
}

/** Headers to add to a Supabase request made while handling an incoming request. Null outside a request. */
export async function buildAuditHeaders(): Promise<Record<string, string> | null> {
  try {
    const h = await headers();
    const out: Record<string, string> = {};
    const ip = clientIp(h);
    if (ip) out['x-audit-ip'] = ip;
    const ua = ascii(h.get('user-agent'), 400);
    if (ua) out['x-audit-ua'] = ua;
    const did = ascii(readCookie(h.get('cookie'), 'attendo_did'), 80);
    if (did) out['x-audit-device-id'] = did;
    const client = ascii(readCookie(h.get('cookie'), 'attendo_client'), 20);
    if (client) out['x-audit-client'] = client;
    const rid = ascii(h.get('x-vercel-id') || h.get('x-request-id'), 100);
    if (rid) out['x-audit-request-id'] = rid;
    const actor = verified.get(requestKey(h));
    if (actor && Date.now() - actor.t < TTL_MS) {
      out['x-audit-actor-id'] = actor.id;
      if (actor.email) out['x-audit-actor-email'] = ascii(actor.email, 200);
    }
    return Object.keys(out).length ? out : null;
  } catch {
    return null; // outside a request scope (build, cron)
  }
}

// ─── user agent parsing (kept in sync with the SQL helpers in v160) ───
export function uaDevice(ua: string): string {
  if (!ua) return 'unknown';
  if (/AttenDoApp|; wv\)|Capacitor/i.test(ua)) return 'mobile-app';
  if (/iPad|Tablet/i.test(ua)) return 'tablet';
  if (/Mobi|Android|iPhone/i.test(ua)) return 'mobile';
  if (/bot|curl|python|node|axios|okhttp/i.test(ua)) return 'bot/script';
  return 'desktop';
}
export function uaOs(ua: string): string | null {
  if (!ua) return null;
  if (/Android/i.test(ua)) return 'Android';
  if (/iPhone|iPad|iOS/i.test(ua)) return 'iOS';
  if (/Windows/i.test(ua)) return 'Windows';
  if (/Mac OS X|Macintosh/i.test(ua)) return 'macOS';
  if (/Linux/i.test(ua)) return 'Linux';
  return 'other';
}
export function uaBrowser(ua: string): string | null {
  if (!ua) return null;
  if (/Edg\//i.test(ua)) return 'Edge';
  if (/OPR\/|Opera/i.test(ua)) return 'Opera';
  if (/Chrome\/|CriOS/i.test(ua)) return 'Chrome';
  if (/Firefox\//i.test(ua)) return 'Firefox';
  if (/Safari\//i.test(ua)) return 'Safari';
  return 'other';
}

export interface RequestDevice {
  ip: string | null;
  userAgent: string | null;
  deviceType: string;
  os: string | null;
  browser: string | null;
  deviceId: string | null;
  client: string | null;
  requestId: string | null;
}

export function describeRequestDevice(request: { headers: HeaderReader }): RequestDevice {
  const h = request.headers;
  const ua = ascii(h.get('user-agent'), 400);
  const cookie = h.get('cookie');
  return {
    ip: clientIp(h) || null,
    userAgent: ua || null,
    deviceType: uaDevice(ua),
    os: uaOs(ua),
    browser: uaBrowser(ua),
    deviceId: ascii(readCookie(cookie, 'attendo_did'), 80) || null,
    client: ascii(readCookie(cookie, 'attendo_client'), 20) || null,
    requestId: ascii(h.get('x-vercel-id') || h.get('x-request-id'), 100) || null,
  };
}

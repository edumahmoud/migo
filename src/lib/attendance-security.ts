import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const GPS_RADIUS_METERS = 20;
export const GPS_MAX_ACCURACY_METERS = 50;
export const QR_LIFETIME_SECONDS = 15; // shown QR rotates every 10s; 15s leaves time for the fingerprint prompt
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Server-only module. Never import into a client component.
export function issueAttendanceQr(sessionId: string, startedAt: string, secret: string, now = Date.now()) {
  if (!secret) throw new Error('Missing attendance signing secret');
  const expiresAt = Math.floor(now / 1000) + QR_LIFETIME_SECONDS;
  const payload = Buffer.from(JSON.stringify({ v: 1, s: sessionId, b: startedAt, e: expiresAt, n: randomBytes(16).toString('hex') })).toString('base64url');
  const signature = createHmac('sha256', secret).update(`attendance-qr-v1:${payload}`).digest('base64url');
  return { token: `attendo:v1:${payload}.${signature}`, expiresAt };
}

export function verifyAttendanceQr(token: unknown, sessionId: string, startedAt: string, secret: string, now = Date.now()): boolean {
  if (!secret || typeof token !== 'string' || token.length > 2048 || !token.startsWith('attendo:v1:')) return false;
  const parts = token.slice(11).split('.');
  if (parts.length !== 2) return false;
  try {
    const [payload, signature] = parts;
    const expected = createHmac('sha256', secret).update(`attendance-qr-v1:${payload}`).digest();
    const actual = Buffer.from(signature, 'base64url');
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return false;
    const value = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    const time = Math.floor(now / 1000);
    return value.v === 1 && value.s === sessionId && value.b === startedAt && typeof value.n === 'string'
      && Number.isInteger(value.e) && value.e > time && value.e <= time + QR_LIFETIME_SECONDS;
  } catch { return false; }
}

export function validPosition(lat: unknown, lon: unknown, accuracy: unknown): boolean {
  return typeof lat === 'number' && Number.isFinite(lat) && lat >= -90 && lat <= 90
    && typeof lon === 'number' && Number.isFinite(lon) && lon >= -180 && lon <= 180
    && !(lat === 0 && lon === 0)
    && typeof accuracy === 'number' && Number.isFinite(accuracy) && accuracy > 0 && accuracy <= GPS_MAX_ACCURACY_METERS;
}

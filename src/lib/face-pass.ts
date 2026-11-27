import { createHmac, timingSafeEqual } from 'crypto';

// A short-lived proof that this user passed a live face check for this purpose (server decided, not the phone).
const KEY = () => process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.TELEGRAM_WEBHOOK_SECRET || '';

export const FACE_MATCH_MAX_DISTANCE = 0.5; // euclidean distance between 128-d embeddings; lower is closer

export function distance(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; s += d * d; }
  return Math.sqrt(s);
}

export function validEmbedding(v: unknown): v is number[] {
  return Array.isArray(v) && v.length === 128 && v.every((x) => typeof x === 'number' && Number.isFinite(x) && Math.abs(x) < 10);
}

function sign(payload: string): string {
  return createHmac('sha256', KEY()).update(payload).digest('hex');
}

export function makeFacePass(userId: string, scope: string, minutes = 120): string {
  const exp = Date.now() + minutes * 60_000;
  const p = `${userId}.${scope}.${exp}`;
  return `${exp}.${sign(p)}`;
}

export function checkFacePass(pass: unknown, userId: string, scope: string): boolean {
  if (typeof pass !== 'string' || !KEY()) return false;
  const [expStr, sig] = pass.split('.');
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < Date.now() || !sig) return false;
  const want = sign(`${userId}.${scope}.${exp}`);
  try { return sig.length === want.length && timingSafeEqual(Buffer.from(sig), Buffer.from(want)); } catch { return false; }
}

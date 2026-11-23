// =====================================================
// SCORM content serving helpers (pure): safe paths, MIME types, signed access tokens
// =====================================================

import { createHmac, timingSafeEqual } from 'crypto';

const MIME: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  htm: 'text/html; charset=utf-8',
  xhtml: 'application/xhtml+xml; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  json: 'application/json; charset=utf-8',
  xml: 'application/xml; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  ico: 'image/x-icon',
  bmp: 'image/bmp',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  m4a: 'audio/mp4',
  mp4: 'video/mp4',
  webm: 'video/webm',
  m4v: 'video/mp4',
  pdf: 'application/pdf',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
  eot: 'application/vnd.ms-fontobject',
  swf: 'application/x-shockwave-flash',
  wasm: 'application/wasm',
};

export function contentTypeFor(path: string): string {
  const ext = path.split('?')[0].split('#')[0].split('.').pop()?.toLowerCase() || '';
  return MIME[ext] || 'application/octet-stream';
}

/**
 * Normalize a request path into a zip entry name.
 * Returns null for anything that tries to escape the package or is malformed.
 */
export function safeZipPath(segments: string[] | string): string | null {
  const raw = Array.isArray(segments) ? segments.join('/') : segments;
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null;
  }
  decoded = decoded.split('?')[0].split('#')[0].replace(/\\/g, '/');
  if (decoded.includes('\0')) return null;
  const parts: string[] = [];
  for (const part of decoded.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') return null;
    parts.push(part);
  }
  if (parts.length === 0) return null;
  return parts.join('/');
}

// ─── Signed access tokens (iframes cannot send Authorization headers) ───

export interface ScormContentTokenPayload {
  /** package id */
  p: string;
  /** user id */
  u: string;
  /** expiry, unix seconds */
  e: number;
  /** 1 when the user manages the package (may view drafts) */
  m: 0 | 1;
  /** resource id the token was issued for (used to inject the learner's saved state) */
  r?: string;
  /** 1 when progress is tracked for this user (student), 0 for previews */
  t?: 0 | 1;
}

function secret(): string {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required to sign SCORM content tokens');
  return `scorm-content:${key}`;
}

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function signContentToken(payload: ScormContentTokenPayload, key: string = secret()): string {
  const body = b64url(Buffer.from(JSON.stringify(payload), 'utf8'));
  const sig = b64url(createHmac('sha256', key).update(body).digest());
  return `${body}.${sig}`;
}

export function verifyContentToken(
  token: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
  key: string = secret(),
): ScormContentTokenPayload | null {
  const dot = token.indexOf('.');
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = b64url(createHmac('sha256', key).update(body).digest());
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const json = Buffer.from(body.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    const payload = JSON.parse(json) as ScormContentTokenPayload;
    if (typeof payload.p !== 'string' || typeof payload.u !== 'string' || typeof payload.e !== 'number') return null;
    if (payload.e < nowSeconds) return null;
    return {
      p: payload.p,
      u: payload.u,
      e: payload.e,
      m: payload.m === 1 ? 1 : 0,
      r: typeof payload.r === 'string' ? payload.r : undefined,
      t: payload.t === 1 ? 1 : 0,
    };
  } catch {
    return null;
  }
}

export const CONTENT_TOKEN_TTL_SECONDS = 4 * 60 * 60;

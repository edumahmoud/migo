// =====================================================
// SCORM runtime helpers (pure): status mapping, time math, number clamping
// =====================================================

import type { ScormCompletionStatus, ScormSuccessStatus } from '@/lib/scorm-types';

export interface NormalizedStatus {
  completion: ScormCompletionStatus;
  success: ScormSuccessStatus;
}

/**
 * Map a SCORM 1.2 cmi.core.lesson_status to the stored completion/success pair.
 * Accepts both "not attempted" (spec) and "not_attempted" (stored form).
 */
export function mapLessonStatus12(raw: string | null | undefined): NormalizedStatus {
  const v = String(raw ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  switch (v) {
    case 'passed':
      return { completion: 'completed', success: 'passed' };
    case 'failed':
      return { completion: 'incomplete', success: 'failed' };
    case 'completed':
      return { completion: 'completed', success: 'unknown' };
    case 'incomplete':
    case 'browsed':
      return { completion: 'incomplete', success: 'unknown' };
    case 'not_attempted':
      return { completion: 'not_attempted', success: 'unknown' };
    default:
      return { completion: 'unknown', success: 'unknown' };
  }
}

/** Reverse mapping: stored values to a valid SCORM 1.2 lesson_status. */
export function toLessonStatus12(completion: string | null | undefined, success: string | null | undefined): string {
  if (success === 'passed') return 'passed';
  if (success === 'failed') return 'failed';
  if (completion === 'completed') return 'completed';
  if (completion === 'incomplete') return 'incomplete';
  return 'not attempted';
}

export function normalizeCompletion2004(raw: string | null | undefined): ScormCompletionStatus {
  const v = String(raw ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (v === 'completed' || v === 'incomplete' || v === 'not_attempted' || v === 'unknown') return v;
  return 'unknown';
}

export function normalizeSuccess2004(raw: string | null | undefined): ScormSuccessStatus {
  const v = String(raw ?? '').trim().toLowerCase();
  if (v === 'passed' || v === 'failed' || v === 'unknown') return v;
  return 'unknown';
}

// ─── Time ───

/** Parse SCORM 1.2 "HHHH:MM:SS.SS" or ISO 8601 "PT1H2M3.5S" / "P1DT2H" into seconds. NaN if invalid. */
export function parseScormTime(raw: string | null | undefined): number {
  const v = String(raw ?? '').trim();
  if (!v) return NaN;
  const clock = v.match(/^(\d{1,4}):([0-5]?\d):([0-5]?\d)(?:\.(\d{1,2}))?$/);
  if (clock) {
    return Number(clock[1]) * 3600 + Number(clock[2]) * 60 + Number(clock[3]) + (clock[4] ? Number(`0.${clock[4]}`) : 0);
  }
  const iso = v.match(/^P(?:(\d+(?:\.\d+)?)Y)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i);
  if (iso && v.length > 1 && !/^PT?$/i.test(v)) {
    const [, y, mo, d, h, mi, s] = iso.map((x) => (x === undefined ? 0 : Number(x)));
    return y * 31536000 + mo * 2592000 + d * 86400 + h * 3600 + mi * 60 + s;
  }
  return NaN;
}

/** Format seconds as "HH:MM:SS" (hours can exceed 99). */
export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.round(Number.isFinite(totalSeconds) ? totalSeconds : 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

/** Normalize any accepted SCORM time into "HH:MM:SS"; falls back to 00:00:00. */
export function normalizeSessionTime(raw: string | null | undefined): string {
  const secs = parseScormTime(raw);
  return Number.isNaN(secs) ? '00:00:00' : formatClock(secs);
}

export function addTimes(totalRaw: string | null | undefined, sessionRaw: string | null | undefined): string {
  const a = parseScormTime(totalRaw);
  const b = parseScormTime(sessionRaw);
  return formatClock((Number.isNaN(a) ? 0 : a) + (Number.isNaN(b) ? 0 : b));
}

/** Seconds -> ISO 8601 duration for SCORM 2004 (cmi.total_time). */
export function toIsoDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(Number.isFinite(totalSeconds) ? totalSeconds : 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `PT${h}H${m}M${sec}S`;
}

// ─── Numbers ───

/** Convert to a finite number or null; clamp into [min, max] (column is DECIMAL(5,2)). */
export function cleanScore(value: unknown, min = -999.99, max = 999.99): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : parseFloat(String(value));
  if (!Number.isFinite(n)) return null;
  return Math.round(Math.min(max, Math.max(min, n)) * 100) / 100;
}

/** Scaled scores are limited to [-1, 1] by the SCORM 2004 spec. */
export function cleanScaled(value: unknown): number | null {
  return cleanScore(value, -1, 1);
}

export const MAX_SUSPEND_DATA = 65536;

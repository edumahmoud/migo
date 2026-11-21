// =====================================================
// Distributed rate limiting (Postgres-backed) — SERVER ONLY
// =====================================================
// This module imports supabaseServer (which uses next/headers), so it must
// NEVER be imported from client components or from modules they pull in
// (api-security.ts stays client-safe; that is why this lives apart).
// Import it only from route handlers / server code.

import { NextRequest } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import {
  checkRateLimit,
  RATE_LIMIT_MAX_REQUESTS,
  RATE_LIMIT_WINDOW_MS,
} from '@/lib/api-security';

export interface DistributedRateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
  /** 'distributed' when the Postgres counter answered, 'memory-fallback' otherwise */
  backend: 'distributed' | 'memory-fallback';
}

/**
 * Rate limit backed by the shared Postgres counter (migration
 * 20261121194500_distributed_rate_limits.sql). Unlike the in-memory
 * checkRateLimit, counters survive cold starts and are shared across all
 * serverless instances, so limits actually hold on Vercel.
 *
 * Fails CLOSED-ish: if the database counter is unreachable, it falls back
 * to the in-memory limiter (still protective within one instance) and
 * reports backend 'memory-fallback' so callers can log the degradation.
 *
 * Use this on sensitive endpoints: OTP send/verify, login-adjacent lookups,
 * payment initiation. Requires the rate_limits migration to be applied.
 */
export async function checkRateLimitDistributed(
  request: NextRequest,
  options?: { userId?: string; maxRequests?: number; windowMs?: number; scope?: string },
): Promise<DistributedRateLimitResult> {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const baseKey = options?.userId ? `user:${options.userId}` : `ip:${ip}`;
  const key = options?.scope ? `${options.scope}:${baseKey}` : baseKey;
  const maxRequests = options?.maxRequests ?? RATE_LIMIT_MAX_REQUESTS;
  const windowMs = options?.windowMs ?? RATE_LIMIT_WINDOW_MS;

  try {
    const { data, error } = await supabaseServer.rpc('check_rate_limit', {
      p_key: key,
      p_max: maxRequests,
      p_window_ms: windowMs,
    });

    const row = Array.isArray(data) ? data[0] : data;
    if (error || !row) {
      throw new Error(error?.message || 'check_rate_limit returned no row');
    }

    return {
      allowed: Boolean(row.allowed),
      remaining: Number(row.remaining ?? 0),
      retryAfterMs: Number(row.retry_after_ms ?? 0),
      backend: 'distributed',
    };
  } catch (err) {
    console.warn('[rate-limit] distributed counter unavailable — falling back to in-memory', {
      error: err instanceof Error ? err.message : String(err),
      key,
    });
    const fallback = checkRateLimit(request, options?.userId, maxRequests);
    return { ...fallback, backend: 'memory-fallback' };
  }
}

// =====================================================
// API Security Utilities
// =====================================================

import { NextRequest, NextResponse } from 'next/server';

// --- Rate Limiting (in-memory) ---

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

const rateLimitMap = new Map<string, RateLimitEntry>();

const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 10;

/** Check rate limit by IP. Returns { allowed, remaining, retryAfterMs } */
export function checkRateLimit(request: NextRequest): {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
} {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const now = Date.now();

  // Clean up expired entries periodically
  if (rateLimitMap.size > 1000) {
    for (const [key, entry] of rateLimitMap.entries()) {
      if (now > entry.resetTime) {
        rateLimitMap.delete(key);
      }
    }
  }

  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetTime) {
    rateLimitMap.set(ip, { count: 1, resetTime: now + RATE_LIMIT_WINDOW_MS });
    return { allowed: true, remaining: RATE_LIMIT_MAX_REQUESTS - 1, retryAfterMs: 0 };
  }

  if (entry.count >= RATE_LIMIT_MAX_REQUESTS) {
    const retryAfterMs = entry.resetTime - now;
    return { allowed: false, remaining: 0, retryAfterMs };
  }

  entry.count++;
  return { allowed: true, remaining: RATE_LIMIT_MAX_REQUESTS - entry.count, retryAfterMs: 0 };
}

/** Create rate limit headers for the response */
export function getRateLimitHeaders(remaining: number, retryAfterMs: number): Record<string, string> {
  const headers: Record<string, string> = {
    'X-RateLimit-Remaining': String(remaining),
    'X-RateLimit-Limit': String(RATE_LIMIT_MAX_REQUESTS),
  };
  if (retryAfterMs > 0) {
    headers['Retry-After'] = String(Math.ceil(retryAfterMs / 1000));
  }
  return headers;
}

// --- Request Validation ---

const MAX_CONTENT_LENGTH = 1_000_000; // 1MB max request body (default)
const MAX_CONTENT_LENGTH_LARGE = 5_000_000; // 5MB for endpoints that handle large text (summaries, quizzes)

/** Validate request: content-type, body size. Returns error response or null if valid */
export function validateRequest(request: NextRequest, options?: { largeBody?: boolean }): NextResponse | null {
  const maxLen = options?.largeBody ? MAX_CONTENT_LENGTH_LARGE : MAX_CONTENT_LENGTH;

  // Content-Type validation
  const contentType = request.headers.get('content-type');
  if (!contentType || (!contentType.includes('application/json') && !contentType.includes('multipart/form-data'))) {
    return NextResponse.json(
      { success: false, error: 'يجب أن يكون نوع المحتوى application/json' },
      { status: 415 }
    );
  }

  // Content-Length validation
  const contentLength = request.headers.get('content-length');
  if (contentLength && parseInt(contentLength, 10) > maxLen) {
    return NextResponse.json(
      { success: false, error: 'حجم الطلب كبير جداً' },
      { status: 413 }
    );
  }

  return null;
}

// --- Input Sanitization ---

/** Sanitize a string input: trim, limit length, strip HTML */
export function sanitizeString(input: unknown, maxLength: number = 50000): string {
  if (typeof input !== 'string') return '';
  return input.replace(/<[^>]*>/g, '').trim().substring(0, maxLength);
}

/** Generic safe error response that doesn't leak internals */
export function safeErrorResponse(message: string, status: number = 500): NextResponse {
  return NextResponse.json(
    { success: false, error: message },
    { status }
  );
}

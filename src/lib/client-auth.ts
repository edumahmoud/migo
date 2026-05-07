// =====================================================
// Client-Side Authentication Helpers
// =====================================================
// These utilities handle the common issue of Supabase auth
// session hydration on mobile PWA, where localStorage reads
// can take 1-5 seconds before the session is available.

import { supabase } from '@/lib/supabase';

/**
 * Wait for a valid Supabase auth session with exponential backoff.
 *
 * On mobile PWA (standalone mode), the Supabase client needs to:
 *   1. Read the session from localStorage
 *   2. Validate the JWT with Supabase servers
 *   3. Potentially refresh an expired token
 *
 * This process can take 1-5 seconds on mobile devices.
 * Without waiting, getSession() returns null and all
 * authenticated API calls (file uploads, data mutations) fail.
 *
 * If the session appears expired or stale, attempts to refresh it.
 *
 * @param maxWaitMs Maximum time to wait in milliseconds (default: 15000 for mobile safety)
 * @returns The access_token string, or empty string if no session found
 */
export async function waitForSession(maxWaitMs = 15000): Promise<string> {
  const startTime = Date.now();
  const delays = [500, 800, 1200, 1800, 2500, 3500]; // progressive backoff
  let attempt = 0;

  while (Date.now() - startTime < maxWaitMs) {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token || '';
      if (token) {
        // Check if token is about to expire (within 60 seconds)
        // If so, try to refresh it to avoid using a stale token
        if (session.expires_at) {
          const expiresInSeconds = session.expires_at - Math.floor(Date.now() / 1000);
          if (expiresInSeconds < 60) {
            console.warn(`[waitForSession] Token expires in ${expiresInSeconds}s, refreshing...`);
            try {
              const { data: { session: refreshedSession } } = await supabase.auth.refreshSession();
              if (refreshedSession?.access_token) {
                console.log(`[waitForSession] Token refreshed successfully`);
                return refreshedSession.access_token;
              }
            } catch (refreshErr) {
              console.warn('[waitForSession] Token refresh failed, using current token:', refreshErr);
            }
          }
        }
        if (attempt > 0) {
          console.log(`[waitForSession] Got token after ${attempt} retries, ${Date.now() - startTime}ms`);
        }
        return token;
      }

      // No token found — try to refresh the session explicitly
      // This helps when the session is stored but not yet hydrated
      if (attempt === 1) {
        try {
          const { data: { session: refreshedSession } } = await supabase.auth.refreshSession();
          if (refreshedSession?.access_token) {
            console.log('[waitForSession] Got token via refreshSession()');
            return refreshedSession.access_token;
          }
        } catch (refreshErr) {
          // Refresh failed, continue with retry loop
        }
      }
    } catch (err) {
      console.warn(`[waitForSession] getSession() threw error (attempt ${attempt + 1}):`, err);
    }

    const delay = delays[Math.min(attempt, delays.length - 1)];
    console.warn(`[waitForSession] No token yet (attempt ${attempt + 1}), waiting ${delay}ms...`);
    await new Promise(resolve => setTimeout(resolve, delay));
    attempt++;
  }

  // Last resort: try refreshSession one more time
  try {
    const { data: { session } } = await supabase.auth.refreshSession();
    if (session?.access_token) {
      console.log('[waitForSession] Got token via final refreshSession() attempt');
      return session.access_token;
    }
  } catch {
    // Give up
  }

  console.error('[waitForSession] Failed to get session after', maxWaitMs, 'ms');
  return '';
}

/**
 * Get auth headers for API requests, with session retry for mobile PWA.
 *
 * Usage:
 *   const headers = await getAuthHeaders();
 *   const res = await fetch('/api/...', { method: 'POST', headers, body: ... });
 *
 * @param maxWaitMs Maximum time to wait for session (default: 15000)
 * @returns Object with Authorization header and Content-Type if json is true
 */
export async function getAuthHeaders(
  maxWaitMs = 15000,
  options: { json?: boolean; userId?: string } = {}
): Promise<Record<string, string>> {
  const token = await waitForSession(maxWaitMs);
  const headers: Record<string, string> = {};

  if (options.json !== false) {
    headers['Content-Type'] = 'application/json';
  }

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  if (options.userId) {
    headers['x-user-id'] = options.userId;
  }

  return headers;
}

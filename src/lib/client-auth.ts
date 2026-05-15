// =====================================================
// Client-Side Authentication Helpers
// =====================================================
// These utilities handle the common issue of Supabase auth
// session hydration on mobile PWA, where localStorage reads
// can take 1-5 seconds before the session is available.

import { supabase } from '@/lib/supabase';

// ─── Cached auth token ───
// getSession() can hang on mobile/PWA after the app has been in the background.
// Caching the token avoids repeated getSession() calls that may never resolve.
let cachedAuthToken: string | null = null;
let cachedAuthExpiry = 0;
const AUTH_CACHE_TTL = 300000; // 5 minutes

// ─── Auth state listener (initialized once) ───
let authListenerInitialized = false;

/**
 * Initialize the auth state change listener to keep the token cache fresh.
 * This should be called once in a top-level component (e.g. the dashboard or layout).
 * It is idempotent — calling it multiple times has no effect.
 */
export function initAuthCacheListener(): void {
  if (authListenerInitialized) return;
  authListenerInitialized = true;

  try {
    supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.access_token) {
        cachedAuthToken = session.access_token;
        cachedAuthExpiry = Date.now() + AUTH_CACHE_TTL;
      } else {
        cachedAuthToken = null;
        cachedAuthExpiry = 0;
      }
    });
  } catch {
    // Listener setup failed — cache will be populated on first getCachedAuthHeaders call
  }
}

/**
 * Get cached auth headers for API requests.
 *
 * Instead of calling getSession() on every request (which can hang on mobile/PWA),
 * this function checks a module-level cache first. The cache is kept fresh by the
 * auth state change listener (see initAuthCacheListener).
 *
 * If the cache is empty or expired, it falls back to getSession() with error handling.
 * If getSession() fails or hangs, it returns whatever cached token is available.
 *
 * Usage:
 *   const headers = await getCachedAuthHeaders();
 *   const res = await fetch('/api/...', { method: 'POST', headers, body: ... });
 */
export async function getCachedAuthHeaders(): Promise<Record<string, string>> {
  // Check cache first — this is the fast path that avoids getSession() entirely
  if (cachedAuthToken && Date.now() < cachedAuthExpiry) {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${cachedAuthToken}`,
    };
  }

  // Cache miss or expired — try to get a fresh token
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token || '';
    if (token) {
      cachedAuthToken = token;
      cachedAuthExpiry = Date.now() + AUTH_CACHE_TTL;
    }
    return {
      'Content-Type': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    };
  } catch {
    // getSession() failed or hung — try with whatever cached token we have
    if (cachedAuthToken) {
      return {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${cachedAuthToken}`,
      };
    }
    return { 'Content-Type': 'application/json' };
  }
}

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
  // Check cache first — avoid the expensive retry loop if we already have a token
  if (cachedAuthToken && Date.now() < cachedAuthExpiry) {
    return cachedAuthToken;
  }

  const startTime = Date.now();
  const delays = [500, 800, 1200, 1800, 2500, 3500]; // progressive backoff
  let attempt = 0;

  while (Date.now() - startTime < maxWaitMs) {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token || '';
      if (token) {
        // Update cache
        cachedAuthToken = token;
        cachedAuthExpiry = Date.now() + AUTH_CACHE_TTL;

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
                cachedAuthToken = refreshedSession.access_token;
                cachedAuthExpiry = Date.now() + AUTH_CACHE_TTL;
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
            cachedAuthToken = refreshedSession.access_token;
            cachedAuthExpiry = Date.now() + AUTH_CACHE_TTL;
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
      cachedAuthToken = session.access_token;
      cachedAuthExpiry = Date.now() + AUTH_CACHE_TTL;
      return session.access_token;
    }
  } catch {
    // Give up
  }

  // If all else failed, try returning whatever we have cached
  if (cachedAuthToken) {
    console.warn('[waitForSession] Using cached token as fallback');
    return cachedAuthToken;
  }

  console.error('[waitForSession] Failed to get session after', maxWaitMs, 'ms');
  return '';
}

/**
 * Get auth headers for API requests, with session retry for mobile PWA.
 *
 * This function uses waitForSession() which has exponential backoff.
 * For most API calls, prefer getCachedAuthHeaders() which is faster
 * and avoids the getSession() hang issue on mobile/PWA.
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

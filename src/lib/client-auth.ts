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
        if (attempt > 0) {
          console.log(`[waitForSession] Got token after ${attempt} retries, ${Date.now() - startTime}ms`);
        }
        return token;
      }
    } catch (err) {
      console.warn(`[waitForSession] getSession() threw error (attempt ${attempt + 1}):`, err);
    }

    const delay = delays[Math.min(attempt, delays.length - 1)];
    console.warn(`[waitForSession] No token yet (attempt ${attempt + 1}), waiting ${delay}ms...`);
    await new Promise(resolve => setTimeout(resolve, delay));
    attempt++;
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

// =====================================================
// AttenDo - Session Tracker Utility
// Tracks user sessions, enforces single-session concurrency
// =====================================================

import { supabase, isSupabaseConfigured } from '@/lib/supabase';

const SESSION_STORAGE_KEY = 'attendo_session_id';
const SESSION_CHECK_INTERVAL_MS = 60_000; // 60 seconds

/**
 * Generate a device fingerprint from browser properties.
 * Only runs on the client side.
 */
function generateFingerprint(): string {
  if (typeof window === 'undefined') return '';

  const components = [
    navigator.userAgent,
    `${screen.width}x${screen.height}`,
    navigator.language,
    String(new Date().getTimezoneOffset()),
  ];
  const raw = components.join('|');

  // Simple hash function
  let hash = 0;
  for (let i = 0; i < raw.length; i++) {
    const char = raw.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}

/**
 * Register a new session for the user.
 * 
 * DISABLED: Single-session enforcement is currently disabled.
 * This only stores a session record without deactivating other sessions.
 */
export async function registerSession(userId: string): Promise<void> {
  if (typeof window === 'undefined') return;
  if (!isSupabaseConfigured) return;

  try {
    const fingerprint = generateFingerprint();
    if (!fingerprint) return;

    // Insert new session record (without deactivating others)
    const { data, error } = await supabase
      .from('user_sessions')
      .insert({
        user_id: userId,
        device_fingerprint: fingerprint,
        is_active: true,
      })
      .select('id')
      .single();

    if (error) {
      console.warn('[SessionTracker] Failed to register session:', error.message);
      return;
    }

    // Store session ID in sessionStorage for later reference
    sessionStorage.setItem(SESSION_STORAGE_KEY, data.id);

    // NOTE: We intentionally do NOT deactivate other sessions
    // (single-session enforcement is disabled)
  } catch (err) {
    console.warn('[SessionTracker] registerSession error:', err);
  }
}

/**
 * Validate that the current session is still the active one.
 * Returns false if another session has taken over (user logged in from another device).
 * 
 * DISABLED: Single-session enforcement is currently disabled.
 * This always returns true to allow multiple simultaneous sessions.
 */
export async function validateSession(userId: string): Promise<boolean> {
  // Feature disabled — always allow
  return true;
}

/**
 * End the current session by marking it as inactive.
 * Called during sign-out.
 */
export async function endSession(): Promise<void> {
  if (typeof window === 'undefined') return;
  if (!isSupabaseConfigured) {
    sessionStorage.removeItem(SESSION_STORAGE_KEY);
    return;
  }

  try {
    const sessionId = sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (!sessionId) return;

    await supabase
      .from('user_sessions')
      .update({ is_active: false })
      .eq('id', sessionId);

    // Clear session ID from sessionStorage
    sessionStorage.removeItem(SESSION_STORAGE_KEY);
  } catch (err) {
    // Don't block sign-out if session tracking fails
    console.warn('[SessionTracker] endSession error:', err);
    // Still clean up sessionStorage
    sessionStorage.removeItem(SESSION_STORAGE_KEY);
  }
}

/**
 * Start periodic session validation.
 * Returns a cleanup function that clears the interval.
 */
export function startSessionValidation(
  userId: string,
  onSessionInvalidated: () => void
): () => void {
  if (typeof window === 'undefined') return () => {};
  if (!isSupabaseConfigured) return () => {};

  const intervalId = setInterval(async () => {
    const isValid = await validateSession(userId);
    if (!isValid) {
      clearInterval(intervalId);
      onSessionInvalidated();
    }
  }, SESSION_CHECK_INTERVAL_MS);

  return () => clearInterval(intervalId);
}

'use client';

import { useEffect, useRef, useCallback } from 'react';
import { setPWABusyOperation, checkAndApplyPendingSWReload } from '@/components/shared/sw-registration';

/**
 * usePWALifecycle
 *
 * Manages PWA lifecycle events to protect user operations from page reloads
 * and state loss on mobile devices.
 *
 * PROBLEMS SOLVED:
 * 1. When user opens native file picker on Android PWA, the app goes to background.
 *    Android may terminate the WebView process. When user returns, the app reloads
 *    from start_url ("/") instead of the current page, losing all form state.
 * 2. Service Worker updates trigger controllerchange → page reload, destroying modals.
 * 3. White screen detection script may reload during slow hydration after returning
 *    from background.
 * 4. After Android kills the PWA process and restores it, the page loads from scratch.
 *    sessionStorage is LOST (tied to the process), so any state saved there is gone.
 *
 * SOLUTION:
 * - Uses localStorage instead of sessionStorage (survives process kills!)
 * - Sets a global busy flag when modals/forms are open (also persisted to localStorage)
 * - Saves component state to localStorage when app goes to background
 * - Restores state on component MOUNT if saved state exists (handles process kill)
 * - Checks for deferred SW reloads when modals close (with reload-loop prevention)
 */
interface PWALifecycleOptions {
  /** Unique key for localStorage (include dynamic IDs like subjectId) */
  stateKey: string;
  /** Whether the user is in a busy operation (modal open, form active, etc.) */
  isBusy: boolean;
  /** Function to serialize current state for saving */
  onSave?: () => Record<string, unknown>;
  /** Function to restore state from saved data */
  onRestore?: (state: Record<string, unknown>) => void;
  /** Maximum age of saved state in ms before it's considered stale (default: 30 minutes) */
  maxAgeMs?: number;
}

// Prefix for localStorage keys
const STATE_PREFIX = '_pwa_state_';

export function usePWALifecycle({
  stateKey,
  isBusy,
  onSave,
  onRestore,
  maxAgeMs = 30 * 60 * 1000,
}: PWALifecycleOptions) {
  const isBusyRef = useRef(isBusy);
  const onSaveRef = useRef(onSave);
  const onRestoreRef = useRef(onRestore);
  const hasRestoredOnMount = useRef(false);

  // Keep refs in sync with latest values (avoid stale closures)
  useEffect(() => {
    isBusyRef.current = isBusy;
    onSaveRef.current = onSave;
    onRestoreRef.current = onRestore;
  }, [isBusy, onSave, onRestore]);

  // ─── Set/clear the global busy flag ───
  useEffect(() => {
    setPWABusyOperation(isBusy);

    // When becoming not-busy, check if there's a pending SW reload
    // (but only after the initial mount to avoid triggering it too early)
    if (!isBusy && hasRestoredOnMount.current) {
      checkAndApplyPendingSWReload();
    }

    return () => {
      // Clean up: clear busy flag when component unmounts while busy
      if (isBusyRef.current) {
        setPWABusyOperation(false);
      }
    };
  }, [isBusy]);

  // ─── Save state to localStorage ───
  // CRITICAL: Uses localStorage instead of sessionStorage because sessionStorage
  // is LOST when Android kills the PWA process. localStorage persists across
  // process kills, so the user's state can be restored when the app restarts.
  const saveState = useCallback(() => {
    if (!onSaveRef.current) return;
    try {
      const state = onSaveRef.current();
      const entry = { data: state, _ts: Date.now() };
      localStorage.setItem(`${STATE_PREFIX}${stateKey}`, JSON.stringify(entry));
      console.log(`[PWALifecycle] Saved state for "${stateKey}" to localStorage`);
    } catch (err) {
      console.warn(`[PWALifecycle] Failed to save state for "${stateKey}":`, err);
    }
  }, [stateKey]);

  // ─── Restore state from localStorage ───
  const restoreState = useCallback((): Record<string, unknown> | null => {
    try {
      const raw = localStorage.getItem(`${STATE_PREFIX}${stateKey}`);
      if (!raw) return null;

      const entry = JSON.parse(raw);
      // Check staleness
      if (entry._ts && Date.now() - entry._ts > maxAgeMs) {
        console.log(`[PWALifecycle] Saved state for "${stateKey}" is stale, discarding`);
        localStorage.removeItem(`${STATE_PREFIX}${stateKey}`);
        return null;
      }

      console.log(`[PWALifecycle] Restoring state for "${stateKey}" from localStorage`);
      if (onRestoreRef.current && entry.data) {
        onRestoreRef.current(entry.data);
      }
      return entry.data;
    } catch (err) {
      console.warn(`[PWALifecycle] Failed to restore state for "${stateKey}":`, err);
      return null;
    }
  }, [stateKey, maxAgeMs]);

  // ─── Clear saved state ───
  const clearSavedState = useCallback(() => {
    try {
      localStorage.removeItem(`${STATE_PREFIX}${stateKey}`);
    } catch {}
  }, [stateKey]);

  // ─── CRITICAL FIX: Restore state on component MOUNT ───
  // When Android kills the PWA process and restores it, the page loads from scratch.
  // sessionStorage is LOST, but localStorage persists.
  // This effect runs ONCE on mount and checks if there's saved state in localStorage.
  // If there is, it means the app was interrupted (process kill, crash, etc.) and we
  // should restore the user's previous state (re-open the modal, fill form fields, etc.)
  useEffect(() => {
    if (hasRestoredOnMount.current) return; // Only run once
    hasRestoredOnMount.current = true;

    // Small delay to allow React state setters to be ready
    const timer = setTimeout(() => {
      const restored = restoreState();
      if (restored) {
        console.log(`[PWALifecycle] Restored state on mount for "${stateKey}" (process was likely killed)`);
        // Clear the busy flag from localStorage since we've restored the state
        // (the modal will re-open and set it again via its isBusy prop)
        try {
          localStorage.removeItem('_attendo_busy');
        } catch {}
        // Check for pending SW reload — but DON'T trigger it immediately
        // because the user just had their state restored (modal re-opened).
        // The pending reload will be checked when the modal closes.
      }
    }, 150); // Slightly longer delay to ensure React hydration

    return () => clearTimeout(timer);
   
  }, []); // Intentionally empty — run once on mount

  // ─── Auto-save when app goes to background (visibilitychange + pagehide) ───
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden' && isBusyRef.current) {
        // App going to background while user is in a busy operation — save state!
        saveState();
      }
    };

    const handlePageHide = () => {
      if (isBusyRef.current) {
        saveState();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pagehide', handlePageHide);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pagehide', handlePageHide);
    };
  }, [saveState]);

  // ─── Auto-restore when app comes back from background (pageshow with persisted) ───
  useEffect(() => {
    const handlePageShow = (e: Event) => {
      const pageEvent = e as PageTransitionEvent;
      if (pageEvent.persisted) {
        // Page was restored from bfcache — try to restore state
        console.log(`[PWALifecycle] Page restored from bfcache, checking saved state for "${stateKey}"`);
        restoreState();
      }
    };

    window.addEventListener('pageshow', handlePageShow);
    return () => window.removeEventListener('pageshow', handlePageShow);
  }, [stateKey, restoreState]);

  return { saveState, restoreState, clearSavedState };
}

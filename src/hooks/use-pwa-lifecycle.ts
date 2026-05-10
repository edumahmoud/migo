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
 *
 * SOLUTION:
 * - Sets a global busy flag when modals/forms are open
 * - Saves component state to sessionStorage when app goes to background
 * - Restores state when app comes back to foreground
 * - Checks for deferred SW reloads when modals close
 *
 * Usage:
 *   const { saveState, restoreState, clearSavedState } = usePWALifecycle({
 *     stateKey: 'lecture-create-{subjectId}',
 *     isBusy: createOpen,
 *     onSave: () => ({ title: newTitle, desc: newDesc, ... }),
 *     onRestore: (state) => { setNewTitle(state.title); ... },
 *   });
 */
interface PWALifecycleOptions {
  /** Unique key for sessionStorage (include dynamic IDs like subjectId) */
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
    if (!isBusy) {
      checkAndApplyPendingSWReload();
    }

    return () => {
      // Clean up: clear busy flag when component unmounts while busy
      if (isBusyRef.current) {
        setPWABusyOperation(false);
      }
    };
  }, [isBusy]);

  // ─── Save state to sessionStorage ───
  const saveState = useCallback(() => {
    if (!onSaveRef.current) return;
    try {
      const state = onSaveRef.current();
      const entry = { data: state, _ts: Date.now() };
      sessionStorage.setItem(`_pwa_state_${stateKey}`, JSON.stringify(entry));
      console.log(`[PWALifecycle] Saved state for "${stateKey}"`);
    } catch (err) {
      console.warn(`[PWALifecycle] Failed to save state for "${stateKey}":`, err);
    }
  }, [stateKey]);

  // ─── Restore state from sessionStorage ───
  const restoreState = useCallback((): Record<string, unknown> | null => {
    try {
      const raw = sessionStorage.getItem(`_pwa_state_${stateKey}`);
      if (!raw) return null;

      const entry = JSON.parse(raw);
      // Check staleness
      if (entry._ts && Date.now() - entry._ts > maxAgeMs) {
        console.log(`[PWALifecycle] Saved state for "${stateKey}" is stale, discarding`);
        sessionStorage.removeItem(`_pwa_state_${stateKey}`);
        return null;
      }

      console.log(`[PWALifecycle] Restoring state for "${stateKey}"`);
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
      sessionStorage.removeItem(`_pwa_state_${stateKey}`);
    } catch {}
  }, [stateKey]);

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

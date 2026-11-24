'use client';

import { useEffect, useRef } from 'react';
import { NavigationHistory } from '@/lib/navigation-history';

export interface UseNavigationHistoryOptions {
  /** Whether tracking is active (e.g. a user is signed in). */
  enabled: boolean;
  /**
   * Serialized identity of the current logical location (stable key order),
   * or null while the location is unknown. Changes push a history entry.
   */
  snapshot: string | null;
  /** Apply a previously seen serialized snapshot (system back button). */
  onRestore: (snapshot: string) => void;
  /** Back pressed on the root location — show "press back again to exit". */
  onExitWarning: () => void;
}

/**
 * Mirrors the app's logical navigation onto the browser history stack so the
 * system back button steps back through screens instead of exiting the
 * installed PWA. See src/lib/navigation-history.ts for the state machine.
 */
export function useNavigationHistory({
  enabled,
  snapshot,
  onRestore,
  onExitWarning,
}: UseNavigationHistoryOptions): void {
  const coreRef = useRef<NavigationHistory | null>(null);
  const callbacksRef = useRef({ onRestore, onExitWarning });
  callbacksRef.current = { onRestore, onExitWarning };

  // Start/stop the tracker. It lives for the whole signed-in session.
  useEffect(() => {
    if (!enabled || snapshot === null || typeof window === 'undefined') return;

    const core = new NavigationHistory({
      adapter: {
        replaceState: (state) => window.history.replaceState(state, ''),
        pushState: (state) => window.history.pushState(state, ''),
        back: () => window.history.back(),
      },
      onRestore: (snap) => callbacksRef.current.onRestore(snap),
      onExitWarning: () => callbacksRef.current.onExitWarning(),
    });
    core.start(snapshot);
    coreRef.current = core;

    const handlePopState = (event: PopStateEvent) => core.handlePop(event.state);
    window.addEventListener('popstate', handlePopState);

    return () => {
      window.removeEventListener('popstate', handlePopState);
      core.stop();
      coreRef.current = null;
    };
    // The tracker anchors once per session; later locations flow through
    // the navigate effect below.
  }, [enabled]);

  // Mirror logical location changes onto the history stack.
  useEffect(() => {
    if (snapshot === null) return;
    coreRef.current?.navigate(snapshot);
  }, [snapshot]);
}

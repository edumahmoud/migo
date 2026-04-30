'use client';

import { useState, useCallback, useRef, useEffect } from 'react';

/**
 * Hook to track which sections have been mounted.
 * Implements a "keep-alive" pattern: sections are mounted lazily on first visit,
 * then kept mounted (hidden with CSS) when navigating away.
 * This prevents the expensive unmount/remount cycle that was causing navigation freezes.
 *
 * Uses the "adjusting state during render" pattern (instead of useEffect + setState)
 * to avoid cascading renders and satisfy the react-hooks/set-state-in-effect lint rule.
 * See: https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes
 *
 * Usage:
 *   const { isMounted, isActive } = useMountedSections(activeSection);
 *   // isMounted('chat') → true after user visits chat for the first time
 *   // isActive('chat') → true only when chat is the current section
 */
export function useMountedSections(activeSection: string) {
  const [mountedSections, setMountedSections] = useState<Set<string>>(() => new Set([activeSection]));

  // Adjust state during render (before any early returns) when activeSection changes.
  // This is the recommended React pattern for derived state that grows over time.
  if (!mountedSections.has(activeSection)) {
    const next = new Set(mountedSections);
    next.add(activeSection);
    setMountedSections(next);
  }

  const isMounted = useCallback(
    (section: string) => mountedSections.has(section),
    [mountedSections]
  );

  const isActive = useCallback(
    (section: string) => section === activeSection,
    [activeSection]
  );

  return { isMounted, isActive, mountedSections };
}

/**
 * Hook that provides a navigation-aware active section with ZERO desync.
 *
 * PROBLEM:
 *   When the user clicks a sidebar item:
 *     1. Zustand store updates instantly (synchronous)
 *     2. usePathname() updates 1-2 render cycles later (async)
 *   The old `pathnameSection || storeSection` pattern was broken because
 *   `pathnameSection` is always truthy (e.g. 'dashboard'), so during the
 *   transition window the stale pathname value won and the store was ignored.
 *
 * SOLUTION:
 *   Store = SOLE source of truth for rendering (instant CSS toggle).
 *   Pathname is synced to the store ONLY when the URL changes independently
 *   (browser back/forward, page refresh) — NOT during sidebar click transitions.
 *
 * DETECTION LOGIC:
 *   - Sidebar click: storeSection changes, pathnameSection stays the same momentarily
 *   - Browser back/forward: pathnameSection changes, storeSection stays the same
 *   - Page refresh: storeSection defaults to 'dashboard', pathnameSection reflects the URL
 *
 *   We track `prevStoreSection` to distinguish these cases:
 *   - If storeSection changed → sidebar click → DON'T sync pathname→store
 *   - If storeSection didn't change but pathname differs → browser nav → DO sync
 *
 * Usage:
 *   const activeSection = useNavigationSync({
 *     pathnameSection,
 *     storeSection,
 *     setStoreSection,
 *   });
 */
export function useNavigationSync({
  pathnameSection,
  storeSection,
  setStoreSection,
}: {
  pathnameSection: string;
  storeSection: string;
  setStoreSection: (section: string) => void;
}): string {
  const prevStoreRef = useRef(storeSection);
  const hasSyncedMount = useRef(false);

  // ── On mount: sync pathname → store (handles page refresh at deep URLs) ──
  useEffect(() => {
    if (!hasSyncedMount.current && pathnameSection !== storeSection) {
      setStoreSection(pathnameSection as any);
      prevStoreRef.current = pathnameSection;
    }
    hasSyncedMount.current = true;
    // We intentionally only run this on mount. The dependency array includes
    // the values we read, but the hasSyncedMount guard ensures it only executes once.
  }, [pathnameSection, storeSection, setStoreSection]);

  // ── Sync pathname → store for browser back/forward ──
  // We ONLY sync when the store DIDN'T change (meaning this is a browser-initiated
  // navigation, not a sidebar click). If the store changed, it means the sidebar
  // clicked and the URL just hasn't caught up yet — we must not overwrite the store.
  useEffect(() => {
    const storeChanged = storeSection !== prevStoreRef.current;
    prevStoreRef.current = storeSection;

    if (!storeChanged && pathnameSection !== storeSection) {
      // Store didn't change but pathname did → browser back/forward or direct URL
      setStoreSection(pathnameSection as any);
    }
  }, [pathnameSection, storeSection, setStoreSection]);

  // The store is the sole source of truth for rendering
  return storeSection;
}

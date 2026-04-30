'use client';

import { useState, useCallback } from 'react';

/**
 * Hook to track which sections have been mounted.
 * Implements a "keep-alive" pattern: sections are mounted lazily on first visit,
 * then kept mounted (hidden with CSS) when navigating away.
 *
 * IMPORTANT: The `activeSection` parameter should be derived DIRECTLY from
 * `usePathname()` (via `useNavigationSync`). This ensures the UI is strictly
 * reactive to the URL and eliminates Zustand vs Router race conditions.
 *
 * Usage:
 *   const activeSection = useNavigationSync({...}); // derives from pathname
 *   const { isMounted } = useMountedSections(activeSection);
 *   // isMounted('chat') → true after user visits chat for the first time
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
 * useNavigationSync - Syncs pathname → Zustand store for sidebar highlight.
 *
 * ARCHITECTURE DECISION: `usePathname()` is the SOLE source of truth for
 * section visibility (CSS hidden/block toggle). The Zustand store is only
 * used so the sidebar can highlight the active item.
 *
 * Previously, this hook tried to make Zustand the "sole source of truth"
 * while syncing pathname for browser navigation. This caused race conditions
 * and desync issues where the UI wouldn't update on sidebar clicks.
 *
 * Now, the sidebar calls `router.push()` to navigate, the URL changes,
 * `usePathname()` updates, and the UI re-renders immediately. The Zustand
 * store is synced FROM the pathname (not vice versa).
 *
 * This hook:
 *   1. Returns `pathnameSection` ALWAYS (URL = source of truth for rendering)
 *   2. Syncs `pathnameSection` → Zustand store (for sidebar highlight)
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
  // Sync pathname → store whenever they differ.
  // This ensures the sidebar (which reads from the store) stays in sync.
  // Using useEffect to avoid render-phase side effects.
  if (pathnameSection !== storeSection) {
    // Use microtask to defer the store update slightly, avoiding
    // "Cannot update a component while rendering a different component" warnings.
    // But still effectively synchronous for the user's perception.
    queueMicrotask(() => {
      setStoreSection(pathnameSection as any);
    });
  }

  // ALWAYS return the pathname-derived section.
  // This is the SOLE source of truth for rendering decisions.
  return pathnameSection;
}

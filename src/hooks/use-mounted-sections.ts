'use client';

import { useEffect } from 'react';

/**
 * useNavigationSync - Syncs pathname → Zustand store for sidebar highlight.
 *
 * ARCHITECTURE: `usePathname()` is the SOLE source of truth for which
 * section is active. The Zustand store is ONLY used so the sidebar can
 * highlight the active item without re-reading the URL on every render.
 *
 * The sidebar calls `router.push()` to navigate, the URL changes,
 * `usePathname()` updates, and the UI re-renders immediately. The Zustand
 * store is synced FROM the pathname (not vice versa).
 *
 * This hook:
 *   1. Returns `pathnameSection` ALWAYS (URL = source of truth for rendering)
 *   2. Syncs `pathnameSection` → Zustand store (for sidebar highlight)
 *
 * REBUILD NOTE: The old `useMountedSections` hook implemented a "keep-alive"
 * pattern that kept ALL sections in the DOM with CSS `hidden` class. This
 * caused the navigation blocking bug because Radix UI Dialog components in
 * hidden sections could add `inert` attributes to the page root. The new
 * architecture uses simple conditional rendering — only the active section
 * is in the DOM at any time, eliminating the entire class of bugs.
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
  // Sync pathname → store using useEffect (not render-phase side effect)
  useEffect(() => {
    if (pathnameSection !== storeSection) {
      setStoreSection(pathnameSection as any);
    }
  }, [pathnameSection, storeSection, setStoreSection]);

  // ALWAYS return the pathname-derived section.
  // This is the SOLE source of truth for rendering decisions.
  return pathnameSection;
}

'use client';

import { useLayoutEffect, useEffect } from 'react';

/**
 * useNavigationSync - Syncs pathname ↔ Zustand store for navigation.
 *
 * ARCHITECTURE (v2 — fixes navigation bug):
 * The Zustand store is the PRIMARY source of truth for rendering.
 * It's updated from TWO sources:
 *   1. Sidebar clicks → immediate `setStoreSection()` call (instant update)
 *   2. URL changes → `useLayoutEffect` syncs pathname → store (for direct URL access)
 *
 * WHY NOT usePathname() as primary source?
 * In Next.js 16 with catch-all routes (`[[...section]]`), `usePathname()`
 * may not trigger re-renders for soft navigations within the same route group.
 * The URL changes in the browser but the component doesn't re-render.
 * By using the Zustand store as primary, sidebar clicks cause IMMEDIATE state
 * changes that always trigger re-renders, while URL→store sync handles
 * direct URL navigation (typing URL, browser back/forward, page refresh).
 *
 * This hook:
 *   1. Syncs pathname → store using `useLayoutEffect` (before browser paint)
 *   2. Returns `storeSection` (the primary source for rendering)
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
  // Sync pathname → store using useLayoutEffect (runs before browser paint)
  // This ensures the store is always in sync with the URL on:
  // - Direct URL access (typing in address bar)
  // - Browser back/forward navigation
  // - Page refresh
  // We use useLayoutEffect instead of useEffect to avoid a visual flash
  // where the wrong section is briefly shown before the store updates.
  useLayoutEffect(() => {
    if (pathnameSection !== storeSection) {
      setStoreSection(pathnameSection as any);
    }
  }, [pathnameSection, storeSection, setStoreSection]);

  // Also sync as a fallback with regular useEffect (in case useLayoutEffect
  // was skipped during SSR hydration)
  useEffect(() => {
    if (pathnameSection !== storeSection) {
      setStoreSection(pathnameSection as any);
    }
  }, [pathnameSection, storeSection, setStoreSection]);

  // Return the STORE section as the primary source for rendering.
  // The store is updated immediately on sidebar clicks AND from URL sync.
  return storeSection;
}

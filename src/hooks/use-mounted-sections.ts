'use client';

import { useLayoutEffect, useEffect, useRef } from 'react';

/**
 * useNavigationSync - Syncs pathname → Zustand store for navigation.
 *
 * ARCHITECTURE (v3 — fixes the race condition bug):
 * The Zustand store is the PRIMARY source of truth for rendering.
 * It's updated from TWO sources:
 *   1. Sidebar clicks → immediate `setStoreSection()` call (instant update)
 *   2. URL changes → sync pathname → store (for direct URL access)
 *
 * CRITICAL FIX: The sync effect only fires when `pathnameSection` changes,
 * NOT when `storeSection` changes. This prevents the race condition:
 *
 *   OLD BUG (v2):
 *   1. Sidebar sets store to 'subjects'
 *   2. useLayoutEffect fires because storeSection was in dependency array
 *   3. pathnameSection is still 'dashboard' (usePathname() hasn't updated yet)
 *   4. Effect resets store back to 'dashboard' — UNDOES the sidebar click!
 *   5. Since usePathname() doesn't re-render for catch-all routes,
 *      the store stays wrong forever — user must refresh
 *
 *   NEW FIX (v3):
 *   1. Sidebar sets store to 'subjects'
 *   2. useLayoutEffect does NOT fire (storeSection is NOT in deps)
 *   3. Store stays at 'subjects' — correct section renders immediately
 *   4. When pathname eventually updates, effect fires but finds no mismatch
 *
 * A ref tracks the last synced pathnameSection to ensure we only sync
 * when the pathname actually changes (not on every render).
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
  // Track the last pathnameSection that was synced to the store.
  // Initialized to null so the first render always syncs (for direct URL access).
  const lastSyncedPathname = useRef<string | null>(null);

  // Sync pathname → store using useLayoutEffect (runs before browser paint).
  // Only fires when pathnameSection changes (direct URL, browser back/forward,
  // page refresh). Does NOT fire when storeSection changes from sidebar click.
  useLayoutEffect(() => {
    if (pathnameSection !== lastSyncedPathname.current) {
      lastSyncedPathname.current = pathnameSection;
      setStoreSection(pathnameSection as any);
    }
  }, [pathnameSection, setStoreSection]); // NO storeSection in deps!

  // Fallback useEffect for SSR hydration edge cases.
  // Same logic — only fires when pathnameSection changes.
  useEffect(() => {
    if (pathnameSection !== lastSyncedPathname.current) {
      lastSyncedPathname.current = pathnameSection;
      setStoreSection(pathnameSection as any);
    }
  }, [pathnameSection, setStoreSection]); // NO storeSection in deps!

  // Return the STORE section as the primary source for rendering.
  return storeSection;
}

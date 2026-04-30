/**
 * Navigation Cleanup Utility — v8
 *
 * Simplified version that delegates to the module-level inert-guard
 * for the heavy lifting. The inert-guard (imported in layout.tsx):
 *   - Prevents `inert` on html/body via setAttribute override
 *   - Uses MutationObserver to remove `inert` immediately when added
 *   - Runs a 100ms interval cleanup as fallback
 *
 * This module just dispatches a custom event and calls forceRemoveInert
 * on pathname changes.
 */

import { forceRemoveInert } from './inert-guard';

/**
 * Called on navigation to clean up any leftover state.
 */
export function cleanupAfterNavigation() {
  if (typeof document === 'undefined') return;

  // 1. Dispatch custom event so sections can close their dialogs
  document.dispatchEvent(new CustomEvent('navigation:cleanup'));

  // 2. Immediate cleanup
  forceRemoveInert();

  // 3. Deferred cleanup (catches inert re-added during close animations)
  setTimeout(forceRemoveInert, 50);
  setTimeout(forceRemoveInert, 150);
  setTimeout(forceRemoveInert, 300);
}

// These are no longer used by the layout (cleanup is now inline in layout.tsx)
// but kept for backward compatibility
export function initNavigationGuard() { /* no-op — cleanup is now in inert-guard module */ }
export function destroyNavigationGuard() { /* no-op */ }

/**
 * Navigation Cleanup Utility — v9 (Simplified)
 *
 * With Dialog/Sheet/AlertDialog using modal={false}, Radix no longer
 * adds `inert` to the page. This eliminates the root cause of the
 * "hover works but clicks don't" bug entirely.
 *
 * This module now just dispatches a cleanup event on navigation
 * and does basic body style cleanup as a safety net.
 */

/**
 * Called on navigation to clean up any leftover state.
 */
export function cleanupAfterNavigation() {
  if (typeof document === 'undefined') return;

  // Dispatch custom event so sections can close their dialogs
  document.dispatchEvent(new CustomEvent('navigation:cleanup'));

  // Safety net: fix any stale body styles
  const body = document.body;
  if (body.style.pointerEvents === 'none') {
    body.style.pointerEvents = '';
  }
}

// These are no longer used but kept for backward compatibility
export function initNavigationGuard() { /* no-op */ }
export function destroyNavigationGuard() { /* no-op */ }

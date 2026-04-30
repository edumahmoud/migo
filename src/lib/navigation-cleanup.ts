/**
 * Navigation Cleanup Utility — SIMPLIFIED (v5)
 *
 * REBUILD: The old navigation-cleanup.ts (v4) was a 300+ line utility that
 * fought the `inert` attribute added by Radix UI Dialog components. It used
 * MutationObservers, requestAnimationFrame loops, and periodic safety intervals
 * to remove `inert` from the page content.
 *
 * The root cause was the "keep-alive" pattern that kept ALL sections in the DOM
 * with CSS `hidden` class. Radix Dialog components in hidden sections could add
 * `inert` to the page root, blocking all clicks (but not hover, since inert
 * doesn't affect CSS :hover).
 *
 * The rebuild eliminates the keep-alive pattern entirely — only the active
 * section is in the DOM. This means:
 *   - No hidden sections with Dialog state
 *   - No stale `inert` attributes
 *   - No need for aggressive cleanup
 *
 * This file is kept as a minimal utility for body lock cleanup only.
 */

/**
 * Clean up body styles that modals/dialogs may have left behind.
 * This is a lightweight cleanup for body overflow/pointer-events
 * that Radix UI or custom modals might set.
 */
export function cleanupBodyLocks() {
  if (typeof document === 'undefined') return;

  const body = document.body;
  // Only reset if no dialog is genuinely open
  const openDialogs = document.querySelectorAll('[data-state="open"][role="dialog"]');
  if (openDialogs.length === 0) {
    body.style.removeProperty('pointer-events');
    body.style.removeProperty('overflow');
    body.style.removeProperty('padding-right');
    body.removeAttribute('data-scroll-locked');
    body.style.pointerEvents = '';
    body.style.overflow = '';
  }
}

/**
 * Called on navigation to clean up any leftover body locks.
 */
export function cleanupAfterNavigation() {
  cleanupBodyLocks();
}

// These are no-ops now — kept for backward compatibility with imports
export function initNavigationGuard() {}
export function destroyNavigationGuard() {}

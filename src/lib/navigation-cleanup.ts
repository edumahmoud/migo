/**
 * Navigation Cleanup Utility — v6 (Targeted Fix)
 *
 * ROOT CAUSE: Radix UI Dialog/AlertDialog adds `inert` attribute to sibling
 * elements when a dialog opens. The `inert` attribute blocks ALL user
 * interaction events (click, focus, keyboard) but does NOT block CSS :hover.
 * This is why users see hover effects but clicks don't work.
 *
 * When a section with an open Radix Dialog unmounts (due to conditional rendering),
 * the Dialog's cleanup animation may not complete, leaving `inert` stuck on the page.
 *
 * APPROACH:
 *   1. MutationObserver: immediately removes `inert` when added to non-dialog content
 *   2. Navigation cleanup: removes `inert` + body locks on pathname change
 *   3. No rAF loops or periodic intervals needed (the MutationObserver is sufficient)
 */

let observer: MutationObserver | null = null;

/**
 * Check if any Radix Dialog is genuinely open (visible + interactive).
 */
function isDialogOpen(): boolean {
  // Check for open dialog content in portals
  const openDialogs = document.querySelectorAll(
    '[data-state="open"][role="dialog"], ' +
    '[data-state="open"][data-slot="dialog-content"], ' +
    '[data-state="open"][data-slot="alert-dialog-content"], ' +
    '[data-state="open"][data-slot="sheet-content"]'
  );
  return openDialogs.length > 0;
}

/**
 * Remove `inert` attribute from elements that shouldn't have it.
 * Only removes from the React root content, not from inside dialog portals.
 */
function removeStaleInert() {
  if (typeof document === 'undefined') return;

  // If a dialog IS genuinely open, inert on the root is expected behavior
  // (it prevents interaction with content behind the dialog)
  if (isDialogOpen()) return;

  // No dialog is open — remove ALL inert attributes
  document.documentElement.removeAttribute('inert');
  document.body.removeAttribute('inert');

  const inertElements = document.querySelectorAll('[inert]');
  inertElements.forEach((el) => {
    // Don't remove inert from inside a dialog portal (that's intentional)
    if (el.closest('[data-radix-portal]')) return;
    el.removeAttribute('inert');
  });
}

/**
 * Clean up body styles that modals/dialogs may have left behind.
 */
export function cleanupBodyLocks() {
  if (typeof document === 'undefined') return;

  if (!isDialogOpen()) {
    const body = document.body;
    body.style.removeProperty('pointer-events');
    body.style.removeProperty('overflow');
    body.style.removeProperty('padding-right');
    body.removeAttribute('data-scroll-locked');
    body.removeAttribute('data-radix-scroll-locked');
    body.style.pointerEvents = '';
    body.style.overflow = '';
  }
}

/**
 * Full cleanup — removes inert, body locks, and stale overlays.
 */
function fullCleanup() {
  removeStaleInert();
  cleanupBodyLocks();
}

/**
 * Initialize the MutationObserver guard.
 * Watches for `inert` attribute additions and removes them when no dialog is open.
 */
export function initNavigationGuard() {
  if (typeof document === 'undefined' || observer) return;

  observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === 'attributes' && mutation.attributeName === 'inert') {
        const target = mutation.target;
        if (target instanceof HTMLElement && target.hasAttribute('inert')) {
          // Remove inert if no dialog is genuinely open
          if (!isDialogOpen()) {
            target.removeAttribute('inert');
          }
        }
      }
    }
  });

  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['inert'],
    subtree: true,
  });
}

/**
 * Destroy the MutationObserver guard.
 */
export function destroyNavigationGuard() {
  if (observer) {
    observer.disconnect();
    observer = null;
  }
}

/**
 * Called on navigation to clean up any leftover state.
 */
export function cleanupAfterNavigation() {
  if (typeof document === 'undefined') return;

  // 1. Dispatch custom event so sections can close their dialogs
  document.dispatchEvent(new CustomEvent('navigation:cleanup'));

  // 2. Immediate cleanup
  fullCleanup();

  // 3. Deferred cleanup (catches inert re-added during close animations)
  setTimeout(fullCleanup, 100);
  setTimeout(fullCleanup, 300);
  setTimeout(fullCleanup, 500);
}

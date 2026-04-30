/**
 * Navigation Cleanup Utility — v7 (Nuclear Option)
 *
 * ROOT CAUSE: Radix UI Dialog/AlertDialog adds `inert` attribute to sibling
 * elements when a dialog opens. The `inert` attribute blocks ALL user
 * interaction events (click, focus, keyboard) but does NOT block CSS :hover.
 * This is why users see hover effects but clicks don't work.
 *
 * When a section with an open Radix Dialog unmounts (due to conditional rendering),
 * the Dialog's cleanup animation may not complete, leaving `inert` stuck on the page.
 *
 * APPROACH (v7 — Nuclear):
 *   1. ALWAYS remove `inert` from non-portal elements (no isDialogOpen check)
 *   2. Navigation cleanup: removes inert + body locks on pathname change
 *   3. Belt-and-suspenders: DialogContent and AlertDialogContent components
 *      now have their own useInertCleanup hook
 *   4. Layout has a periodic setInterval that force-removes inert every 500ms
 *
 * Why no isDialogOpen check? Because the check itself was unreliable —
 * after React unmounts a dialog's parent, the dialog portal may briefly
 * remain in the DOM with data-state="open", causing isDialogOpen() to
 * incorrectly return true and prevent inert removal.
 */

/**
 * Remove `inert` attribute from ALL non-portal elements, unconditionally.
 * Also fixes body pointer-events and scroll locks.
 */
function forceRemoveInert() {
  if (typeof document === 'undefined') return;

  // Remove inert from root elements
  document.documentElement.removeAttribute('inert');
  document.body.removeAttribute('inert');

  // Remove inert from all other elements (except inside dialog portals)
  const inertElements = document.querySelectorAll('[inert]');
  inertElements.forEach((el) => {
    // Don't remove inert from inside a dialog portal (that's the dialog content itself)
    if (!el.closest('[data-radix-portal]')) {
      el.removeAttribute('inert');
    }
  });

  // Fix body styles that Radix may have left behind
  const body = document.body;
  if (body.style.pointerEvents === 'none') {
    body.style.pointerEvents = '';
  }
  // Only remove overflow/padding if no dialog is genuinely visible
  const visibleDialogs = document.querySelectorAll(
    '[data-state="open"][role="dialog"]:not([style*="display: none"])'
  );
  if (visibleDialogs.length === 0) {
    body.style.removeProperty('overflow');
    body.style.removeProperty('padding-right');
    body.removeAttribute('data-scroll-locked');
    body.removeAttribute('data-radix-scroll-locked');
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
  forceRemoveInert();

  // 3. Deferred cleanup (catches inert re-added during close animations)
  setTimeout(forceRemoveInert, 50);
  setTimeout(forceRemoveInert, 150);
  setTimeout(forceRemoveInert, 300);
  setTimeout(forceRemoveInert, 600);
}

// These are no longer used by the layout (cleanup is now inline in layout.tsx)
// but kept for backward compatibility
export function initNavigationGuard() { /* no-op — cleanup is now in layout */ }
export function destroyNavigationGuard() { /* no-op */ }

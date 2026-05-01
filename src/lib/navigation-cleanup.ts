/**
 * Navigation Cleanup Utility — v11
 *
 * The REAL root cause of the "hover works but clicks don't" bug was
 * `aria-modal="true"` on the MobileDrawer that was always present in the DOM
 * even when closed (fixed in app-sidebar.tsx v11). This module provides
 * safety nets for remaining edge cases with Radix modal components.
 *
 * With Dialog/Sheet/AlertDialog restored to modal={true}, Radix may set:
 *   - `body.style.pointerEvents = "none"` via DismissableLayer
 *   - `aria-hidden="true"` on sibling elements via `aria-hidden` package
 *   - `inert` attribute on sibling elements
 *
 * If a modal's parent unmounts during navigation before cleanup, these
 * can remain stuck. This module cleans them up on navigation.
 */

/**
 * Called on navigation to clean up any leftover state.
 */
export function cleanupAfterNavigation() {
  if (typeof document === 'undefined') return;

  // Dispatch custom event so sections can close their dialogs
  document.dispatchEvent(new CustomEvent('navigation:cleanup'));

  // Safety net 1: Fix stale body.style.pointerEvents
  // The Radix DismissableLayer sets this to "none" when a modal component
  // is open. If the component unmounts during navigation without cleanup,
  // this stays stuck at "none" and blocks all clicks.
  const body = document.body;
  if (body.style.pointerEvents === 'none') {
    console.warn('[navigation-cleanup] Fixing stuck body.style.pointerEvents = "none"');
    body.style.pointerEvents = '';
  }

  // Safety net 2: Remove stale aria-hidden from React root elements
  // The `hideOthers()` function from `aria-hidden` adds aria-hidden="true"
  // to siblings of modal content (portals). If cleanup doesn't complete,
  // the React root can get stuck with aria-hidden="true".
  const rootEl = document.getElementById('__next') || document.getElementById('root');
  if (rootEl?.getAttribute('aria-hidden') === 'true') {
    console.warn('[navigation-cleanup] Removing stuck aria-hidden="true" from root element');
    rootEl.removeAttribute('aria-hidden');
  }

  // Safety net 3: Remove stale data-aria-hidden marker
  // The `hideOthers()` function also adds a `data-aria-hidden` marker
  // attribute. Clean this up too.
  if (rootEl?.getAttribute('data-aria-hidden') === 'true') {
    rootEl.removeAttribute('data-aria-hidden');
  }

  // Safety net 4: Remove stuck inert attribute from React root
  // Radix modal components add `inert` to sibling elements when a modal
  // is open. If the modal's parent unmounts during navigation before
  // Radix's cleanup, `inert` can remain stuck.
  if (rootEl?.hasAttribute('inert')) {
    console.warn('[navigation-cleanup] Removing stuck inert attribute from root element');
    rootEl.removeAttribute('inert');
  }
}

// These are no longer used but kept for backward compatibility
export function initNavigationGuard() { /* no-op */ }
export function destroyNavigationGuard() { /* no-op */ }

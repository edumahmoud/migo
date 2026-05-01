/**
 * Navigation Cleanup Utility — v10
 *
 * With Dialog/Sheet/AlertDialog/DropdownMenu/ContextMenu using modal={false},
 * Radix no longer sets `body.style.pointerEvents = "none"` or adds
 * `aria-hidden` to sibling elements. This eliminates the root cause of the
 * "hover works but clicks don't" bug.
 *
 * ROOT CAUSE ANALYSIS:
 * The Radix DismissableLayer component (used internally by Dialog, Menu,
 * Popover, etc.) sets `body.style.pointerEvents = "none"` when
 * `disableOutsidePointerEvents = true` (which happens when modal=true).
 * If the component's parent unmounts during navigation before the
 * DismissableLayer's useEffect cleanup runs, `body.style.pointerEvents`
 * can get stuck at "none", blocking ALL clicks while CSS :hover still
 * works on elements with explicit `pointer-events: auto`.
 *
 * Additionally, `hideOthers()` from the `aria-hidden` package adds
 * `aria-hidden="true"` to sibling elements of the modal content. If
 * cleanup doesn't complete, this can also remain stuck.
 *
 * This module provides safety nets for both issues.
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
}

// These are no longer used but kept for backward compatibility
export function initNavigationGuard() { /* no-op */ }
export function destroyNavigationGuard() { /* no-op */ }

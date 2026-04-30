/**
 * Navigation Cleanup Utility
 *
 * When the user navigates between sections while a modal/dialog is open,
 * the modal's backdrop overlay can remain in the DOM, blocking all pointer events.
 *
 * This utility provides two functions:
 * 1. closeAllModals() - Called from each dashboard to close all modal states
 * 2. cleanupBodyLocks() - Removes any body scroll/pointer-events locks left by modals
 */

/**
 * Force-remove any body styles that modals/dialogs may have added.
 *
 * Radix UI Dialog/Sheet primitives add these to <body>:
 *   - pointer-events: none
 *   - overflow: hidden
 *   - padding-right: <scrollbar-width>px
 *
 * If a navigation happens while a modal is open, the modal's cleanup effect
 * may not run (because the component is keep-alive hidden, not unmounted).
 * This function ensures the body is always interactive after navigation.
 */
export function cleanupBodyLocks() {
  if (typeof document === 'undefined') return;

  const body = document.body;

  // Remove pointer-events lock (Radix UI Dialog adds this)
  body.style.removeProperty('pointer-events');

  // Remove overflow lock (most modal libraries add overflow: hidden to body)
  body.style.removeProperty('overflow');

  // Remove padding-right compensation (Radix UI adds this to prevent layout shift)
  body.style.removeProperty('padding-right');

  // Also remove the data-scroll-locked attribute that some libraries use
  body.removeAttribute('data-scroll-locked');
  body.removeAttribute('data-radix-scroll-locked');

  // Remove any Radix UI data attributes
  body.removeAttribute('data-radix-scroll-area-overflow-style');

  // Force body to be interactive
  body.style.pointerEvents = '';
  body.style.overflow = '';
}

/**
 * Remove any lingering modal/overlay elements from the DOM.
 * This is a safety net for cases where React hasn't cleaned up yet.
 */
export function forceCleanupOverlays() {
  if (typeof document === 'undefined') return;

  // Remove any Radix UI portal remnants
  const radixPortals = document.querySelectorAll('[data-radix-portal]');
  radixPortals.forEach((portal) => {
    // Only remove if it's empty or contains only backdrop
    if (portal.children.length === 0 || (portal.children.length === 1 && portal.children[0].getAttribute('data-state') === 'closed')) {
      portal.remove();
    }
  });

  // Reset body
  cleanupBodyLocks();
}

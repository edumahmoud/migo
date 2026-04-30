/**
 * Navigation Cleanup Utility
 *
 * When the user navigates between sections while a modal/dialog is open,
 * the modal's backdrop overlay can remain in the DOM, blocking all pointer events.
 *
 * This utility provides safe cleanup functions that ONLY manipulate CSS properties
 * and body styles — it NEVER removes React-managed DOM nodes (which causes crashes).
 *
 * IMPORTANT: We use CSS-based approaches (pointer-events: none) instead of
 * DOM removal because React needs to manage its own DOM nodes. Removing
 * portal elements directly causes React to crash on subsequent updates.
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
 * Mark stale overlays as non-interactive using CSS only.
 *
 * IMPORTANT: This function does NOT remove DOM nodes. Removing React-managed
 * portal elements causes React to crash on subsequent renders/updates.
 * Instead, we mark stale overlays with data attributes so CSS rules can
 * apply pointer-events: none.
 */
export function markStaleOverlays() {
  if (typeof document === 'undefined') return;

  // 1. Mark any closed Radix UI portal content as non-interactive
  const closedPortalContent = document.querySelectorAll(
    '[data-radix-portal] [data-state="closed"]'
  );
  closedPortalContent.forEach((el) => {
    (el as HTMLElement).style.pointerEvents = 'none';
  });

  // 2. Mark any Framer Motion exit-animating elements as non-interactive
  const exitingElements = document.querySelectorAll('[data-exiting="true"]');
  exitingElements.forEach((el) => {
    (el as HTMLElement).style.pointerEvents = 'none';
  });

  // 3. Mark stale overlays/backdrops (aria-hidden=true inside portals)
  const staleOverlays = document.querySelectorAll(
    '[data-radix-portal] [aria-hidden="true"]'
  );
  staleOverlays.forEach((el) => {
    (el as HTMLElement).style.pointerEvents = 'none';
  });
}

/**
 * Comprehensive cleanup that should be called on every navigation.
 * This is the main entry point — it handles all known overlay blocking scenarios.
 *
 * Strategy:
 * 1. Clean up body locks (most critical — pointer-events on body)
 * 2. Mark stale overlays as non-interactive (CSS-based, no DOM removal)
 * 3. Double-check after microtask and rAF for delayed React updates
 */
export function cleanupAfterNavigation() {
  if (typeof document === 'undefined') return;

  // Clean up body locks first (most critical)
  cleanupBodyLocks();

  // Then mark stale overlays as non-interactive (NO DOM removal)
  markStaleOverlays();

  // Safety net: ensure body is interactive after a microtask
  // This catches cases where React updates happen after our cleanup
  queueMicrotask(() => {
    cleanupBodyLocks();
  });

  // And again after a requestAnimationFrame (for React 18 concurrent mode)
  requestAnimationFrame(() => {
    cleanupBodyLocks();
    markStaleOverlays();
  });
}

// ─── Removed: MutationObserver and DOM removal ───
// The MutationObserver for Framer Motion exit animations was too expensive
// and caused performance crashes. The CSS rule [data-exiting="true"] in
// globals.css handles this more efficiently.
//
// The forceCleanupOverlays() function that removed DOM nodes (portal.remove())
// was causing React to crash on subsequent renders. We now use CSS-only
// approaches (pointer-events: none) instead.

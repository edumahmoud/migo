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

  // Remove the Radix UI "inert" attribute from body (added by Dialog when open)
  // When a Dialog opens, Radix adds `inert` to body to prevent background interaction
  body.removeAttribute('inert');
}

/**
 * Remove `inert` and `aria-hidden` from main page content elements.
 *
 * When a Radix UI Dialog opens, it sets `inert` and `aria-hidden="true"` on
 * siblings of the dialog portal to implement the "inert" pattern. If the
 * dialog is closed via navigation (keep-alive hidden) instead of normal close,
 * these attributes can remain, making the page unclickable.
 */
function cleanupInertAttributes() {
  if (typeof document === 'undefined') return;

  // Remove inert from the main content wrapper (#main-content or similar)
  const mainContent = document.querySelector('[data-radix-scroll-area]') ||
                      document.querySelector('main') ||
                      document.querySelector('[role="main"]');
  if (mainContent) {
    mainContent.removeAttribute('inert');
    // Don't remove aria-hidden from main content — that's set by our keep-alive
  }

  // Remove inert from body children that shouldn't have it
  // (but NOT from tabpanel children — those legitimately have aria-hidden)
  const bodyChildren = document.body.children;
  for (let i = 0; i < bodyChildren.length; i++) {
    const child = bodyChildren[i];
    // Skip Radix portals — they manage their own inert state
    if (child.hasAttribute('data-radix-portal')) continue;
    // Skip script/style elements
    if (child.tagName === 'SCRIPT' || child.tagName === 'STYLE') continue;

    // If this element has inert but is NOT a tabpanel, it was likely set by Radix Dialog
    if (child.hasAttribute('inert') && child.getAttribute('role') !== 'tabpanel') {
      child.removeAttribute('inert');
    }
  }
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
  //    But only if the portal doesn't contain any open content
  const staleOverlays = document.querySelectorAll(
    '[data-radix-portal] [aria-hidden="true"]'
  );
  staleOverlays.forEach((el) => {
    // Check if the parent portal has any open content
    const portal = el.closest('[data-radix-portal]');
    if (portal && !portal.querySelector('[data-state="open"]')) {
      (el as HTMLElement).style.pointerEvents = 'none';
    }
  });

  // 4. Handle Radix UI Dialog overlays specifically
  //    These have class "fixed inset-0" and can block the entire viewport
  const radixOverlays = document.querySelectorAll(
    '[data-radix-overlay]'
  );
  radixOverlays.forEach((overlay) => {
    const state = overlay.getAttribute('data-state');
    if (state !== 'open') {
      (overlay as HTMLElement).style.pointerEvents = 'none';
    }
  });
}

/**
 * Comprehensive cleanup that should be called on every navigation.
 * This is the main entry point — it handles all known overlay blocking scenarios.
 *
 * Strategy:
 * 1. Clean up body locks (most critical — pointer-events on body)
 * 2. Clean up inert attributes (Radix UI "inert" pattern)
 * 3. Mark stale overlays as non-interactive (CSS-based, no DOM removal)
 * 4. Double-check after microtask and rAF for delayed React updates
 */
export function cleanupAfterNavigation() {
  if (typeof document === 'undefined') return;

  // Clean up body locks first (most critical)
  cleanupBodyLocks();

  // Clean up inert attributes (Radix UI "inert" pattern on page content)
  cleanupInertAttributes();

  // Then mark stale overlays as non-interactive (NO DOM removal)
  markStaleOverlays();

  // Safety net: ensure body is interactive after a microtask
  // This catches cases where React updates happen after our cleanup
  queueMicrotask(() => {
    cleanupBodyLocks();
    cleanupInertAttributes();
  });

  // And again after a requestAnimationFrame (for React 18 concurrent mode)
  requestAnimationFrame(() => {
    cleanupBodyLocks();
    cleanupInertAttributes();
    markStaleOverlays();
  });

  // Final safety net after 500ms (catches delayed animations/transitions)
  setTimeout(() => {
    cleanupBodyLocks();
    cleanupInertAttributes();
  }, 500);
}

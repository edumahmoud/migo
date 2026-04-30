/**
 * Navigation Cleanup Utility
 *
 * When the user navigates between sections while a modal/dialog is open,
 * the modal's backdrop overlay can remain in the DOM, blocking all pointer events.
 *
 * This utility provides aggressive cleanup functions to ensure:
 * 1. Body locks (pointer-events, overflow) are always removed after navigation
 * 2. Stale modal overlays/backdrops are removed from the DOM
 * 3. Radix UI portal remnants are cleaned up
 * 4. Framer Motion exit-animating elements are marked as non-interactive
 */

// ─── Global MutationObserver for Framer Motion exit animations ───
// This observer watches for elements that Framer Motion is animating out
// and ensures they have pointer-events: none to prevent blocking clicks.
let fmObserver: MutationObserver | null = null;
let fmObserverInitialized = false;

/**
 * Initialize a MutationObserver that watches for Framer Motion exit animations
 * and marks them with data-exiting="true" so the CSS rule can apply
 * pointer-events: none.
 *
 * This should be called once when the app mounts (e.g., in the dashboard layout).
 */
export function initExitAnimationObserver() {
  if (typeof document === 'undefined' || fmObserverInitialized) return;
  fmObserverInitialized = true;

  fmObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      // When Framer Motion removes an element from AnimatePresence,
      // it first animates it out (opacity: 0, etc.) then removes it.
      // During the animation, the element is still in the DOM and can block clicks.
      for (const node of mutation.addedNodes) {
        if (node instanceof HTMLElement) {
          // Check if this is a Framer Motion exit animation element
          // FM applies style="opacity: 0; ..." during exit animations
          const style = node.getAttribute('style') || '';
          if (style.includes('opacity: 0') && !node.hasAttribute('data-exiting')) {
            node.setAttribute('data-exiting', 'true');
          }
        }
      }
      // When style changes on existing elements (FM animates opacity to 0)
      if (mutation.type === 'attributes' && mutation.attributeName === 'style') {
        const target = mutation.target;
        if (target instanceof HTMLElement) {
          const style = target.getAttribute('style') || '';
          if (style.includes('opacity: 0') && !target.hasAttribute('data-exiting')) {
            target.setAttribute('data-exiting', 'true');
          } else if (!style.includes('opacity: 0') && target.hasAttribute('data-exiting')) {
            target.removeAttribute('data-exiting');
          }
        }
      }
    }
  });

  fmObserver.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['style'],
  });
}

/**
 * Stop the Framer Motion exit animation observer.
 */
export function destroyExitAnimationObserver() {
  if (fmObserver) {
    fmObserver.disconnect();
    fmObserver = null;
    fmObserverInitialized = false;
  }
}

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
 * AGGRESSIVE: Removes ALL stale overlays, not just empty ones.
 */
export function forceCleanupOverlays() {
  if (typeof document === 'undefined') return;

  // 1. Remove any Radix UI portal remnants that are closed or stale
  const radixPortals = document.querySelectorAll('[data-radix-portal]');
  radixPortals.forEach((portal) => {
    // Remove portals that are empty, closed, or contain only backdrops
    const hasOpenContent = portal.querySelector('[data-state="open"]');
    if (!hasOpenContent) {
      portal.remove();
    }
  });

  // 2. Remove any Radix UI overlays/backdrops that are lingering
  const radixOverlays = document.querySelectorAll('[data-radix-overlay]');
  radixOverlays.forEach((overlay) => {
    // Remove overlays that aren't associated with an open dialog
    const state = overlay.getAttribute('data-state');
    if (state !== 'open') {
      overlay.remove();
    }
  });

  // 3. Mark any Framer Motion exit-animating elements as non-interactive
  // AnimatePresence keeps elements in DOM during exit; mark them so CSS can
  // apply pointer-events: none
  const exitingElements = document.querySelectorAll('[data-exiting="true"]');
  exitingElements.forEach((el) => {
    (el as HTMLElement).style.pointerEvents = 'none';
  });

  // 4. Remove any stale fixed-position overlays that have pointer-events
  // This catches any overlay that wasn't properly cleaned up by React
  const staleOverlays = document.querySelectorAll(
    '.fixed.inset-0[data-state="closed"], .fixed.inset-0[aria-hidden="true"]'
  );
  staleOverlays.forEach((overlay) => {
    // Only remove if it's a direct child of body (i.e., a portal)
    if (overlay.parentElement === document.body) {
      overlay.remove();
    }
  });

  // 5. Reset body
  cleanupBodyLocks();
}

/**
 * Comprehensive cleanup that should be called on every navigation.
 * This is the main entry point — it handles all known overlay blocking scenarios.
 */
export function cleanupAfterNavigation() {
  if (typeof document === 'undefined') return;

  // Clean up body locks first (most critical)
  cleanupBodyLocks();

  // Then remove stale overlays
  forceCleanupOverlays();

  // Safety net: ensure body is interactive after a microtask
  // This catches cases where React updates happen after our cleanup
  queueMicrotask(() => {
    cleanupBodyLocks();
  });

  // And again after a requestAnimationFrame (for React 18 concurrent mode)
  requestAnimationFrame(() => {
    cleanupBodyLocks();
    // Also check for any new stale overlays that React may have just removed
    const closedPortals = document.querySelectorAll('[data-radix-portal]');
    closedPortals.forEach((portal) => {
      const hasOpenContent = portal.querySelector('[data-state="open"]');
      if (!hasOpenContent) {
        portal.remove();
      }
    });
  });
}

/**
 * Navigation Cleanup Utility
 *
 * When the user navigates between sections while a modal/dialog is open,
 * the modal's backdrop overlay can remain in the DOM, blocking all pointer events.
 *
 * The primary cause: Radix UI Dialog adds `inert` attribute and `pointer-events: none`
 * to page content when a dialog opens. In the keep-alive pattern, when the user
 * navigates away while a dialog is open, the dialog's cleanup doesn't run properly
 * because the section is hidden (display: none) but still mounted.
 *
 * This utility provides:
 * 1. Immediate cleanup of body locks and inert attributes
 * 2. A MutationObserver guard that prevents React from re-adding inert/pointer-events
 *    when a dialog is in a HIDDEN section (keep-alive display:none)
 * 3. A custom event mechanism for sections to close their dialogs on navigation
 */

// ─── Guard state ───
let guardActive = false;
let guardObserver: MutationObserver | null = null;

/**
 * Check if any VISIBLE Radix UI Dialog is currently open.
 * A dialog is "visible" if its portal has content with data-state="open"
 * AND that content is NOT inside a hidden tabpanel.
 */
function isAnyVisibleDialogOpen(): boolean {
  if (typeof document === 'undefined') return false;

  // Find all open Radix UI Dialog/Sheet/AlertDialog content
  const openDialogs = document.querySelectorAll(
    '[data-state="open"][role="dialog"], [data-state="open"][role="alertdialog"]'
  );

  if (openDialogs.length === 0) return false;

  // Check if any of these open dialogs are actually visible
  // (not inside a hidden section/tabpanel)
  for (const dialog of openDialogs) {
    // Check if the dialog or any ancestor has display:none or is hidden
    const hiddenAncestor = dialog.closest(
      '[style*="display: none"], [style*="display:none"], .hidden, [aria-hidden="true"][role="tabpanel"]'
    );
    if (!hiddenAncestor) {
      // This dialog is visible — don't remove inert/pointer-events
      return true;
    }
  }

  // All open dialogs are in hidden sections — safe to remove inert/pointer-events
  return false;
}

/**
 * Force-remove any body styles that modals/dialogs may have added.
 *
 * Radix UI Dialog/Sheet primitives add these to <body>:
 *   - pointer-events: none
 *   - overflow: hidden
 *   - padding-right: <scrollbar-width>px
 */
export function cleanupBodyLocks() {
  if (typeof document === 'undefined') return;

  // Don't clean up if a visible dialog is open
  if (isAnyVisibleDialogOpen()) return;

  const body = document.body;

  // Remove pointer-events lock (Radix UI Dialog adds this)
  body.style.removeProperty('pointer-events');

  // Remove overflow lock (most modal libraries add overflow: hidden to body)
  body.style.removeProperty('overflow');

  // Remove padding-right compensation (Radix UI adds this to prevent layout shift)
  body.style.removeProperty('padding-right');

  // Remove data attributes
  body.removeAttribute('data-scroll-locked');
  body.removeAttribute('data-radix-scroll-locked');
  body.removeAttribute('data-radix-scroll-area-overflow-style');

  // Force body to be interactive
  body.style.pointerEvents = '';
  body.style.overflow = '';
}

/**
 * Remove `inert` attribute from page content elements.
 *
 * When a Radix UI Dialog opens, it adds `inert` to siblings of the portal
 * (the "inert" pattern). In keep-alive, if the dialog's section is hidden,
 * the inert stays because React re-adds it on each render.
 *
 * This function removes inert ONLY when no visible dialog is open.
 */
function cleanupInertAttributes() {
  if (typeof document === 'undefined') return;

  // Don't remove inert if a visible dialog is open (it's intentional)
  if (isAnyVisibleDialogOpen()) return;

  // Remove inert from body
  document.body.removeAttribute('inert');

  // Remove inert from ALL body children (except portals and scripts)
  const bodyChildren = document.body.children;
  for (let i = 0; i < bodyChildren.length; i++) {
    const child = bodyChildren[i];
    if (child.hasAttribute('data-radix-portal')) continue;
    if (child.tagName === 'SCRIPT' || child.tagName === 'STYLE') continue;
    if (child.tagName === 'LINK' || child.tagName === 'META') continue;
    if (child.hasAttribute('inert')) {
      child.removeAttribute('inert');
    }
  }

  // Also remove inert from any #main-content or similar wrapper
  const mainWrapper = document.querySelector('[data-radix-scroll-area]') ||
                      document.querySelector('main') ||
                      document.querySelector('[role="main"]');
  if (mainWrapper?.hasAttribute('inert')) {
    mainWrapper.removeAttribute('inert');
  }
}

/**
 * Mark stale overlays as non-interactive using CSS only.
 *
 * IMPORTANT: This function does NOT remove DOM nodes. Removing React-managed
 * portal elements causes React to crash on subsequent renders/updates.
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

  // 2. Mark stale overlays/backdrops (in portals with no open content)
  const portals = document.querySelectorAll('[data-radix-portal]');
  portals.forEach((portal) => {
    const hasOpenContent = portal.querySelector('[data-state="open"]');
    if (!hasOpenContent) {
      // This portal is stale — mark all its content as non-interactive
      portal.querySelectorAll('[data-radix-overlay]').forEach((overlay) => {
        (overlay as HTMLElement).style.pointerEvents = 'none';
      });
    }
  });
}

/**
 * Initialize the MutationObserver guard that prevents React from re-adding
 * `inert` and `pointer-events: none` when a dialog is in a hidden section.
 *
 * This should be called once when the app mounts (in the dashboard layout).
 * It watches for attribute changes on body and body children, and immediately
 * removes `inert` and `pointer-events: none` if no visible dialog is open.
 */
export function initNavigationGuard() {
  if (typeof document === 'undefined' || guardActive) return;
  guardActive = true;

  guardObserver = new MutationObserver((mutations) => {
    let needsCleanup = false;

    for (const mutation of mutations) {
      if (mutation.type === 'attributes') {
        const target = mutation.target;
        if (target instanceof HTMLElement) {
          // Check if inert was added
          if (mutation.attributeName === 'inert' && target.hasAttribute('inert')) {
            needsCleanup = true;
          }
          // Check if pointer-events: none was added to body
          if (mutation.attributeName === 'style' && target === document.body) {
            const pe = document.body.style.pointerEvents;
            if (pe === 'none') {
              needsCleanup = true;
            }
          }
        }
      }
    }

    if (needsCleanup) {
      // Only clean up if no visible dialog is open
      if (!isAnyVisibleDialogOpen()) {
        cleanupBodyLocks();
        cleanupInertAttributes();
      }
    }
  });

  // Watch body for attribute changes
  guardObserver.observe(document.body, {
    attributes: true,
    attributeFilter: ['inert', 'style'],
    subtree: false, // Only watch body itself, children handled separately
  });

  // Also watch body children for inert attribute
  // We need to re-observe when children are added/removed
  const childrenObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === 'childList') {
        // New children added — check if they have inert
        for (const node of mutation.addedNodes) {
          if (node instanceof HTMLElement && node.hasAttribute('inert')) {
            if (!isAnyVisibleDialogOpen()) {
              node.removeAttribute('inert');
            }
          }
        }
      }
    }
  });

  childrenObserver.observe(document.body, {
    childList: true,
  });
}

/**
 * Destroy the navigation guard observer.
 */
export function destroyNavigationGuard() {
  if (guardObserver) {
    guardObserver.disconnect();
    guardObserver = null;
  }
  guardActive = false;
}

/**
 * Comprehensive cleanup that should be called on every navigation.
 * This is the main entry point — it handles all known overlay blocking scenarios.
 */
export function cleanupAfterNavigation() {
  if (typeof document === 'undefined') return;

  // 1. Dispatch custom event so sections can close their dialogs
  //    This is the PRIMARY fix: sections that use Radix UI Dialog/Sheet
  //    should listen for this event and close their dialogs.
  document.dispatchEvent(new CustomEvent('navigation:cleanup'));

  // 2. Clean up body locks and inert attributes
  cleanupBodyLocks();
  cleanupInertAttributes();
  markStaleOverlays();

  // 3. Safety net: cleanup after microtask (catches React batched updates)
  queueMicrotask(() => {
    cleanupBodyLocks();
    cleanupInertAttributes();
  });

  // 4. Safety net: cleanup after rAF (catches React concurrent mode)
  requestAnimationFrame(() => {
    cleanupBodyLocks();
    cleanupInertAttributes();
    markStaleOverlays();
  });

  // 5. Final safety net after 500ms (catches delayed animations)
  setTimeout(() => {
    cleanupBodyLocks();
    cleanupInertAttributes();
  }, 500);
}

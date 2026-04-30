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
 * KEY INSIGHT: Radix UI Dialog portals live at `<body>` level, NOT inside the
 * hidden tabpanel. So even when a section is hidden via `display:none`, the
 * portal with `data-state="open"` remains visible at body level, and Radix UI
 * keeps `inert` on the page content (#__next / React root).
 *
 * The `inert` HTML attribute blocks ALL user interaction events (click, focus,
 * keyboard) but does NOT block CSS `:hover` (which is applied by the browser's
 * rendering engine based on pointer position, not JavaScript events). This is
 * why users see hover effects but clicks don't work.
 *
 * This utility provides:
 * 1. Unconditional cleanup of body locks and inert attributes after navigation
 * 2. A MutationObserver guard that prevents stale inert/pointer-events
 * 3. A custom event mechanism for sections to close their dialogs on navigation
 * 4. Force-close of orphaned dialog portals
 */

// ─── Guard state ───
let guardActive = false;
let bodyObserver: MutationObserver | null = null;
let subtreeObserver: MutationObserver | null = null;
let safetyInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Check if any VISIBLE Radix UI Dialog is currently open AND its trigger
 * is NOT inside a hidden tabpanel.
 *
 * IMPORTANT: A dialog portal at body level with `data-state="open"` is
 * considered "visible" by Radix UI. But if the dialog's trigger/section
 * is inside a hidden tabpanel (keep-alive display:none), the dialog
 * shouldn't be treated as visible — it's an orphan from a hidden section.
 */
function isAnyGenuinelyVisibleDialogOpen(): boolean {
  if (typeof document === 'undefined') return false;

  // Find all open Radix UI Dialog/Sheet/AlertDialog content at body level
  const openDialogs = document.querySelectorAll(
    '[data-state="open"][role="dialog"], [data-state="open"][role="alertdialog"]'
  );

  if (openDialogs.length === 0) return false;

  for (const dialog of openDialogs) {
    // Check if the dialog content is inside a portal
    const portal = dialog.closest('[data-radix-portal]') || dialog.closest('[data-slot="sheet-portal"]') || dialog.closest('[data-slot="dialog-portal"]');

    if (!portal) {
      // Not in a portal — check if it's inside a hidden section
      const hiddenAncestor = dialog.closest(
        '[style*="display: none"], [style*="display:none"], .hidden, [aria-hidden="true"][role="tabpanel"]'
      );
      if (!hiddenAncestor) {
        // Dialog is visible and not inside a hidden section
        return true;
      }
      continue;
    }

    // The dialog IS inside a portal at body level.
    // We need to check if the dialog's TRIGGER is inside a hidden tabpanel.
    // Strategy: look for any visible dialog trigger that's NOT in a hidden tabpanel.
    // If we can't find one, the dialog is likely orphaned from a hidden section.

    // Check if ANY element with aria-haspopup="dialog" or a dialog trigger
    // is visible (not inside a hidden tabpanel)
    const dialogTriggerSelector = '[aria-haspopup="dialog"], [data-state="open"][role="dialog"] + [data-radix-collection-item]';

    // Alternative approach: check if the portal itself is visible
    // (not inside a hidden element)
    const portalParent = portal.parentElement;
    if (portalParent === document.body) {
      // Portal is a direct child of body — it's "visible" in the DOM sense.
      // But we need to check if the dialog's SECTION is visible.
      // Since we can't easily determine which section a dialog belongs to,
      // we use a heuristic: if there are open dialogs AND the page content
      // has inert, check if the user can actually see the dialog.

      // Heuristic: if the dialog's overlay (backdrop) is visible (has opacity > 0),
      // then the dialog is genuinely visible.
      const overlay = portal.querySelector('[data-radix-overlay][data-state="open"], [data-slot="sheet-overlay"][data-state="open"], [data-slot="dialog-overlay"][data-state="open"]');
      if (overlay) {
        // Check the computed opacity of the overlay
        const computedStyle = window.getComputedStyle(overlay);
        const opacity = computedStyle.opacity;
        if (opacity && parseFloat(opacity) > 0) {
          // The overlay is visible — the dialog is genuinely visible
          return true;
        }
      }

      // Check the dialog content itself for visibility
      const computedDialogStyle = window.getComputedStyle(dialog);
      if (computedDialogStyle.display !== 'none' &&
          computedDialogStyle.visibility !== 'hidden' &&
          computedDialogStyle.opacity !== '0') {
        // The dialog content appears visible
        // But we need to check if it's actually meaningful (not just an empty shell)
        // Check if the dialog has actual content (not just a skeleton)
        if (dialog.children.length > 0) {
          return true;
        }
      }
    }
  }

  // No genuinely visible dialog found
  return false;
}

/**
 * Force-remove any body styles that modals/dialogs may have added.
 *
 * Radix UI Dialog/Sheet primitives add these to <body>:
 *   - pointer-events: none
 *   - overflow: hidden
 *   - padding-right: <scrollbar-width>px
 *
 * UNCONDITIONAL: Always removes these styles, even if a dialog appears open.
 * If a dialog is genuinely visible, Radix UI will re-add these in the same
 * render cycle.
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
 * UNCONDITIONAL: Always removes inert, regardless of whether a dialog
 * appears to be open. If a dialog IS genuinely visible, Radix UI will
 * re-add inert in the same render cycle (via its useEffect).
 *
 * This is critical because in the keep-alive pattern:
 * - A dialog in a hidden section (display:none) has its portal at body level
 * - The portal has data-state="open", making it appear "visible"
 * - Radix UI keeps inert on #__next because it sees the open portal
 * - But the dialog SHOULDN'T be visible because its section is hidden
 * - So we must forcefully remove inert, and let Radix UI re-add it only
 *   if the dialog is genuinely visible
 */
function cleanupInertAttributes() {
  if (typeof document === 'undefined') return;

  // Remove inert from body itself
  document.body.removeAttribute('inert');

  // Remove inert from ALL body children (except portals, scripts, styles)
  const bodyChildren = document.body.children;
  for (let i = 0; i < bodyChildren.length; i++) {
    const child = bodyChildren[i];
    // Skip portals — they manage their own inert state
    if (child.hasAttribute('data-radix-portal')) continue;
    if (child.getAttribute('data-slot')?.includes('portal')) continue;
    // Skip non-interactive elements
    if (child.tagName === 'SCRIPT' || child.tagName === 'STYLE') continue;
    if (child.tagName === 'LINK' || child.tagName === 'META') continue;
    if (child.hasAttribute('inert')) {
      child.removeAttribute('inert');
    }
  }

  // Also scan deeper: remove inert from key interactive containers
  // This catches cases where Radix UI adds inert to a nested container
  const interactiveContainers = document.querySelectorAll(
    'main, [role="main"], header, [role="banner"], aside, nav, [role="navigation"]'
  );
  interactiveContainers.forEach((el) => {
    if (el.hasAttribute('inert')) {
      el.removeAttribute('inert');
    }
  });

  // Also check #__next (Next.js React root) specifically
  const nextRoot = document.getElementById('__next');
  if (nextRoot?.hasAttribute('inert')) {
    nextRoot.removeAttribute('inert');
  }

  // Also check any React root container
  const reactRoot = document.querySelector('[data-reactroot]') ||
                    document.querySelector('[id="__next"]') ||
                    document.querySelector('[id="root"]');
  if (reactRoot?.hasAttribute('inert')) {
    reactRoot.removeAttribute('inert');
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
      // Also mark the entire portal as non-interactive
      (portal as HTMLElement).style.pointerEvents = 'none';
    }
  });

  // 3. Also mark any orphaned sheet/dialog overlays
  const allOverlays = document.querySelectorAll(
    '[data-slot="sheet-overlay"], [data-slot="dialog-overlay"], [data-radix-overlay]'
  );
  allOverlays.forEach((overlay) => {
    const state = overlay.getAttribute('data-state');
    if (state !== 'open') {
      (overlay as HTMLElement).style.pointerEvents = 'none';
    }
  });
}

/**
 * Force-close any orphaned dialog portals.
 *
 * When a dialog in a hidden section (keep-alive) has its portal at body level
 * with data-state="open", we need to close it. We do this by dispatching
 * an Escape key event, which Radix UI Dialog listens for and handles.
 */
function forceCloseOrphanedDialogs() {
  if (typeof document === 'undefined') return;

  // Find all open dialog portals
  const openDialogs = document.querySelectorAll(
    '[data-radix-portal] [data-state="open"][role="dialog"], ' +
    '[data-radix-portal] [data-state="open"][role="alertdialog"], ' +
    '[data-slot="sheet-portal"] [data-state="open"], ' +
    '[data-slot="dialog-portal"] [data-state="open"]'
  );

  if (openDialogs.length === 0) return;

  // Check if the dialog's section is hidden
  // Since we can't easily determine which section a dialog belongs to,
  // we use the heuristic: if the page content has inert, and the dialog
  // is in a portal, the dialog might be orphaned.

  // Dispatch Escape key event to close dialogs
  // This is the safest way to close Radix UI dialogs programmatically
  const escapeEvent = new KeyboardEvent('keydown', {
    key: 'Escape',
    code: 'Escape',
    keyCode: 27,
    which: 27,
    bubbles: true,
    cancelable: true,
  });

  document.dispatchEvent(escapeEvent);
}

/**
 * Initialize the MutationObserver guard that prevents stale `inert` and
 * `pointer-events: none` from blocking page interactivity.
 *
 * This should be called once when the app mounts (in the dashboard layout).
 */
export function initNavigationGuard() {
  if (typeof document === 'undefined' || guardActive) return;
  guardActive = true;

  // ─── Observer 1: Watch body for attribute changes ───
  bodyObserver = new MutationObserver((mutations) => {
    let needsCleanup = false;

    for (const mutation of mutations) {
      if (mutation.type === 'attributes') {
        const target = mutation.target;
        if (target instanceof HTMLElement) {
          // Check if inert was added to body or body children
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
      // Use requestAnimationFrame to batch cleanup and avoid fighting React
      requestAnimationFrame(() => {
        if (!isAnyGenuinelyVisibleDialogOpen()) {
          cleanupBodyLocks();
          cleanupInertAttributes();
        }
      });
    }
  });

  // Watch body itself for attribute changes
  bodyObserver.observe(document.body, {
    attributes: true,
    attributeFilter: ['inert', 'style'],
    subtree: false,
  });

  // ─── Observer 2: Watch body children for inert attribute ───
  // This catches inert being added to #__next and other body children
  subtreeObserver = new MutationObserver((mutations) => {
    let needsCleanup = false;

    for (const mutation of mutations) {
      if (mutation.type === 'attributes') {
        const target = mutation.target;
        if (target instanceof HTMLElement) {
          if (mutation.attributeName === 'inert' && target.hasAttribute('inert')) {
            // Don't remove inert from portals — they manage their own state
            if (!target.hasAttribute('data-radix-portal') &&
                !target.getAttribute('data-slot')?.includes('portal')) {
              needsCleanup = true;
            }
          }
        }
      } else if (mutation.type === 'childList') {
        // New children added — check if they have inert
        for (const node of mutation.addedNodes) {
          if (node instanceof HTMLElement && node.hasAttribute('inert')) {
            if (!node.hasAttribute('data-radix-portal')) {
              needsCleanup = true;
            }
          }
        }
      }
    }

    if (needsCleanup) {
      requestAnimationFrame(() => {
        if (!isAnyGenuinelyVisibleDialogOpen()) {
          cleanupInertAttributes();
          cleanupBodyLocks();
        }
      });
    }
  });

  // Watch ALL body descendants for inert attribute changes
  // This is crucial because Radix UI adds inert to #__next (React root),
  // which is a child of body, not body itself.
  subtreeObserver.observe(document.body, {
    attributes: true,
    attributeFilter: ['inert'],
    childList: true,
    subtree: true,
  });

  // ─── Periodic safety check ───
  // Every 2 seconds, check if inert or pointer-events: none is blocking
  // page interaction and clean it up. This is a belt-and-suspenders approach
  // that catches any cases the MutationObserver misses.
  safetyInterval = setInterval(() => {
    if (!isAnyGenuinelyVisibleDialogOpen()) {
      cleanupBodyLocks();
      cleanupInertAttributes();
    }
  }, 2000);
}

/**
 * Destroy the navigation guard observers and safety interval.
 */
export function destroyNavigationGuard() {
  if (bodyObserver) {
    bodyObserver.disconnect();
    bodyObserver = null;
  }
  if (subtreeObserver) {
    subtreeObserver.disconnect();
    subtreeObserver = null;
  }
  if (safetyInterval) {
    clearInterval(safetyInterval);
    safetyInterval = null;
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

  // 2. Force-close any orphaned dialog portals
  //    This handles dialogs that don't listen for navigation:cleanup
  forceCloseOrphanedDialogs();

  // 3. UNCONDITIONAL cleanup of body locks and inert attributes
  //    This is critical: we MUST remove inert even if a dialog appears open,
  //    because the dialog might be orphaned from a hidden section.
  //    If the dialog is genuinely visible, Radix UI will re-add inert.
  cleanupBodyLocks();
  cleanupInertAttributes();
  markStaleOverlays();

  // 4. Safety net: cleanup after microtask (catches React batched updates)
  queueMicrotask(() => {
    cleanupBodyLocks();
    cleanupInertAttributes();
  });

  // 5. Safety net: cleanup after rAF (catches React concurrent mode)
  requestAnimationFrame(() => {
    cleanupBodyLocks();
    cleanupInertAttributes();
    markStaleOverlays();
  });

  // 6. Final safety net after 300ms (catches delayed animations/transitions)
  setTimeout(() => {
    cleanupBodyLocks();
    cleanupInertAttributes();
  }, 300);

  // 7. Extra safety net after 1s (catches very slow animations)
  setTimeout(() => {
    cleanupBodyLocks();
    cleanupInertAttributes();
  }, 1000);
}

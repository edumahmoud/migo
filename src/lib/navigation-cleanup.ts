/**
 * Navigation Cleanup Utility — v2 (Simplified & Aggressive)
 *
 * ROOT CAUSE: Radix UI Dialog adds `inert` attribute to the React root
 * when a Dialog/Sheet opens. The `inert` attribute blocks ALL user interaction
 * events (click, focus, keyboard) but does NOT block CSS `:hover` (which is
 * applied by the browser's rendering engine based on pointer position).
 * This is why users see hover effects but clicks don't work.
 *
 * PREVIOUS APPROACH (v1 — FAILED):
 * Used `isAnyGenuinelyVisibleDialogOpen()` to decide whether to remove `inert`.
 * This function was too complex and could incorrectly return `true`, preventing
 * cleanup. It also used `requestAnimationFrame` delays in the MutationObserver,
 * which allowed Radix UI to re-add `inert` between the detection and cleanup.
 *
 * NEW APPROACH (v2):
 * 1. UNCONDITIONALLY remove `inert` — always, no exceptions
 * 2. If a dialog IS genuinely open, the overlay blocks clicks on page content anyway
 * 3. If no dialog is open, `inert` shouldn't be there
 * 4. Add `pointerdown` capture-phase listener to remove `inert` on ANY interaction
 * 5. MutationObserver removes `inert` SYNCHRONOUSLY (no rAF delay)
 * 6. Remove `forceCloseOrphanedDialogs()` — dispatching Escape has side effects
 */

// ─── Guard state ───
let guardActive = false;
let bodyObserver: MutationObserver | null = null;
let subtreeObserver: MutationObserver | null = null;
let safetyInterval: ReturnType<typeof setInterval> | null = null;
let pointerdownHandler: ((e: PointerEvent) => void) | null = null;

/**
 * Force-remove any body styles that modals/dialogs may have added.
 *
 * Radix UI Dialog/Sheet primitives add these to <body>:
 *   - pointer-events: none
 *   - overflow: hidden
 *   - padding-right: <scrollbar-width>px
 *
 * UNCONDITIONAL: Always removes these styles.
 */
export function cleanupBodyLocks() {
  if (typeof document === 'undefined') return;

  const body = document.body;
  body.style.removeProperty('pointer-events');
  body.style.removeProperty('overflow');
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
 * Remove `inert` attribute from ALL non-portal page content elements.
 *
 * UNCONDITIONAL: Always removes inert from everything except portals.
 * If a dialog IS genuinely open, the overlay blocks interaction anyway.
 * If no dialog is open, inert MUST NOT be present.
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

  // Scan deeper: remove inert from key interactive containers
  const interactiveContainers = document.querySelectorAll(
    'main, [role="main"], header, [role="banner"], aside, nav, [role="navigation"], div[id]'
  );
  interactiveContainers.forEach((el) => {
    if (el.hasAttribute('inert')) {
      el.removeAttribute('inert');
    }
  });

  // Check #__next (Next.js React root) specifically
  const nextRoot = document.getElementById('__next');
  if (nextRoot?.hasAttribute('inert')) {
    nextRoot.removeAttribute('inert');
  }

  // Check any React root container
  const reactRoot = document.querySelector('[data-reactroot]') ||
                    document.querySelector('[id="__next"]') ||
                    document.querySelector('[id="root"]');
  if (reactRoot?.hasAttribute('inert')) {
    reactRoot.removeAttribute('inert');
  }

  // Nuclear option: remove inert from EVERYTHING except portals
  // This catches any edge cases where inert is added to unexpected elements
  const allInert = document.querySelectorAll('[inert]');
  allInert.forEach((el) => {
    // Keep inert on portals (they manage their own state)
    if (el.hasAttribute('data-radix-portal')) return;
    if (el.getAttribute('data-slot')?.includes('portal')) return;
    el.removeAttribute('inert');
  });
}

/**
 * Mark stale overlays as non-interactive using CSS only.
 *
 * IMPORTANT: This function does NOT remove DOM nodes. Removing React-managed
 * portal elements causes React to crash on subsequent renders/updates.
 */
export function markStaleOverlays() {
  if (typeof document === 'undefined') return;

  // Mark any closed Radix UI portal content as non-interactive
  const closedPortalContent = document.querySelectorAll(
    '[data-radix-portal] [data-state="closed"]'
  );
  closedPortalContent.forEach((el) => {
    (el as HTMLElement).style.pointerEvents = 'none';
  });

  // Mark stale overlays/backdrops (in portals with no open content)
  const portals = document.querySelectorAll('[data-radix-portal]');
  portals.forEach((portal) => {
    const hasOpenContent = portal.querySelector('[data-state="open"]');
    if (!hasOpenContent) {
      portal.querySelectorAll('[data-radix-overlay]').forEach((overlay) => {
        (overlay as HTMLElement).style.pointerEvents = 'none';
      });
      (portal as HTMLElement).style.pointerEvents = 'none';
    }
  });

  // Mark any orphaned sheet/dialog overlays
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
 * Run full cleanup — removes inert, body locks, and marks stale overlays.
 * Called UNCONDITIONALLY without checking if dialogs are open.
 */
function fullCleanup() {
  cleanupBodyLocks();
  cleanupInertAttributes();
  markStaleOverlays();
}

/**
 * Initialize the navigation guard.
 *
 * This sets up:
 * 1. MutationObserver — removes `inert` SYNCHRONOUSLY when detected
 * 2. Pointerdown capture listener — removes `inert` on ANY user interaction
 * 3. Periodic safety check — removes `inert` every 500ms as belt-and-suspenders
 */
export function initNavigationGuard() {
  if (typeof document === 'undefined' || guardActive) return;
  guardActive = true;

  // ─── Pointerdown capture-phase listener ───
  // When the user's pointer goes down, the browser dispatches a `pointerdown`
  // event at `document` level (capture phase) BEFORE it reaches the target.
  // If `inert` is on the React root, the target would be the nearest non-inert
  // ancestor, and the actual button wouldn't receive the event.
  // By removing `inert` during the capture phase, subsequent events
  // (pointerup, click) will reach the correct target.
  pointerdownHandler = () => {
    fullCleanup();
  };
  document.addEventListener('pointerdown', pointerdownHandler, true); // capture phase

  // ─── Observer 1: Watch body for attribute changes ───
  bodyObserver = new MutationObserver(() => {
    // SYNCHRONOUS cleanup — no requestAnimationFrame delay
    // This ensures inert is removed before the browser processes any events
    fullCleanup();
  });

  bodyObserver.observe(document.body, {
    attributes: true,
    attributeFilter: ['inert', 'style'],
    subtree: false,
  });

  // ─── Observer 2: Watch body descendants for inert attribute ───
  subtreeObserver = new MutationObserver(() => {
    // SYNCHRONOUS cleanup — no requestAnimationFrame delay
    fullCleanup();
  });

  subtreeObserver.observe(document.body, {
    attributes: true,
    attributeFilter: ['inert'],
    childList: true,
    subtree: true,
  });

  // ─── Periodic safety check ───
  // Every 500ms, unconditionally remove inert and body locks.
  // This catches any cases the MutationObserver and pointerdown listener miss.
  safetyInterval = setInterval(() => {
    fullCleanup();
  }, 500);
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
  if (pointerdownHandler) {
    document.removeEventListener('pointerdown', pointerdownHandler, true);
    pointerdownHandler = null;
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
  document.dispatchEvent(new CustomEvent('navigation:cleanup'));

  // 2. UNCONDITIONAL full cleanup
  fullCleanup();

  // 3. Safety net: cleanup after microtask (catches React batched updates)
  queueMicrotask(() => {
    fullCleanup();
  });

  // 4. Safety net: cleanup after rAF (catches React concurrent mode)
  requestAnimationFrame(() => {
    fullCleanup();
  });

  // 5. Safety net after 150ms (catches close animation start)
  setTimeout(() => {
    fullCleanup();
  }, 150);

  // 6. Safety net after 400ms (catches close animation mid-way)
  setTimeout(() => {
    fullCleanup();
  }, 400);

  // 7. Final safety net after 800ms (catches close animation end)
  setTimeout(() => {
    fullCleanup();
  }, 800);
}

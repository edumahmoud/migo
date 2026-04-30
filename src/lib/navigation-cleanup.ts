/**
 * Navigation Cleanup Utility — v3 (Simplified)
 *
 * The mobile sidebar now uses a custom CSS drawer instead of Radix UI Sheet,
 * which eliminates the primary source of `inert` attribute blocking.
 *
 * This utility now serves as a safety net for:
 * 1. Other Radix UI Dialogs that might be open during navigation (settings, chat, etc.)
 * 2. Any orphaned dialog portals from hidden keep-alive sections
 * 3. Body locks (overflow: hidden, pointer-events: none) from any modal
 */

// ─── Guard state ───
let guardActive = false;
let subtreeObserver: MutationObserver | null = null;
let safetyInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Force-remove any body styles that modals/dialogs may have added.
 */
export function cleanupBodyLocks() {
  if (typeof document === 'undefined') return;

  const body = document.body;
  body.style.removeProperty('pointer-events');
  body.style.removeProperty('overflow');
  body.style.removeProperty('padding-right');
  body.removeAttribute('data-scroll-locked');
  body.removeAttribute('data-radix-scroll-locked');
  body.removeAttribute('data-radix-scroll-area-overflow-style');
  body.style.pointerEvents = '';
  body.style.overflow = '';
}

/**
 * Remove `inert` attribute from ALL non-portal page content elements.
 *
 * UNCONDITIONAL: Always removes inert. If a dialog IS genuinely open,
 * the overlay blocks interaction anyway. If no dialog is open, inert
 * MUST NOT be present.
 */
function cleanupInertAttributes() {
  if (typeof document === 'undefined') return;

  // Remove inert from body itself
  document.body.removeAttribute('inert');

  // Nuclear option: remove inert from EVERYTHING except portals
  const allInert = document.querySelectorAll('[inert]');
  allInert.forEach((el) => {
    // Keep inert on Radix portals (they manage their own state)
    if (el.hasAttribute('data-radix-portal')) return;
    if (el.getAttribute('data-slot')?.includes('portal')) return;
    el.removeAttribute('inert');
  });
}

/**
 * Mark stale overlays as non-interactive using CSS only.
 */
export function markStaleOverlays() {
  if (typeof document === 'undefined') return;

  // Mark any closed Radix UI portal content as non-interactive
  document.querySelectorAll('[data-radix-portal] [data-state="closed"]').forEach((el) => {
    (el as HTMLElement).style.pointerEvents = 'none';
  });

  // Mark stale portals (no open content) as non-interactive
  document.querySelectorAll('[data-radix-portal]').forEach((portal) => {
    const hasOpenContent = portal.querySelector('[data-state="open"]');
    if (!hasOpenContent) {
      portal.querySelectorAll('[data-radix-overlay]').forEach((overlay) => {
        (overlay as HTMLElement).style.pointerEvents = 'none';
      });
      (portal as HTMLElement).style.pointerEvents = 'none';
    }
  });

  // Mark closed overlays
  document.querySelectorAll(
    '[data-slot="sheet-overlay"], [data-slot="dialog-overlay"], [data-radix-overlay]'
  ).forEach((overlay) => {
    const state = overlay.getAttribute('data-state');
    if (state !== 'open') {
      (overlay as HTMLElement).style.pointerEvents = 'none';
    }
  });
}

/**
 * Full cleanup — removes inert, body locks, and marks stale overlays.
 */
function fullCleanup() {
  cleanupBodyLocks();
  cleanupInertAttributes();
  markStaleOverlays();
}

/**
 * Initialize the navigation guard.
 *
 * Sets up:
 * 1. MutationObserver — removes `inert` synchronously when detected on non-portal elements
 * 2. Periodic safety check — removes `inert` and body locks every 500ms
 */
export function initNavigationGuard() {
  if (typeof document === 'undefined' || guardActive) return;
  guardActive = true;

  // ─── MutationObserver: Watch for inert attribute additions ───
  subtreeObserver = new MutationObserver((mutations) => {
    let needsCleanup = false;

    for (const mutation of mutations) {
      if (mutation.type === 'attributes' && mutation.attributeName === 'inert') {
        const target = mutation.target;
        if (target instanceof HTMLElement && target.hasAttribute('inert')) {
          // Don't remove inert from portals
          if (!target.hasAttribute('data-radix-portal') &&
              !target.getAttribute('data-slot')?.includes('portal')) {
            needsCleanup = true;
          }
        }
      } else if (mutation.type === 'attributes' && mutation.attributeName === 'style') {
        const target = mutation.target;
        if (target === document.body && target instanceof HTMLElement) {
          const pe = target.style.pointerEvents;
          if (pe === 'none') {
            needsCleanup = true;
          }
        }
      } else if (mutation.type === 'childList') {
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
      // Synchronous cleanup — no delay
      fullCleanup();
    }
  });

  subtreeObserver.observe(document.body, {
    attributes: true,
    attributeFilter: ['inert', 'style'],
    childList: true,
    subtree: true,
  });

  // ─── Periodic safety check ───
  safetyInterval = setInterval(() => {
    fullCleanup();
  }, 500);
}

/**
 * Destroy the navigation guard.
 */
export function destroyNavigationGuard() {
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
 */
export function cleanupAfterNavigation() {
  if (typeof document === 'undefined') return;

  // 1. Dispatch custom event so sections can close their dialogs
  document.dispatchEvent(new CustomEvent('navigation:cleanup'));

  // 2. Full cleanup
  fullCleanup();

  // 3. Deferred cleanups for animation timing
  requestAnimationFrame(() => {
    fullCleanup();
  });

  setTimeout(() => {
    fullCleanup();
  }, 300);

  setTimeout(() => {
    fullCleanup();
  }, 600);
}

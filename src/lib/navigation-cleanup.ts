/**
 * Navigation Cleanup Utility — v4 (Definitive Fix)
 *
 * ROOT CAUSE: The `inert` HTML attribute blocks ALL user interaction events
 * (click, focus, keyboard) but does NOT block CSS :hover. This is why users
 * see hover effects but clicks don't work after navigation.
 *
 * Radix UI Dialog adds `inert` to page content when a dialog opens, and
 * removes it when the dialog closes. However, if a dialog's close animation
 * is interrupted (e.g., by navigation), `inert` can be left on the page
 * permanently.
 *
 * PREVIOUS APPROACHES (all failed):
 *   v1-v2: Conditional removal — too conservative, missed edge cases
 *   v3: Unconditional removal + MutationObserver + 500ms interval — still
 *       had a gap between inert being (re-)added and the next cleanup cycle
 *
 * CURRENT APPROACH (v4):
 *   1. requestAnimationFrame loop after each navigation — runs every 16ms
 *      for 2 seconds, catching any inert re-addition within one frame
 *   2. MutationObserver — immediate synchronous cleanup on inert addition
 *   3. Safety interval — 1-second periodic check as last resort
 *   4. Cleanup also covers <html> element (not just <body>)
 *
 * Key insight: The rAF loop after navigation is critical because Radix UI
 * can re-add `inert` during its close animation (up to 300ms), and the
 * MutationObserver callback might run after the re-addition but before
 * the next paint, causing a brief but disruptive gap.
 */

// ─── Guard state ───
let guardActive = false;
let subtreeObserver: MutationObserver | null = null;
let safetyInterval: ReturnType<typeof setInterval> | null = null;
let rafCleanupId: number | null = null;
let rafCleanupEnd = 0;

/**
 * Check if any Radix UI dialog is genuinely open (not closing/closed).
 */
function isDialogGenuinelyOpen(): boolean {
  // Check for open dialog/alert-dialog content in portals
  const openDialogs = document.querySelectorAll(
    '[data-state="open"][data-slot="dialog-content"], ' +
    '[data-state="open"][data-slot="alert-dialog-content"], ' +
    '[data-state="open"][data-slot="sheet-content"]'
  );
  return openDialogs.length > 0;
}

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
 * Remove `inert` attribute from ALL elements that shouldn't have it.
 *
 * Strategy:
 * - If a dialog IS genuinely open → only remove inert from the <html> and
 *   <body> elements (these should never have inert directly; Radix adds
 *   inert to a wrapper div, not body/html)
 * - If NO dialog is open → remove inert from EVERYTHING
 */
function cleanupInertAttributes() {
  if (typeof document === 'undefined') return;

  const dialogOpen = isDialogGenuinelyOpen();

  // Always remove inert from <html> — it should never have inert
  document.documentElement.removeAttribute('inert');

  // Always remove inert from <body> — Radix adds inert to a wrapper, not body
  document.body.removeAttribute('inert');

  if (!dialogOpen) {
    // No dialog is open — remove inert from EVERYTHING
    const allInert = document.querySelectorAll('[inert]');
    allInert.forEach((el) => {
      el.removeAttribute('inert');
    });
  } else {
    // A dialog IS open — only remove inert from non-portal elements
    // Radix portals render at body level and manage their own inert state
    const allInert = document.querySelectorAll('[inert]');
    allInert.forEach((el) => {
      // Skip elements inside Radix portals (they manage their own state)
      if (el.closest('[data-radix-portal]')) return;
      // Skip the portal itself
      if (el.hasAttribute('data-radix-portal')) return;
      // Skip Radix dialog content (the open dialog itself)
      if (el.getAttribute('data-slot')?.includes('dialog-content') ||
          el.getAttribute('data-slot')?.includes('sheet-content')) return;
      el.removeAttribute('inert');
    });
  }
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
 * Start a requestAnimationFrame cleanup loop.
 * This runs every frame for the specified duration, ensuring that
 * any `inert` re-addition is caught within one frame (16ms).
 */
function startRafCleanup(durationMs = 2000) {
  rafCleanupEnd = Date.now() + durationMs;

  function rafLoop() {
    if (Date.now() > rafCleanupEnd) {
      rafCleanupId = null;
      return;
    }
    fullCleanup();
    rafCleanupId = requestAnimationFrame(rafLoop);
  }

  // Cancel any existing rAF loop
  if (rafCleanupId !== null) {
    cancelAnimationFrame(rafCleanupId);
  }
  rafCleanupId = requestAnimationFrame(rafLoop);
}

/**
 * Initialize the navigation guard.
 *
 * Sets up:
 * 1. MutationObserver — removes `inert` synchronously when detected
 * 2. Periodic safety check — removes `inert` and body locks every 1 second
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
          needsCleanup = true;
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
            needsCleanup = true;
          }
        }
      }
    }

    if (needsCleanup) {
      // Synchronous cleanup — no delay
      fullCleanup();
    }
  });

  // Observe both <html> and <body> with subtree
  subtreeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['inert', 'style'],
    childList: true,
    subtree: true,
  });

  // ─── Periodic safety check (1 second) ───
  safetyInterval = setInterval(() => {
    fullCleanup();
  }, 1000);
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
  if (rafCleanupId !== null) {
    cancelAnimationFrame(rafCleanupId);
    rafCleanupId = null;
  }
  guardActive = false;
}

/**
 * Comprehensive cleanup that should be called on every navigation.
 *
 * This triggers:
 * 1. A custom event so sections can close their dialogs
 * 2. Immediate full cleanup
 * 3. A 2-second requestAnimationFrame loop for aggressive cleanup
 * 4. Deferred cleanups at 300ms, 600ms, and 1000ms
 */
export function cleanupAfterNavigation() {
  if (typeof document === 'undefined') return;

  // 1. Dispatch custom event so sections can close their dialogs
  document.dispatchEvent(new CustomEvent('navigation:cleanup'));

  // 2. Immediate full cleanup
  fullCleanup();

  // 3. Start rAF cleanup loop for 2 seconds (critical for catching
  //    inert re-additions during Radix Dialog close animations)
  startRafCleanup(2000);

  // 4. Deferred cleanups for animation timing
  setTimeout(() => {
    fullCleanup();
  }, 300);

  setTimeout(() => {
    fullCleanup();
  }, 600);

  setTimeout(() => {
    fullCleanup();
  }, 1000);
}

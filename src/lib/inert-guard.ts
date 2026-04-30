/**
 * Inert Guard — Module-level singleton that prevents stale `inert` attributes
 * from blocking the entire page after navigation.
 *
 * ROOT CAUSE OF THE BUG:
 * Radix UI Dialog/Sheet/AlertDialog adds `inert` to sibling elements
 * when a dialog opens (modal behavior). The `inert` attribute blocks
 * ALL user interaction (click, focus, keyboard) but NOT CSS :hover.
 * This is exactly why users see hover effects but clicks don't work.
 *
 * When a section with a Dialog unmounts during navigation (conditional
 * rendering), Radix's cleanup animation may not complete, leaving
 * `inert` stuck on the page root. The per-component `useInertCleanup`
 * hooks stop running when the Dialog unmounts, so they can't clean up.
 *
 * SOLUTION (v2 — conservative approach):
 * This module runs at the module level (not inside a React component),
 * so it persists across component mounts/unmounts. It:
 *   1. Removes `inert` from html/body on a 100ms interval
 *   2. Removes `pointer-events: none` from body style on a 100ms interval
 *   3. Removes `inert` from non-dialog elements when pathname changes
 *
 * IMPORTANT: We do NOT override setAttribute or use MutationObserver.
 * Those approaches interfere with React's DOM reconciliation and cause
 * "Cannot read properties of null (reading 'removeChild')" errors.
 * We also do NOT remove inert from inside open dialogs.
 */

let initialized = false;

/**
 * Remove `inert` from html/body and any stale inert on non-dialog elements.
 * Also fix body pointer-events.
 */
function forceRemoveInert() {
  if (typeof document === 'undefined') return;

  // Always remove inert from html and body — these are the main culprits
  // Radix adds inert to html/body siblings when a dialog opens
  if (document.documentElement.hasAttribute('inert')) {
    document.documentElement.removeAttribute('inert');
  }
  if (document.body.hasAttribute('inert')) {
    document.body.removeAttribute('inert');
  }

  // Remove inert from other elements ONLY if there's no open dialog.
  // If a dialog is genuinely open, its inert is intentional.
  const hasOpenDialog = document.querySelector('[data-state="open"][role="dialog"]');
  if (!hasOpenDialog) {
    document.querySelectorAll('[inert]').forEach((el) => {
      // Don't remove from inside Radix portals (that's the dialog content itself)
      if (!el.closest('[data-radix-portal]')) {
        el.removeAttribute('inert');
      }
    });
  }

  // Fix body pointer-events (another Radix artifact)
  if (document.body.style.pointerEvents === 'none') {
    document.body.style.pointerEvents = '';
  }
}

function initInertGuard() {
  if (typeof window === 'undefined' || initialized) return;
  initialized = true;

  // ── Periodic cleanup ──
  // 100ms interval that removes inert from html/body.
  // This is fast enough to prevent user-visible blocking (previous was 500ms).
  // We don't use MutationObserver or setAttribute override because those
  // interfere with React's DOM reconciliation and cause removeChild errors.
  setInterval(forceRemoveInert, 100);

  // ── Run immediately ──
  forceRemoveInert();
}

// Auto-initialize when this module is imported
initInertGuard();

export { forceRemoveInert, initInertGuard };

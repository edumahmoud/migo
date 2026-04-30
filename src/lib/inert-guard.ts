/**
 * Inert Guard — Module-level singleton that prevents `inert` attribute
 * from blocking the entire page.
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
 * SOLUTION:
 * This module runs at the module level (not inside a React component),
 * so it persists across component mounts/unmounts. It:
 *   1. Immediately removes `inert` from html/body when detected
 *   2. Uses MutationObserver for instant detection
 *   3. Uses setInterval as belt-and-suspenders fallback
 *   4. Overrides setAttribute on html/body to block `inert` entirely
 *
 * Trade-off: Dialogs won't truly "trap" focus in the background.
 * The overlay still visually blocks the background and clicking it
 * closes the dialog. This is acceptable because the alternative
 * (broken clicks everywhere) is much worse.
 */

let initialized = false;

function forceRemoveInert() {
  if (typeof document === 'undefined') return;

  // Remove inert from root elements immediately
  document.documentElement.removeAttribute('inert');
  document.body.removeAttribute('inert');

  // Remove inert from ALL other elements
  // (No exception for [data-radix-portal] — closed dialog portals
  // with inert can also block interaction)
  document.querySelectorAll('[inert]').forEach((el) => {
    // Only keep inert inside an actually open dialog content
    const isInOpenDialog = el.closest('[data-state="open"][role="dialog"]');
    if (!isInOpenDialog) {
      el.removeAttribute('inert');
    }
  });

  // Fix body pointer-events (another Radix artifact)
  if (document.body.style.pointerEvents === 'none') {
    document.body.style.pointerEvents = '';
  }
}

function initInertGuard() {
  if (typeof window === 'undefined' || initialized) return;
  initialized = true;

  // ── 1. Override setAttribute on html and body ──
  // Prevent `inert` from ever being set on document.documentElement or body.
  // These are the elements Radix typically adds `inert` to.
  const origSetAttribute = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (name: string, value: string) {
    if (
      name === 'inert' &&
      (this === document.documentElement || this === document.body)
    ) {
      // Silently ignore — never allow inert on html/body
      return;
    }
    return origSetAttribute.call(this, name, value);
  };

  // ── 2. MutationObserver — remove inert IMMEDIATELY when added ──
  // Unlike the previous queueMicrotask approach, we remove inert
  // SYNCHRONOUSLY in the observer callback. This prevents the race
  // condition where Radix adds inert, we queue a microtask to remove
  // it, but the user's click happens before the microtask runs.
  const observer = new MutationObserver((mutations) => {
    let needsCleanup = false;
    for (const mutation of mutations) {
      if (mutation.type === 'attributes' && mutation.attributeName === 'inert') {
        const target = mutation.target;
        if (target instanceof HTMLElement && target.hasAttribute('inert')) {
          // Remove inert immediately (synchronously)
          // Only keep inert inside an actually open dialog
          const isInOpenDialog = target.closest('[data-state="open"][role="dialog"]');
          if (!isInOpenDialog) {
            target.removeAttribute('inert');
          }
          needsCleanup = true;
        }
      }
      // Also catch style changes on body (pointer-events: none)
      if (
        mutation.type === 'attributes' &&
        mutation.attributeName === 'style' &&
        mutation.target === document.body &&
        document.body.style.pointerEvents === 'none'
      ) {
        document.body.style.pointerEvents = '';
        needsCleanup = true;
      }
    }
    // If we removed inert, also do a full pass to catch any we missed
    if (needsCleanup) {
      forceRemoveInert();
    }
  });

  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['inert', 'style'],
    subtree: true,
  });

  // ── 3. Periodic cleanup as belt-and-suspenders fallback ──
  // 100ms is fast enough that users won't notice, but slow enough
  // to not cause performance issues.
  setInterval(forceRemoveInert, 100);

  // ── 4. Run immediately ──
  forceRemoveInert();
}

// Auto-initialize when this module is imported
initInertGuard();

export { forceRemoveInert, initInertGuard };

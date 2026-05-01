/**
 * Navigation Cleanup Utility — v12
 *
 * CRITICAL FIX: In Next.js App Router, there's NO #__next or #root wrapper
 * div — React renders directly into <body>. Previous safety nets used
 * `document.getElementById('__next')` which ALWAYS returned null, so they
 * NEVER cleaned up stuck `inert` or `aria-hidden` attributes!
 *
 * This version scans ALL children of document.body for stuck attributes.
 */

/**
 * Called on navigation to clean up any leftover state.
 */
export function cleanupAfterNavigation() {
  if (typeof document === 'undefined') return;

  // Dispatch custom event so sections can close their dialogs
  document.dispatchEvent(new CustomEvent('navigation:cleanup'));

  const body = document.body;

  // Safety net 1: Fix stale body.style.pointerEvents
  if (body.style.pointerEvents === 'none') {
    console.warn('[navigation-cleanup] Fixing stuck body.style.pointerEvents = "none"');
    body.style.pointerEvents = '';
  }

  // Safety net 2: Fix stuck body.style.overflow
  if (body.style.overflow === 'hidden') {
    console.warn('[navigation-cleanup] Fixing stuck body.style.overflow = "hidden"');
    body.style.overflow = '';
  }

  // Safety net 3: Scan ALL body children for stuck inert/aria-hidden
  // This is the CRITICAL fix — previous versions only checked #__next which
  // doesn't exist in Next.js App Router!
  const bodyChildren = body.children;
  for (let i = 0; i < bodyChildren.length; i++) {
    const el = bodyChildren[i] as HTMLElement;

    // Skip Radix portal elements (they manage their own state)
    if (el.hasAttribute('data-radix-portal') || el.getAttribute('data-slot')?.includes('portal')) {
      continue;
    }

    // Skip script, style, link, meta elements
    const tag = el.tagName.toLowerCase();
    if (tag === 'script' || tag === 'style' || tag === 'link' || tag === 'meta') {
      continue;
    }

    // Remove stuck inert attribute
    if (el.hasAttribute('inert')) {
      console.warn('[navigation-cleanup] Removing stuck inert from', tag, el.id || el.className?.substring(0, 50));
      el.removeAttribute('inert');
    }

    // Remove stuck aria-hidden
    if (el.getAttribute('aria-hidden') === 'true') {
      console.warn('[navigation-cleanup] Removing stuck aria-hidden from', tag, el.id || el.className?.substring(0, 50));
      el.removeAttribute('aria-hidden');
    }

    // Remove stuck data-aria-hidden marker
    if (el.getAttribute('data-aria-hidden') === 'true') {
      el.removeAttribute('data-aria-hidden');
    }
  }

  // Safety net 4: Remove any leftover Radix portal overlays that are
  // stuck in the closed state. These `fixed inset-0 z-50` elements
  // cover the entire screen and block all clicks.
  const closedOverlays = document.querySelectorAll(
    '[data-state="closed"][data-radix-dialog-overlay], ' +
    '[data-state="closed"][data-radix-alert-dialog-overlay], ' +
    '[data-state="closed"][data-slot="dialog-overlay"], ' +
    '[data-state="closed"][data-slot="sheet-overlay"], ' +
    '[data-slot="alert-dialog-overlay"][data-state="closed"]'
  );
  closedOverlays.forEach((el) => {
    console.warn('[navigation-cleanup] Removing stuck closed overlay from DOM');
    el.remove();
  });

  // Safety net 5: Remove any Radix portal containers that are empty
  // or contain only closed-state elements.
  document.querySelectorAll('[data-radix-portal]').forEach((portal) => {
    const hasOpenContent = portal.querySelector('[data-state="open"]');
    if (!hasOpenContent) {
      console.warn('[navigation-cleanup] Removing orphaned Radix portal');
      portal.remove();
    }
  });
}

// These are no longer used but kept for backward compatibility
export function initNavigationGuard() { /* no-op */ }
export function destroyNavigationGuard() { /* no-op */ }

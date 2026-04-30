'use client';

import { useState, useCallback } from 'react';

/**
 * SectionTransition — wraps a keep-alive section to add smooth enter animations.
 *
 * Problem:
 *   Dashboard sections use a "keep-alive" pattern: all mounted sections stay in
 *   the DOM, toggled via the CSS `hidden` class. This prevents expensive
 *   unmount/remount cycles but results in jarring instant-switch navigation
 *   with no visual transition.
 *
 * Solution:
 *   This wrapper detects when its section transitions from inactive → active
 *   and applies a CSS animation (`animate-section-enter` defined in globals.css).
 *   The animation fades in + slides up the content over 300ms.
 *   It re-triggers on every navigation by toggling `shouldAnimate` state.
 *
 *   Uses the same render-phase state update pattern as `useMountedSections`
 *   to avoid lint violations (no setState in effects, no ref updates in render).
 *
 * IMPORTANT: Does NOT use `role="tabpanel"` or `aria-hidden` because:
 *   - The CSS rule `[role="tabpanel"][aria-hidden="true"]` applies
 *     `pointer-events: none !important`, which can interfere with interaction
 *   - The `hidden` class (display: none) already handles visibility completely
 *   - Using both `hidden` + `aria-hidden` is redundant and risks CSS conflicts
 *
 * Usage:
 *   <SectionTransition isActive={activeSection === 'dashboard'}>
 *     <DashboardContent />
 *   </SectionTransition>
 */
export default function SectionTransition({
  isActive,
  children,
}: {
  isActive: boolean;
  children: React.ReactNode;
}) {
  // Track the previous value of isActive using state (not ref, to avoid lint issues)
  const [prevIsActive, setPrevIsActive] = useState(isActive);
  const [shouldAnimate, setShouldAnimate] = useState(false);

  // Detect inactive → active transition during render.
  // This is the recommended React pattern for derived state that grows over time,
  // same as used in useMountedSections hook.
  if (isActive && !prevIsActive) {
    setPrevIsActive(true);
    setShouldAnimate(true);
  } else if (!isActive && prevIsActive) {
    setPrevIsActive(false);
  }

  const handleAnimationEnd = useCallback(() => {
    setShouldAnimate(false);
  }, []);

  return (
    <div className={isActive ? '' : 'hidden'}>
      <div
        className={shouldAnimate ? 'animate-section-enter' : ''}
        onAnimationEnd={handleAnimationEnd}
      >
        {children}
      </div>
    </div>
  );
}

'use client';

import { useState, useCallback } from 'react';

/**
 * Hook to track which sections have been mounted.
 * Implements a "keep-alive" pattern: sections are mounted lazily on first visit,
 * then kept mounted (hidden with CSS) when navigating away.
 * This prevents the expensive unmount/remount cycle that was causing navigation freezes.
 *
 * Uses the "adjusting state during render" pattern (instead of useEffect + setState)
 * to avoid cascading renders and satisfy the react-hooks/set-state-in-effect lint rule.
 * See: https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes
 *
 * Usage:
 *   const { isMounted, isActive } = useMountedSections(activeSection);
 *   // isMounted('chat') → true after user visits chat for the first time
 *   // isActive('chat') → true only when chat is the current section
 */
export function useMountedSections(activeSection: string) {
  const [mountedSections, setMountedSections] = useState<Set<string>>(() => new Set([activeSection]));

  // Adjust state during render (before any early returns) when activeSection changes.
  // This is the recommended React pattern for derived state that grows over time.
  if (!mountedSections.has(activeSection)) {
    const next = new Set(mountedSections);
    next.add(activeSection);
    setMountedSections(next);
  }

  const isMounted = useCallback(
    (section: string) => mountedSections.has(section),
    [mountedSections]
  );

  const isActive = useCallback(
    (section: string) => section === activeSection,
    [activeSection]
  );

  return { isMounted, isActive, mountedSections };
}

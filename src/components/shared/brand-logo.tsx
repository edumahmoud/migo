'use client';

/**
 * BrandLogo — v132e
 *
 * A reusable brand logo component that shows the institution's logo
 * image when available, falling back to the default gradient +
 * GraduationCap icon.
 *
 * v132e change: reads localStorage SYNCHRONOUSLY in useState's lazy
 * initializer (instead of useEffect) so the logo is available on the
 * very first render — no GraduationCap flash. Also adds a subtle
 * fade-in + scale animation when the logo appears.
 *
 * v132d change: when a logo is present, the container has NO gradient
 * background — just a transparent surface so the logo appears naturally.
 *
 * Used in:
 *   - All loading/splash screens (replaces the hardcoded GraduationCap)
 *   - Error boundaries
 *   - Any place that needs to show the institution brand
 *
 * The logo URL is read from two sources (in priority order):
 *   1. The institution store (if populated — for components inside
 *      the React tree after the store has loaded)
 *   2. localStorage 'attendo-institution-logo' (read SYNCHRONOUSLY in
 *      useState's lazy initializer — gives instant logo on first paint)
 *
 * If neither source has a logo URL, the fallback gradient box with
 * GraduationCap is shown.
 */

import { useState, useEffect } from 'react';
import { GraduationCap } from 'lucide-react';
import { useInstitutionStore } from '@/stores/institution-store';

// Cache key for localStorage — must match the key used in
// institution-store.ts / institution-head.tsx.
const LOGO_STORAGE_KEY = 'attendo-institution-logo';

/** Read the logo URL from localStorage SYNCHRONOUSLY. */
function readLogoFromStorage(): string | null {
  try {
    const stored = localStorage.getItem(LOGO_STORAGE_KEY);
    if (stored && stored !== 'null' && stored !== 'undefined') {
      return stored;
    }
  } catch {
    // localStorage may be unavailable (private mode, SSR, etc.)
  }
  return null;
}

export function BrandLogo({
  size = 'md',
  withShadow = true,
  className = '',
}: {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  withShadow?: boolean;
  className?: string;
}) {
  // Read the logo URL from the institution store (reactive — updates
  // when the store is populated).
  const storeLogo = useInstitutionStore((s) => s.institution?.logo_url);

  // v132e: read localStorage SYNCHRONOUSLY in the lazy initializer.
  // This makes the logo available on the VERY FIRST render — no flash
  // of the GraduationCap fallback. The previous approach used useEffect
  // to read localStorage, which meant the first render saw null → showed
  // GraduationCap for one frame → then swapped to the logo.
  const [cachedLogo, setCachedLogo] = useState<string | null>(readLogoFromStorage);

  // When the store updates, also update the localStorage cache + state.
  useEffect(() => {
    if (storeLogo) {
      setCachedLogo(storeLogo);
      try { localStorage.setItem(LOGO_STORAGE_KEY, storeLogo); } catch { /* ignore */ }
    }
  }, [storeLogo]);

  const logoUrl = storeLogo || cachedLogo;

  // Size mapping for the container + icon.
  const sizeMap = {
    sm: { box: 'w-10 h-10 rounded-xl', icon: 'w-5 h-5' },
    md: { box: 'w-12 h-12 rounded-xl', icon: 'w-6 h-6' },
    lg: { box: 'w-16 h-16 rounded-2xl', icon: 'w-9 h-9' },
    xl: { box: 'w-20 h-20 rounded-2xl', icon: 'w-11 h-11' },
  } as const;
  const dims = sizeMap[size];

  const shadowClass = withShadow ? 'shadow-lg shadow-sky-500/30' : '';

  if (logoUrl) {
    // v132d: NO gradient background — just a transparent surface so
    // the logo appears naturally. v132e: add a subtle fade-in + scale
    // animation so the logo "pops in" smoothly instead of appearing
    // abruptly.
    return (
      <div
        className={`${dims.box} ${shadowClass} overflow-hidden flex items-center justify-center shrink-0 bg-transparent animate-in fade-in zoom-in duration-300 ${className}`}
      >
        <img
          src={logoUrl}
          alt="شعار المؤسسة"
          className="w-full h-full object-contain"
          onError={(e) => {
            // If the logo fails to load (e.g., 404, broken URL),
            // hide the img so the fallback gradient shows.
            (e.currentTarget as HTMLImageElement).style.display = 'none';
          }}
        />
      </div>
    );
  }

  // Fallback: gradient box + GraduationCap icon (only when NO logo
  // exists at all — e.g., fresh install before setup wizard).
  return (
    <div
      className={`${dims.box} ${shadowClass} bg-sky-600 flex items-center justify-center shrink-0 ${className}`}
    >
      <GraduationCap className={`${dims.icon} text-white`} />
    </div>
  );
}

/**
 * getInstitutionLogoFromStorage — v132c
 *
 * Reads the institution logo URL from localStorage SYNCHRONOUSLY.
 * Used by components that run OUTSIDE the React tree (global-error.tsx,
 * offline page, etc.) where hooks aren't available.
 *
 * Returns null if no logo is cached or localStorage is unavailable.
 */
export function getInstitutionLogoFromStorage(): string | null {
  return readLogoFromStorage();
}

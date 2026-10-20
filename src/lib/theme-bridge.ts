/**
 * Theme Bridge — v134n
 *
 * Maps Mantine theme identities to shadcn CSS variables.
 * This allows shadcn components to automatically use the selected
 * Mantine color identity WITHOUT rewriting every shadcn component.
 *
 * When the user changes their theme identity, this bridge updates the
 * CSS variables on :root (light) and .dark (dark mode), and all
 * shadcn components re-render with the new colors instantly.
 *
 * Color mapping strategy:
 *   - primary: shade[6] of the identity (Mantine's primary shade)
 *   - ring: same as primary
 *   - accent: shade[4] (slightly lighter)
 *   - chart-1..5: rotated through the identity's shades
 *   - sidebar-primary: same as primary
 *
 * Background/foreground/border stay unchanged — only the accent colors
 * follow the identity. This keeps the UI consistent while letting users
 * pick their preferred accent color.
 */

import { useEffect } from 'react';
import { useThemeStore } from '@/stores/theme-store';
import { IDENTITY_LABELS, type ThemeIdentity } from '@/lib/mantine-theme';

// Hex → OKLCH converter (approximate, good enough for UI theming).
// Source: https://en.wikipedia.org/wiki/OKLCH_color_space
function hexToOklch(hex: string): string {
  // Remove # and parse RGB
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;

  // sRGB → linear
  const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const lr = lin(r), lg = lin(g), lb = lin(b);

  // Linear sRGB → OKLab (D65)
  let lx = 0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb;
  let ly = 0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb;
  let lz = 0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb;

  // OKLab → OKLCH
  const okL = 0.2104542553 * lx + 0.7936177850 * ly - 0.0040720468 * lz;
  const okA = 1.9779984951 * lx - 2.4285922050 * ly + 0.4505937099 * lz;
  const okB = 0.0259040371 * lx + 0.7827717662 * ly - 0.8086757660 * lz;
  const okC = Math.sqrt(okA * okA + okB * okB);
  const okH = Math.atan2(okB, okA) * (180 / Math.PI);
  const hue = okH < 0 ? okH + 360 : okH;

  return `oklch(${okL.toFixed(3)} ${okC.toFixed(3)} ${hue.toFixed(1)})`;
}

// Build the CSS variable overrides for a given identity.
function buildCssVars(identity: ThemeIdentity): Record<string, string> {
  const labels = IDENTITY_LABELS[identity];
  // Use the primary hex color from IDENTITY_LABELS.
  // We compute lighter/darker variants by mixing with white/black in OKLCH space.
  const primaryOklch = hexToOklch(labels.hex);

  // For the primary-foreground, we use white (light mode) or near-white (dark mode)
  // since the primary colors are dark enough.
  return {
    '--primary': primaryOklch,
    '--primary-foreground': 'oklch(0.985 0 0)',
    '--ring': primaryOklch,
    '--sidebar-primary': primaryOklch,
    '--sidebar-primary-foreground': 'oklch(0.985 0 0)',
    '--sidebar-ring': primaryOklch,
    '--chart-1': primaryOklch,
  };
}

/**
 * Hook that applies the current theme identity to shadcn CSS variables.
 * Call this once in a top-level component (e.g., MantineProviders).
 */
export function useThemeBridge() {
  const identity = useThemeStore((s) => s.identity);
  const mode = useThemeStore((s) => s.mode);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const vars = buildCssVars(identity);
    const root = document.documentElement;

    // Apply to both :root (light) and .dark (dark mode)
    // by setting on :root — the .dark selector will override
    // background/foreground but keep our primary color.
    Object.entries(vars).forEach(([key, value]) => {
      root.style.setProperty(key, value);
    });

    // For dark mode, we want a slightly lighter primary.
    // We detect dark mode by checking if .dark class is on <html>.
    const isDark = root.classList.contains('dark');
    if (isDark) {
      // Lighten the primary by ~15% in OKLCH L channel
      const primaryOklch = vars['--primary'];
      // Parse and lighten
      const match = primaryOklch.match(/oklch\(([0-9.]+) ([0-9.]+) ([0-9.]+)\)/);
      if (match) {
        const l = Math.min(0.85, parseFloat(match[1]) + 0.12);
        const c = match[2];
        const h = match[3];
        const lightened = `oklch(${l} ${c} ${h})`;
        root.style.setProperty('--primary', lightened);
        root.style.setProperty('--ring', lightened);
        root.style.setProperty('--sidebar-primary', lightened);
        root.style.setProperty('--sidebar-ring', lightened);
        root.style.setProperty('--chart-1', lightened);
      }
    }
  }, [identity, mode]);
}

/**
 * Listen for dark mode class changes on <html> and re-apply the bridge.
 * This handles the case where the user toggles dark mode via the existing
 * ThemeToggle (which adds/removes the 'dark' class).
 */
export function useDarkModeListener() {
  const identity = useThemeStore((s) => s.identity);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;

    // Initial apply
    const apply = () => {
      const vars = buildCssVars(identity);
      const isDark = root.classList.contains('dark');
      Object.entries(vars).forEach(([key, value]) => {
        root.style.setProperty(key, value);
      });
      if (isDark) {
        const match = vars['--primary'].match(/oklch\(([0-9.]+) ([0-9.]+) ([0-9.]+)\)/);
        if (match) {
          const l = Math.min(0.85, parseFloat(match[1]) + 0.12);
          const lightened = `oklch(${l} ${match[2]} ${match[3]})`;
          root.style.setProperty('--primary', lightened);
          root.style.setProperty('--ring', lightened);
          root.style.setProperty('--sidebar-primary', lightened);
          root.style.setProperty('--sidebar-ring', lightened);
          root.style.setProperty('--chart-1', lightened);
        }
      }
    };

    apply();

    // Observe class attribute changes on <html>
    const observer = new MutationObserver(apply);
    observer.observe(root, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, [identity]);
}

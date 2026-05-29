'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { motion } from 'framer-motion';
import { useTranslations } from '@/i18n/use-translations';

/**
 * ThemeToggle — a simple toggle button that flips between light and dark mode.
 *
 * IMPORTANT: This component does NOT initialize the theme on mount.
 * Theme initialization happens in the inline <script> in layout.tsx,
 * which runs BEFORE React hydrates. This prevents dark mode from
 * being activated unexpectedly when the dropdown opens for the first time.
 *
 * On mount, we only READ the current DOM state to sync our local state.
 */
export default function ThemeToggle() {
  const [dark, setDark] = useState(false);
  const [mounted, setMounted] = useState(false);
  const { t } = useTranslations();

  // Keep a ref in sync so the toggle callback always reads the latest value
  // without needing `dark` in its dependency array (prevents stale closure).
  // Updated via useEffect to comply with React's rules of hooks (no ref writes during render).
  const darkRef = useRef(dark);
  useEffect(() => { darkRef.current = dark; });

  // ─── Mount guard ───
  // Prevents the toggle from firing during the initial render cycle.
  // When the ThemeToggle mounts inside a dropdown, the enter animation
  // can create a timing window where a residual click/touch event from
  // the triggering interaction (opening the dropdown) is dispatched to
  // the newly rendered button. By delaying interactivity until after the
  // browser has painted (via requestAnimationFrame), we ensure any
  // spurious events from the dropdown opening are safely ignored.
  const canToggleRef = useRef(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reading from external system (DOM) and syncing to React state
    setMounted(true);
    // Only READ the current DOM state — do NOT apply/modify the theme.
    // Theme initialization is handled by the inline script in layout.tsx
    // so it's already correct before React hydrates.
    const isDark = document.documentElement.classList.contains('dark');
     
    setDark(isDark);

    // Enable toggling after the browser has painted, so any residual
    // click events from the dropdown opening are safely ignored.
    requestAnimationFrame(() => {
      canToggleRef.current = true;
    });
  }, []);

  // Listen for theme changes from OTHER instances (e.g. settings page) so
  // the icon stays in sync when the user toggles dark mode elsewhere.
  useEffect(() => {
    const observer = new MutationObserver(() => {
      const isDark = document.documentElement.classList.contains('dark');
      setDark(isDark);
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });
    return () => observer.disconnect();
  }, []);

  const toggle = useCallback((e: React.MouseEvent) => {
    // Guard: ignore clicks that fire during the initial mount cycle
    // (e.g. residual events from the dropdown opening interaction)
    if (!canToggleRef.current) return;

    // Prevent the click from propagating to the dropdown's outside-click handler
    // or any parent element that might interfere.
    e.stopPropagation();
    e.preventDefault();

    const newDark = !darkRef.current;
    setDark(newDark);
    if (newDark) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('attendo-theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('attendo-theme', 'light');
    }
  }, []);

  return (
    <button
      type="button"
      onClick={toggle}
      className="flex items-center gap-2 w-full px-4 py-2.5 text-sm text-foreground hover:bg-muted/50 active:bg-muted/80 transition-colors rounded-lg"
      aria-label={dark ? t('settings.lightMode') : t('settings.darkMode')}
    >
      <motion.div
        initial={false}
        animate={{ rotate: dark ? 180 : 0 }}
        transition={{ duration: 0.3, ease: 'easeInOut' }}
      >
        {dark ? (
          <Sun className="h-4 w-4 text-amber-500" />
        ) : (
          <Moon className="h-4 w-4 text-sky-600" />
        )}
      </motion.div>
      <span>{dark ? t('settings.lightMode') : t('settings.darkMode')}</span>
    </button>
  );
}

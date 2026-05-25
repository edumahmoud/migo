'use client';

import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { motion } from 'framer-motion';
import { useTranslations } from '@/i18n/use-translations';

const THEME_STORAGE_KEY = 'attendo-theme';

/**
 * ThemeToggle — a simple toggle button that flips between light and dark mode.
 *
 * IMPORTANT: This component does NOT initialize the theme on mount.
 * Theme initialization happens in the inline <script> in layout.tsx,
 * which runs BEFORE React hydrates. This prevents dark mode from
 * being activated unexpectedly when the dropdown opens for the first time.
 *
 * On mount, we VERIFY that the DOM state matches the stored preference.
 * If there's a mismatch (e.g., .dark class is present but preference is 'light'),
 * we correct the DOM state. This handles the edge case where something else
 * (like a browser extension or SSR hydration mismatch) adds .dark incorrectly.
 */
export default function ThemeToggle() {
  const [dark, setDark] = useState(false);
  const [mounted, setMounted] = useState(false);
  const { t } = useTranslations();

  useEffect(() => {
    setMounted(true);
    // VERIFY DOM state matches localStorage preference.
    // This is critical to prevent dark mode from activating unexpectedly.
    // The inline script in layout.tsx already handles initialization,
    // but we add an extra safety check here.
    try {
      const storedTheme = localStorage.getItem(THEME_STORAGE_KEY);
      const isDarkInDOM = document.documentElement.classList.contains('dark');

      if (storedTheme === 'dark') {
        // User explicitly chose dark mode — ensure DOM matches
        if (!isDarkInDOM) {
          document.documentElement.classList.add('dark');
        }
        setDark(true);
      } else {
        // User is in light mode (or no preference set — default to light)
        // CRITICAL: If .dark class is present but user didn't choose dark,
        // remove it. This prevents the bug where dark mode activates
        // unexpectedly when the dropdown opens.
        if (isDarkInDOM) {
          document.documentElement.classList.remove('dark');
        }
        setDark(false);
        // Ensure preference is stored so future loads are consistent
        if (!storedTheme) {
          localStorage.setItem(THEME_STORAGE_KEY, 'light');
        }
      }
    } catch {
      // localStorage unavailable — just read DOM state as fallback
      const isDark = document.documentElement.classList.contains('dark');
      setDark(isDark);
    }
  }, []);

  const toggle = () => {
    const newDark = !dark;
    setDark(newDark);
    if (newDark) {
      document.documentElement.classList.add('dark');
      localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem(THEME_STORAGE_KEY, 'light');
    }
  };

  if (!mounted) return null;

  return (
    <button
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

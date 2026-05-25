'use client';

import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { motion } from 'framer-motion';
import { useTranslations } from '@/i18n/use-translations';

const THEME_STORAGE_KEY = 'attendo-theme';

/**
 * ThemeToggle — a simple toggle button that flips between light and dark mode.
 *
 * IMPORTANT: This component does NOT initialize or modify the theme on mount.
 * Theme initialization happens in the inline <script> in layout.tsx,
 * which runs BEFORE React hydrates. This prevents dark mode from
 * being activated unexpectedly when the dropdown opens for the first time.
 *
 * On mount, we ONLY READ the current DOM/localStorage state to sync our
 * React state. We never add/remove the 'dark' class or write to localStorage
 * during mount — that caused the bug where dark mode activated when the
 * dropdown opened. The layout inline script is the single source of truth
 * for theme initialization.
 */
export default function ThemeToggle() {
  const [dark, setDark] = useState(false);
  const [mounted, setMounted] = useState(false);
  const { t } = useTranslations();

  useEffect(() => {
    setMounted(true);
    // READ-ONLY: Just sync React state with the current DOM/localStorage state.
    // Theme initialization is handled by the inline script in layout.tsx,
    // which runs before React hydrates. We do NOT modify the DOM or localStorage
    // here — doing so caused the bug where dark mode activated unexpectedly
    // when the dropdown opened for the first time.
    try {
      const storedTheme = localStorage.getItem(THEME_STORAGE_KEY);
      if (storedTheme === 'dark') {
        setDark(true);
      } else {
        setDark(false);
      }
    } catch {
      // localStorage unavailable — read DOM state as fallback
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

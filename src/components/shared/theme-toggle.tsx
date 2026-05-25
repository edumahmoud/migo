'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { Moon, Sun } from 'lucide-react';
import { motion } from 'framer-motion';
import { useTranslations } from '@/i18n/use-translations';

const THEME_STORAGE_KEY = 'attendo-theme';

/**
 * ThemeToggle — a simple toggle button that flips between light and dark mode.
 *
 * CRITICAL MOBILE FIX: This component has a 400ms click guard after mounting.
 * On mobile, when the user taps their profile picture to open the dropdown,
 * the ThemeToggle mounts and renders. If the tap event is still propagating
 * (mobile touch events last 100-300ms), it can accidentally hit the newly
 * rendered ThemeToggle button, activating dark mode unintentionally.
 *
 * The click guard prevents this by ignoring clicks for 400ms after mount.
 * Theme initialization happens in the inline <script> in layout.tsx.
 */
export default function ThemeToggle() {
  const [dark, setDark] = useState(false);
  const [mounted, setMounted] = useState(false);
  const interactiveRef = useRef(false);
  const { t } = useTranslations();

  useEffect(() => {
    setMounted(true);

    // READ-ONLY: Just sync React state with the current DOM/localStorage state.
    try {
      const storedTheme = localStorage.getItem(THEME_STORAGE_KEY);
      if (storedTheme === 'dark') {
        setDark(true);
      } else {
        setDark(false);
      }
    } catch {
      const isDark = document.documentElement.classList.contains('dark');
      setDark(isDark);
    }

    // CLICK GUARD: Prevent accidental taps on mobile for 400ms after mount.
    const guardTimer = setTimeout(() => {
      interactiveRef.current = true;
    }, 400);

    return () => clearTimeout(guardTimer);
  }, []);

  const toggle = useCallback(() => {
    // CLICK GUARD: Ignore clicks during the first 400ms after mount
    if (!interactiveRef.current) return;

    const newDark = !dark;
    setDark(newDark);
    if (newDark) {
      document.documentElement.classList.add('dark');
      localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem(THEME_STORAGE_KEY, 'light');
    }
  }, [dark]);

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

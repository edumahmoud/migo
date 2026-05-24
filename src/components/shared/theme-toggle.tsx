'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { motion } from 'framer-motion';
import { useI18n } from '@/lib/i18n/context';

export default function ThemeToggle() {
  const { t } = useI18n();
  // Use lazy state initialization to read the actual DOM state immediately.
  // This avoids the two-step render (false → useEffect → true) that could
  // cause a flash or, in edge cases, an unintended theme toggle on first mount.
  const [dark, setDark] = useState(() => {
    if (typeof document === 'undefined') return false;
    return document.documentElement.classList.contains('dark');
  });

  // Keep a ref in sync so the toggle callback always reads the latest value
  // without needing `dark` in its dependency array (prevents stale closure).
  const darkRef = useRef(dark);
  darkRef.current = dark;

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
    // Prevent the click from propagating to the dropdown's outside-click handler
    // or any parent element that might interfere.
    e.stopPropagation();

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
      onClick={toggle}
      className="flex items-center gap-2 w-full px-4 py-2.5 text-sm text-foreground hover:bg-muted/50 active:bg-muted/80 transition-colors rounded-lg"
      aria-label={dark ? t('theme.lightMode') : t('theme.darkMode')}
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
      <span>{dark ? t('theme.lightMode') : t('theme.darkMode')}</span>
    </button>
  );
}

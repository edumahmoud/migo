'use client';

/**
 * MantineProviders — v134n
 *
 * Wraps the app with MantineProvider + Notifications + Modals + Tiptap.
 * Reads theme from useThemeStore and applies it.
 *
 * Also handles:
 *   - RTL direction (from i18n locale)
 *   - Color scheme resolution (light/dark/system)
 *   - DB sync on mount
 */

import { useEffect, useMemo, useState } from 'react';
import { MantineProvider, ColorSchemeScript } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { ModalsProvider } from '@mantine/modals';
import { NavigationProgress } from '@mantine/nprogress';
import { useThemeStore, resolveColorScheme } from '@/stores/theme-store';
import { createTheme } from '@/lib/mantine-theme';
import { useAuthStore } from '@/stores/auth-store';
import { useLocaleStore } from '@/i18n/locale-store';

export default function MantineProviders({ children }: { children: React.ReactNode }) {
  const { identity, mode, syncFromDb, syncToDb } = useThemeStore();
  const user = useAuthStore((s) => s.user);
  const { direction } = useLocaleStore();
  const [, setSystemChangeCounter] = useState(0);

  // Sync theme from DB when user logs in.
  useEffect(() => {
    if (user?.id) {
      syncFromDb(user.id);
    }
  }, [user?.id, syncFromDb]);

  // Sync theme to DB whenever it changes (debounced via useEffect).
  useEffect(() => {
    if (user?.id) {
      const timer = setTimeout(() => syncToDb(user.id), 500);
      return () => clearTimeout(timer);
    }
  }, [identity, mode, user?.id, syncToDb]);

  // Listen for system color scheme changes if mode is 'system'.
  useEffect(() => {
    if (mode !== 'system' || typeof window === 'undefined') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => setSystemChangeCounter((c) => c + 1);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [mode]);

  // Resolve color scheme (light/dark) — recomputes on mode change + system change.
  const colorScheme = useMemo(() => resolveColorScheme(mode), [mode]);

  // v134n: pass colorScheme directly to createTheme (Mantine v9 supports it).
  const theme = useMemo(() => createTheme(identity, colorScheme), [identity, colorScheme]);

  return (
    <>
      <ColorSchemeScript forceColorScheme={colorScheme} />
      <MantineProvider theme={theme} forceColorScheme={colorScheme}>
        <NavigationProgress />
        <ModalsProvider>
          <Notifications position="top-center" />
          <div dir={direction}>{children}</div>
        </ModalsProvider>
      </MantineProvider>
    </>
  );
}


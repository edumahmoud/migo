/**
 * Theme Store — v134n
 *
 * Manages user's theme identity + mode.
 * Syncs with the `user_preferences` table via /api/user/preferences.
 *
 * On first load: reads from localStorage (instant), then syncs with DB.
 * On change: updates localStorage + DB (debounced).
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { THEME_IDENTITIES, THEME_MODES, type ThemeIdentity, type ThemeMode } from '@/lib/mantine-theme';

interface ThemeState {
  // ─── State ───
  identity: ThemeIdentity;
  mode: ThemeMode;
  synced: boolean; // true when DB sync has completed at least once
  loading: boolean;

  // ─── Actions ───
  setIdentity: (id: ThemeIdentity) => void;
  setMode: (mode: ThemeMode) => void;
  setBoth: (id: ThemeIdentity, mode: ThemeMode) => void;
  syncFromDb: (userId: string) => Promise<void>;
  syncToDb: (userId: string) => Promise<void>;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      identity: 'sky',
      mode: 'system',
      synced: false,
      loading: false,

      setIdentity: (id) => {
        set({ identity: id });
        // DB sync is triggered by the component that has the userId
      },

      setMode: (mode) => {
        set({ mode });
      },

      setBoth: (id, mode) => {
        set({ identity: id, mode });
      },

      syncFromDb: async (userId) => {
        if (!userId) return;
        set({ loading: true });
        try {
          const res = await fetch('/api/user/preferences', {
            headers: { 'x-user-id': userId },
          });
          const json = await res.json();
          if (json.success && json.preferences) {
            // Only override if DB has a value (don't override localStorage with DB defaults)
            set({
              identity: json.preferences.theme_identity ?? get().identity,
              mode: json.preferences.theme_mode ?? get().mode,
              synced: true,
            });
          } else {
            // No DB row yet — push current localStorage value to DB
            await get().syncToDb(userId);
            set({ synced: true });
          }
        } catch {
          // Non-critical — keep localStorage value
          set({ synced: true });
        } finally {
          set({ loading: false });
        }
      },

      syncToDb: async (userId) => {
        if (!userId) return;
        const { identity, mode } = get();
        try {
          await fetch('/api/user/preferences', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'x-user-id': userId },
            body: JSON.stringify({ theme_identity: identity, theme_mode: mode }),
          });
        } catch {
          // Non-critical — try again on next change
        }
      },
    }),
    {
      name: 'attendo-theme-prefs',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        identity: state.identity,
        mode: state.mode,
      }),
    },
  ),
);

// ─── Helpers ───

export function isValidIdentity(id: string): id is ThemeIdentity {
  return (THEME_IDENTITIES as string[]).includes(id);
}

export function isValidMode(mode: string): mode is ThemeMode {
  return (THEME_MODES as string[]).includes(mode);
}

/**
 * Resolve the actual color scheme (light/dark) for Mantine,
 * taking into account the 'system' mode (which reads prefers-color-scheme).
 */
export function resolveColorScheme(mode: ThemeMode): 'light' | 'dark' {
  if (mode === 'system') {
    if (typeof window === 'undefined') return 'light';
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return mode;
}

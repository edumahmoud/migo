'use client';

import { create } from 'zustand';

// ─── Types ───

export interface InstitutionData {
  id?: string;
  name: string;
  name_en?: string | null;
  type: 'center' | 'school' | 'university';
  logo_url?: string | null;
  tagline?: string | null;
  country?: string | null;
  city?: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  timezone?: string | null;
  academic_year?: string | null;
  description?: string | null;
  created_at?: string;
  updated_at?: string;
}

interface InstitutionState {
  institution: InstitutionData | null;
  loading: boolean;
  loaded: boolean;

  // Actions
  fetchInstitution: () => Promise<void>;
  setInstitution: (data: InstitutionData | null) => void;
  reset: () => void;
}

// ─── Store ───

// v132c: localStorage key for caching the logo URL so loading screens
// can display it on the very first paint (before the store fetch
// resolves). Must match the key in brand-logo.tsx.
const LOGO_STORAGE_KEY = 'attendo-institution-logo';

/** Cache the logo URL to localStorage so loading screens can read it instantly. */
function cacheLogoUrl(logoUrl: string | null | undefined) {
  try {
    if (logoUrl) {
      localStorage.setItem(LOGO_STORAGE_KEY, logoUrl);
    } else {
      localStorage.removeItem(LOGO_STORAGE_KEY);
    }
  } catch {
    // localStorage may be unavailable (private mode, SSR, etc.) — ignore.
  }
}

export const useInstitutionStore = create<InstitutionState>((set, get) => ({
  institution: null,
  loading: false,
  loaded: false,

  fetchInstitution: async () => {
    // Don't refetch if already loaded (unless forced)
    if (get().loaded) return;

    set({ loading: true });
    try {
      const res = await fetch('/api/setup');
      if (res.ok) {
        const data = await res.json();
        if (data.institution) {
          const inst = data.institution as InstitutionData;
          // v132c: persist logo URL to localStorage for instant access
          // on the next page load's first paint.
          cacheLogoUrl(inst.logo_url);
          set({ institution: inst, loading: false, loaded: true });
        } else {
          cacheLogoUrl(null);
          set({ institution: null, loading: false, loaded: true });
        }
      } else {
        set({ loading: false, loaded: true });
      }
    } catch {
      set({ loading: false, loaded: true });
    }
  },

  setInstitution: (data) => {
    // v132c: update the localStorage cache whenever the store is
    // updated directly (e.g., from the admin institution settings page).
    cacheLogoUrl(data?.logo_url);
    set({ institution: data, loaded: true });
  },

  reset: () => {
    // v132c: keep the localStorage cache on reset — the logo hasn't
    // changed, only the auth state did. This way the next login's
    // loading screen still shows the logo.
    set({ institution: null, loading: false, loaded: false });
  },
}));

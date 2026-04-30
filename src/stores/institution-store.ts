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
          set({ institution: data.institution as InstitutionData, loading: false, loaded: true });
        } else {
          set({ institution: null, loading: false, loaded: true });
        }
      } else {
        set({ loading: false, loaded: true });
      }
    } catch {
      set({ loading: false, loaded: true });
    }
  },

  setInstitution: (data) => set({ institution: data, loaded: true }),

  reset: () => set({ institution: null, loading: false, loaded: false }),
}));

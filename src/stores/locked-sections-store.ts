'use client';

import { create } from 'zustand';
import { getCachedAuthHeaders } from '@/lib/client-auth';

/**
 * locked-sections-store — v134
 *
 * Caches the lock status of all sections for the current user.
 * Fetched once on dashboard mount via fetchLockedSections().
 *
 * The sidebar + dashboard use this to:
 *   - Show a lock icon on locked sections
 *   - Intercept clicks on locked sections
 *   - Show the SectionLockedView when a locked section is clicked
 */

export interface LockedSectionInfo {
  locked: boolean;
  unlocked: boolean;
  expiresAt: string | null;
  unlockSource: 'personal' | 'global_all' | 'global_new_users' | null;
  config: {
    section_label: string;
    student_monthly_price: number;
    student_yearly_price: number;
    teacher_monthly_price: number;
    teacher_yearly_price: number;
    currency: string;
    student_monthly_limit: number | null;
    student_yearly_limit: number | null;
    teacher_monthly_limit: number | null;
    teacher_yearly_limit: number | null;
    usage_period_days: number;
    usage_metric: string | null;
  };
}

interface LockedSectionsState {
  sections: Record<string, LockedSectionInfo>;
  loaded: boolean;
  loading: boolean;
  fetchLockedSections: () => Promise<void>;
  isLocked: (sectionKey: string) => boolean;
  getSection: (sectionKey: string) => LockedSectionInfo | null;
}

export const useLockedSectionsStore = create<LockedSectionsState>((set, get) => ({
  sections: {},
  loaded: false,
  loading: false,

  fetchLockedSections: async () => {
    if (get().loaded || get().loading) return;
    set({ loading: true });
    try {
      const res = await fetch('/api/sections/locked-status', {
        headers: await getCachedAuthHeaders(),
      });
      const json = await res.json();
      if (json.success) {
        set({ sections: json.sections ?? {}, loaded: true, loading: false });
      } else {
        set({ loaded: true, loading: false });
      }
    } catch {
      set({ loaded: true, loading: false });
    }
  },

  isLocked: (sectionKey: string) => {
    const s = get().sections[sectionKey];
    return s?.locked === true;
  },

  getSection: (sectionKey: string) => {
    return get().sections[sectionKey] ?? null;
  },
}));

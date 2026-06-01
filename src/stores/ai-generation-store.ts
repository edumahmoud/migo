import { create } from 'zustand';

// -------------------------------------------------------
// AI Generation Store
// Persists the active AI question generation task to localStorage
// so that progress survives navigation within the app.
// Stale tasks (>10 min) are auto-cleared on restore.
// -------------------------------------------------------

export interface AiGenerationState {
  bankId: string;
  bankName: string;
  subjectName?: string;
  status: 'extracting' | 'generating' | 'saving';
  startedAt: number;
}

interface AiGenerationStore {
  activeTask: AiGenerationState | null;
  startTask: (bankId: string, bankName: string, subjectName?: string) => void;
  updateStatus: (status: AiGenerationState['status']) => void;
  completeTask: () => void;
  cancelTask: () => void;
  restoreFromStorage: () => void;
}

const STORAGE_KEY = 'attendo_ai_generation';
const MAX_AGE = 10 * 60 * 1000; // 10 minutes — auto-clear stale tasks

export const useAiGenerationStore = create<AiGenerationStore>((set, get) => ({
  activeTask: null,

  startTask: (bankId, bankName, subjectName) => {
    const task: AiGenerationState = {
      bankId,
      bankName,
      subjectName,
      status: 'extracting',
      startedAt: Date.now(),
    };
    set({ activeTask: task });
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(task));
    } catch {
      // localStorage may be unavailable (e.g. private browsing quota)
    }
  },

  updateStatus: (status) => {
    const current = get().activeTask;
    if (!current) return;
    const updated = { ...current, status };
    set({ activeTask: updated });
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    } catch {
      // ignore
    }
  },

  completeTask: () => {
    set({ activeTask: null });
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  },

  cancelTask: () => {
    set({ activeTask: null });
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  },

  restoreFromStorage: () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const task: AiGenerationState = JSON.parse(raw);
      // Auto-clear stale tasks (older than 10 minutes)
      if (Date.now() - task.startedAt > MAX_AGE) {
        localStorage.removeItem(STORAGE_KEY);
        return;
      }
      set({ activeTask: task });
    } catch {
      // Corrupted data — clear it
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch {
        // ignore
      }
    }
  },
}));

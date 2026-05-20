// =====================================================
// Video Upload Store — Global background upload tracking
// =====================================================
// Manages video upload state globally so uploads continue
// in the background even when the user navigates away from
// the videos tab. Uses XMLHttpRequest for real progress tracking.

import { create } from 'zustand';
import { supabase } from '@/lib/supabase';
import { getCachedAuthHeaders } from '@/lib/client-auth';
import { toast } from 'sonner';

// ─── Types ───

export type UploadStatus = 'uploading' | 'saving' | 'done' | 'error' | 'cancelled';

export interface VideoUploadTask {
  id: string;            // unique task ID
  subjectId: string;
  file: File;
  title: string;
  description: string;
  status: UploadStatus;
  progress: number;      // 0–100 (storage upload progress)
  error?: string;
  videoUrl?: string;
  storagePath?: string;
  xhr?: XMLHttpRequest;  // reference for cancellation
}

interface VideoUploadState {
  tasks: VideoUploadTask[];
  addTask: (task: Omit<VideoUploadTask, 'status' | 'progress' | 'xhr'>) => string;
  updateTask: (id: string, updates: Partial<VideoUploadTask>) => void;
  removeTask: (id: string) => void;
  cancelTask: (id: string) => void;
  startUpload: (id: string) => Promise<void>;
  clearCompleted: () => void;
}

// ─── Helper: generate unique ID ───
function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// ─── Store ───
export const useVideoUploadStore = create<VideoUploadState>()((set, get) => ({
  tasks: [],

  addTask: (task) => {
    const id = task.id || uid();
    const newTask: VideoUploadTask = { ...task, id, status: 'uploading', progress: 0 };
    set((state) => ({ tasks: [newTask, ...state.tasks] }));
    return id;
  },

  updateTask: (id, updates) => {
    set((state) => ({
      tasks: state.tasks.map((t) => (t.id === id ? { ...t, ...updates } : t)),
    }));
  },

  removeTask: (id) => {
    set((state) => ({ tasks: state.tasks.filter((t) => t.id !== id) }));
  },

  cancelTask: (id) => {
    const task = get().tasks.find((t) => t.id === id);
    if (task?.xhr) {
      task.xhr.abort();
    }
    get().updateTask(id, { status: 'cancelled', progress: 0 });
    // Clean up storage file if it was partially uploaded
    if (task?.storagePath) {
      supabase.storage.from('user-files').remove([task.storagePath]).catch(() => {});
    }
  },

  startUpload: async (id) => {
    const task = get().tasks.find((t) => t.id === id);
    if (!task) return;

    const { file, subjectId, title, description } = task;

    try {
      // ── Step 1: Get auth info ──
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const userId = session?.user?.id;
      if (!userId) {
        get().updateTask(id, { status: 'error', error: 'يرجى تسجيل الدخول أولاً' });
        return;
      }

      // ── Step 2: Upload file to Supabase Storage using XMLHttpRequest for real progress ──
      const fileExt = file.name.split('.').pop();
      const storagePath = `${userId}/videos/${subjectId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${fileExt}`;

      // Get the Supabase URL for the upload endpoint
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
      const uploadUrl = `${supabaseUrl}/storage/v1/object/user-files/${storagePath}`;

      // Get a fresh auth token for the XHR request
      const authToken = session.access_token;

      // Create XHR for progress tracking
      const xhr = new XMLHttpRequest();

      // Store XHR reference so we can cancel later
      get().updateTask(id, { xhr, storagePath });

      // Wrap XHR in a promise
      const uploadPromise = new Promise<void>((resolve, reject) => {
        xhr.upload.addEventListener('progress', (e) => {
          if (e.lengthComputable) {
            // Map storage progress to 0-90% (reserve 10% for DB save)
            const pct = Math.round((e.loaded / e.total) * 90);
            get().updateTask(id, { progress: pct });
          }
        });

        xhr.addEventListener('load', () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve();
          } else {
            try {
              const errBody = JSON.parse(xhr.responseText);
              reject(new Error(errBody.error || errBody.message || `HTTP ${xhr.status}`));
            } catch {
              reject(new Error(`فشل رفع الفيديو (HTTP ${xhr.status})`));
            }
          }
        });

        xhr.addEventListener('error', () => reject(new Error('فشل الاتصال بالخادم أثناء رفع الفيديو')));
        xhr.addEventListener('abort', () => reject(new Error('تم إلغاء الرفع')));

        xhr.open('POST', uploadUrl);
        xhr.setRequestHeader('Authorization', `Bearer ${authToken}`);
        xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
        xhr.setRequestHeader('x-upsert', 'false');
        xhr.send(file);
      });

      await uploadPromise;

      // ── Step 3: Get public URL ──
      const { data: urlData } = supabase.storage.from('user-files').getPublicUrl(storagePath);
      const videoUrl = urlData.publicUrl;

      get().updateTask(id, { videoUrl, status: 'saving', progress: 92 });

      // ── Step 4: Create DB record via API ──
      const headers = await getCachedAuthHeaders();
      const response = await fetch('/api/videos/upload', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          subjectId,
          uploadedBy: userId,
          title: title.trim(),
          description: description.trim() || null,
          videoUrl,
          storagePath,
          videoType: file.type,
          videoSize: file.size,
        }),
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error || 'فشل حفظ بيانات الفيديو');
      }

      get().updateTask(id, { status: 'done', progress: 100 });
      toast.success(`تم رفع الفيديو "${title}" بنجاح`);
    } catch (err: unknown) {
      const taskNow = get().tasks.find((t) => t.id === id);
      // Don't show error for cancelled tasks
      if (taskNow?.status === 'cancelled') return;

      const message = err instanceof Error ? err.message : 'حدث خطأ أثناء رفع الفيديو';
      get().updateTask(id, { status: 'error', error: message });
      toast.error(message);
    }
  },

  clearCompleted: () => {
    set((state) => ({
      tasks: state.tasks.filter((t) => t.status !== 'done' && t.status !== 'cancelled'),
    }));
  },
}));

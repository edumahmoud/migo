// =====================================================
// File Upload Store — Global background upload tracking
// =====================================================
// Manages file uploads in the background so users can
// navigate freely while uploads run. Follows the same
// pattern as video-upload-store but simplified (no TUS
// or chunking — files are typically <50MB).

import { create } from 'zustand';
import { supabase, supabaseUrl } from '@/lib/supabase';
import { waitForSession, getCachedAuthHeaders } from '@/lib/client-auth';
import { toast } from 'sonner';

// ─── Types ───

export type FileUploadStatus = 'uploading' | 'paused' | 'cancelled' | 'success' | 'error';

export interface FileUploadTask {
  id: string;
  file: File;
  fileData: ArrayBuffer | null; // Pre-read data for mobile PWA safety
  fileName: string;
  fileType: string;
  fileSize: number;
  customName: string;
  extension: string;
  progress: number; // 0–100
  status: FileUploadStatus;
  error?: string;
  profileId: string;
  subjectIds: string[]; // Course IDs to assign after upload
}

interface FileUploadState {
  tasks: FileUploadTask[];
  addTask: (task: Omit<FileUploadTask, 'status' | 'progress'>) => string;
  updateTask: (id: string, updates: Partial<FileUploadTask>) => void;
  removeTask: (id: string) => void;
  pauseTask: (id: string) => void;
  resumeTask: (id: string) => void;
  cancelTask: (id: string) => void;
  pauseAll: () => void;
  resumeAll: () => void;
  cancelAll: () => void;
  clearCompleted: () => void;
}

// ─── Constants ───

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
const FILE_SIZE_LIMIT = 4 * 1024 * 1024; // 4MB — threshold for server-side upload

// ─── Helper: generate unique ID ───
function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// ─── Helper: determine file type category (mirrors server-side logic) ───
function getFileTypeCategory(mimeType: string): string {
  const lower = mimeType.toLowerCase();
  if (lower.startsWith('image/')) return 'image';
  if (lower.startsWith('video/')) return 'video';
  if (lower.startsWith('audio/')) return 'audio';
  if (lower === 'application/pdf') return 'pdf';
  if (lower.includes('word') || lower.includes('document')) return 'document';
  if (lower.includes('sheet') || lower.includes('excel')) return 'spreadsheet';
  if (lower.includes('presentation') || lower.includes('powerpoint')) return 'presentation';
  if (lower === 'text/plain' || lower === 'text/csv') return 'text';
  if (lower.includes('zip') || lower.includes('rar') || lower.includes('compressed')) return 'archive';
  return 'other';
}

// ─── Helper: format file size ───
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
}

// ─── In-flight abort controllers per task ───
const abortControllers = new Map<string, AbortController>();

// ─── Pause signals per task ───
const pauseSignals = new Map<string, { resolve: () => void }>();

// ─── In-flight XHR references per task (for abort) ───
const activeXHRs = new Map<string, XMLHttpRequest>();

// ─── Store ───
export const useFileUploadStore = create<FileUploadState>()((set, get) => ({
  tasks: [],

  addTask: (task) => {
    const id = task.id || uid();
    const newTask: FileUploadTask = { ...task, id, status: 'uploading', progress: 0 };
    set((state) => ({ tasks: [newTask, ...state.tasks] }));
    // Auto-start upload
    startUpload(id);
    return id;
  },

  updateTask: (id, updates) => {
    set((state) => ({
      tasks: state.tasks.map((t) => (t.id === id ? { ...t, ...updates } : t)),
    }));
  },

  pauseTask: (id) => {
    // Abort current in-flight request (fetch or XHR)
    const controller = abortControllers.get(id);
    if (controller) {
      controller.abort();
      abortControllers.delete(id);
    }
    const xhr = activeXHRs.get(id);
    if (xhr) {
      xhr.abort();
      activeXHRs.delete(id);
    }
    // Set pause signal so upload loop will wait when it checks
    if (!pauseSignals.has(id)) {
      pauseSignals.set(id, { resolve: () => {} });
    }
    get().updateTask(id, { status: 'paused' });
  },

  resumeTask: (id) => {
    // Resolve the pause signal so the upload loop continues
    const signal = pauseSignals.get(id);
    if (signal) {
      signal.resolve();
      pauseSignals.delete(id);
    }
    get().updateTask(id, { status: 'uploading' });
    // Restart the upload loop from where it paused
    startUpload(id);
  },

  cancelTask: (id) => {
    // Abort any in-flight request
    const controller = abortControllers.get(id);
    if (controller) {
      controller.abort();
      abortControllers.delete(id);
    }
    const xhr = activeXHRs.get(id);
    if (xhr) {
      xhr.abort();
      activeXHRs.delete(id);
    }
    // Resolve and clear pause signal
    const signal = pauseSignals.get(id);
    if (signal) {
      signal.resolve();
      pauseSignals.delete(id);
    }
    get().updateTask(id, { status: 'cancelled', progress: 0 });
  },

  pauseAll: () => {
    const activeTasks = get().tasks.filter((t) => t.status === 'uploading');
    for (const task of activeTasks) {
      get().pauseTask(task.id);
    }
  },

  resumeAll: () => {
    const pausedTasks = get().tasks.filter((t) => t.status === 'paused');
    for (const task of pausedTasks) {
      get().resumeTask(task.id);
    }
  },

  cancelAll: () => {
    const activeTasks = get().tasks.filter((t) => t.status === 'uploading' || t.status === 'paused');
    for (const task of activeTasks) {
      get().cancelTask(task.id);
    }
  },

  removeTask: (id) => {
    // Abort any in-flight request
    const controller = abortControllers.get(id);
    if (controller) {
      controller.abort();
      abortControllers.delete(id);
    }
    const xhr = activeXHRs.get(id);
    if (xhr) {
      xhr.abort();
      activeXHRs.delete(id);
    }
    // Clean up pause signal
    const signal = pauseSignals.get(id);
    if (signal) {
      signal.resolve();
      pauseSignals.delete(id);
    }
    set((state) => ({ tasks: state.tasks.filter((t) => t.id !== id) }));
  },

  clearCompleted: () => {
    set((state) => ({
      tasks: state.tasks.filter((t) => t.status !== 'success' && t.status !== 'cancelled'),
    }));
  },
}));

// ─────────────────────────────────────────────────────
// Upload implementation
// ─────────────────────────────────────────────────────

// ─── Helper: check if task is paused/cancelled and wait if paused ───
async function checkPauseState(taskId: string): Promise<boolean> {
  const task = useFileUploadStore.getState().tasks.find((t) => t.id === taskId);
  if (!task || task.status === 'cancelled') return false; // cancelled → abort upload
  if (task.status === 'paused' || pauseSignals.has(taskId)) {
    // Wait for resume signal
    await new Promise<void>((resolve) => {
      const signal = pauseSignals.get(taskId);
      if (signal) {
        signal.resolve = resolve;
      } else {
        pauseSignals.set(taskId, { resolve });
      }
    });
    // After resume, re-check status
    const resumedTask = useFileUploadStore.getState().tasks.find((t) => t.id === taskId);
    if (!resumedTask || resumedTask.status === 'cancelled') return false;
  }
  return true; // ok to continue
}

async function startUpload(taskId: string) {
  const task = useFileUploadStore.getState().tasks.find((t) => t.id === taskId);
  if (!task) return;

  // If task is paused, don't start — resumeTask will call startUpload again
  if (task.status === 'paused' || task.status === 'cancelled') return;

  const store = useFileUploadStore.getState();

  try {
    // ── Step 1: Get auth token ──
    const token = await waitForSession(15000);
    if (!token) {
      const t = useFileUploadStore.getState().tasks.find((x) => x.id === taskId);
      if (t?.status === 'cancelled' || t?.status === 'paused') return;
      store.updateTask(taskId, { status: 'error', error: 'يرجى تسجيل الدخول أولاً' });
      return;
    }

    // Check pause/cancel after async auth
    if (!(await checkPauseState(taskId))) return;

    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
    if (!supabaseUrl || !supabaseAnonKey) {
      store.updateTask(taskId, { status: 'error', error: 'إعدادات التخزين غير مكتملة' });
      return;
    }

    // ── Step 2: Prepare file data ──
    const fileName = task.fileName || 'unknown';
    const fileType = task.fileType || 'application/octet-stream';
    const fileSize = task.fileSize || 0;

    let arrayBuffer: ArrayBuffer;
    if (task.fileData && task.fileData.byteLength > 0) {
      arrayBuffer = task.fileData;
    } else {
      try {
        arrayBuffer = await task.file.arrayBuffer();
      } catch {
        store.updateTask(taskId, { status: 'error', error: `فشل قراءة الملف "${fileName}"` });
        return;
      }
    }

    const uploadBlob = new Blob([arrayBuffer], { type: fileType });

    // Build storage path
    const originalExt = fileName.includes('.') ? '.' + fileName.split('.').pop() : '';
    const displayName = task.customName.trim() ? task.customName.trim() + originalExt : fileName;
    const safeStorageName = `${Date.now()}_${fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    const storagePath = `${task.profileId}/${safeStorageName}`;
    const fileTypeCategory = getFileTypeCategory(fileType);

    let uploadSucceeded = false;

    // ── Step 3 (PRIMARY): Server-side upload for small files (≤4MB) ──
    if (fileSize <= FILE_SIZE_LIMIT) {
      // Check pause/cancel before server-side upload
      if (!(await checkPauseState(taskId))) return;

      try {
        store.updateTask(taskId, { progress: 15 });

        // Simulated progress for server-side upload (no native progress events)
        const startTime = Date.now();
        const estimatedMs = Math.max(3000, (fileSize / (2 * 1024 * 1024)) * 1000);
        const simInterval = setInterval(() => {
          const elapsed = Date.now() - startTime;
          const ratio = Math.min(elapsed / estimatedMs, 0.85);
          const pct = Math.round(10 + ratio * 75);
          const currentTask = useFileUploadStore.getState().tasks.find((t) => t.id === taskId);
          if (currentTask && currentTask.status === 'uploading') {
            useFileUploadStore.getState().updateTask(taskId, { progress: pct });
          } else {
            clearInterval(simInterval);
          }
        }, 500);

        const uploadFormData = new FormData();
        uploadFormData.append('file', uploadBlob, fileName);
        uploadFormData.append('userId', task.profileId);
        uploadFormData.append('customName', task.customName.trim());

        const controller = new AbortController();
        abortControllers.set(taskId, controller);
        const timeoutId = setTimeout(() => controller.abort(), 60000);

        const res = await fetch('/api/files/upload', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
          },
          body: uploadFormData,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);
        clearInterval(simInterval);
        abortControllers.delete(taskId);

        let result: { success: boolean; data?: Record<string, unknown>; error?: string };
        if (res.ok) {
          try { result = await res.json(); }
          catch { result = { success: false, error: 'استجابة الخادم غير متوقعة' }; }
        } else {
          const errorText = await res.text();
          try { result = JSON.parse(errorText); }
          catch { result = { success: false, error: `خطأ HTTP ${res.status}` }; }
        }

        if (result.success && result.data?.id) {
          uploadSucceeded = true;
          console.log(`[File Upload] Server-side upload succeeded for ${displayName}`);
        } else {
          console.warn(`[File Upload] Server-side upload failed for ${displayName}:`, result.error, '— falling back to direct storage');
        }
      } catch (serverErr) {
        // If aborted due to pause/cancel, return silently
        const t = useFileUploadStore.getState().tasks.find((x) => x.id === taskId);
        if (t?.status === 'paused' || t?.status === 'cancelled') return;
        console.warn(`[File Upload] Server-side upload error for ${displayName}:`, serverErr instanceof Error ? serverErr.message : serverErr, '— falling back to direct storage');
      }
    } else {
      console.log(`[File Upload] File ${displayName} is ${Math.round(fileSize / 1024 / 1024)}MB, using direct storage`);
    }

    // ── Step 4 (FALLBACK): Direct upload to Supabase Storage ──
    if (!uploadSucceeded) {
      // Check pause/cancel before direct upload
      if (!(await checkPauseState(taskId))) return;

      let storageUploadSuccess = false;

      // Try XHR direct upload (real progress)
      try {
        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.timeout = 5 * 60 * 1000; // 5 min

          // Store XHR reference for abort on pause/cancel
          activeXHRs.set(taskId, xhr);

          xhr.upload.addEventListener('progress', (e) => {
            if (e.lengthComputable) {
              const pct = Math.round((e.loaded / e.total) * 90);
              useFileUploadStore.getState().updateTask(taskId, { progress: pct });
            }
          });

          xhr.addEventListener('load', () => {
            activeXHRs.delete(taskId);
            if (xhr.status >= 200 && xhr.status < 300) {
              resolve();
            } else {
              reject(new Error(`HTTP ${xhr.status}`));
            }
          });

          xhr.addEventListener('error', () => {
            activeXHRs.delete(taskId);
            reject(new Error('Network error'));
          });
          xhr.addEventListener('abort', () => {
            activeXHRs.delete(taskId);
            reject(new Error('Aborted'));
          });
          xhr.addEventListener('timeout', () => {
            activeXHRs.delete(taskId);
            reject(new Error('انتهت مهلة الرفع'));
          });

          const storageUploadUrl = `${supabaseUrl}/storage/v1/object/user-files/${storagePath}`;
          xhr.open('POST', storageUploadUrl);
          xhr.setRequestHeader('Authorization', `Bearer ${token}`);
          xhr.setRequestHeader('apikey', supabaseAnonKey);
          xhr.setRequestHeader('x-upsert', 'false');

          const formData = new FormData();
          formData.append('cacheControl', '3600');
          formData.append('file', uploadBlob, fileName);
          xhr.send(formData);
        });

        storageUploadSuccess = true;
      } catch (xhrErr) {
        // If aborted due to pause/cancel, return silently
        const t = useFileUploadStore.getState().tasks.find((x) => x.id === taskId);
        if (t?.status === 'paused' || t?.status === 'cancelled') return;
        console.warn(`[File Upload] XHR failed for ${task.customName}, trying SDK:`, xhrErr instanceof Error ? xhrErr.message : xhrErr);
      }

      // SDK fallback
      if (!storageUploadSuccess) {
        // Check pause/cancel before SDK upload
        if (!(await checkPauseState(taskId))) return;

        try {
          store.updateTask(taskId, { progress: 10 });

          const startTime = Date.now();
          const estimatedMs = Math.max(3000, (fileSize / (2 * 1024 * 1024)) * 1000);
          const simInterval = setInterval(() => {
            const elapsed = Date.now() - startTime;
            const ratio = Math.min(elapsed / estimatedMs, 0.85);
            const pct = Math.round(10 + ratio * 75);
            const currentTask = useFileUploadStore.getState().tasks.find((t) => t.id === taskId);
            if (currentTask && currentTask.status === 'uploading') {
              useFileUploadStore.getState().updateTask(taskId, { progress: pct });
            } else {
              clearInterval(simInterval);
            }
          }, 500);

          const { error: uploadError } = await supabase.storage
            .from('user-files')
            .upload(storagePath, uploadBlob, {
              cacheControl: '3600',
              contentType: fileType,
              upsert: false,
            });

          clearInterval(simInterval);

          if (uploadError) {
            throw uploadError;
          }
          storageUploadSuccess = true;
        } catch (sdkErr) {
          // If aborted due to pause/cancel, return silently
          const t = useFileUploadStore.getState().tasks.find((x) => x.id === taskId);
          if (t?.status === 'paused' || t?.status === 'cancelled') return;
          console.error(`[File Upload] SDK also failed for ${task.customName}:`, sdkErr);
        }
      }

      if (!storageUploadSuccess) {
        const t = useFileUploadStore.getState().tasks.find((x) => x.id === taskId);
        if (t?.status === 'paused' || t?.status === 'cancelled') return;
        store.updateTask(taskId, { status: 'error', error: 'فشل رفع الملف' });
        return;
      }

      // Check pause/cancel before DB record creation
      if (!(await checkPauseState(taskId))) return;

      store.updateTask(taskId, { progress: 92 });

      // Create DB record via lightweight API
      const fileUrl = `${supabaseUrl}/storage/v1/object/public/user-files/${storagePath}`;

      const controller2 = new AbortController();
      abortControllers.set(taskId, controller2);
      const timeoutId2 = setTimeout(() => controller2.abort(), 30000);

      try {
        const res = await fetch('/api/files/create-record', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            userId: task.profileId,
            fileName: displayName,
            fileType: fileTypeCategory,
            fileSize: fileSize,
            fileUrl,
            storagePath,
          }),
          signal: controller2.signal,
        });

        let result: { success: boolean; data?: Record<string, unknown>; error?: string };
        if (res.ok) {
          try { result = await res.json(); }
          catch { result = { success: false, error: 'استجابة الخادم غير متوقعة' }; }
        } else {
          const errorText = await res.text();
          try { result = JSON.parse(errorText); }
          catch { result = { success: false, error: `خطأ HTTP ${res.status}` }; }
        }
        clearTimeout(timeoutId2);
        abortControllers.delete(taskId);

        if (result.success && result.data?.id) {
          uploadSucceeded = true;
        } else {
          console.error('[File Upload] Create record error:', result.error);
          await supabase.storage.from('user-files').remove([storagePath]);
          store.updateTask(taskId, { status: 'error', error: result.error || 'فشل حفظ بيانات الملف' });
          return;
        }
      } finally {
        clearTimeout(timeoutId2);
        abortControllers.delete(taskId);
      }
    }

    // ── Step 5: Assign to courses if subject IDs provided ──
    if (uploadSucceeded && task.subjectIds.length > 0) {
      try {
        // Get the uploaded file ID — for server-side uploads, it's in result.data.id
        // For direct uploads, we need to fetch it from the DB
        let uploadedFileId: string | undefined;

        // Try to get the file ID from the just-created record
        const { data: fileRecord } = await supabase
          .from('user_files')
          .select('id')
          .eq('user_id', task.profileId)
          .eq('file_url', `${supabaseUrl}/storage/v1/object/public/user-files/${storagePath}`)
          .single();

        if (fileRecord?.id) {
          uploadedFileId = fileRecord.id;
        }

        if (uploadedFileId) {
          // Make file public when assigning to courses
          await supabase
            .from('user_files')
            .update({ visibility: 'public', updated_at: new Date().toISOString() })
            .eq('id', uploadedFileId);

          const headers = await getCachedAuthHeaders();
          await fetch('/api/files/bulk-assign', {
            method: 'POST',
            headers,
            body: JSON.stringify({
              fileIds: [uploadedFileId],
              subjectIds: task.subjectIds,
              userId: task.profileId,
            }),
          });
        }
      } catch (assignErr) {
        console.error('[File Upload] Bulk assign failed:', assignErr);
        // Non-critical — file is uploaded, just not assigned to courses
      }
    }

    // ── Done! ──
    if (uploadSucceeded) {
      // Clean up pause signals
      pauseSignals.delete(taskId);
      store.updateTask(taskId, { status: 'success', progress: 100 });
      toast.success(`تم رفع "${displayName}" بنجاح`);
    }
  } catch (err: unknown) {
    const taskNow = useFileUploadStore.getState().tasks.find((t) => t.id === taskId);
    // Don't show error for cancelled/paused tasks
    if (!taskNow || taskNow.status === 'cancelled' || taskNow.status === 'paused') return;

    const message = err instanceof Error ? err.message : 'حدث خطأ أثناء رفع الملف';
    useFileUploadStore.getState().updateTask(taskId, { status: 'error', error: message });
    toast.error(message);
  }
}

// Export helpers for the indicator component
export { formatFileSize };

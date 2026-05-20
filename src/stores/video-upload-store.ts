// =====================================================
// Video Upload Store — Global background upload tracking
// =====================================================
// Uses Supabase TUS resumable upload protocol to send
// videos in small chunks (6MB each), bypassing the
// Supabase Cloud infrastructure's single-request size
// limit (50MB on free plan). Supports pause/resume/cancel.
// Uploads continue in the background across page navigation.

import { create } from 'zustand';
import { supabase } from '@/lib/supabase';
import { getCachedAuthHeaders } from '@/lib/client-auth';
import { toast } from 'sonner';

// ─── Types ───

export type UploadStatus = 'uploading' | 'paused' | 'saving' | 'done' | 'error' | 'cancelled';

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
  tusUrl?: string;       // TUS upload URL from Location header
  uploadOffset: number;  // bytes uploaded so far (for pause/resume)
}

interface VideoUploadState {
  tasks: VideoUploadTask[];
  addTask: (task: Omit<VideoUploadTask, 'status' | 'progress' | 'uploadOffset'>) => string;
  updateTask: (id: string, updates: Partial<VideoUploadTask>) => void;
  removeTask: (id: string) => void;
  cancelTask: (id: string) => void;
  pauseTask: (id: string) => void;
  resumeTask: (id: string) => void;
  startUpload: (id: string) => Promise<void>;
  clearCompleted: () => void;
}

// ─── Constants ───

const CHUNK_SIZE = 6 * 1024 * 1024; // 6MB per chunk — well under any plan limit

// ─── Helper: generate unique ID ───
function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// ─── Helper: base64 encode for TUS metadata ───
function toBase64(str: string): string {
  try {
    return btoa(unescape(encodeURIComponent(str)));
  } catch {
    return btoa(str);
  }
}

// ─── In-flight abort controllers per task ───
const abortControllers = new Map<string, AbortController>();

// ─── Pause signals per task ───
const pauseSignals = new Map<string, { paused: boolean; resumeResolve?: () => void }>();

// ─── Store ───
export const useVideoUploadStore = create<VideoUploadState>()((set, get) => ({
  tasks: [],

  addTask: (task) => {
    const id = task.id || uid();
    const newTask: VideoUploadTask = { ...task, id, status: 'uploading', progress: 0, uploadOffset: 0 };
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
    // Abort any in-flight request
    const controller = abortControllers.get(id);
    if (controller) {
      controller.abort();
      abortControllers.delete(id);
    }
    // Clear pause signal
    const signal = pauseSignals.get(id);
    if (signal) {
      signal.paused = false;
      signal.resumeResolve?.();
      pauseSignals.delete(id);
    }
    const task = get().tasks.find((t) => t.id === id);
    get().updateTask(id, { status: 'cancelled', progress: 0 });
    // Clean up storage file if partially uploaded
    if (task?.storagePath) {
      supabase.storage.from('video-files').remove([task.storagePath]).catch(() => {});
    }
  },

  pauseTask: (id) => {
    // Abort current chunk request
    const controller = abortControllers.get(id);
    if (controller) {
      controller.abort();
      abortControllers.delete(id);
    }
    // Set pause signal so next iteration waits
    const signal = pauseSignals.get(id);
    if (signal) {
      signal.paused = true;
    } else {
      pauseSignals.set(id, { paused: true });
    }
    get().updateTask(id, { status: 'paused' });
  },

  resumeTask: (id) => {
    const signal = pauseSignals.get(id);
    if (signal) {
      signal.paused = false;
      signal.resumeResolve?.();
    }
    get().updateTask(id, { status: 'uploading' });
    // Resume the upload loop
    resumeUploadLoop(id);
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

      const authToken = session.access_token;
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';

      // ── Step 2: Build storage path ──
      const fileExt = file.name.split('.').pop() || 'mp4';
      const storagePath = `${userId}/videos/${subjectId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${fileExt}`;

      get().updateTask(id, { storagePath });

      // ── Step 3: Create TUS resumable upload session ──
      // This sends a POST with Upload-Length header to get an upload URL.
      // The file is NOT sent here — only metadata.
      const metadataParts = [
        `filename ${toBase64(file.name)}`,
        `bucketName ${toBase64('video-files')}`,
      ].join(',');

      let tusUrl: string;

      try {
        const createResponse = await fetch(`${supabaseUrl}/storage/v1/upload/resumable`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${authToken}`,
            'Upload-Length': String(file.size),
            'Upload-Metadata': metadataParts,
            'Tus-Resumable': '1.0.0',
            'x-upsert': 'false',
          },
        });

        if (!createResponse.ok) {
          const errText = await createResponse.text().catch(() => '');
          let errMsg = `HTTP ${createResponse.status}`;
          try {
            const errJson = JSON.parse(errText);
            errMsg = errJson.error || errJson.message || errMsg;
          } catch { /* use default */ }

          // If TUS endpoint is unavailable, fallback to direct upload
          if (createResponse.status === 404 || createResponse.status === 501) {
            console.warn('[Video Upload] TUS endpoint not available, falling back to direct upload');
            await directUpload(id, task, authToken, supabaseUrl, storagePath, userId);
            return;
          }

          throw new Error(errMsg);
        }

        // Get the upload URL from Location header (may be relative)
        const location = createResponse.headers.get('Location');
        if (!location) {
          throw new Error('لم يتم استلام رابط الرفع من الخادم');
        }

        // Handle relative vs absolute URL
        tusUrl = location.startsWith('http')
          ? location
          : `${supabaseUrl}${location.startsWith('/') ? '' : '/'}${location}`;

        get().updateTask(id, { tusUrl });
      } catch (err) {
        // If TUS creation fails, try direct upload as fallback
        if (err instanceof Error && (err.message.includes('Failed to fetch') || err.message.includes('NetworkError'))) {
          console.warn('[Video Upload] TUS creation failed, falling back to direct upload');
          await directUpload(id, task, authToken, supabaseUrl, storagePath, userId);
          return;
        }
        throw err;
      }

      // ── Step 4: Upload chunks via TUS PATCH requests ──
      await uploadChunks(id, file, tusUrl, authToken, 0);

      // ── Step 5: Get public URL ──
      const { data: urlData } = supabase.storage.from('video-files').getPublicUrl(storagePath);
      const videoUrl = urlData.publicUrl;

      get().updateTask(id, { videoUrl, status: 'saving', progress: 92 });

      // ── Step 6: Create DB record via API ──
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

      // Clean up pause signals
      pauseSignals.delete(id);

      get().updateTask(id, { status: 'done', progress: 100 });
      toast.success(`تم رفع الفيديو "${title}" بنجاح`);
    } catch (err: unknown) {
      const taskNow = get().tasks.find((t) => t.id === id);
      // Don't show error for cancelled/paused tasks
      if (taskNow?.status === 'cancelled' || taskNow?.status === 'paused') return;

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

// ─────────────────────────────────────────────────────
// TUS chunked upload implementation
// ─────────────────────────────────────────────────────

async function uploadChunks(
  taskId: string,
  file: File,
  tusUrl: string,
  authToken: string,
  startOffset: number,
) {
  let offset = startOffset;
  const totalSize = file.size;

  while (offset < totalSize) {
    const store = useVideoUploadStore.getState();
    const task = store.tasks.find((t) => t.id === taskId);
    if (!task || task.status === 'cancelled') return;

    // Check pause signal
    const signal = pauseSignals.get(taskId);
    if (signal?.paused) {
      // Wait for resume
      await new Promise<void>((resolve) => {
        signal.resumeResolve = resolve;
      });
      // After resume, re-check
      const resumedTask = useVideoUploadStore.getState().tasks.find((t) => t.id === taskId);
      if (!resumedTask || resumedTask.status === 'cancelled') return;
    }

    // Slice the chunk
    const chunkEnd = Math.min(offset + CHUNK_SIZE, totalSize);
    const chunk = file.slice(offset, chunkEnd);
    const chunkSize = chunkEnd - offset;

    // Create abort controller for this chunk
    const controller = new AbortController();
    abortControllers.set(taskId, controller);

    try {
      // Refresh auth token for long uploads
      let currentToken = authToken;
      try {
        const { data: { session: freshSession } } = await supabase.auth.getSession();
        if (freshSession?.access_token) {
          currentToken = freshSession.access_token;
        }
      } catch { /* use existing token */ }

      // Send chunk via PATCH (TUS protocol)
      const response = await fetch(tusUrl, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${currentToken}`,
          'Upload-Offset': String(offset),
          'Content-Type': 'application/offset+octet-stream',
          'Tus-Resumable': '1.0.0',
        },
        body: chunk,
        signal: controller.signal,
        // @ts-expect-error — duplex is needed for streaming upload in some browsers
        duplex: 'half',
      });

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        let errMsg = `HTTP ${response.status}`;

        // Handle 413 specifically
        if (response.status === 413) {
          errMsg = 'حجم الملف كبير جداً، يرجى رفع فيديو أصغر من 500 ميجابايت';
        } else {
          try {
            const errJson = JSON.parse(errText);
            errMsg = errJson.error || errJson.message || errMsg;
          } catch { /* use default */ }
        }

        throw new Error(errMsg);
      }

      // Update offset
      offset += chunkSize;

      // Calculate progress (0-90% for upload, 90-100% for DB save)
      const pct = Math.round((offset / totalSize) * 90);
      useVideoUploadStore.getState().updateTask(taskId, { progress: pct, uploadOffset: offset });

    } catch (err: unknown) {
      abortControllers.delete(taskId);

      // If aborted due to pause, save offset and return silently
      if (err instanceof DOMException && err.name === 'AbortError') {
        const currentTask = useVideoUploadStore.getState().tasks.find((t) => t.id === taskId);
        if (currentTask?.status === 'paused') {
          // Offset already saved, just return
          return;
        }
        if (currentTask?.status === 'cancelled') {
          return;
        }
        // Re-abort during chunk — treat as pause
        useVideoUploadStore.getState().updateTask(taskId, { status: 'paused', uploadOffset: offset });
        pauseSignals.set(taskId, { paused: true });
        return;
      }

      throw err;
    }

    abortControllers.delete(taskId);
  }
}

// ─────────────────────────────────────────────────────
// Resume upload from saved offset
// ─────────────────────────────────────────────────────

async function resumeUploadLoop(taskId: string) {
  const task = useVideoUploadStore.getState().tasks.find((t) => t.id === taskId);
  if (!task || !task.tusUrl || !task.file) return;

  try {
    // Get a fresh auth token
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) {
      useVideoUploadStore.getState().updateTask(taskId, { status: 'error', error: 'يرجى تسجيل الدخول أولاً' });
      return;
    }

    // Verify the upload offset with the server using HEAD request
    let serverOffset = task.uploadOffset;
    try {
      const headResponse = await fetch(task.tusUrl, {
        method: 'HEAD',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Tus-Resumable': '1.0.0',
        },
      });
      if (headResponse.ok) {
        const offsetHeader = headResponse.headers.get('Upload-Offset');
        if (offsetHeader) {
          serverOffset = parseInt(offsetHeader, 10);
        }
      }
    } catch { /* use local offset */ }

    // Use server offset if it's more up-to-date
    const resumeOffset = Math.max(serverOffset, task.uploadOffset);
    useVideoUploadStore.getState().updateTask(taskId, { status: 'uploading', uploadOffset: resumeOffset });

    // Continue chunked upload
    await uploadChunks(taskId, task.file, task.tusUrl, session.access_token, resumeOffset);

    // After all chunks are uploaded, proceed to DB save
    const updatedTask = useVideoUploadStore.getState().tasks.find((t) => t.id === taskId);
    if (!updatedTask || updatedTask.status !== 'uploading') return;

    const { data: urlData } = supabase.storage.from('video-files').getPublicUrl(updatedTask.storagePath!);
    const videoUrl = urlData.publicUrl;

    useVideoUploadStore.getState().updateTask(taskId, { videoUrl, status: 'saving', progress: 92 });

    // Create DB record
    const headers = await getCachedAuthHeaders();
    const response = await fetch('/api/videos/upload', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        subjectId: updatedTask.subjectId,
        uploadedBy: session.user.id,
        title: updatedTask.title.trim(),
        description: updatedTask.description.trim() || null,
        videoUrl,
        storagePath: updatedTask.storagePath,
        videoType: updatedTask.file.type,
        videoSize: updatedTask.file.size,
      }),
    });

    const result = await response.json();

    if (!response.ok || !result.success) {
      throw new Error(result.error || 'فشل حفظ بيانات الفيديو');
    }

    pauseSignals.delete(taskId);
    useVideoUploadStore.getState().updateTask(taskId, { status: 'done', progress: 100 });
    toast.success(`تم رفع الفيديو "${updatedTask.title}" بنجاح`);
  } catch (err: unknown) {
    const taskNow = useVideoUploadStore.getState().tasks.find((t) => t.id === taskId);
    if (taskNow?.status === 'cancelled' || taskNow?.status === 'paused') return;

    const message = err instanceof Error ? err.message : 'حدث خطأ أثناء رفع الفيديو';
    useVideoUploadStore.getState().updateTask(taskId, { status: 'error', error: message });
    toast.error(message);
  }
}

// ─────────────────────────────────────────────────────
// Fallback: Direct upload (for Supabase instances without TUS)
// ─────────────────────────────────────────────────────

async function directUpload(
  taskId: string,
  task: VideoUploadTask,
  authToken: string,
  supabaseUrl: string,
  storagePath: string,
  userId: string,
) {
  const { file, subjectId, title, description } = task;

  // Use XHR for progress tracking
  const uploadUrl = `${supabaseUrl}/storage/v1/object/video-files/${storagePath}`;
  const xhr = new XMLHttpRequest();

  const uploadPromise = new Promise<void>((resolve, reject) => {
    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) {
        const pct = Math.round((e.loaded / e.total) * 90);
        useVideoUploadStore.getState().updateTask(taskId, { progress: pct, uploadOffset: e.loaded });
      }
    });

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        try {
          const errBody = JSON.parse(xhr.responseText);
          let errMsg = errBody.error || errBody.message || `HTTP ${xhr.status}`;
          if (xhr.status === 413) {
            errMsg = 'حجم الملف كبير جداً. يرجى استخدام فيديو أصغر من 50 ميجابايت أو الترقية لخطة Pro';
          }
          reject(new Error(errMsg));
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

  // Create an abort controller that calls xhr.abort()
  const controller = new AbortController();
  controller.signal.addEventListener('abort', () => xhr.abort());
  abortControllers.set(taskId, controller);

  await uploadPromise;
  abortControllers.delete(taskId);

  // Get public URL
  const { data: urlData } = supabase.storage.from('video-files').getPublicUrl(storagePath);
  const videoUrl = urlData.publicUrl;

  useVideoUploadStore.getState().updateTask(taskId, { videoUrl, status: 'saving', progress: 92 });

  // Create DB record
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

  useVideoUploadStore.getState().updateTask(taskId, { status: 'done', progress: 100 });
  toast.success(`تم رفع الفيديو "${title}" بنجاح`);
}

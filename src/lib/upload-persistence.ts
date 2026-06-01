// =====================================================
// Upload Persistence — IndexedDB storage for file uploads
// =====================================================
// Persists file upload task metadata + ArrayBuffer data
// to IndexedDB so uploads survive page reloads.
// On reload, interrupted uploads can be retried using
// the stored ArrayBuffer data.

const DB_NAME = 'migo-upload-persistence';
const DB_VERSION = 1;
const TASK_STORE = 'tasks';
const DATA_STORE = 'file-data';

// ─── Serializable task metadata (no File/ArrayBuffer) ───

export interface PersistedUploadTask {
  id: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  customName: string;
  extension: string;
  progress: number;
  status: string; // 'uploading' | 'paused' | 'cancelled' | 'success' | 'error' | 'interrupted'
  error?: string;
  profileId: string;
  subjectIds: string[];
  createdAt: number; // timestamp for cleanup
}

// ─── Open / Initialize Database ───

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(TASK_STORE)) {
        db.createObjectStore(TASK_STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(DATA_STORE)) {
        db.createObjectStore(DATA_STORE, { keyPath: 'id' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// ─── Task Metadata Operations ───

export async function saveTaskMeta(task: PersistedUploadTask): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(TASK_STORE, 'readwrite');
    tx.objectStore(TASK_STORE).put(task);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch (err) {
    console.warn('[UploadPersistence] Failed to save task meta:', err);
  }
}

export async function getTaskMeta(id: string): Promise<PersistedUploadTask | null> {
  try {
    const db = await openDB();
    const tx = db.transaction(TASK_STORE, 'readonly');
    const request = tx.objectStore(TASK_STORE).get(id);
    return new Promise<PersistedUploadTask | null>((resolve) => {
      request.onsuccess = () => resolve((request.result as PersistedUploadTask) || null);
      request.onerror = () => resolve(null);
    }).finally(() => db.close());
  } catch {
    return null;
  }
}

export async function getAllTaskMetas(): Promise<PersistedUploadTask[]> {
  try {
    const db = await openDB();
    const tx = db.transaction(TASK_STORE, 'readonly');
    const request = tx.objectStore(TASK_STORE).getAll();
    return new Promise<PersistedUploadTask[]>((resolve) => {
      request.onsuccess = () => resolve((request.result as PersistedUploadTask[]) || []);
      request.onerror = () => resolve([]);
    }).finally(() => db.close());
  } catch {
    return [];
  }
}

export async function deleteTaskMeta(id: string): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(TASK_STORE, 'readwrite');
    tx.objectStore(TASK_STORE).delete(id);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch (err) {
    console.warn('[UploadPersistence] Failed to delete task meta:', err);
  }
}

// ─── File Data Operations (ArrayBuffer) ───

export async function saveFileData(id: string, data: ArrayBuffer): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(DATA_STORE, 'readwrite');
    tx.objectStore(DATA_STORE).put({ id, data });
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch (err) {
    console.warn('[UploadPersistence] Failed to save file data:', err);
  }
}

export async function getFileData(id: string): Promise<ArrayBuffer | null> {
  try {
    const db = await openDB();
    const tx = db.transaction(DATA_STORE, 'readonly');
    const request = tx.objectStore(DATA_STORE).get(id);
    return new Promise<ArrayBuffer | null>((resolve) => {
      request.onsuccess = () => resolve((request.result?.data as ArrayBuffer) || null);
      request.onerror = () => resolve(null);
    }).finally(() => db.close());
  } catch {
    return null;
  }
}

export async function deleteFileData(id: string): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(DATA_STORE, 'readwrite');
    tx.objectStore(DATA_STORE).delete(id);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch (err) {
    console.warn('[UploadPersistence] Failed to delete file data:', err);
  }
}

// ─── Cleanup: remove old completed/failed tasks (older than 1 hour) ───

export async function cleanupOldTasks(): Promise<void> {
  try {
    const all = await getAllTaskMetas();
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    const toDelete = all.filter(
      (t) =>
        (t.status === 'success' || t.status === 'cancelled' || t.status === 'error' || t.status === 'interrupted') &&
        t.createdAt < oneHourAgo
    );
    for (const task of toDelete) {
      await deleteTaskMeta(task.id);
      await deleteFileData(task.id);
    }
    if (toDelete.length > 0) {
      console.log(`[UploadPersistence] Cleaned up ${toDelete.length} old task(s)`);
    }
  } catch (err) {
    console.warn('[UploadPersistence] Cleanup failed:', err);
  }
}

// ─── Full cleanup for a single task ───

export async function cleanupTask(id: string): Promise<void> {
  await deleteTaskMeta(id);
  await deleteFileData(id);
}

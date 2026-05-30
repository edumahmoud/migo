import { create } from 'zustand';
import { supabase } from '@/lib/supabase';
import type { DBNotification, NotificationType } from '@/lib/types';
import { toast } from 'sonner';

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  read: boolean;
  createdAt: string;
  link?: string | null;
}

interface NotificationState {
  notifications: Notification[];
  unreadCount: number;
  initialized: boolean;
  initializing: boolean;
  currentUserId: string | null;
  subscription: ReturnType<typeof supabase.channel> | null;
  refetchTimer: ReturnType<typeof setInterval> | null;

  // Actions
  initializeNotifications: (userId: string) => Promise<void>;
  refetchNotifications: () => Promise<void>;
  createNotification: (notification: {
    userId: string;
    type: NotificationType;
    title: string;
    message: string;
    link?: string;
  }) => Promise<void>;
  addNotification: (notification: Omit<Notification, 'id' | 'read' | 'createdAt'>) => void;
  markAsRead: (id: string) => void;
  markAllAsRead: () => void;
  clearNotification: (id: string) => void;
  clearAll: () => void;
  cleanup: (fullReset?: boolean) => void;
}

/** Convert a DBNotification (from Supabase) to the client-side Notification shape */
function dbToNotification(db: DBNotification): Notification {
  return {
    id: db.id,
    type: db.type,
    title: db.title,
    message: db.message,
    read: db.read,
    createdAt: db.created_at,
    link: db.link,
  };
}

// Polling intervals for notification fallback (milliseconds)
const NOTIFICATION_REFETCH_INTERVAL_INITIAL = 8000; // 8 seconds for the first minute
const NOTIFICATION_REFETCH_INTERVAL = 15000; // 15 seconds after the first minute

// ─── Global dedup structures (module-level, outside Zustand) ───
// These provide O(1) lookup and survive across Zustand set() calls,
// preventing race conditions where two set() callbacks read the same
// stale state and both add the same notification.

/**
 * Set of all notification IDs we've ever seen (both DB UUIDs and local notif-* IDs).
 * This is the PRIMARY dedup mechanism — simple and reliable.
 * Checked before adding any notification to prevent duplicates from:
 *   - Supabase Realtime delivering the same INSERT event twice (reconnection)
 *   - Realtime + polling race condition
 *   - Multiple components initializing notifications simultaneously
 */
const seenNotificationIds = new Set<string>();

/**
 * Set of notification IDs currently pending deletion from the DB.
 * Used to prevent polling from re-adding notifications that were optimistically
 * removed from the store but whose DB DELETE hasn't completed yet.
 * Entries are automatically removed after 10 seconds (safety net).
 */
const pendingDeletionIds = new Map<string, number>(); // id → timestamp

/** Mark a notification ID as pending deletion */
function markPendingDeletion(id: string): void {
  pendingDeletionIds.set(id, Date.now());
}

/** Check if a notification ID is pending deletion */
function isPendingDeletion(id: string): boolean {
  const ts = pendingDeletionIds.get(id);
  if (!ts) return false;
  // Auto-expire after 10 seconds
  if (Date.now() - ts > 10000) {
    pendingDeletionIds.delete(id);
    return false;
  }
  return true;
}

/** Prune expired pending deletion entries */
function prunePendingDeletions(): void {
  const now = Date.now();
  for (const [id, ts] of pendingDeletionIds) {
    if (now - ts > 10000) pendingDeletionIds.delete(id);
  }
}

/** Reset all global dedup structures (called on cleanup / sign-out) */
function resetDedupStructures(): void {
  seenNotificationIds.clear();
}

// ─── localStorage-backed deletion tracking ───
// When a user deletes notifications and the DB DELETE fails silently (e.g. RLS errors),
// the notifications would reappear on page reload. This localStorage set tracks
// deleted IDs across page reloads so they can be filtered out during fetch.
const DELETED_IDS_STORAGE_KEY = 'attendo_deleted_notif_ids';
const DELETED_IDS_MAX_AGE = 24 * 60 * 60 * 1000; // 24 hours

interface DeletedIdEntry {
  id: string;
  deletedAt: number;
}

function getDeletedIdsFromStorage(): Set<string> {
  try {
    const raw = localStorage.getItem(DELETED_IDS_STORAGE_KEY);
    if (!raw) return new Set();
    const entries: DeletedIdEntry[] = JSON.parse(raw);
    const now = Date.now();
    // Filter out expired entries and return as Set
    const valid = entries.filter(e => now - e.deletedAt < DELETED_IDS_MAX_AGE);
    // Save cleaned version back
    localStorage.setItem(DELETED_IDS_STORAGE_KEY, JSON.stringify(valid));
    return new Set(valid.map(e => e.id));
  } catch {
    return new Set();
  }
}

function addDeletedIdToStorage(id: string): void {
  try {
    const raw = localStorage.getItem(DELETED_IDS_STORAGE_KEY);
    const entries: DeletedIdEntry[] = raw ? JSON.parse(raw) : [];
    entries.push({ id, deletedAt: Date.now() });
    // Keep only last 200 entries
    if (entries.length > 200) entries.splice(0, entries.length - 200);
    localStorage.setItem(DELETED_IDS_STORAGE_KEY, JSON.stringify(entries));
  } catch { /* localStorage may be unavailable */ }
}

function addDeletedIdsToStorage(ids: string[]): void {
  try {
    const raw = localStorage.getItem(DELETED_IDS_STORAGE_KEY);
    const entries: DeletedIdEntry[] = raw ? JSON.parse(raw) : [];
    const now = Date.now();
    for (const id of ids) {
      entries.push({ id, deletedAt: now });
    }
    // Keep only last 200 entries
    if (entries.length > 200) entries.splice(0, entries.length - 200);
    localStorage.setItem(DELETED_IDS_STORAGE_KEY, JSON.stringify(entries));
  } catch { /* localStorage may be unavailable */ }
}

/** Check if a Supabase error is caused by RLS infinite recursion (42P17) */
function isRLSRecursionError(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return error.code === '42P17' || /infinite recursion/i.test(error.message ?? '');
}

// ─── Notification sound / haptic feedback ───
/**
 * Play a short notification sound and vibrate the device when a new
 * notification arrives. Uses the Web Audio API to generate a distinct
 * three-tone chime without requiring an external audio file.
 * Also attempts an HTML5 Audio fallback for more reliable mobile playback.
 */
let audioContext: AudioContext | null = null;

export function playNotificationFeedback(): void {
  // Vibrate on supported devices (mobile)
  try {
    if (navigator.vibrate) {
      navigator.vibrate([150, 80, 150]);
    }
  } catch { /* vibration not supported */ }

  // ─── Attempt 1: HTML5 Audio with data URI (more reliable on mobile) ───
  // Some mobile browsers (especially iOS Safari) only allow audio playback
  // via the Audio element, not Web Audio API, and only after user interaction.
  // We try this first because it's more likely to work on mobile.
  try {
    // Generate a short WAV file as a data URI for a noticeable beep
    // This is a simple PCM sine wave beep: 800Hz, 200ms, mono, 8000 sample rate
    const sampleRate = 8000;
    const duration = 0.25;
    const numSamples = Math.floor(sampleRate * duration);
    const frequency = 800;
    // Create WAV buffer
    const buffer = new ArrayBuffer(44 + numSamples * 2);
    const view = new DataView(buffer);
    // WAV header
    const writeString = (offset: number, str: string) => {
      for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
    };
    writeString(0, 'RIFF');
    view.setUint32(4, 36 + numSamples * 2, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true); // chunk size
    view.setUint16(20, 1, true);  // PCM
    view.setUint16(22, 1, true);  // mono
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true); // byte rate
    view.setUint16(32, 2, true);  // block align
    view.setUint16(34, 16, true); // bits per sample
    writeString(36, 'data');
    view.setUint32(40, numSamples * 2, true);
    // Generate sine wave samples with fade-out
    for (let i = 0; i < numSamples; i++) {
      const t = i / sampleRate;
      const fadeOut = 1 - (t / duration); // linear fade out
      const sample = Math.sin(2 * Math.PI * frequency * t) * 0.6 * fadeOut;
      view.setInt16(44 + i * 2, Math.max(-32768, Math.min(32767, sample * 32767)), true);
    }
    const blob = new Blob([buffer], { type: 'audio/wav' });
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.volume = 0.8;
    const playPromise = audio.play();
    if (playPromise) {
      playPromise.catch(() => { /* autoplay blocked, will try Web Audio */ }).finally(() => {
        // Clean up the object URL after a delay
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      });
    }
  } catch { /* Audio element not supported, try Web Audio fallback */ }

  // ─── Attempt 2: Web Audio API three-tone chime ───
  // Play a more noticeable three-tone ascending chime with higher gain
  try {
    if (!audioContext) {
      audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    const ctx = audioContext;
    if (ctx.state === 'suspended') {
      ctx.resume();
    }

    const now = ctx.currentTime;

    // First tone — 880Hz, louder
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(880, now);
    gain1.gain.setValueAtTime(0.35, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.2);

    // Second tone — 1320Hz, higher pitch, delayed
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(1320, now + 0.12);
    gain2.gain.setValueAtTime(0.001, now);
    gain2.gain.setValueAtTime(0.30, now + 0.12);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.12);
    osc2.stop(now + 0.35);

    // Third tone — 1760Hz, highest pitch, more delayed — more distinct
    const osc3 = ctx.createOscillator();
    const gain3 = ctx.createGain();
    osc3.type = 'sine';
    osc3.frequency.setValueAtTime(1760, now + 0.25);
    gain3.gain.setValueAtTime(0.001, now);
    gain3.gain.setValueAtTime(0.25, now + 0.25);
    gain3.gain.exponentialRampToValueAtTime(0.001, now + 0.55);
    osc3.connect(gain3);
    gain3.connect(ctx.destination);
    osc3.start(now + 0.25);
    osc3.stop(now + 0.55);
  } catch { /* audio not available, non-critical */ }
}

export const useNotificationStore = create<NotificationState>((set, get) => ({
  notifications: [],
  unreadCount: 0,
  initialized: false,
  initializing: false,
  currentUserId: null,
  subscription: null,
  refetchTimer: null,

  refetchNotifications: async () => {
    const userId = get().currentUserId;
    if (!userId) return;

    try {
      // Check if we have a valid session before querying
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData?.session) return;

      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(100);

      if (error) {
        if (!isRLSRecursionError(error)) {
          console.error('Failed to refetch notifications:', JSON.stringify({ message: error.message, code: error.code, details: error.details }, null, 2));
        }
        return;
      }

      const dbNotifications = (data || []).map(dbToNotification);

      // Prune expired pending deletions periodically
      prunePendingDeletions();

      // Load localStorage deleted IDs early — needed for both new-from-poll detection and filtering
      const localStorageDeletedIds = getDeletedIdsFromStorage();

      // ─── Detect truly NEW notifications (arrived since last refetch) ───
      // These are notifications whose IDs are NOT in seenNotificationIds yet.
      // We need to detect them BEFORE marking all DB IDs as seen, so we can
      // show toasts for notifications that arrived via polling (not Realtime).
      const newFromPoll: Notification[] = [];
      for (const n of dbNotifications) {
        if (!seenNotificationIds.has(n.id) && !isPendingDeletion(n.id) && !localStorageDeletedIds.has(n.id)) {
          newFromPoll.push(n);
        }
      }

      // Mark all DB notification IDs as seen (so Realtime duplicates are caught)
      for (const n of dbNotifications) {
        seenNotificationIds.add(n.id);
      }

      // Filter out notifications that are pending deletion
      // (optimistically removed from store but DB DELETE not yet completed)
      // Also filter out notifications whose IDs are in the localStorage deleted set
      const filteredDbNotifications = dbNotifications.filter(
        (n) => !isPendingDeletion(n.id) && !localStorageDeletedIds.has(n.id)
      );

      // Merge intelligently — DB data is the source of truth
      set((state) => {
        const dbIdSet = new Set(filteredDbNotifications.map((n) => n.id));

        // Keep local-only notifications that don't have a DB counterpart yet
        const localOnly = state.notifications.filter(
          (n) => n.id.startsWith('notif-') && !dbIdSet.has(n.id)
        );

        // Suppress local-only notifications that match a DB notification by title+type
        // (The DB version supersedes the local optimistic version)
        const survivingLocal = localOnly.filter((n) => {
          return !filteredDbNotifications.some(
            (dbN) => dbN.title === n.title && dbN.type === n.type && dbN.message === n.message
          );
        });

        // Deduplicate DB IDs within the new results (defensive)
        const uniqueDbNotifications: Notification[] = [];
        const seenInBatch = new Set<string>();
        for (const n of filteredDbNotifications) {
          if (!seenInBatch.has(n.id)) {
            seenInBatch.add(n.id);
            uniqueDbNotifications.push(n);
          }
        }

        // Merge: DB notifications first (authoritative), then surviving local-only
        const merged = [...uniqueDbNotifications, ...survivingLocal]
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
          .slice(0, 100);

        const unreadCount = merged.filter((n) => !n.read).length;
        return { notifications: merged, unreadCount };
      });

      // ─── Show toasts + feedback for notifications detected via polling ───
      if (newFromPoll.length > 0) {
        // Play notification sound/haptic
        playNotificationFeedback();

        // Show toasts for unread notifications (limit to 3 to avoid flooding)
        const toShow = newFromPoll.filter(n => !n.read).slice(0, 3);
        for (const n of toShow) {
          try {
            toast(n.title, {
              description: n.message,
              duration: 5000,
            });
          } catch { /* sonner may not be mounted */ }
        }
      }
    } catch (err) {
      // Silently ignore refetch errors - they're non-critical and the polling will retry
    }
  },

  initializeNotifications: async (userId: string) => {
    // Prevent duplicate initialization for the same user
    if (get().initialized && get().currentUserId === userId) return;
    // Prevent concurrent initialization (race condition guard)
    if (get().initializing) return;

    // Mark as initializing to block concurrent calls
    set({ initializing: true });

    try {
    // Early RLS recursion check — try a lightweight query first
    try {
      const { error } = await supabase
        .from('notifications')
        .select('id')
        .limit(1);
      if (isRLSRecursionError(error)) {
        console.warn('Notification store: RLS recursion detected, skipping real-time setup');
        set({ initialized: true, initializing: false, currentUserId: userId });
        return;
      }
    } catch {
      // If even the probe throws, degrade gracefully
      console.warn('Notification store: probe query failed, degrading gracefully');
      set({ initialized: true, initializing: false, currentUserId: userId });
      return;
    }

    // Clean up any existing subscription first (partial reset — keep data and dedup structures
    // to prevent race conditions where Realtime re-delivers events after cleanup)
    get().cleanup(false);

    // ─── Use a STABLE channel name per user (no timestamp) ───
    // This ensures we always have exactly one channel per user, and cleanup
    // can reliably find and remove it. Previously, timestamped channel names
    // could leave orphaned channels that consumed resources without delivering events.
    const channelName = `notifications:${userId}`;

    // Remove any lingering channels for this user (including old timestamped ones)
    const allChannels = supabase.getChannels();
    for (const ch of allChannels) {
      // Match both stable name and old timestamped format
      if (
        ch.topic === channelName ||
        ch.topic === `realtime:${channelName}` ||
        ch.topic.startsWith(`realtime:notifications:${userId}:`) ||
        ch.topic.startsWith(`notifications:${userId}:`)
      ) {
        supabase.removeChannel(ch);
      }
    }

    try {
      // 1. Fetch all notifications from DB for this user
      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(100);

      if (error) {
        if (isRLSRecursionError(error)) {
          console.warn('Notification store: RLS recursion on fetch, degrading gracefully');
        } else {
          console.error('Failed to fetch notifications:', JSON.stringify({ message: error.message, code: error.code, details: error.details }, null, 2));
        }
        // Still set initialized so we don't keep retrying on every render
        set({ initialized: true, initializing: false, currentUserId: userId });
        return;
      }

      // 2. Replace the store's notifications array with DB data
      // Filter out notifications whose IDs are in the localStorage deleted set
      const localStorageDeletedIds = getDeletedIdsFromStorage();
      const notifications = (data || []).map(dbToNotification).filter(
        (n) => !localStorageDeletedIds.has(n.id)
      );
      const unreadCount = notifications.filter((n) => !n.read).length;

      // Populate global dedup structures with initial data
      for (const n of notifications) {
        seenNotificationIds.add(n.id);
      }

      // 3. Set up real-time subscription for INSERT events
      // Build the channel with all handlers BEFORE subscribing
      const channel = supabase
        .channel(channelName)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'notifications',
            filter: `user_id=eq.${userId}`,
          },
          (payload) => {
            const newNotif = dbToNotification(payload.new as DBNotification);

            // ─── Primary dedup: check seen IDs set ───
            // This prevents Supabase Realtime duplicate events (e.g., during reconnection)
            // and also catches race conditions with polling.
            if (seenNotificationIds.has(newNotif.id)) {
              return;
            }

            // Mark as seen immediately to prevent any concurrent handler from adding it
            seenNotificationIds.add(newNotif.id);

            set((state) => {
              // Double-check by ID (in case another set() added it between our seenIds check and here)
              if (state.notifications.some((n) => n.id === newNotif.id)) {
                return state;
              }

              // Check if a local-only notification with matching content already exists
              // (added by addNotification before the Realtime event arrived)
              // Replace it with the DB version (which is authoritative)
              const localOnlyMatch = state.notifications.find(
                (n) =>
                  n.id.startsWith('notif-') &&
                  n.title === newNotif.title &&
                  n.type === newNotif.type &&
                  n.message === newNotif.message
              );

              if (localOnlyMatch) {
                // Replace the local-only duplicate with the DB version
                const filtered = state.notifications.filter((n) => n.id !== localOnlyMatch.id);
                return {
                  notifications: [newNotif, ...filtered].slice(0, 100),
                  unreadCount: state.unreadCount, // Local was already counted
                };
              }

              return {
                notifications: [newNotif, ...state.notifications].slice(0, 100),
                unreadCount: state.unreadCount + (newNotif.read ? 0 : 1),
              };
            });

            // ─── Show toast + audio/haptic feedback for new notifications ───
            if (!newNotif.read) {
              playNotificationFeedback();
              try {
                toast(newNotif.title, {
                  description: newNotif.message,
                  duration: 5000,
                });
              } catch { /* sonner may not be mounted yet */ }
            }
          }
        )
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'notifications',
            filter: `user_id=eq.${userId}`,
          },
          (payload) => {
            const updated = dbToNotification(payload.new as DBNotification);
            // Mark as seen in case we get an INSERT after an UPDATE
            seenNotificationIds.add(updated.id);
            set((state) => {
              const existed = state.notifications.find((n) => n.id === updated.id);
              if (!existed) {
                // Notification not in store yet — add it (might have been missed)
                return {
                  notifications: [updated, ...state.notifications].slice(0, 100),
                  unreadCount: state.unreadCount + (updated.read ? 0 : 1),
                };
              }
              const prevUnread = existed.read ? 0 : 1;
              const newUnread = updated.read ? 0 : 1;
              return {
                notifications: state.notifications.map((n) =>
                  n.id === updated.id ? updated : n
                ),
                unreadCount: Math.max(0, state.unreadCount - prevUnread + newUnread),
              };
            });
          }
        )
        .on(
          'postgres_changes',
          {
            event: 'DELETE',
            schema: 'public',
            table: 'notifications',
            filter: `user_id=eq.${userId}`,
          },
          (payload) => {
            const deletedId = (payload.old as { id: string })?.id;
            if (!deletedId) return;
            // Keep in seenNotificationIds to prevent re-adding
            set((state) => {
              const notif = state.notifications.find((n) => n.id === deletedId);
              return {
                notifications: state.notifications.filter((n) => n.id !== deletedId),
                unreadCount: Math.max(0, state.unreadCount - (notif && !notif.read ? 1 : 0)),
              };
            });
          }
        )
        .subscribe((status) => {
          // ─── Reconnection logic ───
          // If the subscription drops or errors, the polling fallback will keep
          // notifications flowing. But we log the status for debugging.
          if (status === 'SUBSCRIBED') {
            console.log(`[notifications] Realtime subscription active for user ${userId}`);
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            console.warn(`[notifications] Realtime subscription issue (${status}) for user ${userId} — polling fallback active`);
            // Attempt to re-subscribe after a delay if the channel errored
            if (status === 'CHANNEL_ERROR') {
              setTimeout(() => {
                const currentSub = get().subscription;
                if (currentSub) {
                  console.log(`[notifications] Attempting to re-subscribe for user ${userId}`);
                  try {
                    currentSub.subscribe();
                  } catch {
                    console.warn(`[notifications] Re-subscribe failed for user ${userId}`);
                  }
                }
              }, 5000);
            }
          } else if (status === 'CLOSED') {
            console.log(`[notifications] Realtime channel closed for user ${userId}`);
          }
        });

      // 4. Set up polling fallback for when real-time subscription doesn't deliver
      // Use a faster interval (8s) for the first minute, then switch to 15s
      const initStartTime = Date.now();
      const refetchTimer = setInterval(() => {
        get().refetchNotifications();
        // After the first minute, reduce polling frequency
        if (Date.now() - initStartTime > 60000 && refetchTimer) {
          clearInterval(refetchTimer);
          const newTimer = setInterval(() => {
            get().refetchNotifications();
          }, NOTIFICATION_REFETCH_INTERVAL);
          // Update the timer reference in the store
          set({ refetchTimer: newTimer });
        }
      }, NOTIFICATION_REFETCH_INTERVAL_INITIAL);

      // 5. Immediately fetch to catch any notifications that arrived before the subscription was active
      get().refetchNotifications();

      set({
        notifications,
        unreadCount,
        initialized: true,
        initializing: false,
        currentUserId: userId,
        subscription: channel,
        refetchTimer,
      });
    } catch (err) {
      console.error('Failed to initialize notifications:', err);
      set({ initialized: true, initializing: false, currentUserId: userId });
    }
    // Safety net: ensure `initializing` is always reset, even if an unexpected
    // error occurs between the two try blocks or in any early return path.
  } finally {
    if (get().initializing) {
      set({ initializing: false });
    }
  }
  },

  createNotification: async (notification) => {
    try {
      // Insert into DB - real-time subscription will add it to the store
      const { data, error } = await supabase.from('notifications').insert({
        user_id: notification.userId,
        type: notification.type,
        title: notification.title,
        message: notification.message,
        link: notification.link || null,
      }).select('id')
      .single();

      if (error) {
        if (isRLSRecursionError(error)) {
          console.warn('Notification store: RLS recursion on insert, adding locally');
        } else {
          console.error('Failed to create notification in DB:', error);
        }
        // Fallback: add to store directly (client-side only)
        get().addNotification(notification);
      } else if (data?.id) {
        // Mark the DB-generated ID as seen so Realtime echo is deduped
        seenNotificationIds.add(data.id);
      }
      // If successful, the real-time subscription or polling will handle adding it
    } catch (err) {
      console.warn('Notification store: create failed, adding locally');
      // Fallback: add to store directly (client-side only)
      get().addNotification(notification);
    }
  },

  addNotification: (notification) => {
    const newNotification: Notification = {
      ...notification,
      id: `notif-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      read: false,
      createdAt: new Date().toISOString(),
    };

    // ─── Dedup: check seenNotificationIds (primary mechanism) ───
    // Check if an identical notification (same title+type+message) already exists in the store
    // This catches the case where addNotification is called as a fallback but the
    // notification was already added via Realtime or polling.
    const currentNotifications = get().notifications;
    const isDuplicate = currentNotifications.some(
      (n) => n.title === notification.title && n.type === notification.type && n.message === notification.message
    );
    if (isDuplicate) {
      return;
    }

    // Mark as seen
    seenNotificationIds.add(newNotification.id);

    set((state) => {
      // Double-check by content within the set callback (catches race conditions)
      const exists = state.notifications.some(
        (n) => n.title === notification.title && n.type === notification.type && n.message === notification.message
      );
      if (exists) return state;

      return {
        notifications: [newNotification, ...state.notifications].slice(0, 100),
        unreadCount: state.unreadCount + 1,
      };
    });
  },

  markAsRead: (id) => {
    const state = get();
    const notif = state.notifications.find((n) => n.id === id);

    // Update in store immediately
    set((s) => ({
      notifications: s.notifications.map((n) =>
        n.id === id ? { ...n, read: true } : n
      ),
      unreadCount: Math.max(0, s.unreadCount - (s.notifications.find((n) => n.id === id && !n.read) ? 1 : 0)),
    }));

    // Update in DB (only for DB-persisted notifications, not client-only ones)
    if (notif && !notif.id.startsWith('notif-')) {
      supabase
        .from('notifications')
        .update({ read: true })
        .eq('id', id)
        .then(({ error }) => {
          if (error) {
            if (isRLSRecursionError(error)) console.warn('Notification store: RLS recursion on markAsRead');
            else console.error('Failed to mark notification as read in DB:', error);
          }
        });
    }
  },

  markAllAsRead: () => {
    const state = get();
    const dbNotifIds = state.notifications.filter((n) => !n.read && !n.id.startsWith('notif-')).map((n) => n.id);

    // Update in store immediately
    set((s) => ({
      notifications: s.notifications.map((n) => ({ ...n, read: true })),
      unreadCount: 0,
    }));

    // Update all in DB
    if (dbNotifIds.length > 0 && state.currentUserId) {
      supabase
        .from('notifications')
        .update({ read: true })
        .in('id', dbNotifIds)
        .eq('user_id', state.currentUserId)
        .then(({ error }) => {
          if (error) {
            if (isRLSRecursionError(error)) console.warn('Notification store: RLS recursion on markAllAsRead');
            else console.error('Failed to mark all notifications as read in DB:', error);
          }
        });
    }
  },

  clearNotification: (id) => {
    const state = get();
    const notif = state.notifications.find((n) => n.id === id);

    // Mark as pending deletion to prevent polling from re-adding it
    markPendingDeletion(id);

    // Track in localStorage so if DB DELETE fails, the ID won't reappear on reload
    addDeletedIdToStorage(id);

    // IMPORTANT: Do NOT remove from seenNotificationIds!
    // Keeping the ID in seenNotificationIds prevents refetchNotifications()
    // from re-adding this notification if the DB DELETE is still pending or failed.

    // Remove from store immediately
    set((s) => ({
      notifications: s.notifications.filter((n) => n.id !== id),
      unreadCount: Math.max(0, s.unreadCount - (notif && !notif.read ? 1 : 0)),
    }));

    // Delete from DB (only for DB-persisted notifications)
    if (notif && !notif.id.startsWith('notif-')) {
      supabase
        .from('notifications')
        .delete()
        .eq('id', id)
        .then(({ error }) => {
          // Always remove from pending deletion set after DB operation completes
          pendingDeletionIds.delete(id);
          if (error) {
            if (isRLSRecursionError(error)) console.warn('Notification store: RLS recursion on clearNotification');
            else console.error('Failed to delete notification from DB:', error);
          }
        });
    } else {
      // Local-only notification, just remove from pending set
      pendingDeletionIds.delete(id);
    }
  },

  clearAll: () => {
    const state = get();

    // Mark all current notification IDs as pending deletion
    for (const n of state.notifications) {
      markPendingDeletion(n.id);
    }

    // Track all IDs in localStorage so if DB DELETE fails, they won't reappear on reload
    const allIds = state.notifications.map((n) => n.id);
    if (allIds.length > 0) {
      addDeletedIdsToStorage(allIds);
    }

    // IMPORTANT: Do NOT call resetDedupStructures() here!
    // Keeping the dedup structures populated prevents refetch from re-adding
    // deleted notifications before the DB DELETE completes.

    // Clear store immediately
    set({ notifications: [], unreadCount: 0 });

    // Delete all from DB
    if (state.currentUserId) {
      supabase
        .from('notifications')
        .delete()
        .eq('user_id', state.currentUserId)
        .then(({ error }) => {
          // Clear pending deletion set after DB operation completes
          pendingDeletionIds.clear();
          if (error) {
            if (isRLSRecursionError(error)) console.warn('Notification store: RLS recursion on clearAll');
            else console.error('Failed to clear all notifications from DB:', error);
          } else {
            // DB DELETE succeeded — now safe to clear dedup structures
            resetDedupStructures();
          }
        });
    } else {
      pendingDeletionIds.clear();
    }
  },

  cleanup: (fullReset = true) => {
    const { subscription, refetchTimer, currentUserId } = get();
    if (subscription) {
      subscription.unsubscribe();
      supabase.removeChannel(subscription);
    }
    // Clear the polling timer
    if (refetchTimer) {
      clearInterval(refetchTimer);
    }
    // Also remove any notification channels that might be lingering
    // (including old timestamped channels)
    const notificationChannels = supabase.getChannels().filter((ch) => {
      if (!currentUserId) return ch.topic.includes('notifications:');
      // Match stable name, old timestamped names, and Supabase's internal "realtime:" prefix
      return (
        ch.topic === `notifications:${currentUserId}` ||
        ch.topic === `realtime:notifications:${currentUserId}` ||
        ch.topic.includes(`notifications:${currentUserId}:`)
      );
    });
    notificationChannels.forEach((ch) => supabase.removeChannel(ch));

    // Full reset (sign-out): clear everything including dedup structures and notifications.
    // Partial reset (reinitialize): only clean up subscription/timer, keep data and dedup
    // to prevent duplicate notifications from race conditions between cleanup and re-subscribe.
    if (fullReset) {
      // Reset global dedup structures
      resetDedupStructures();
      pendingDeletionIds.clear();

      set({
        notifications: [],
        unreadCount: 0,
        subscription: null,
        refetchTimer: null,
        initialized: false,
        initializing: false,
        currentUserId: null,
      });
    } else {
      // Partial cleanup: only reset subscription/timer state, keep notifications and dedup
      set({
        subscription: null,
        refetchTimer: null,
        initialized: false,
        initializing: false,
      });
    }
  },
}));

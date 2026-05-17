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
const NOTIFICATION_REFETCH_INTERVAL_INITIAL = 8000; // 8 seconds for the first minute — reduced from 5s to minimize overlap with Realtime
const NOTIFICATION_REFETCH_INTERVAL = 15000; // 15 seconds after the first minute — frequent enough to catch missed realtime events

// Deduplication window — how long to suppress duplicate notifications with same title+message+type
const DEDUP_WINDOW_MS = 60000; // 60 seconds — extended from 30s to cover more race conditions

// ─── Global dedup structures (module-level, outside Zustand) ───
// These provide O(1) lookup and survive across Zustand set() calls,
// preventing race conditions where two set() callbacks read the same
// stale state and both add the same notification.

/**
 * Set of all notification IDs we've ever seen (both DB UUIDs and local notif-* IDs).
 * Checked before adding any notification to prevent duplicates from:
 *   - Supabase Realtime delivering the same INSERT event twice (reconnection)
 *   - Realtime + polling race condition
 *   - Multiple components initializing notifications simultaneously
 */
const seenNotificationIds = new Set<string>();

/**
 * Map of content hashes to timestamps. A content hash is derived from
 * title+message+type. Used for fast content-based dedup without O(n) array scan.
 * Entries older than DEDUP_WINDOW_MS are pruned on each check.
 */
const contentHashTimestamps = new Map<string, number>();

/** Generate a content hash from title+message+type */
function contentHash(title: string, message: string, type: string): string {
  return `${title}::${message}::${type}`;
}

/** Check if a content hash was seen recently (within DEDUP_WINDOW_MS) */
function isContentHashRecent(hash: string): boolean {
  const ts = contentHashTimestamps.get(hash);
  if (!ts) return false;
  if (Date.now() - ts > DEDUP_WINDOW_MS) {
    contentHashTimestamps.delete(hash);
    return false;
  }
  return true;
}

/** Record a content hash as seen now */
function markContentHashSeen(hash: string): void {
  contentHashTimestamps.set(hash, Date.now());
}

/** Prune expired content hash entries (call periodically) */
function pruneContentHashes(): void {
  const now = Date.now();
  for (const [hash, ts] of contentHashTimestamps) {
    if (now - ts > DEDUP_WINDOW_MS) {
      contentHashTimestamps.delete(hash);
    }
  }
}

/** Check if a notification ID was already seen and mark it if not */
function isSeenAndMark(notifId: string): boolean {
  if (seenNotificationIds.has(notifId)) return true;
  seenNotificationIds.add(notifId);
  return false;
}

/** Reset all global dedup structures (called on cleanup / sign-out) */
function resetDedupStructures(): void {
  seenNotificationIds.clear();
  contentHashTimestamps.clear();
}

/** Check if a Supabase error is caused by RLS infinite recursion (42P17) */
function isRLSRecursionError(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return error.code === '42P17' || /infinite recursion/i.test(error.message ?? '');
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

      // Prune expired content hashes periodically
      pruneContentHashes();

      // Mark all DB notification IDs as seen (so Realtime duplicates are caught)
      for (const n of dbNotifications) {
        seenNotificationIds.add(n.id);
        markContentHashSeen(contentHash(n.title, n.message, n.type));
      }

      // Merge intelligently — DB data is the source of truth
      set((state) => {
        const dbIdSet = new Set(dbNotifications.map((n) => n.id));

        // Keep local-only notifications that don't have a DB counterpart yet
        // (These were added optimistically before the DB insert propagated)
        const localOnly = state.notifications.filter(
          (n) => n.id.startsWith('notif-') && !dbIdSet.has(n.id)
        );

        // Suppress local-only notifications that match a DB notification by content
        // (The DB version supersedes the local optimistic version)
        const survivingLocal = localOnly.filter((n) => {
          const hash = contentHash(n.title, n.message, n.type);
          // Check if any DB notification has the same content hash
          return !dbNotifications.some(
            (dbN) => contentHash(dbN.title, dbN.message, dbN.type) === hash
          );
        });

        // Also check for duplicate DB IDs within the new results
        // (shouldn't happen normally, but defensive)
        const uniqueDbNotifications: Notification[] = [];
        const seenInBatch = new Set<string>();
        for (const n of dbNotifications) {
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
      const { error: probeError } = await supabase
        .from('notifications')
        .select('id')
        .limit(1);
      if (isRLSRecursionError(probeError)) {
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

    // Also remove any lingering channel with the same name from Supabase's internal map
    // This handles the case where cleanup() didn't fully remove it
    // Note: Supabase internally prefixes channel topics with "realtime:"
    const channelName = `notifications:${userId}:${Date.now()}`;
    const existingChannel = supabase.getChannels().find((ch) =>
      ch.topic === channelName || ch.topic === `realtime:${channelName}`
    );
    if (existingChannel) {
      supabase.removeChannel(existingChannel);
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
      const notifications = (data || []).map(dbToNotification);
      const unreadCount = notifications.filter((n) => !n.read).length;

      // Populate global dedup structures with initial data
      for (const n of notifications) {
        seenNotificationIds.add(n.id);
        markContentHashSeen(contentHash(n.title, n.message, n.type));
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

            // ─── Fast dedup: check seen IDs set FIRST ───
            // This prevents Supabase Realtime duplicate events (e.g., during reconnection)
            // and also catches race conditions with polling.
            if (seenNotificationIds.has(newNotif.id)) {
              return;
            }

            // Mark as seen immediately to prevent any concurrent handler from adding it
            seenNotificationIds.add(newNotif.id);

            // ─── Content hash dedup ───
            const hash = contentHash(newNotif.title, newNotif.message, newNotif.type);
            if (isContentHashRecent(hash)) {
              // Content duplicate within window — but might be a local-only notification
              // that should be replaced with the DB version
              set((state) => {
                const localMatch = state.notifications.find(
                  (n) => n.id.startsWith('notif-') && contentHash(n.title, n.message, n.type) === hash
                );
                if (localMatch) {
                  // Replace the local-only with the DB version
                  const filtered = state.notifications.filter((n) => n.id !== localMatch.id);
                  return {
                    notifications: [newNotif, ...filtered].slice(0, 100),
                    unreadCount: state.unreadCount, // Local was already counted
                  };
                }
                // No local match — this is a true duplicate, skip it
                return state;
              });
              return;
            }

            markContentHashSeen(hash);

            set((state) => {
              // Double-check by ID (in case another set() added it between our seenIds check and here)
              if (state.notifications.some((n) => n.id === newNotif.id)) {
                return state;
              }

              // Check if a local-only notification with matching content already exists
              // (added by addNotification before the Realtime event arrived)
              const now = Date.now();
              const localOnlyMatch = state.notifications.find(
                (n) =>
                  n.id.startsWith('notif-') &&
                  contentHash(n.title, n.message, n.type) === hash &&
                  now - new Date(n.createdAt).getTime() < DEDUP_WINDOW_MS
              );

              if (localOnlyMatch) {
                // Replace the local-only duplicate with the DB version
                const filtered = state.notifications.filter((n) => n.id !== localOnlyMatch.id);
                return {
                  notifications: [newNotif, ...filtered].slice(0, 100),
                  unreadCount: state.unreadCount, // Local was already counted
                };
              }

              // Also check by link field (more specific than content)
              if (newNotif.link && state.notifications.some(
                (n) => n.link === newNotif.link && n.type === newNotif.type &&
                now - new Date(n.createdAt).getTime() < DEDUP_WINDOW_MS
              )) {
                return state;
              }

              return {
                notifications: [newNotif, ...state.notifications].slice(0, 100),
                unreadCount: state.unreadCount + (newNotif.read ? 0 : 1),
              };
            });

            // ─── Show toast notification when a new notification arrives ───
            // Previously, notifications only appeared in the bell dropdown.
            // Now we also show a sonner toast so the user sees it immediately.
            // EXCEPT: Chat notifications are shown only in the chat section icon,
            // not as toasts or in the bell dropdown.
            if (!newNotif.read && newNotif.type !== 'chat') {
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
              if (!existed) return state;
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
            // Remove from seen IDs set
            seenNotificationIds.delete(deletedId);
            set((state) => {
              const notif = state.notifications.find((n) => n.id === deletedId);
              return {
                notifications: state.notifications.filter((n) => n.id !== deletedId),
                unreadCount: Math.max(0, state.unreadCount - (notif && !notif.read ? 1 : 0)),
              };
            });
          }
        )
        .subscribe();

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
    // Without this, the flag stays `true` forever, blocking all future init attempts.
  } finally {
    if (get().initializing) {
      set({ initializing: false });
    }
  }
  },

  createNotification: async (notification) => {
    // Pre-mark content hash so Realtime dedup catches the echo
    const hash = contentHash(notification.title, notification.message, notification.type);
    markContentHashSeen(hash);

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

    // ─── Fast dedup: check global structures ───
    const hash = contentHash(notification.title, notification.message, notification.type);

    // Check content hash first (O(1))
    if (isContentHashRecent(hash)) {
      return;
    }

    // Also check by link field (more specific than content)
    if (notification.link) {
      // We need to check existing notifications for link match
      // But the global content hash doesn't include link, so we check state
      // This is still O(n) but only for the link check, not content
      const currentNotifications = get().notifications;
      const now = Date.now();
      const linkDuplicate = currentNotifications.some(
        (n) => n.link === notification.link && n.type === notification.type &&
        now - new Date(n.createdAt).getTime() < DEDUP_WINDOW_MS
      );
      if (linkDuplicate) {
        return;
      }
    }

    // Mark as seen
    seenNotificationIds.add(newNotification.id);
    markContentHashSeen(hash);

    set((state) => {
      // Additional check within the set callback for full content dedup
      // (catches race condition where addNotification was called twice
      // before the first set() completed)
      const now = Date.now();
      const isDuplicate = state.notifications.some(
        (n) =>
          contentHash(n.title, n.message, n.type) === hash &&
          now - new Date(n.createdAt).getTime() < DEDUP_WINDOW_MS
      );
      if (isDuplicate) return state;

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

    // Remove from seen IDs
    seenNotificationIds.delete(id);

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
          if (error) {
            if (isRLSRecursionError(error)) console.warn('Notification store: RLS recursion on clearNotification');
            else console.error('Failed to delete notification from DB:', error);
          }
        });
    }
  },

  clearAll: () => {
    const state = get();

    // Clear global dedup structures
    resetDedupStructures();

    // Clear store immediately
    set({ notifications: [], unreadCount: 0 });

    // Delete all from DB
    if (state.currentUserId) {
      supabase
        .from('notifications')
        .delete()
        .eq('user_id', state.currentUserId)
        .then(({ error }) => {
          if (error) {
            if (isRLSRecursionError(error)) console.warn('Notification store: RLS recursion on clearAll');
            else console.error('Failed to clear all notifications from DB:', error);
          }
        });
    }
  },

  cleanup: (fullReset = true) => {
    const { subscription, refetchTimer } = get();
    if (subscription) {
      subscription.unsubscribe();
      supabase.removeChannel(subscription);
    }
    // Clear the polling timer
    if (refetchTimer) {
      clearInterval(refetchTimer);
    }
    // Also remove any notification channels that might be lingering
    const notificationChannels = supabase.getChannels().filter((ch) =>
      ch.topic.includes('notifications:')
    );
    notificationChannels.forEach((ch) => supabase.removeChannel(ch));

    // Full reset (sign-out): clear everything including dedup structures and notifications.
    // Partial reset (reinitialize): only clean up subscription/timer, keep data and dedup
    // to prevent duplicate notifications from race conditions between cleanup and re-subscribe.
    if (fullReset) {
      // Reset global dedup structures
      resetDedupStructures();

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

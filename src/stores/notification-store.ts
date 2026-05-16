import { create } from 'zustand';
import { supabase } from '@/lib/supabase';
import type { DBNotification, NotificationType } from '@/lib/types';

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
  cleanup: () => void;
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
const DEDUP_WINDOW_MS = 30000; // 30 seconds

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

      // Merge intelligently — DB data is the source of truth
      set((state) => {
        // Use DB ID as primary dedup key — if a DB notification has the same ID
        // as an existing one, it's the same notification (no duplicate)
        const dbIdSet = new Set(dbNotifications.map((n) => n.id));

        // Keep local-only notifications that don't have a DB counterpart yet
        // (These were added optimistically before the DB insert propagated)
        const localOnly = state.notifications.filter(
          (n) => n.id.startsWith('notif-') && !dbIdSet.has(n.id)
        );

        // Also suppress local-only notifications that match a DB notification by ID or content
        // (The DB version supersedes the local optimistic version)
        const dbIdAndContentSet = new Set(
          dbNotifications.map((n) => `${n.id}::${n.title}::${n.message}::${n.type}`)
        );
        const survivingLocal = localOnly.filter((n) => {
          // Check by content match
          const contentKey = `${n.title}::${n.message}::${n.type}`;
          const hasDbContentMatch = dbNotifications.some(
            (dbN) => `${dbN.id}::${dbN.title}::${dbN.message}::${dbN.type}`.includes(contentKey)
          );
          return !hasDbContentMatch;
        });

        // Merge: DB notifications first (authoritative), then surviving local-only
        const merged = [...dbNotifications, ...survivingLocal]
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

    // Clean up any existing subscription first
    get().cleanup();

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
            set((state) => {
              // Prevent duplicates: check by ID first (primary dedup key)
              if (state.notifications.some((n) => n.id === newNotif.id)) {
                return state;
              }
              // Check if a local-only notification with matching content already exists
              // (added by addNotification before the Realtime event arrived)
              const now = Date.now();
              const localOnlyMatch = state.notifications.some(
                (n) =>
                  n.id.startsWith('notif-') &&
                  n.title === newNotif.title &&
                  n.message === newNotif.message &&
                  n.type === newNotif.type &&
                  now - new Date(n.createdAt).getTime() < DEDUP_WINDOW_MS
              );
              // Also check by link field (more specific than content)
              if (newNotif.link && state.notifications.some(
                (n) => n.link === newNotif.link && n.type === newNotif.type &&
                now - new Date(n.createdAt).getTime() < DEDUP_WINDOW_MS
              )) {
                return state;
              }
              if (localOnlyMatch) {
                // Replace the local-only duplicate with the DB version
                const filtered = state.notifications.filter(
                  (n) =>
                    !(
                      n.id.startsWith('notif-') &&
                      n.title === newNotif.title &&
                      n.message === newNotif.message &&
                      n.type === newNotif.type
                    )
                );
                const unreadDelta = filtered.length < state.notifications.length
                  ? 0 // Local one was already counted
                  : (newNotif.read ? 0 : 1);
                return {
                  notifications: [newNotif, ...filtered].slice(0, 100),
                  unreadCount: Math.max(0, state.unreadCount + unreadDelta),
                };
              }
              // Content-based dedup within window (catches race conditions)
              const contentDuplicate = state.notifications.some(
                (n) =>
                  n.title === newNotif.title &&
                  n.message === newNotif.message &&
                  n.type === newNotif.type &&
                  now - new Date(n.createdAt).getTime() < DEDUP_WINDOW_MS
              );
              if (contentDuplicate) {
                return state;
              }
              return {
                notifications: [newNotif, ...state.notifications].slice(0, 100),
                unreadCount: state.unreadCount + (newNotif.read ? 0 : 1),
              };
            });
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
      // Use a faster interval (10s) for the first minute, then switch to 30s
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
  },

  createNotification: async (notification) => {
    try {
      // Insert into DB - real-time subscription will add it to the store
      const { error } = await supabase.from('notifications').insert({
        user_id: notification.userId,
        type: notification.type,
        title: notification.title,
        message: notification.message,
        link: notification.link || null,
      });

      if (error) {
        if (isRLSRecursionError(error)) {
          console.warn('Notification store: RLS recursion on insert, adding locally');
        } else {
          console.error('Failed to create notification in DB:', error);
        }
        // Fallback: add to store directly (client-side only)
        get().addNotification(notification);
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

    set((state) => {
      // Dedup: check if a notification with the same title+message+type was added within the dedup window
      const now = Date.now();
      const isDuplicate = state.notifications.some(
        (n) =>
          n.title === notification.title &&
          n.message === notification.message &&
          n.type === notification.type &&
          now - new Date(n.createdAt).getTime() < DEDUP_WINDOW_MS
      );
      if (isDuplicate) return state;

      // Also check by link field (more specific than content)
      if (notification.link && state.notifications.some(
        (n) => n.link === notification.link && n.type === notification.type &&
        now - new Date(n.createdAt).getTime() < DEDUP_WINDOW_MS
      )) {
        return state;
      }

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

  cleanup: () => {
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
    // Reset ALL state — notifications, unreadCount, etc.
    // Previous version didn't reset notifications/unreadCount, causing stale
    // data to persist after sign-out and contaminate the next user's session
    set({
      notifications: [],
      unreadCount: 0,
      subscription: null,
      refetchTimer: null,
      initialized: false,
      initializing: false,
      currentUserId: null,
    });
  },
}));

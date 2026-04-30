import { create } from 'zustand';
import type { UserStatus } from '@/lib/types';
import { getSocket } from '@/lib/socket';
import { supabase } from '@/lib/supabase';
import type { RealtimeChannel, RealtimePresenceJoinPayload } from '@supabase/supabase-js';

// =====================================================
// AttenDo - Global Status Store
// =====================================================
// Centralizes user presence status tracking so all
// components (chat, header, profile, settings) share
// the same status data instead of each maintaining
// their own local copies.
//
// Dual strategy:
//   - Socket.IO: Primary when available (typing, presence, status)
//   - Supabase Presence: Fallback on Vercel (no Socket.IO server)
//
// IMPORTANT: init() MUST be called with a userId for
// Supabase Presence to work correctly. Without a userId,
// the presence channel key defaults to 'anonymous' and
// other users won't see this user as online.
// =====================================================

interface StatusState {
  /** Map of userId → UserStatus for ALL known users */
  userStatuses: Map<string, UserStatus>;
  /** The current user's own status */
  myStatus: UserStatus;
  /** The current user's ID (needed to sync myStatus from socket events) */
  myUserId: string | null;
  /** Whether the store has been initialized with socket listeners */
  initialized: boolean;

  // Actions
  /** Initialize socket event listeners. Call with userId for Presence to work. */
  init: (userId?: string) => void;
  /** Set the current user's own status and emit to socket */
  setMyStatus: (status: UserStatus, userId: string) => void;
  /** Get a specific user's visible status */
  getUserStatus: (userId: string) => UserStatus;
  /** Request statuses for specific users from the server */
  fetchUserStatuses: (userIds: string[]) => void;
  /** Batch update statuses (e.g. from online-users list) */
  setOnlineUsers: (userIds: string[]) => void;
  /** Update a single user's status */
  setUserStatus: (userId: string, status: UserStatus) => void;
  /** Remove a user from statuses (e.g. on disconnect) */
  removeUser: (userId: string) => void;
  /** Clean up all listeners (call on sign out) */
  cleanup: () => void;
}

// =====================================================
// Status helper functions (shared across components)
// =====================================================

export function getStatusColor(status: UserStatus): string {
  switch (status) {
    case 'online': return 'bg-emerald-500';
    case 'busy': return 'bg-amber-500';
    case 'away': return 'bg-orange-500';
    default: return 'bg-gray-400';
  }
}

export function getStatusLabel(status: UserStatus): string {
  switch (status) {
    case 'online': return 'متصل';
    case 'busy': return 'مشغول';
    case 'away': return 'بعيد';
    default: return 'غير متصل';
  }
}

export function getStatusTextColor(status: UserStatus): string {
  switch (status) {
    case 'online': return 'text-emerald-600';
    case 'busy': return 'text-amber-600';
    case 'away': return 'text-orange-600';
    default: return 'text-gray-500';
  }
}

export function getStatusBorderColor(status: UserStatus): string {
  switch (status) {
    case 'online': return 'border-emerald-300';
    case 'busy': return 'border-amber-300';
    case 'away': return 'border-orange-300';
    default: return 'border-gray-300';
  }
}

/** Returns true if the user is "visible" (online, busy, or away) */
export function isVisible(status: UserStatus): boolean {
  return status === 'online' || status === 'busy' || status === 'away';
}

// =====================================================
// Local storage key for persisting own status
// =====================================================
const STATUS_STORAGE_KEY = 'attenddo-user-status';

function loadSavedStatus(): UserStatus {
  if (typeof window === 'undefined') return 'online';
  try {
    const saved = localStorage.getItem(STATUS_STORAGE_KEY);
    if (saved && ['online', 'busy', 'away', 'offline', 'invisible'].includes(saved)) {
      return saved as UserStatus;
    }
  } catch {
    // Ignore
  }
  return 'online';
}

// =====================================================
// Store
// =====================================================

// Keep track of registered listeners so we can avoid duplicates
let listenersRegistered = false;

// Supabase Presence channel (used when Socket.IO is unavailable)
let presenceChannel: RealtimeChannel | null = null;

// Track whether we've set up presence with a real userId
let presenceInitializedWithUserId = false;

// Presence state tracking for Supabase Realtime
interface PresenceState {
  userId: string;
  status: UserStatus;
  onlineAt: string;
}

export const useStatusStore = create<StatusState>((set, get) => ({
  userStatuses: new Map<string, UserStatus>(),
  myStatus: loadSavedStatus(),
  myUserId: null,
  initialized: false,

  init: (userId?: string) => {
    // If userId is provided, store it immediately
    if (userId) {
      set({ myUserId: userId });
    }

    const socket = getSocket();

    // If no socket is available (Realtime-only mode / no Socket.IO server),
    // use Supabase Presence as a fallback for online/offline tracking.
    if (!socket) {
      // Set up Supabase Presence for online status tracking
      const effectiveUserId = userId || get().myUserId;
      if (effectiveUserId) {
        setupSupabasePresence(get, effectiveUserId);
        // Also set our status to online immediately
        get().setMyStatus(get().myStatus, effectiveUserId);
      } else {
        // Defer presence setup until setMyStatus is called with a userId
        // Store a flag so setMyStatus knows to initialize presence
        setupDeferredPresence(get);
      }
      set({ initialized: true });
      return;
    }

    // Remove any previously attached listeners (safe even if none exist)
    socket.off('connect', handleConnect);
    socket.off('online-users', handleOnlineUsers);
    socket.off('user-online', handleUserOnline);
    socket.off('user-offline', handleUserOffline);
    socket.off('user-status-changed', handleUserStatusChanged);
    socket.off('user-statuses', handleUserStatuses);

    listenersRegistered = true;

    // ─── On connect/reconnect: re-request online users ───
    function handleConnect() {
      socket.emit('get-online-users');
      // Also re-emit our own status so others see us as online
      const { myStatus, myUserId } = get();
      if (myUserId && myStatus !== 'offline') {
        socket.emit('status-change', { userId: myUserId, status: myStatus });
      }
    }
    socket.on('connect', handleConnect);

    // ─── Receive online users list (on connect/reconnect) ───
    function handleOnlineUsers(userIds: string[]) {
      set((state) => {
        const next = new Map(state.userStatuses);
        for (const uid of userIds) {
          const existing = next.get(uid);
          if (!existing || existing === 'offline') {
            next.set(uid, 'online');
          }
        }
        return { userStatuses: next };
      });
    }
    socket.on('online-users', handleOnlineUsers);

    // ─── User came online ───
    function handleUserOnline(userId: string) {
      set((state) => {
        const next = new Map(state.userStatuses);
        const existing = next.get(userId);
        if (!existing || existing === 'offline') {
          next.set(userId, 'online');
        }
        return { userStatuses: next };
      });
    }
    socket.on('user-online', handleUserOnline);

    // ─── User went offline ───
    function handleUserOffline(userId: string) {
      set((state) => {
        const next = new Map(state.userStatuses);
        next.set(userId, 'offline');
        return { userStatuses: next };
      });
    }
    socket.on('user-offline', handleUserOffline);

    // ─── User status changed (online/busy/away/offline/invisible) ───
    function handleUserStatusChanged(data: { userId: string; status: UserStatus }) {
      set((state) => {
        const next = new Map(state.userStatuses);
        next.set(data.userId, data.status);
        const isOwnStatus = data.userId === state.myUserId;
        return {
          userStatuses: next,
          ...(isOwnStatus ? { myStatus: data.status } : {}),
        };
      });
    }
    socket.on('user-status-changed', handleUserStatusChanged);

    // ─── Receive statuses from get-user-status response ───
    function handleUserStatuses(statuses: Record<string, UserStatus>) {
      set((state) => {
        const next = new Map(state.userStatuses);
        for (const [uid, status] of Object.entries(statuses)) {
          next.set(uid, status);
        }
        return { userStatuses: next };
      });
    }
    socket.on('user-statuses', handleUserStatuses);

    // If already connected, request online users immediately
    if (socket.connected) {
      socket.emit('get-online-users');
    }

    // Also emit our own status if we have a userId
    const { myStatus, myUserId } = get();
    if (myUserId && socket.connected && myStatus !== 'offline') {
      socket.emit('status-change', { userId: myUserId, status: myStatus });
    }

    set({ initialized: true });
  },

  setMyStatus: (status: UserStatus, userId: string) => {
    // Save to localStorage
    try {
      localStorage.setItem(STATUS_STORAGE_KEY, status);
    } catch {
      // Ignore
    }

    // Emit to socket (only if available)
    const socket = getSocket();
    if (socket?.connected) {
      socket.emit('status-change', { userId, status });
    }

    // Update Supabase Presence (for Vercel fallback)
    // If presence channel doesn't exist yet, create it now with the correct userId
    if (!presenceChannel && !getSocket()) {
      setupSupabasePresence(get, userId);
    }
    updatePresenceStatus(userId, status);

    // Update local state immediately
    set((state) => {
      const next = new Map(state.userStatuses);
      next.set(userId, status);
      return { myStatus: status, myUserId: userId, userStatuses: next };
    });
  },

  getUserStatus: (userId: string) => {
    return get().userStatuses.get(userId) || 'offline';
  },

  fetchUserStatuses: (userIds: string[]) => {
    const socket = getSocket();
    if (socket?.connected && userIds.length > 0) {
      socket.emit('get-user-status', { userIds });
    }

    // When Socket.IO is unavailable, use Supabase Presence to check statuses
    if (!socket && presenceChannel) {
      // Trigger a presence sync by re-tracking our own presence
      // This causes a 'sync' event which updates all user statuses
      const { myStatus, myUserId } = get();
      if (myUserId) {
        try {
          presenceChannel.track({
            userId: myUserId,
            status: myStatus,
            onlineAt: new Date().toISOString(),
          });
        } catch {
          // Ignore tracking errors
        }
      }
    }

    // Additionally, directly check the current presence state for these users
    if (!socket && presenceChannel) {
      try {
        const state = presenceChannel.presenceState<PresenceState>();
        const updates: Array<{ userId: string; status: UserStatus }> = [];
        for (const uid of userIds) {
          const presences = state[uid];
          if (presences && presences.length > 0) {
            const latestPresence = presences[presences.length - 1];
            updates.push({ userId: uid, status: latestPresence.status || 'online' });
          }
        }
        if (updates.length > 0) {
          set((s) => {
            const next = new Map(s.userStatuses);
            for (const u of updates) {
              next.set(u.userId, u.status);
            }
            return { userStatuses: next };
          });
        }
      } catch {
        // Ignore presence state errors
      }
    }
  },

  setOnlineUsers: (userIds: string[]) => {
    set((state) => {
      const next = new Map(state.userStatuses);
      for (const uid of userIds) {
        const existing = next.get(uid);
        if (!existing || existing === 'offline') {
          next.set(uid, 'online');
        }
      }
      return { userStatuses: next };
    });
  },

  setUserStatus: (userId: string, status: UserStatus) => {
    set((state) => {
      const next = new Map(state.userStatuses);
      next.set(userId, status);
      return { userStatuses: next };
    });
  },

  removeUser: (userId: string) => {
    set((state) => {
      const next = new Map(state.userStatuses);
      next.set(userId, 'offline');
      return { userStatuses: next };
    });
  },

  cleanup: () => {
    // Clean up Supabase Presence channel
    if (presenceChannel) {
      try {
        supabase.removeChannel(presenceChannel);
      } catch { /* Ignore */ }
      presenceChannel = null;
      presenceInitializedWithUserId = false;
    }
    set({ myUserId: null, initialized: false });
  },
}));

// =====================================================
// Supabase Presence Helper (fallback for Vercel)
// =====================================================

function setupSupabasePresence(getState: () => StatusState, userId: string) {
  // Don't create duplicate channels
  if (presenceChannel) {
    // If channel exists but wasn't set up with a real userId, recreate it
    if (!presenceInitializedWithUserId && userId) {
      try {
        supabase.removeChannel(presenceChannel);
        presenceChannel = null;
      } catch { /* Ignore */ }
    } else {
      // Channel already properly initialized
      return;
    }
  }

  try {
    const { myStatus } = getState();

    console.log(`[StatusStore] Setting up Supabase Presence for user: ${userId}`);

    presenceChannel = supabase.channel('attenddo-presence', {
      config: {
        presence: {
          key: userId, // Use userId as the presence key (NOT 'anonymous')
        },
      },
    });

    presenceChannel.on('presence', { event: 'sync' }, () => {
      const state = presenceChannel?.presenceState<PresenceState>();
      if (!state) return;

      const onlineUserIds: string[] = [];
      for (const [key, presences] of Object.entries(state)) {
        // key is the userId we set in presence config
        if (key === 'anonymous') continue;
        // Mark this user as online
        onlineUserIds.push(key);
        // Check if they have a specific status
        const latestPresence = presences[presences.length - 1];
        if (latestPresence?.status && latestPresence.status !== 'online') {
          useStatusStore.getState().setUserStatus(key, latestPresence.status);
        }
      }

      // Mark all present users as online
      useStatusStore.getState().setOnlineUsers(onlineUserIds);

      // Mark users NOT in the presence list as offline
      const currentStatuses = useStatusStore.getState().userStatuses;
      const offlineUpdates: string[] = [];
      currentStatuses.forEach((status, uid) => {
        if (status !== 'offline' && !onlineUserIds.includes(uid)) {
          offlineUpdates.push(uid);
        }
      });
      for (const uid of offlineUpdates) {
        useStatusStore.getState().setUserStatus(uid, 'offline');
      }
    });

    presenceChannel.on('presence', { event: 'join' }, ({ newPresences }: RealtimePresenceJoinPayload<PresenceState>) => {
      for (const p of newPresences) {
        if (p.userId && p.status) {
          useStatusStore.getState().setUserStatus(p.userId, p.status);
        } else if (p.userId) {
          useStatusStore.getState().setUserStatus(p.userId, 'online');
        }
      }
    });

    presenceChannel.on('presence', { event: 'leave' }, ({ leftPresences }: { leftPresences: PresenceState[] }) => {
      for (const p of leftPresences) {
        if (p.userId) {
          useStatusStore.getState().setUserStatus(p.userId, 'offline');
        }
      }
    });

    presenceChannel.subscribe(async (subStatus) => {
      console.log('[StatusStore] Presence subscription status:', subStatus);
      if (subStatus === 'SUBSCRIBED') {
        // Track our own presence
        await presenceChannel?.track({
          userId,
          status: myStatus,
          onlineAt: new Date().toISOString(),
        });
        presenceInitializedWithUserId = true;
      }
    });
  } catch (err) {
    console.error('[StatusStore] Supabase Presence setup error:', err);
  }
}

/**
 * Deferred presence setup — creates a temporary channel that will be
 * replaced with a proper one once setMyStatus() is called with a userId.
 */
function setupDeferredPresence(getState: () => StatusState) {
  // Create a minimal channel just to subscribe to presence events
  // so we can see OTHER users coming online, but don't track ourselves yet
  if (presenceChannel) return;

  try {
    presenceChannel = supabase.channel('attenddo-presence', {
      config: {
        presence: {
          key: `pending-${Date.now()}`, // Temporary key, will be replaced
        },
      },
    });

    presenceChannel.on('presence', { event: 'sync' }, () => {
      const state = presenceChannel?.presenceState<PresenceState>();
      if (!state) return;

      const onlineUserIds: string[] = [];
      for (const [key, presences] of Object.entries(state)) {
        if (key.startsWith('pending-') || key === 'anonymous') continue;
        onlineUserIds.push(key);
        const latestPresence = presences[presences.length - 1];
        if (latestPresence?.status && latestPresence.status !== 'online') {
          useStatusStore.getState().setUserStatus(key, latestPresence.status);
        }
      }

      useStatusStore.getState().setOnlineUsers(onlineUserIds);

      const currentStatuses = useStatusStore.getState().userStatuses;
      const offlineUpdates: string[] = [];
      currentStatuses.forEach((status, uid) => {
        if (status !== 'offline' && !onlineUserIds.includes(uid)) {
          offlineUpdates.push(uid);
        }
      });
      for (const uid of offlineUpdates) {
        useStatusStore.getState().setUserStatus(uid, 'offline');
      }
    });

    presenceChannel.on('presence', { event: 'join' }, ({ newPresences }: RealtimePresenceJoinPayload<PresenceState>) => {
      for (const p of newPresences) {
        if (p.userId && p.status) {
          useStatusStore.getState().setUserStatus(p.userId, p.status);
        } else if (p.userId) {
          useStatusStore.getState().setUserStatus(p.userId, 'online');
        }
      }
    });

    presenceChannel.on('presence', { event: 'leave' }, ({ leftPresences }: { leftPresences: PresenceState[] }) => {
      for (const p of leftPresences) {
        if (p.userId) {
          useStatusStore.getState().setUserStatus(p.userId, 'offline');
        }
      }
    });

    presenceChannel.subscribe((subStatus) => {
      console.log('[StatusStore] Deferred presence subscription:', subStatus);
    });
  } catch (err) {
    console.error('[StatusStore] Deferred presence setup error:', err);
  }
}

function updatePresenceStatus(userId: string, status: UserStatus) {
  if (!presenceChannel) return;

  // If the channel was set up with a temporary/pending key, recreate with real userId
  if (!presenceInitializedWithUserId) {
    const state = useStatusStore.getState();
    setupSupabasePresence(() => state, userId);
    return;
  }

  try {
    presenceChannel.track({
      userId,
      status,
      onlineAt: new Date().toISOString(),
    });
  } catch {
    // Ignore tracking errors
  }
}

import { create } from 'zustand';
import type { UserStatus } from '@/lib/types';
import { getSocket } from '@/lib/socket';

// =====================================================
// AttenDo - Global Status Store
// =====================================================
// Centralizes user presence status tracking so all
// components (chat, header, profile, settings) share
// the same status data instead of each maintaining
// their own local copies.
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
  /** Initialize socket event listeners (call once after socket connects) */
  init: () => void;
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

export const useStatusStore = create<StatusState>((set, get) => ({
  userStatuses: new Map<string, UserStatus>(),
  myStatus: loadSavedStatus(),
  myUserId: null,
  initialized: false,

  init: () => {
    // Always re-attach listeners — the socket may have been destroyed and recreated
    // since the last init() call. Removing old listeners first prevents duplicates.
    const socket = getSocket();

    // Remove any previously attached listeners (safe even if none exist)
    socket.off('connect', handleConnect);
    socket.off('online-users', handleOnlineUsers);
    socket.off('user-online', handleUserOnline);
    socket.off('user-offline', handleUserOffline);
    socket.off('user-status-changed', handleUserStatusChanged);
    socket.off('user-statuses', handleUserStatuses);

    listenersRegistered = true;

    // ─── On connect/reconnect: re-request online users ───
    // This is critical to recover status data after a disconnect
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
          // Don't overwrite a known non-online status (e.g. busy/away/invisible)
          // unless they're currently offline/unknown
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
        // Only set to online if they were offline or unknown
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
        // If this is our own status update reflected back, sync myStatus
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

    set({ initialized: true });
  },

  setMyStatus: (status: UserStatus, userId: string) => {
    // Save to localStorage
    try {
      localStorage.setItem(STATUS_STORAGE_KEY, status);
    } catch {
      // Ignore
    }

    // Emit to socket
    const socket = getSocket();
    if (socket.connected) {
      socket.emit('status-change', { userId, status });
    }

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
    if (socket.connected && userIds.length > 0) {
      socket.emit('get-user-status', { userIds });
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
}));


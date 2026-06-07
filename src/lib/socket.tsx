'use client';

// =====================================================
// AttenDo - Chat Connection Provider
// =====================================================
// Strategy:
//   - PRIMARY: Supabase Realtime (works everywhere, including Vercel)
//   - BONUS: Socket.IO (typing indicators, presence) — only when available
//
// On Vercel without NEXT_PUBLIC_CHAT_SERVICE_URL, Socket.IO is
// skipped entirely and Realtime handles all message delivery.
// The UI shows "متصل" (connected) once Realtime subscribes.
// =====================================================

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type ReactElement,
} from 'react';
import { io, Socket } from 'socket.io-client';
import type { UserStatus } from '@/lib/types';

// =====================================================
// Types
// =====================================================

/** Connection status of the chat system */
export type SocketConnectionStatus = 'connected' | 'disconnected' | 'connecting' | 'realtime';

/** Value provided by the SocketContext */
export interface SocketContextValue {
  /** The Socket.IO instance (null if skipped or not yet created) */
  socket: Socket | null;
  /** Current connection status */
  status: SocketConnectionStatus;
  /** Whether the chat system is connected (Socket.IO or Realtime) */
  isConnected: boolean;
  /** Whether we're using Realtime mode (no Socket.IO server) */
  isRealtimeMode: boolean;
}

/** Return type of the useSharedSocket hook */
export interface UseSharedSocketReturn extends SocketContextValue {
  /** Join a specific conversation room */
  joinRoom: (conversationId: string) => void;
  /** Leave a specific conversation room */
  leaveRoom: (conversationId: string) => void;
  /** Join multiple conversation rooms at once */
  joinAllRooms: (conversationIds: string[]) => void;
  /** Emit a status change event (online/away/busy/offline/invisible) */
  emitStatusChange: (userId: string, status: UserStatus) => void;
}

// =====================================================
// Detect if Socket.IO server is available
// =====================================================

function hasChatServiceUrl(): boolean {
  return !!process.env.NEXT_PUBLIC_CHAT_SERVICE_URL;
}

function getSocketUrl(): string {
  const customUrl = process.env.NEXT_PUBLIC_CHAT_SERVICE_URL;
  if (customUrl) return customUrl;
  return '';
}

// =====================================================
// Singleton Socket Management
// =====================================================

let socketInstance: Socket | null = null;
let authCredentials: { userId: string; userName: string } | null = null;
let providerCount = 0;
let providerListenersAttached = false;
let reconnectAttempts = 0;
let socketGivenUp = false;

// Provider-level status listeners
let providerConnectHandler: (() => void) | null = null;
let providerDisconnectHandler: ((reason: string) => void) | null = null;
let providerReconnectAttemptHandler: ((attempt: number) => void) | null = null;
let providerIoReconnectAttemptHandler: (() => void) | null = null;
let providerConnectErrorHandler: ((err: Error) => void) | null = null;
let providerIoReconnectFailedHandler: (() => void) | null = null;
let providerIoErrorHandler: ((err: Error) => void) | null = null;

/**
 * Get or create the singleton Socket.IO instance.
 * If no chat service URL is configured, returns null (Realtime-only mode).
 */
export function getSocket(): Socket | null {
  // If no chat service URL is configured, don't even try Socket.IO
  if (!hasChatServiceUrl() && !socketInstance) {
    return null;
  }

  if (!socketInstance) {
    const SOCKET_OPTIONS: Parameters<typeof io>[1] = {
      path: '/socket.io',
      transports: ['polling', 'websocket'],
      forceNew: false,
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
      timeout: 5000,
      autoConnect: true,
      withCredentials: false,
      query: { XTransformPort: '3003' },
    };

    socketInstance = io(getSocketUrl(), SOCKET_OPTIONS);

    socketInstance.on('connect', async () => {
      reconnectAttempts = 0;
      if (authCredentials) {
        // Get JWT token for server-side verification
        let token: string | undefined;
        try {
          const { supabase } = await import('@/lib/supabase');
          const { data: { session } } = await supabase.auth.getSession();
          token = session?.access_token || undefined;
        } catch {
          // Session unavailable
        }
        socketInstance!.emit('auth', {
          userId: authCredentials.userId,
          userName: authCredentials.userName,
          token,
        });
      }
    });

    socketInstance.on('connect_error', (err) => {
      reconnectAttempts++;
      console.warn(`[Socket] connect_error (attempt ${reconnectAttempts}):`, err.message);
      if (reconnectAttempts >= 3 && !socketGivenUp) {
        socketGivenUp = true;
        console.warn('[Socket] Giving up on Socket.IO — falling back to Realtime');
      }
    });

    socketInstance.on('disconnect', (reason) => {
      console.warn('[Socket] disconnected:', reason);
      if (reason === 'io server disconnect') {
        socketInstance?.connect();
      }
    });
  }

  return socketInstance;
}

export async function setSocketAuth(userId: string, userName: string): Promise<void> {
  authCredentials = { userId, userName };
  const socket = getSocket();

  // Get the current JWT token for server-side verification
  let token: string | undefined;
  try {
    const { supabase } = await import('@/lib/supabase');
    const { data: { session } } = await supabase.auth.getSession();
    token = session?.access_token || undefined;
  } catch {
    // Session unavailable — connect without token (server will reject if JWT verification is enabled)
    console.warn('[Socket] Failed to get session token for Socket.IO auth');
  }

  if (socket?.connected) {
    socket.emit('auth', { userId, userName, token });
  }
}

export function destroySocket(): void {
  if (socketInstance) {
    socketInstance.removeAllListeners();
    socketInstance.disconnect();
    socketInstance = null;
  }
  authCredentials = null;
  providerListenersAttached = false;
  reconnectAttempts = 0;
  socketGivenUp = false;
}

export function isSocketGivenUp(): boolean {
  return socketGivenUp || !hasChatServiceUrl();
}

// =====================================================
// Helper Functions
// =====================================================

export function joinRoom(conversationId: string): void {
  const socket = getSocket();
  if (!socket) return;
  if (socket.connected) {
    socket.emit('join-conversation', { conversationId });
  } else {
    socket.once('connect', () => {
      socket.emit('join-conversation', { conversationId });
    });
  }
}

export function leaveRoom(conversationId: string): void {
  const socket = getSocket();
  if (!socket) return;
  if (socket.connected) {
    socket.emit('leave-conversation', { conversationId });
  }
}

export function joinAllRooms(conversationIds: string[]): void {
  if (conversationIds.length === 0) return;
  const socket = getSocket();
  if (!socket) return;
  if (socket.connected) {
    socket.emit('join-all-conversations', { conversationIds });
  } else {
    socket.once('connect', () => {
      socket.emit('join-all-conversations', { conversationIds });
    });
  }
}

export function emitStatusChange(userId: string, status: UserStatus): void {
  const socket = getSocket();
  if (!socket) return;
  if (socket.connected) {
    socket.emit('status-change', { userId, status });
  }
}

// =====================================================
// React Context
// =====================================================

const SocketContext = createContext<SocketContextValue>({
  socket: null,
  status: 'disconnected',
  isConnected: false,
  isRealtimeMode: false,
});

SocketContext.displayName = 'SocketContext';

// =====================================================
// SocketProvider
// =====================================================

export interface SocketProviderProps {
  children: ReactNode;
}

export function SocketProvider({ children }: SocketProviderProps): ReactElement {
  const isRealtimeMode = !hasChatServiceUrl();
  const [status, setStatus] = useState<SocketConnectionStatus>(() => {
    if (isRealtimeMode) return 'realtime'; // Immediately connected via Realtime
    return 'connecting';
  });
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    providerCount++;

    if (isRealtimeMode) {
      // No Socket.IO server — Realtime mode from the start
      setStatus('realtime');
      socketRef.current = null;
      return () => {
        providerCount--;
      };
    }

    // Socket.IO mode — try to connect
    const socket = getSocket();
    socketRef.current = socket;

    if (!socket) {
      setStatus('realtime');
      return () => { providerCount--; };
    }

    if (socket.connected) {
      setStatus('connected');
    } else if (socket.io.opts.autoConnect) {
      setStatus('connecting');
    } else {
      setStatus('disconnected');
    }

    if (!providerListenersAttached) {
      providerListenersAttached = true;

      providerConnectHandler = () => {
        reconnectAttempts = 0;
        setStatus('connected');
      };
      providerDisconnectHandler = (reason: string) => {
        console.warn('[SocketProvider] disconnect:', reason);
        setStatus('disconnected');
      };
      providerReconnectAttemptHandler = (attempt: number) => {
        reconnectAttempts = attempt;
        setStatus('connecting');
      };
      providerIoReconnectAttemptHandler = () => {
        setStatus('connecting');
      };
      providerConnectErrorHandler = (err: Error) => {
        console.warn('[SocketProvider] connect_error:', err.message);
        // If we've failed multiple times, switch to Realtime mode
        if (reconnectAttempts >= 3) {
          setStatus('realtime');
        } else {
          setStatus('disconnected');
        }
      };

      socket.on('connect', providerConnectHandler);
      socket.on('disconnect', providerDisconnectHandler);
      socket.on('reconnect_attempt', providerReconnectAttemptHandler);
      socket.on('connect_error', providerConnectErrorHandler);
      socket.io.on('reconnect_attempt', providerIoReconnectAttemptHandler);
      socket.io.on('reconnect', providerConnectHandler);

      providerIoReconnectFailedHandler = () => {
        socketGivenUp = true;
        setStatus('realtime');
      };
      socket.io.on('reconnect_failed', providerIoReconnectFailedHandler);

      providerIoErrorHandler = (err: Error) => {
        console.error('[SocketProvider] manager error:', err.message);
      };
      socket.io.on('error', providerIoErrorHandler);
    }

    // Auto-fallback: if socket doesn't connect within 8 seconds, switch to Realtime
    const fallbackTimer = setTimeout(() => {
      if (socket && !socket.connected) {
        console.warn('[SocketProvider] Socket.IO timed out — switching to Realtime mode');
        socketGivenUp = true;
        setStatus('realtime');
      }
    }, 8000);

    return () => {
      providerCount--;
      socketRef.current = null;
      clearTimeout(fallbackTimer);

      if (providerCount <= 0) {
        providerCount = 0;
        if (socket && providerListenersAttached) {
          if (providerConnectHandler) socket.off('connect', providerConnectHandler);
          if (providerDisconnectHandler) socket.off('disconnect', providerDisconnectHandler);
          if (providerReconnectAttemptHandler) socket.off('reconnect_attempt', providerReconnectAttemptHandler as (attempt: number) => void);
          if (providerConnectErrorHandler) socket.off('connect_error', providerConnectErrorHandler);
          if (providerIoReconnectAttemptHandler) socket.io.off('reconnect_attempt', providerIoReconnectAttemptHandler);
          if (providerConnectHandler) socket.io.off('reconnect', providerConnectHandler);
          if (providerIoReconnectFailedHandler) socket.io.off('reconnect_failed', providerIoReconnectFailedHandler);
          if (providerIoErrorHandler) socket.io.off('error', providerIoErrorHandler);
          providerConnectHandler = null;
          providerDisconnectHandler = null;
          providerReconnectAttemptHandler = null;
          providerIoReconnectAttemptHandler = null;
          providerConnectErrorHandler = null;
          providerIoReconnectFailedHandler = null;
          providerIoErrorHandler = null;
          providerListenersAttached = false;
        }
      }
    };
  }, [isRealtimeMode]);

  const [socketInstanceState, setSocketInstanceState] = useState<Socket | null>(null);

  useEffect(() => {
    setSocketInstanceState(socketRef.current);
  }, [status]);

  const contextValue = useMemo<SocketContextValue>(
    () => ({
      socket: socketInstanceState,
      status,
      isConnected: status === 'connected' || status === 'realtime',
      isRealtimeMode: status === 'realtime',
    }),
    [socketInstanceState, status],
  );

  return (
    <SocketContext.Provider value={contextValue}>
      {children}
    </SocketContext.Provider>
  );
}

// =====================================================
// useSharedSocket Hook
// =====================================================

export function useSharedSocket(): UseSharedSocketReturn {
  const ctx = useContext(SocketContext);

  const joinRoomFn = useCallback((conversationId: string) => {
    joinRoom(conversationId);
  }, []);

  const leaveRoomFn = useCallback((conversationId: string) => {
    leaveRoom(conversationId);
  }, []);

  const joinAllRoomsFn = useCallback((conversationIds: string[]) => {
    joinAllRooms(conversationIds);
  }, []);

  const emitStatusChangeFn = useCallback((userId: string, status: UserStatus) => {
    emitStatusChange(userId, status);
  }, []);

  return useMemo(
    () => ({
      socket: ctx.socket,
      status: ctx.status,
      isConnected: ctx.isConnected,
      isRealtimeMode: ctx.isRealtimeMode,
      joinRoom: joinRoomFn,
      leaveRoom: leaveRoomFn,
      joinAllRooms: joinAllRoomsFn,
      emitStatusChange: emitStatusChangeFn,
    }),
    [
      ctx.socket,
      ctx.status,
      ctx.isConnected,
      ctx.isRealtimeMode,
      joinRoomFn,
      leaveRoomFn,
      joinAllRoomsFn,
      emitStatusChangeFn,
    ],
  );
}

// =====================================================
// useSocketEvent Hook
// =====================================================

export function useSocketEvent<T = unknown>(
  event: string,
  handler: (data: T) => void,
): void {
  const handlerRef = useRef(handler);

  useEffect(() => {
    handlerRef.current = handler;
  });

  useEffect(() => {
    const socket = getSocket();
    if (!socket) {
      // Realtime mode — no Socket.IO events to listen for
      // Typing indicators are handled via Supabase Presence in ChatSection
      return;
    }

    const listener = (data: T) => {
      handlerRef.current(data);
    };

    socket.on(event, listener);

    return () => {
      socket.off(event, listener);
    };
  }, [event]);
}

// =====================================================
// Supabase Presence + Broadcast-based typing indicators
// =====================================================
// ALWAYS uses Supabase for typing indicators regardless of
// Socket.IO availability. Socket.IO server may not handle
// typing events, so Supabase is the reliable primary channel.

import { supabase } from '@/lib/supabase';

export interface TypingPresenceState {
  userId: string;
  userName: string;
  conversationId: string;
  isTyping: boolean;
  lastUpdated: number;
}

// Module-level map of conversationId → { channel, subscribed, userId }
const typingChannels = new Map<string, {
  channel: ReturnType<typeof supabase.channel>;
  subscribed: boolean;
  userId: string;
}>();

// Module-level map of conversationId → set of broadcast listeners
const typingListeners = new Map<string, Set<(data: TypingPresenceState) => void>>();

/**
 * Join a Supabase channel for typing indicators in a conversation.
 * ALWAYS creates a fresh channel — removes any stale one first.
 * Returns the conversationId so the caller can use it for cleanup.
 */
export function joinTypingPresence(
  conversationId: string,
  userId: string,
  userName: string,
): string | null {
  // Always remove any existing channel first to avoid stale connections
  const existing = typingChannels.get(conversationId);
  if (existing) {
    try {
      supabase.removeChannel(existing.channel);
    } catch {
      // Ignore cleanup errors
    }
    typingChannels.delete(conversationId);
  }

  const channel = supabase.channel(`typing:${conversationId}`, {
    config: {
      presence: { key: userId },
      broadcast: { self: false }, // Don't receive our own broadcasts
    },
  });

  const entry = { channel, subscribed: false, userId };
  typingChannels.set(conversationId, entry);

  // Listen for broadcast typing events (instant, low latency)
  channel.on('broadcast', { event: 'typing-state' }, (payload) => {
    const data = payload.payload as TypingPresenceState;
    if (!data || !data.conversationId) return;
    const listeners = typingListeners.get(data.conversationId);
    if (listeners) {
      listeners.forEach(fn => fn(data));
    }
  });

  // Track the user's presence state
  channel.subscribe(async (status) => {
    if (status === 'SUBSCRIBED') {
      entry.subscribed = true;
      await channel.track({
        userId,
        userName,
        conversationId,
        isTyping: false,
        lastUpdated: Date.now(),
      });
    } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
      entry.subscribed = false;
      console.warn(`[Typing] Channel subscription failed for ${conversationId}: ${status}`);
      // Retry after 2 seconds
      setTimeout(() => {
        const current = typingChannels.get(conversationId);
        if (current && !current.subscribed) {
          current.channel.subscribe();
        }
      }, 2000);
    }
  });

  return conversationId;
}

/**
 * Register a listener for typing broadcast events on a conversation.
 * Returns an unsubscribe function.
 */
export function onTypingBroadcast(
  conversationId: string,
  listener: (data: TypingPresenceState) => void,
): () => void {
  if (!typingListeners.has(conversationId)) {
    typingListeners.set(conversationId, new Set());
  }
  typingListeners.get(conversationId)!.add(listener);

  return () => {
    const listeners = typingListeners.get(conversationId);
    if (listeners) {
      listeners.delete(listener);
      if (listeners.size === 0) {
        typingListeners.delete(conversationId);
      }
    }
  };
}

/**
 * Leave a Supabase Presence channel for typing indicators.
 */
export function leaveTypingPresence(conversationId: string): void {
  if (!conversationId) return;
  const entry = typingChannels.get(conversationId);
  if (entry) {
    try {
      supabase.removeChannel(entry.channel);
    } catch {
      // Ignore cleanup errors
    }
    typingChannels.delete(conversationId);
  }
  typingListeners.delete(conversationId);
}

/**
 * Broadcast typing state via Supabase Broadcast (instant delivery).
 * Also updates Presence state for fallback polling.
 * Queues the broadcast if the channel isn't subscribed yet.
 */
export function broadcastTypingState(
  conversationId: string,
  userId: string,
  userName: string,
  isTyping: boolean,
): void {
  const entry = typingChannels.get(conversationId);
  if (!entry) return;

  const state: TypingPresenceState = {
    userId,
    userName,
    conversationId,
    isTyping,
    lastUpdated: Date.now(),
  };

  // Always try to broadcast — even if not yet subscribed,
  // Supabase queues the message and sends when ready
  const sendResult = entry.channel.send({
    type: 'broadcast',
    event: 'typing-state',
    payload: state,
  });

  // Only update presence track if subscribed (track fails before subscription)
  if (entry.subscribed) {
    entry.channel.track(state);
  }
}

/**
 * Get all typing users from a presence channel (excluding the current user).
 * This is the fallback method used by polling.
 */
export function getTypingUsers(
  conversationId: string,
  currentUserId: string,
): TypingPresenceState[] {
  const entry = typingChannels.get(conversationId);
  if (!entry || !entry.subscribed) return [];

  const state = entry.channel.presenceState<TypingPresenceState>();
  const typingUsers: TypingPresenceState[] = [];

  for (const key of Object.keys(state)) {
    for (const presence of state[key]) {
      if (
        presence.userId !== currentUserId &&
        presence.isTyping &&
        presence.conversationId === conversationId &&
        Date.now() - presence.lastUpdated < 4000 // Expire after 4 seconds
      ) {
        typingUsers.push(presence);
      }
    }
  }

  return typingUsers;
}

'use client';

// =====================================================
// AttenDo - Shared Singleton Socket.IO Utility
// =====================================================
// Solves the problem of multiple components (chat-section,
// chat-tab, settings-section) each creating their own
// separate socket connections, which caused:
//   - "Not connected to server" status issues
//   - Duplicate connections
//   - Race conditions
//   - Real-time messages not being delivered properly
//
// Usage:
//   1. Wrap your app with <SocketProvider>
//   2. Use `useSharedSocket()` hook in components
//   3. Or use `getSocket()` for non-React code
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
} from 'react';
import { io, Socket } from 'socket.io-client';
import type { UserStatus } from '@/lib/types';

// =====================================================
// Types
// =====================================================

/** Connection status of the singleton socket */
export type SocketConnectionStatus = 'connected' | 'disconnected' | 'connecting';

/** Value provided by the SocketContext */
export interface SocketContextValue {
  /** The singleton Socket.IO instance (null before first init) */
  socket: Socket | null;
  /** Current connection status */
  status: SocketConnectionStatus;
  /** Whether the socket is connected and ready */
  isConnected: boolean;
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
// Constants
// =====================================================

// Socket.IO client connects to the chat service on port 3003.
// Next.js rewrites /socket.io/* → http://localhost:3003/socket.io/* (local only)
// On Vercel, the chat service URL should be set via NEXT_PUBLIC_CHAT_SERVICE_URL env var.
// If not set, Socket.IO will attempt connection but fail gracefully.

function getSocketUrl(): string {
  // If a custom chat service URL is provided (e.g. for Vercel deployment), use it
  const customUrl = process.env.NEXT_PUBLIC_CHAT_SERVICE_URL;
  if (customUrl) return customUrl;

  // Default: empty string = same origin.
  // The Caddy gateway routes requests to the chat service (port 3003)
  // via the XTransformPort query parameter.
  return '';
}

const SOCKET_URL = getSocketUrl();

const SOCKET_OPTIONS: Parameters<typeof io>[1] = {
  path: '/socket.io',         // Path on the server where Socket.IO is served
  transports: ['websocket', 'polling'],
  forceNew: false,            // KEY: reuse existing connection, don't create new
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  timeout: 10000,
  autoConnect: false,         // We connect manually after setup
  query: { XTransformPort: '3003' },  // Caddy gateway uses this to route to chat service
};

// =====================================================
// Singleton Socket Management
// =====================================================

/** The singleton socket instance — created once, reused everywhere */
let socketInstance: Socket | null = null;

/** Stored credentials for auto re-auth on reconnect */
let authCredentials: { userId: string; userName: string } | null = null;

/** Reference count of active SocketProviders — controls lifecycle */
let providerCount = 0;

/** Provider-level status listeners (named so we can remove ONLY these, not auto-auth) */
let providerConnectHandler: (() => void) | null = null;
let providerDisconnectHandler: (() => void) | null = null;
let providerReconnectAttemptHandler: (() => void) | null = null;
let providerIoReconnectAttemptHandler: (() => void) | null = null;
let providerListenersAttached = false;

/**
 * Get or create the singleton Socket.IO instance.
 *
 * - First call creates the socket and stores it.
 * - Subsequent calls return the same instance.
 * - Auto-authenticates with stored credentials on connect.
 * - Auto-re-authenticates on reconnect.
 */
export function getSocket(): Socket {
  if (!socketInstance) {
    socketInstance = io(SOCKET_URL, SOCKET_OPTIONS);

    // ─── Auto-authenticate on every (re)connect ───
    socketInstance.on('connect', () => {
      if (authCredentials) {
        socketInstance!.emit('auth', {
          userId: authCredentials.userId,
          userName: authCredentials.userName,
        });
      }
    });
  }

  // If the socket exists but was disconnected, reconnect
  if (!socketInstance.connected && !socketInstance.active) {
    socketInstance.connect();
  }

  return socketInstance;
}

/**
 * Set the authentication credentials used for auto-auth on
 * connect and reconnect. Call this once the user is known
 * (e.g. after login or profile load).
 */
export function setSocketAuth(userId: string, userName: string): void {
  authCredentials = { userId, userName };

  // If socket is already connected, re-auth immediately
  const socket = getSocket();
  if (socket.connected) {
    socket.emit('auth', { userId, userName });
  }
}

/**
 * Disconnect and destroy the singleton socket.
 * Call this on logout or when the app unmounts entirely.
 */
export function destroySocket(): void {
  if (socketInstance) {
    socketInstance.removeAllListeners();
    socketInstance.disconnect();
    socketInstance = null;
  }
  authCredentials = null;
  providerListenersAttached = false;
}

// =====================================================
// Helper Functions
// =====================================================

/** Join a specific conversation room */
export function joinRoom(conversationId: string): void {
  const socket = getSocket();
  if (socket.connected) {
    socket.emit('join-conversation', { conversationId });
  } else {
    // Queue the join for when we reconnect
    socket.once('connect', () => {
      socket.emit('join-conversation', { conversationId });
    });
  }
}

/** Leave a specific conversation room */
export function leaveRoom(conversationId: string): void {
  const socket = getSocket();
  if (socket.connected) {
    socket.emit('leave-conversation', { conversationId });
  }
}

/** Join multiple conversation rooms at once */
export function joinAllRooms(conversationIds: string[]): void {
  if (conversationIds.length === 0) return;
  const socket = getSocket();
  if (socket.connected) {
    socket.emit('join-all-conversations', { conversationIds });
  } else {
    // Queue the join for when we reconnect
    socket.once('connect', () => {
      socket.emit('join-all-conversations', { conversationIds });
    });
  }
}

/** Emit a status change event (online/away/busy/offline/invisible) */
export function emitStatusChange(userId: string, status: UserStatus): void {
  const socket = getSocket();
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
});

SocketContext.displayName = 'SocketContext';

// =====================================================
// SocketProvider
// =====================================================

export interface SocketProviderProps {
  children: ReactNode;
}

/**
 * Provider that manages the singleton socket lifecycle and
 * exposes it via React context.
 *
 * - Mounts: initializes the socket, attaches status listeners,
 *   increments reference count.
 * - Unmounts: decrements reference count; when it reaches 0,
 *   cleans up status listeners (but does NOT destroy the socket
 *   so other consumers can still use `getSocket()` directly).
 */
export function SocketProvider({ children }: SocketProviderProps): JSX.Element {
  const [status, setStatus] = useState<SocketConnectionStatus>('disconnected');
  const socketRef = useRef<Socket | null>(null);

  // ─── Initialize socket on mount ───
  useEffect(() => {
    providerCount++;

    const socket = getSocket();
    socketRef.current = socket;

    // Set initial status
    if (socket.connected) {
      setStatus('connected');
    } else {
      setStatus(socket.active ? 'connecting' : 'disconnected');
    }

    // Only attach provider-level status listeners once
    // (not per provider instance — they share the same socket)
    // Use named handlers so we can remove ONLY these (not the auto-auth listener)
    if (!providerListenersAttached) {
      providerListenersAttached = true;

      providerConnectHandler = () => setStatus('connected');
      providerDisconnectHandler = () => setStatus('disconnected');
      providerReconnectAttemptHandler = () => setStatus('connecting');
      providerIoReconnectAttemptHandler = () => setStatus('connecting');

      socket.on('connect', providerConnectHandler);
      socket.on('disconnect', providerDisconnectHandler);
      socket.on('reconnect_attempt', providerReconnectAttemptHandler);
      socket.io.on('reconnect_attempt', providerIoReconnectAttemptHandler);
      // Also listen for io-level reconnect success as a safety net
      socket.io.on('reconnect', providerConnectHandler);
    }

    // Ensure the socket is connected
    if (!socket.connected) {
      socket.connect();
    }

    return () => {
      providerCount--;
      socketRef.current = null;

      // When no providers are left, detach the provider-level listeners
      // but keep the socket alive for direct getSocket() consumers
      if (providerCount <= 0) {
        providerCount = 0;
        if (socket && providerListenersAttached) {
          if (providerConnectHandler) socket.off('connect', providerConnectHandler);
          if (providerDisconnectHandler) socket.off('disconnect', providerDisconnectHandler);
          if (providerReconnectAttemptHandler) socket.off('reconnect_attempt', providerReconnectAttemptHandler);
          if (providerIoReconnectAttemptHandler) {
            socket.io.off('reconnect_attempt', providerIoReconnectAttemptHandler);
            socket.io.off('reconnect', providerConnectHandler);
          }
          providerConnectHandler = null;
          providerDisconnectHandler = null;
          providerReconnectAttemptHandler = null;
          providerIoReconnectAttemptHandler = null;
          providerListenersAttached = false;
        }
      }
    };
  }, []);

  // ─── Memoize context value to prevent unnecessary re-renders ───
  // Use state instead of ref to avoid accessing ref during render
  const [socketInstance, setSocketInstance] = useState<Socket | null>(null);

  // Sync ref to state when socket changes (in effects, not during render)
  useEffect(() => {
    setSocketInstance(socketRef.current);
  }, [status]);

  const contextValue = useMemo<SocketContextValue>(
    () => ({
      socket: socketInstance,
      status,
      isConnected: status === 'connected',
    }),
    [socketInstance, status],
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

/**
 * React hook that provides the shared singleton socket,
 * connection status, and helper functions.
 *
 * Must be used within a <SocketProvider>.
 */
export function useSharedSocket(): UseSharedSocketReturn {
  const ctx = useContext(SocketContext);

  if (!ctx) {
    throw new Error('useSharedSocket must be used within a <SocketProvider>');
  }

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
      joinRoom: joinRoomFn,
      leaveRoom: leaveRoomFn,
      joinAllRooms: joinAllRoomsFn,
      emitStatusChange: emitStatusChangeFn,
    }),
    [
      ctx.socket,
      ctx.status,
      ctx.isConnected,
      joinRoomFn,
      leaveRoomFn,
      joinAllRoomsFn,
      emitStatusChangeFn,
    ],
  );
}

// =====================================================
// useSocketEvent Hook (bonus utility)
// =====================================================

/**
 * Convenience hook to subscribe to a socket event with
 * automatic cleanup.
 *
 * Works even if the SocketProvider hasn't mounted yet —
 * it uses `getSocket()` internally.
 */
export function useSocketEvent<T = unknown>(
  event: string,
  handler: (data: T) => void,
): void {
  const handlerRef = useRef(handler);

  // Update the ref inside an effect to comply with React's rules
  useEffect(() => {
    handlerRef.current = handler;
  });

  useEffect(() => {
    const socket = getSocket();

    const listener = (data: T) => {
      handlerRef.current(data);
    };

    socket.on(event, listener);

    return () => {
      socket.off(event, listener);
    };
  }, [event]);
}

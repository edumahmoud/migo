import { createServer } from 'http';
import { Server } from 'socket.io';
import webpush from 'web-push';
import { createClient } from '@supabase/supabase-js';

const httpServer = createServer();
const io = new Server(httpServer, {
  path: '/',
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
  pingTimeout: 60000,
  pingInterval: 25000,
});

// -------------------------------------------------------
// Types
// -------------------------------------------------------
type UserStatus = 'online' | 'away' | 'busy' | 'offline' | 'invisible';

interface OnlineUser {
  id: string;
  name: string;
  socketId: string;
}
interface ChatMessage {
  id: string;
  conversationId: string;
  senderId: string;
  senderName: string;
  content: string;
  createdAt: string;
}
interface TypingPayload {
  conversationId: string;
  userId: string;
  userName: string;
}

// -------------------------------------------------------
// Push Notification Setup
// -------------------------------------------------------
const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails('mailto:support@attendo.app', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  console.log('[Chat] Web Push configured');
} else {
  console.warn('[Chat] VAPID keys not configured — push notifications disabled');
}

const supabase = SUPABASE_URL && SUPABASE_SERVICE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
  : null;

if (!supabase) {
  console.warn('[Chat] Supabase not configured — push subscriptions unavailable');
}

interface PushSubscriptionRow {
  endpoint: string;
  p256dh: string;
  auth_key: string;
}

/**
 * Send a push notification to a user who is offline.
 * Fetches their push subscriptions from Supabase and sends via web-push.
 */
async function sendPushToOfflineUser(userId: string, title: string, body: string, url?: string) {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !supabase) return;

  try {
    const { data: subs, error } = await supabase
      .from('push_subscriptions')
      .select('endpoint, p256dh, auth_key')
      .eq('user_id', userId);

    if (error || !subs || subs.length === 0) return;

    const payload = JSON.stringify({ title, message: body, url: url || '/' });
    const expiredEndpoints: string[] = [];

    for (const sub of subs as PushSubscriptionRow[]) {
      try {
        await webpush.sendNotification({
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth_key },
        }, payload);
      } catch (err: unknown) {
        const error = err as { statusCode?: number };
        if (error.statusCode === 410 || error.statusCode === 404) {
          expiredEndpoints.push(sub.endpoint);
        }
      }
    }

    // Clean up expired subscriptions
    if (expiredEndpoints.length > 0) {
      for (const endpoint of expiredEndpoints) {
        await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint);
      }
      console.log(`[Chat/Push] Cleaned ${expiredEndpoints.length} expired subscription(s) for user ${userId}`);
    }
  } catch (err) {
    console.error('[Chat/Push] Error sending push:', err);
  }
}

// -------------------------------------------------------
// State
// -------------------------------------------------------
const onlineUsers = new Map<string, OnlineUser>(); // socketId -> user
const userSockets = new Map<string, Set<string>>(); // userId -> Set<socketId>
const userStatuses = new Map<string, UserStatus>(); // userId -> status

// -------------------------------------------------------
// Helpers
// -------------------------------------------------------
const generateId = () => Math.random().toString(36).substr(2, 12) + Date.now().toString(36);

/** Get array of currently online userIds */
function getOnlineUserIds(): string[] {
  return Array.from(userSockets.keys());
}

/**
 * Get the visible status for a user.
 * Invisible users appear as 'offline' to others.
 */
function getVisibleStatus(userId: string, requesterId?: string): UserStatus {
  const status = userStatuses.get(userId);
  if (!status) return 'offline';
  // If the user is invisible, they appear as offline to others
  if (status === 'invisible' && userId !== requesterId) return 'offline';
  return status;
}

/** Broadcast current online user list to all connected sockets */
function broadcastOnlineUsers() {
  const onlineIds = getOnlineUserIds();
  io.emit('online-users', onlineIds);
}

/** Emit an event to all sockets of a specific user */
function emitToUser(userId: string, event: string, data: unknown) {
  const sockets = userSockets.get(userId);
  if (sockets) {
    for (const socketId of sockets) {
      io.to(socketId).emit(event, data);
    }
  }
}

/** Broadcast a user's status change to all connected sockets */
function broadcastStatusChange(userId: string, status: UserStatus) {
  // When broadcasting, invisible users show as offline to others
  const visibleStatus = status === 'invisible' ? 'offline' : status;
  io.emit('user-status-changed', { userId, status: visibleStatus });
  // But to the user themselves, send their real status
  emitToUser(userId, 'user-status-changed', { userId, status });
}

// -------------------------------------------------------
// Socket Events
// -------------------------------------------------------
io.on('connection', (socket) => {
  console.log(`[Chat] Connected: ${socket.id}`);

  // ─── Authenticate ───
  socket.on('auth', (data: { userId: string; userName: string }) => {
    const { userId, userName } = data;

    const wasOffline = !userSockets.has(userId);

    // Store user info
    onlineUsers.set(socket.id, { id: userId, name: userName, socketId: socket.id });

    // Track user's sockets (multi-tab support)
    if (!userSockets.has(userId)) {
      userSockets.set(userId, new Set());
    }
    userSockets.get(userId)!.add(socket.id);

    console.log(`[Chat] Auth: ${userName} (${userId}), total sockets: ${userSockets.get(userId)?.size}`);

    // When user comes online, set their status to 'online' by default
    // (unless they already have a status like 'invisible' set)
    if (!userStatuses.has(userId)) {
      userStatuses.set(userId, 'online');
    }

    // Send current online users list to the newly authenticated socket
    socket.emit('online-users', getOnlineUserIds());

    // Send the user their current status
    const currentStatus = userStatuses.get(userId)!;
    socket.emit('user-status-changed', { userId, status: currentStatus });

    // If user was previously offline, broadcast to everyone that they're now online
    if (wasOffline) {
      io.emit('user-online', userId);
      // Broadcast their status change (visible to others)
      broadcastStatusChange(userId, currentStatus);
    }
  });

  // ─── Get Online Users (on demand) ───
  socket.on('get-online-users', () => {
    socket.emit('online-users', getOnlineUserIds());
  });

  // ─── Status Change ───
  socket.on('status-change', (data: { userId: string; status: UserStatus }) => {
    const { userId, status } = data;

    // Validate status value
    const validStatuses: UserStatus[] = ['online', 'away', 'busy', 'offline', 'invisible'];
    if (!validStatuses.includes(status)) {
      console.warn(`[Chat] Invalid status: ${status} from user ${userId}`);
      return;
    }

    const previousStatus = userStatuses.get(userId);
    userStatuses.set(userId, status);

    console.log(`[Chat] Status change: ${userId} -> ${status} (was ${previousStatus || 'unknown'})`);

    // Broadcast the status change
    broadcastStatusChange(userId, status);

    // If user set themselves to 'offline', they should still be "connected" but appear offline
    // If user set themselves to 'invisible', they appear offline to others but still receive messages
    // Neither 'offline' status nor 'invisible' should disconnect the socket
  });

  // ─── Get User Statuses ───
  // Supports both callback pattern AND event-based response
  socket.on('get-user-status', (data: { userIds: string[] }, callback?: (response: { statuses: Record<string, UserStatus> }) => void) => {
    const requesterId = onlineUsers.get(socket.id)?.id;
    const statuses: Record<string, UserStatus> = {};

    for (const userId of data.userIds) {
      statuses[userId] = getVisibleStatus(userId, requesterId);
    }

    // If callback is provided, use it (Socket.IO ack pattern)
    if (typeof callback === 'function') {
      callback({ statuses });
    } else {
      // Fallback: emit as a separate event
      socket.emit('user-statuses', statuses);
    }
  });

  // ─── Join Conversation Room ───
  socket.on('join-conversation', (data: { conversationId: string }) => {
    socket.join(`conv:${data.conversationId}`);
    console.log(`[Chat] ${socket.id} joined conversation: ${data.conversationId}`);
  });

  // ─── Join Multiple Conversation Rooms (on connect/reconnect) ───
  socket.on('join-all-conversations', (data: { conversationIds: string[] }) => {
    for (const convId of data.conversationIds) {
      socket.join(`conv:${convId}`);
    }
    console.log(`[Chat] ${socket.id} joined ${data.conversationIds.length} conversation rooms`);
  });

  // ─── Leave Conversation Room ───
  socket.on('leave-conversation', (data: { conversationId: string }) => {
    socket.leave(`conv:${data.conversationId}`);
    console.log(`[Chat] ${socket.id} left conversation: ${data.conversationId}`);
  });

  // ─── Send Message ───
  socket.on('send-message', (data: {
    conversationId: string;
    senderId: string;
    senderName: string;
    content: string;
    tempId?: string;
    participantIds?: string[]; // list of all participant user IDs for direct delivery
  }) => {
    const message: ChatMessage = {
      id: data.tempId || generateId(),
      conversationId: data.conversationId,
      senderId: data.senderId,
      senderName: data.senderName,
      content: data.content,
      createdAt: new Date().toISOString(),
    };

    // Broadcast to everyone in the conversation room (including sender for confirmation)
    io.to(`conv:${data.conversationId}`).emit('new-message', message);

    // Also emit conversation-updated event to room
    io.to(`conv:${data.conversationId}`).emit('conversation-updated', {
      conversationId: data.conversationId,
      lastMessage: message,
    });

    // Direct notification to all participants (even if they haven't joined the room yet)
    if (data.participantIds && data.participantIds.length > 0) {
      for (const participantId of data.participantIds) {
        if (participantId !== data.senderId) {
          // Send in-app notification via Socket.IO
          emitToUser(participantId, 'chat-notification', {
            conversationId: data.conversationId,
            message,
            senderName: data.senderName,
            content: data.content,
          });

          // If the recipient is NOT online, also send a push notification
          const isRecipientOnline = userSockets.has(participantId);
          if (!isRecipientOnline) {
            sendPushToOfflineUser(
              participantId,
              `رسالة من ${data.senderName}`,
              data.content.substring(0, 100),
              'chat'
            ).catch(() => {});
          }
        }
      }
    }

    console.log(`[Chat] Message in ${data.conversationId}: ${data.senderName}: ${data.content.substring(0, 50)}`);
  });

  // ─── Notify specific user about new conversation ───
  socket.on('notify-new-conversation', (data: {
    targetUserId: string;
    conversationId: string;
    fromUser: { id: string; name: string };
    conversationType: string;
  }) => {
    emitToUser(data.targetUserId, 'new-conversation', {
      conversationId: data.conversationId,
      fromUser: data.fromUser,
      conversationType: data.conversationType,
    });
    console.log(`[Chat] Notified ${data.targetUserId} about new conversation ${data.conversationId}`);
  });

  // ─── Message Updated (Edit) ───
  socket.on('message-updated', (data: { conversationId: string; messageId: string; content: string; isEdited: boolean }) => {
    // Broadcast to everyone in the conversation room
    io.to(`conv:${data.conversationId}`).emit('message-updated', {
      messageId: data.messageId,
      content: data.content,
      isEdited: data.isEdited,
    });

    console.log(`[Chat] Message updated in ${data.conversationId}: ${data.messageId}`);
  });

  // ─── Message Deleted ───
  socket.on('message-deleted', (data: { conversationId: string; messageId: string }) => {
    // Broadcast to everyone in the conversation room
    io.to(`conv:${data.conversationId}`).emit('message-deleted', {
      messageId: data.messageId,
    });

    console.log(`[Chat] Message deleted in ${data.conversationId}: ${data.messageId}`);
  });

  // ─── Typing Indicator ───
  socket.on('typing', (data: TypingPayload) => {
    socket.to(`conv:${data.conversationId}`).emit('user-typing', {
      conversationId: data.conversationId,
      userId: data.userId,
      userName: data.userName,
    });
  });

  // ─── Stop Typing ───
  socket.on('stop-typing', (data: { conversationId: string; userId: string }) => {
    socket.to(`conv:${data.conversationId}`).emit('user-stop-typing', {
      conversationId: data.conversationId,
      userId: data.userId,
    });
  });

  // ─── Disconnect ───
  socket.on('disconnect', () => {
    const user = onlineUsers.get(socket.id);
    if (user) {
      // Remove from user's sockets
      const sockets = userSockets.get(user.id);
      if (sockets) {
        sockets.delete(socket.id);
        if (sockets.size === 0) {
          userSockets.delete(user.id);
          // User is now fully offline — set status and broadcast
          userStatuses.set(user.id, 'offline');
          io.emit('user-offline', user.id);
          broadcastStatusChange(user.id, 'offline');
        }
      }
      onlineUsers.delete(socket.id);
      console.log(`[Chat] Disconnected: ${user.name} (${socket.id})`);
    } else {
      console.log(`[Chat] Disconnected: ${socket.id}`);
    }
  });

  socket.on('error', (error) => {
    console.error(`[Chat] Socket error (${socket.id}):`, error);
  });
});

// -------------------------------------------------------
// Start Server
// -------------------------------------------------------
const PORT = 3003;
httpServer.listen(PORT, () => {
  console.log(`[Chat] AttenDo Chat Service running on port ${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[Chat] Received SIGTERM, shutting down...');
  httpServer.close(() => {
    console.log('[Chat] Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('[Chat] Received SIGINT, shutting down...');
  httpServer.close(() => {
    console.log('[Chat] Server closed');
    process.exit(0);
  });
});

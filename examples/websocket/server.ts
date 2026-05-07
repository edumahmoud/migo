import { createServer } from 'http'
import { Server, Socket } from 'socket.io'

const httpServer = createServer()
const io = new Server(httpServer, {
  // DO NOT change the path, it is used by Caddy to forward the request to the correct port
  path: '/',
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  pingTimeout: 60000,
  pingInterval: 25000,
})

// =====================================================
// User & Room tracking
// =====================================================

interface AuthUser {
  id: string
  userName: string
  socketId: string
  status: string
  conversationRooms: Set<string>
}

// userId → AuthUser
const authenticatedUsers = new Map<string, AuthUser>()
// socketId → userId (for quick lookup on disconnect)
const socketToUser = new Map<string, string>()

const generateMessageId = () => Math.random().toString(36).substr(2, 9)

// =====================================================
// Connection handler
// =====================================================

io.on('connection', (socket: Socket) => {
  console.log(`[Socket] User connected: ${socket.id}`)

  // ─── Auth ───
  socket.on('auth', (data: { userId: string; userName: string }) => {
    const { userId, userName } = data

    // If user was already authenticated on another socket, clean up
    const existingUser = authenticatedUsers.get(userId)
    if (existingUser) {
      // Leave all rooms on old socket
      existingUser.conversationRooms.forEach(room => {
        io.sockets.sockets.get(existingUser.socketId)?.leave(room)
      })
      io.sockets.sockets.get(existingUser.socketId)?.disconnect(true)
    }

    const user: AuthUser = {
      id: userId,
      userName,
      socketId: socket.id,
      status: 'online',
      conversationRooms: new Set(),
    }
    authenticatedUsers.set(userId, user)
    socketToUser.set(socket.id, userId)

    console.log(`[Auth] ${userName} (${userId}) authenticated on socket ${socket.id}`)

    // Broadcast user online
    io.emit('user-online', { userId, userName, status: 'online' })

    // Send current online users to the newly authenticated user
    const onlineUsers = Array.from(authenticatedUsers.values()).map(u => ({
      userId: u.id,
      userName: u.userName,
      status: u.status,
    }))
    socket.emit('online-users', { users: onlineUsers })
  })

  // ─── Join a conversation room ───
  socket.on('join-conversation', (data: { conversationId: string }) => {
    const { conversationId } = data
    socket.join(conversationId)

    const userId = socketToUser.get(socket.id)
    if (userId) {
      const user = authenticatedUsers.get(userId)
      if (user) user.conversationRooms.add(conversationId)
    }

    console.log(`[Room] Socket ${socket.id} joined conversation: ${conversationId}`)
  })

  // ─── Leave a conversation room ───
  socket.on('leave-conversation', (data: { conversationId: string }) => {
    const { conversationId } = data
    socket.leave(conversationId)

    const userId = socketToUser.get(socket.id)
    if (userId) {
      const user = authenticatedUsers.get(userId)
      if (user) user.conversationRooms.delete(conversationId)
    }

    console.log(`[Room] Socket ${socket.id} left conversation: ${conversationId}`)
  })

  // ─── Join multiple conversation rooms ───
  socket.on('join-all-conversations', (data: { conversationIds: string[] }) => {
    const { conversationIds } = data
    conversationIds.forEach(id => {
      socket.join(id)
      const userId = socketToUser.get(socket.id)
      if (userId) {
        const user = authenticatedUsers.get(userId)
        if (user) user.conversationRooms.add(id)
      }
    })
    console.log(`[Room] Socket ${socket.id} joined ${conversationIds.length} conversations`)
  })

  // ─── Send message ───
  socket.on('send-message', (data: {
    conversationId: string
    messageId: string
    senderId: string
    senderName: string
    content: string
    createdAt: string
    type?: string
    replyTo?: string
    participantIds?: string[]
    [key: string]: unknown
  }) => {
    const { conversationId, senderId, senderName, content } = data
    const msgId = data.messageId || data.tempId || generateMessageId()
    const now = data.createdAt || new Date().toISOString()

    // Build a proper ChatMessage-shaped object so the client
    // can use it directly without conversion.
    const chatMsg = {
      id: msgId,
      conversation_id: conversationId,
      conversationId,               // also camelCase for convenience
      sender_id: senderId,
      senderId,                     // also camelCase for convenience
      sender_name: senderName,
      content,
      created_at: now,
      is_deleted: false,
      is_edited: false,
      sender: {
        id: senderId,
        name: senderName,
      },
    }

    // Broadcast to everyone in the conversation room EXCEPT the sender
    socket.to(conversationId).emit('new-message', chatMsg)

    // Also send a direct notification to specific participants
    // who may not be in the room yet (e.g. just opened the app)
    if (data.participantIds && Array.isArray(data.participantIds)) {
      data.participantIds.forEach((pid: string) => {
        const user = authenticatedUsers.get(pid)
        if (user && user.socketId !== socket.id) {
          io.to(user.socketId).emit('chat-notification', {
            conversationId,
            message: chatMsg,
            senderName,
            content: content.substring(0, 100),
          })
        }
      })
    }

    console.log(`[Message] ${senderName} in ${conversationId}: ${content.substring(0, 50)}`)
  })

  // ─── Typing indicator ───
  socket.on('typing', (data: { conversationId: string; userId: string; userName: string }) => {
    const { conversationId, userId, userName } = data
    // Broadcast to everyone in the conversation room EXCEPT the sender
    socket.to(conversationId).emit('user-typing', {
      conversationId,
      userId,
      userName,
    })
  })

  // ─── Stop typing indicator ───
  socket.on('stop-typing', (data: { conversationId: string; userId: string }) => {
    const { conversationId, userId } = data
    // Broadcast to everyone in the conversation room EXCEPT the sender
    socket.to(conversationId).emit('user-stop-typing', {
      conversationId,
      userId,
    })
  })

  // ─── Status change ───
  socket.on('status-change', (data: { userId: string; status: string }) => {
    const { userId, status } = data
    const user = authenticatedUsers.get(userId)
    if (user) {
      user.status = status
    }
    // Broadcast to all connected users
    io.emit('user-status-changed', { userId, status })
  })

  // ─── Get online users ───
  socket.on('get-online-users', () => {
    const onlineUsers = Array.from(authenticatedUsers.values()).map(u => ({
      userId: u.id,
      userName: u.userName,
      status: u.status,
    }))
    socket.emit('online-users', { users: onlineUsers })
  })

  // ─── Get user statuses ───
  socket.on('get-user-statuses', (data: { userIds: string[] }) => {
    const statuses: Record<string, string> = {}
    data.userIds.forEach(uid => {
      const user = authenticatedUsers.get(uid)
      statuses[uid] = user ? user.status : 'offline'
    })
    socket.emit('user-statuses', statuses)
  })

  // ─── New conversation notification ───
  socket.on('new-conversation', (data: {
    conversationId: string
    participantIds: string[]
    title?: string
    [key: string]: unknown
  }) => {
    const { conversationId, participantIds } = data

    // Only notify specific participants, not a global broadcast
    participantIds.forEach(pid => {
      const user = authenticatedUsers.get(pid)
      if (user && user.socketId !== socket.id) {
        io.to(user.socketId).emit('new-conversation', data)
      }
    })

    console.log(`[Conversation] New conversation ${conversationId} notified to: ${participantIds.join(', ')}`)
  })

  // ─── Test event ───
  socket.on('test', (data) => {
    console.log('Received test message:', data)
    socket.emit('test-response', {
      message: 'Server received test message',
      data: data,
      timestamp: new Date().toISOString()
    })
  })

  // ─── Legacy join event (compatibility) ───
  socket.on('join', (data: { username: string }) => {
    console.log(`[Legacy] ${data.username} joined via legacy join event`)
  })

  // ─── Legacy message event (compatibility) ───
  socket.on('message', (data: { content: string; username: string }) => {
    const message = {
      id: generateMessageId(),
      username: data.username,
      content: data.content,
      timestamp: new Date(),
      type: 'user' as const,
    }
    io.emit('message', message)
  })

  // ─── Disconnect ───
  socket.on('disconnect', (reason) => {
    const userId = socketToUser.get(socket.id)

    if (userId) {
      const user = authenticatedUsers.get(userId)
      if (user) {
        console.log(`[Disconnect] ${user.userName} (${userId}) disconnected: ${reason}`)

        // Broadcast user offline
        io.emit('user-offline', { userId, userName: user.userName })

        // Clean up
        authenticatedUsers.delete(userId)
      }
      socketToUser.delete(socket.id)
    } else {
      console.log(`[Disconnect] Unknown socket ${socket.id} disconnected: ${reason}`)
    }
  })

  // ─── Error ───
  socket.on('error', (error) => {
    console.error(`[Error] Socket error (${socket.id}):`, error)
  })
})

// =====================================================
// Start server
// =====================================================

const PORT = 3003
httpServer.listen(PORT, () => {
  console.log(`WebSocket server running on port ${PORT}`)
})

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('Received SIGTERM signal, shutting down server...')
  httpServer.close(() => {
    console.log('WebSocket server closed')
    process.exit(0)
  })
})

process.on('SIGINT', () => {
  console.log('Received SIGINT signal, shutting down server...')
  httpServer.close(() => {
    console.log('WebSocket server closed')
    process.exit(0)
  })
})

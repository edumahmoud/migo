'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useSharedSocket, useSocketEvent } from '@/lib/socket';
import {
  MessageCircle,
  Send,
  Loader2,
  Hash,
  Search,
  Plus,
  ArrowRight,
  X,
  Trash2,
  Pencil,
  Check,
  XCircle,
  Bell,
  Wifi,
  WifiOff,
  RefreshCw,
  MoreHorizontal,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import type { UserProfile, Conversation, ChatMessage } from '@/lib/types';
import UserAvatar, { formatNameWithTitle } from '@/components/shared/user-avatar';
import { useAppStore } from '@/stores/app-store';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

// =====================================================
// Props
// =====================================================
interface ChatSectionProps {
  profile: UserProfile;
  role: 'teacher' | 'student';
}

// =====================================================
// Active conversation info (stored locally to avoid race conditions)
// =====================================================
interface ActiveConvInfo {
  id: string;
  type: 'group' | 'individual';
  title?: string | null;
  otherParticipant?: UserProfile | null;
}

// =====================================================
// Animation variants
// =====================================================
const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.03 } },
};

const itemVariants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.25, ease: 'easeOut' } },
};

const slideInLeft = {
  hidden: { x: 20, opacity: 0 },
  visible: { x: 0, opacity: 1, transition: { duration: 0.2 } },
};

const slideInRight = {
  hidden: { x: -20, opacity: 0 },
  visible: { x: 0, opacity: 1, transition: { duration: 0.2 } },
};

// =====================================================
// Relative time helper (Arabic)
// =====================================================
function relativeTime(dateStr: string): string {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return '';
  const diff = Date.now() - date.getTime();
  if (diff < 0) return 'الآن';
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'الآن';
  if (mins < 60) return `منذ ${mins} د`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `منذ ${hours} س`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `منذ ${days} ي`;
  return date.toLocaleDateString('ar-SA', { month: 'short', day: 'numeric' });
}

// =====================================================
// Typing dots animation component
// =====================================================
function TypingIndicator({ names }: { names: string[] }) {
  if (names.length === 0) return null;
  const label =
    names.length === 1
      ? `${names[0]} يكتب`
      : names.length === 2
        ? `${names[0]} و ${names[1]} يكتبان`
        : `${names[0]} وآخرون يكتبون`;

  return (
    <div className="flex items-center gap-2 px-4 py-2">
      <div className="flex items-center gap-1">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-bounce" style={{ animationDelay: '0ms' }} />
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-bounce" style={{ animationDelay: '150ms' }} />
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-bounce" style={{ animationDelay: '300ms' }} />
      </div>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  );
}

// =====================================================
// Main Component
// =====================================================
export default function ChatSection({ profile, role }: ChatSectionProps) {
  // ─── Shared socket ───
  const { socket, isConnected, joinRoom, leaveRoom, joinAllRooms } = useSharedSocket();
  const { openProfile } = useAppStore();
  const { setTotalChatUnread } = useAppStore();

  // ─── Conversations state ───
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [convFetchError, setConvFetchError] = useState<string | null>(null);

  // ─── Active conversation ───
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [activeConvInfo, setActiveConvInfo] = useState<ActiveConvInfo | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [participants, setParticipants] = useState<{ user_id: string; users: UserProfile }[]>([]);
  const [typingUsers, setTypingUsers] = useState<Map<string, string>>(new Map());
  const [setupInfo, setSetupInfo] = useState<{ sqlEditorUrl?: string; steps?: string[] } | null>(null);

  // ─── Online users tracking ───
  const [onlineUsers, setOnlineUsers] = useState<Set<string>>(new Set());
  const [userStatuses, setUserStatuses] = useState<Map<string, string>>(new Map()); // userId -> status

  // ─── New DM state ───
  const [showNewDM, setShowNewDM] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<UserProfile[]>([]);
  const [searching, setSearching] = useState(false);
  const [creatingChat, setCreatingChat] = useState(false);

  // ─── Message edit state ───
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');

  // ─── Message action menu ───
  const [messageMenuId, setMessageMenuId] = useState<string | null>(null);

  // ─── Delete message confirmation dialog ───
  const [deleteMessageId, setDeleteMessageId] = useState<string | null>(null);

  // ─── Delete conversation confirmation dialog ───
  const [deleteConvId, setDeleteConvId] = useState<string | null>(null);

  // ─── Conversation list filter ───
  const [convFilter, setConvFilter] = useState('');

  // ─── Mobile: show conversation list or chat view ───
  const [showChat, setShowChat] = useState(false);

  // ─── Unread tracking removed — we rely on server counts with immediate refresh ───

  // ─── Refs ───
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const typingTimeoutRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const messageMenuRef = useRef<HTMLDivElement>(null);
  const activeConvIdRef = useRef<string | null>(null);
  const conversationsRef = useRef<Conversation[]>([]);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const backupPollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastPollTimeRef = useRef<number>(0);
  // Track recently processed message IDs to prevent double-counting
  // (both new-message and chat-notification fire for the same message)
  const processedMsgIds = useRef<Set<string>>(new Set());
  // Debounce fetchConversations to prevent hammering the server when multiple socket events fire
  const fetchConvsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Track recently deleted message IDs to prevent polling from restoring them
  const recentlyDeletedMsgIds = useRef<Set<string>>(new Set());

  // ─── Keep refs in sync ───
  useEffect(() => { activeConvIdRef.current = activeConvId; }, [activeConvId]);
  useEffect(() => { conversationsRef.current = conversations; }, [conversations]);

  // =====================================================
  // Fetch conversations with better error handling
  // =====================================================
  const fetchConversations = useCallback(async () => {
    try {
      const res = await fetch(`/api/chat?action=conversations&userId=${profile.id}`);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = await res.json();

      // Check if tables don't exist (error response)
      if (data.error && res.status === 500) {
        setConvFetchError(data.error);
        try {
          const setupRes = await fetch('/api/chat/setup');
          const setupData = await setupRes.json();
          if (setupData.tablesExist === false) {
            setSetupInfo({
              sqlEditorUrl: setupData.sqlEditorUrl,
              steps: setupData.steps,
            });
          }
        } catch {
          // Ignore setup fetch error
        }
        return [];
      }

      setConvFetchError(null);
      setConversations(data.conversations || []);
      return data.conversations || [];
    } catch (err) {
      console.error('Fetch conversations error:', err);
      setConvFetchError('فشل تحميل المحادثات');
      return [];
    } finally {
      setLoading(false);
    }
  }, [profile.id]);

  // Debounced version — coalesces rapid calls (e.g. from multiple socket events)
  const debouncedFetchConversations = useCallback(() => {
    if (fetchConvsTimerRef.current) clearTimeout(fetchConvsTimerRef.current);
    fetchConvsTimerRef.current = setTimeout(() => {
      fetchConversations();
    }, 500);
  }, [fetchConversations]);

  // =====================================================
  // Polling fallback for messages
  // =====================================================
  const pollMessages = useCallback(async () => {
    const convId = activeConvIdRef.current;
    if (!convId) return;

    // Throttle: don't poll more than once per 2 seconds
    const now = Date.now();
    if (now - lastPollTimeRef.current < 2000) return;
    lastPollTimeRef.current = now;

    try {
      const res = await fetch(`/api/chat?action=messages&conversationId=${convId}&limit=50`);
      const data = await res.json();
      const serverMessages: ChatMessage[] = data.messages || [];

      setMessages((prev) => {
        // Merge: keep optimistic messages, add any server messages we don't have
        // Skip messages that were recently deleted (prevents polling from restoring them)
        const existingIds = new Set(prev.map((m) => m.id));
        const newFromServer = serverMessages.filter(
          (m) => !existingIds.has(m.id) && !recentlyDeletedMsgIds.current.has(m.id)
        );
        if (newFromServer.length === 0) return prev;
        // Merge and sort by created_at
        return [...prev, ...newFromServer].sort(
          (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        );
      });
    } catch (err) {
      console.error('Poll messages error:', err);
    }
  }, []);

  // Setup polling intervals
  useEffect(() => {
    // Clear existing intervals
    if (pollingRef.current) clearInterval(pollingRef.current);
    if (backupPollingRef.current) clearInterval(backupPollingRef.current);

    if (!isConnected) {
      // Poll every 3 seconds when socket is disconnected (faster for better UX)
      pollingRef.current = setInterval(pollMessages, 3000);
    }

    // Always poll every 30 seconds as backup (reduced from 15s to lower server load)
    backupPollingRef.current = setInterval(pollMessages, 30000);

    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
      if (backupPollingRef.current) clearInterval(backupPollingRef.current);
    };
  }, [isConnected, pollMessages]);

  // ─── Polling for conversation notifications (when socket disconnected) ───
  const lastConvPollRef = useRef<Conversation[]>([]);
  useEffect(() => {
    if (isConnected) {
      lastConvPollRef.current = []; // Reset when socket reconnects
      return;
    }

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/chat?action=conversations&userId=${profile.id}`);
        if (!res.ok) return;
        const data = await res.json();
        const newConvs: Conversation[] = data.conversations || [];
        const prevConvs = lastConvPollRef.current;

        // Show toast for new unread messages in non-active conversations
        for (const conv of newConvs) {
          const prev = prevConvs.find(c => c.id === conv.id);
          const hasNewUnread = conv.unreadCount && conv.unreadCount > 0 &&
            (!prev || (conv.unreadCount > (prev.unreadCount || 0)));
          const lastMsg = conv.lastMessage;
          const isFromOther = lastMsg && lastMsg.sender_id !== profile.id;

          if (hasNewUnread && isFromOther && conv.id !== activeConvIdRef.current) {
            toast(`رسالة جديدة من ${conv.otherParticipant?.name || 'مستخدم'}`, {
              description: lastMsg.content.substring(0, 60) + (lastMsg.content.length > 60 ? '...' : ''),
              icon: <Bell className="h-4 w-4 text-emerald-600" />,
              duration: 5000,
            });
          }
        }

        lastConvPollRef.current = newConvs;
        setConversations(newConvs);
        const total = newConvs.reduce((sum, conv) => sum + (conv.unreadCount || 0), 0);
        setTotalChatUnread(total);
      } catch {
        // Silently ignore
      }
    }, 8000); // Poll every 8 seconds

    return () => clearInterval(interval);
  }, [isConnected, profile.id, setTotalChatUnread]);

  // =====================================================
  // Socket.io event subscriptions (using shared socket)
  // =====================================================

  // ─── New message (from room broadcast) ───
  useSocketEvent<ChatMessage>('new-message', (msg) => {
    const convId = msg.conversationId || (msg as Record<string, unknown>).conversation_id as string;
    const senderId = msg.sender_id || (msg as Record<string, unknown>).senderId as string;
    const currentActiveId = activeConvIdRef.current;

    // Deduplicate: skip if we already processed this message via chat-notification
    if (processedMsgIds.current.has(msg.id)) {
      // Still refresh conversations for updated last message / unread count
      debouncedFetchConversations();
      return;
    }
    processedMsgIds.current.add(msg.id);
    // Trim the set if it gets too large
    if (processedMsgIds.current.size > 200) {
      const entries = Array.from(processedMsgIds.current);
      processedMsgIds.current = new Set(entries.slice(-100));
    }

    if (convId === currentActiveId) {
      setMessages((prev) => {
        if (prev.some((m) => m.id === msg.id)) return prev;
        // Also check for optimistic message with same sender+content+time (within 5 seconds)
        const isDuplicate = prev.some((m) =>
          m.id.startsWith('temp-') &&
          m.sender_id === senderId &&
          m.content === msg.content &&
          Math.abs(new Date(m.created_at).getTime() - new Date(msg.created_at).getTime()) < 5000
        );
        if (isDuplicate) {
          // Replace the optimistic message with the real one
          return prev.map((m) =>
            m.id.startsWith('temp-') && m.sender_id === senderId && m.content === msg.content
              ? msg
              : m
          );
        }
        return [...prev, msg];
      });
      // Mark as read since we're viewing this conversation
      fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'mark-read', conversationId: convId, userId: profile.id }),
      }).catch(() => {});
    }
    // Always refresh conversation list for updated last message & unread count
    debouncedFetchConversations();
  });

  // ─── Chat notification (direct delivery, even if not in room) ───
  useSocketEvent<{
    conversationId: string;
    message: ChatMessage;
    senderName: string;
    content: string;
  }>('chat-notification', (data) => {
    const currentActiveId = activeConvIdRef.current;
    const msgId = data.message.id;
    const senderId = data.message.sender_id || (data.message as Record<string, unknown>).senderId as string;

    // Deduplicate: if new-message already processed this, only show toast + refresh
    const alreadyProcessed = processedMsgIds.current.has(msgId);
    if (!alreadyProcessed) {
      processedMsgIds.current.add(msgId);
      if (processedMsgIds.current.size > 200) {
        const entries = Array.from(processedMsgIds.current);
        processedMsgIds.current = new Set(entries.slice(-100));
      }
    }

    if (data.conversationId === currentActiveId) {
      if (!alreadyProcessed) {
        setMessages((prev) => {
          if (prev.some((m) => m.id === msgId)) return prev;
          // Check for optimistic duplicate
          const isDuplicate = prev.some((m) =>
            m.id.startsWith('temp-') &&
            m.sender_id === senderId &&
            m.content === data.message.content &&
            Math.abs(new Date(m.created_at).getTime() - new Date(data.message.created_at).getTime()) < 5000
          );
          if (isDuplicate) {
            return prev.map((m) =>
              m.id.startsWith('temp-') && m.sender_id === senderId && m.content === data.message.content
                ? data.message
                : m
            );
          }
          return [...prev, data.message];
        });
      }
      // Mark as read
      fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'mark-read', conversationId: data.conversationId, userId: profile.id }),
      }).catch(() => {});
    } else {
      // Show toast for new messages from others
      if (senderId !== profile.id) {
        toast(`رسالة جديدة من ${data.senderName}`, {
          description: data.content.substring(0, 60) + (data.content.length > 60 ? '...' : ''),
          icon: <Bell className="h-4 w-4 text-emerald-600" />,
          duration: 5000,
        });
      }
    }

    // Refresh conversation list — server has the accurate unread count
    debouncedFetchConversations();
  });

  // ─── New conversation notification ───
  useSocketEvent<{
    conversationId: string;
    fromUser: { id: string; name: string };
    conversationType: string;
  }>('new-conversation', (data) => {
    joinRoom(data.conversationId);
    toast(`محادثة جديدة من ${data.fromUser.name}`, {
      description: 'تم إنشاء محادثة جديدة',
      icon: <MessageCircle className="h-4 w-4 text-emerald-600" />,
      duration: 5000,
    });
    debouncedFetchConversations();
  });

  // ─── Message updated (edit) ───
  useSocketEvent<{ messageId: string; content: string; isEdited: boolean }>('message-updated', (data) => {
    setMessages((prev) =>
      prev.map((m) =>
        m.id === data.messageId
          ? { ...m, content: data.content, is_edited: data.isEdited }
          : m
      )
    );
  });

  // ─── Message deleted ───
  useSocketEvent<{ messageId: string }>('message-deleted', (data) => {
    // Track so polling won't restore this message
    recentlyDeletedMsgIds.current.add(data.messageId);
    setTimeout(() => {
      recentlyDeletedMsgIds.current.delete(data.messageId);
    }, 30000);

    // Remove the message from the array entirely
    setMessages((prev) => prev.filter((m) => m.id !== data.messageId));
  });

  // ─── Conversation updated ───
  useSocketEvent('conversation-updated', () => {
    debouncedFetchConversations();
  });

  // ─── Typing indicators ───
  useSocketEvent<{ conversationId: string; userId: string; userName: string }>('user-typing', (data) => {
    if (data.conversationId === activeConvIdRef.current && data.userId !== profile.id) {
      setTypingUsers((prev) => new Map(prev).set(data.userId, data.userName));
      const existing = typingTimeoutRef.current.get(data.userId);
      if (existing) clearTimeout(existing);
      typingTimeoutRef.current.set(data.userId, setTimeout(() => {
        setTypingUsers((prev) => {
          const next = new Map(prev);
          next.delete(data.userId);
          return next;
        });
      }, 3000));
    }
  });

  useSocketEvent<{ conversationId: string; userId: string }>('user-stop-typing', (data) => {
    if (data.conversationId === activeConvIdRef.current) {
      setTypingUsers((prev) => {
        const next = new Map(prev);
        next.delete(data.userId);
        return next;
      });
    }
  });

  // ─── Online users tracking ───
  useSocketEvent<string[]>('online-users', (userIds) => {
    setOnlineUsers(new Set(userIds));
  });

  useSocketEvent<string>('user-online', (userId) => {
    setOnlineUsers((prev) => new Set(prev).add(userId));
  });

  useSocketEvent<string>('user-offline', (userId) => {
    setOnlineUsers((prev) => {
      const next = new Set(prev);
      next.delete(userId);
      return next;
    });
  });

  // ─── User status changed ───
  useSocketEvent<{ userId: string; status: string }>('user-status-changed', (data) => {
    setUserStatuses((prev) => {
      const next = new Map(prev);
      next.set(data.userId, data.status);
      return next;
    });
    if (data.status === 'online') {
      setOnlineUsers((prev) => new Set(prev).add(data.userId));
    } else if (data.status === 'invisible' || data.status === 'offline') {
      setOnlineUsers((prev) => {
        const next = new Set(prev);
        next.delete(data.userId);
        return next;
      });
    }
    // For 'away' and 'busy': keep them in onlineUsers but track their status separately
  });

  // =====================================================
  // Auto-join rooms when connected
  // =====================================================
  useEffect(() => {
    if (isConnected && conversations.length > 0) {
      const convIds = conversations.map(c => c.id);
      joinAllRooms(convIds);
      if (activeConvId) {
        joinRoom(activeConvId);
      }
    }
  }, [isConnected, conversations, joinAllRooms, joinRoom, activeConvId]);

  // =====================================================
  // Initialize on mount
  // =====================================================
  useEffect(() => {
    fetchConversations();
  }, [fetchConversations]);

  // =====================================================
  // Close message menu on outside click
  // =====================================================
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (messageMenuRef.current && !messageMenuRef.current.contains(e.target as Node)) {
        setMessageMenuId(null);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // =====================================================
  // Open a conversation
  // =====================================================
  const openConversation = useCallback(async (convId: string, convInfo?: ActiveConvInfo) => {
    setActiveConvId(convId);
    setShowChat(true);
    setMessagesLoading(true);
    setTypingUsers(new Map());
    setEditingMessageId(null);
    setMessageMenuId(null);

    // Set conversation info IMMEDIATELY (before any async operations)
    // so the chat box renders without waiting for network requests
    if (convInfo) {
      setActiveConvInfo(convInfo);
    } else {
      const existingConv = conversationsRef.current.find(c => c.id === convId);
      if (existingConv) {
        setActiveConvInfo({
          id: existingConv.id,
          type: existingConv.type,
          title: existingConv.title,
          otherParticipant: existingConv.otherParticipant,
        });
      } else {
        // Fallback: set minimal info so chat box still renders
        setActiveConvInfo({
          id: convId,
          type: 'group',
        });
      }
    }

    // Join room
    joinRoom(convId);

    try {
      // Fetch messages
      const msgRes = await fetch(`/api/chat?action=messages&conversationId=${convId}&limit=50`);
      const msgData = await msgRes.json();
      setMessages(msgData.messages || []);

      // Fetch participants
      const partRes = await fetch(`/api/chat?action=participants&conversationId=${convId}`);
      const partData = await partRes.json();
      setParticipants(partData.participants || []);

      // Update conversation info with more accurate data if we didn't have it before
      if (!convInfo) {
        const existingConv = conversationsRef.current.find(c => c.id === convId);
        if (existingConv) {
          setActiveConvInfo({
            id: existingConv.id,
            type: existingConv.type,
            title: existingConv.title,
            otherParticipant: existingConv.otherParticipant,
          });
        } else {
          const otherPart = (partData.participants || []).find(
            (p: { user_id: string }) => p.user_id !== profile.id
          );
          setActiveConvInfo({
            id: convId,
            type: otherPart ? 'individual' : 'group',
            otherParticipant: otherPart?.users || null,
          });
        }
      }

      // Mark as read
      await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'mark-read', conversationId: convId, userId: profile.id }),
      });

      // Refresh conversations for updated unread count
      fetchConversations();
    } catch (err) {
      console.error('Open conversation error:', err);
      toast.error('فشل فتح المحادثة');
    } finally {
      setMessagesLoading(false);
    }
  }, [profile.id, fetchConversations]);

  // =====================================================
  // Auto-scroll to bottom
  // =====================================================
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, typingUsers]);

  // =====================================================
  // Get participant IDs for current conversation
  // =====================================================
  const getParticipantIds = useCallback((): string[] => {
    return participants.map((p) => p.user_id);
  }, [participants]);

  // =====================================================
  // Send message
  // =====================================================
  const handleSend = async () => {
    const content = newMessage.trim();
    if (!content || !activeConvId || sending) return;

    setSending(true);
    const tempId = `temp-${Date.now()}`;

    const optimisticMsg: ChatMessage = {
      id: tempId,
      sender_id: profile.id,
      content,
      created_at: new Date().toISOString(),
      sender: {
        id: profile.id,
        name: profile.name,
        email: profile.email,
        avatar_url: profile.avatar_url,
      },
    };
    setMessages((prev) => [...prev, optimisticMsg]);
    setNewMessage('');

    const participantIds = getParticipantIds();

    socket?.emit('send-message', {
      conversationId: activeConvId,
      senderId: profile.id,
      senderName: profile.name,
      content,
      tempId,
      participantIds,
      senderAvatarUrl: profile.avatar_url,
      senderEmail: profile.email,
      senderRole: profile.role,
      senderTitleId: profile.title_id,
      senderGender: profile.gender,
    });

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'send-message',
          conversationId: activeConvId,
          senderId: profile.id,
          content,
        }),
      });
      const data = await res.json();

      if (!res.ok || data.error) {
        // API returned an error (e.g. conversation deleted)
        console.error('Send message API error:', data.error);
        toast.error(data.error || 'فشل إرسال الرسالة');
        setMessages((prev) => prev.filter((m) => m.id !== tempId));
        setNewMessage(content);
        // If conversation doesn't exist anymore, refresh list
        if (res.status === 500) {
          fetchConversations();
        }
        return;
      }

      if (data.message?.id) {
        setMessages((prev) =>
          prev.map((m) => m.id === tempId ? { ...m, id: data.message.id } : m)
        );
      }
    } catch (err) {
      console.error('Send message error:', err);
      toast.error('فشل إرسال الرسالة');
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      setNewMessage(content);
    } finally {
      setSending(false);
    }
  };

  // =====================================================
  // Delete message
  // =====================================================
  const handleDeleteMessage = async (msgId: string) => {
    setMessageMenuId(null);
    setDeleteMessageId(null); // Close confirmation dialog

    // Track this ID so polling doesn't restore it
    recentlyDeletedMsgIds.current.add(msgId);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete-message', messageId: msgId, userId: profile.id }),
      });
      const data = await res.json();

      // Check for HTTP errors or API errors BEFORE updating local state
      if (!res.ok || data.error) {
        recentlyDeletedMsgIds.current.delete(msgId);
        toast.error(data.error || 'فشل حذف الرسالة');
        return; // Do NOT remove from UI if API failed
      }

      // Remove the message from the local state entirely after confirmed success
      setMessages((prev) => prev.filter((m) => m.id !== msgId));
      socket?.emit('message-deleted', {
        conversationId: activeConvId,
        messageId: msgId,
      });

      // Clean up the tracking set after a delay (polling won't add it back after this)
      setTimeout(() => {
        recentlyDeletedMsgIds.current.delete(msgId);
      }, 30000);
    } catch (err) {
      console.error('Delete message error:', err);
      recentlyDeletedMsgIds.current.delete(msgId);
      toast.error('فشل حذف الرسالة');
      // Do NOT update local state — the message was not deleted on the server
    }
  };

  // =====================================================
  // Edit message
  // =====================================================
  const handleStartEdit = (msg: ChatMessage) => {
    setMessageMenuId(null);
    setEditingMessageId(msg.id);
    setEditContent(msg.content);
  };

  const handleCancelEdit = () => {
    setEditingMessageId(null);
    setEditContent('');
  };

  const handleSaveEdit = async (msgId: string) => {
    const trimmed = editContent.trim();
    if (!trimmed) return;

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'edit-message', messageId: msgId, userId: profile.id, content: trimmed }),
      });
      const data = await res.json();
      if (data.error) {
        toast.error(data.error);
        return;
      }
      setMessages((prev) =>
        prev.map((m) => m.id === msgId ? { ...m, content: trimmed, is_edited: true } : m)
      );
      socket?.emit('message-updated', {
        conversationId: activeConvId,
        messageId: msgId,
        content: trimmed,
        isEdited: true,
      });
      setEditingMessageId(null);
      setEditContent('');
    } catch (err) {
      console.error('Edit message error:', err);
      toast.error('فشل تعديل الرسالة');
    }
  };

  // =====================================================
  // Handle typing
  // =====================================================
  const handleTyping = (value: string) => {
    setNewMessage(value);
    if (socket && activeConvId) {
      if (value.trim()) {
        socket.emit('typing', {
          conversationId: activeConvId,
          userId: profile.id,
          userName: profile.name,
        });
      } else {
        socket.emit('stop-typing', {
          conversationId: activeConvId,
          userId: profile.id,
        });
      }
    }
  };

  // =====================================================
  // Search users for new DM
  // =====================================================
  const handleSearchUsers = useCallback(async (query: string) => {
    setSearchQuery(query);
    if (!query.trim()) {
      setSearchResults([]);
      return;
    }

    setSearching(true);
    try {
      let subjectIds: string[] = [];

      if (role === 'teacher') {
        const { data } = await supabase
          .from('subjects')
          .select('id')
          .eq('teacher_id', profile.id);
        subjectIds = (data || []).map((s: { id: string }) => s.id);
      } else {
        const { data } = await supabase
          .from('subject_students')
          .select('subject_id')
          .eq('student_id', profile.id)
          .eq('status', 'approved');
        subjectIds = (data || []).map((s: { subject_id: string }) => s.subject_id);
      }

      if (subjectIds.length === 0) {
        setSearchResults([]);
        setSearching(false);
        return;
      }

      const searchPromises = subjectIds.map(sid =>
        fetch(`/api/chat?action=search-users&subjectId=${sid}&query=${encodeURIComponent(query)}&userId=${profile.id}`)
          .then(r => r.json())
          .then(d => d.users || [])
      );

      const results = await Promise.all(searchPromises);
      const allUsers = results.flat();
      const unique = Array.from(new Map(allUsers.map((u: UserProfile) => [u.id, u])).values());
      setSearchResults(unique);
    } catch (err) {
      console.error('Search users error:', err);
    } finally {
      setSearching(false);
    }
  }, [profile.id, role]);

  // =====================================================
  // Start individual conversation
  // =====================================================
  const startIndividualChat = async (otherUser: UserProfile) => {
    if (creatingChat) return;
    setCreatingChat(true);

    try {
      let subjectId: string | undefined;

      if (role === 'teacher') {
        const { data: teacherSubjects } = await supabase
          .from('subjects')
          .select('id')
          .eq('teacher_id', profile.id);

        if (teacherSubjects && teacherSubjects.length > 0) {
          const subjectIds = teacherSubjects.map((s: { id: string }) => s.id);
          const { data: enrollments } = await supabase
            .from('subject_students')
            .select('subject_id')
            .eq('student_id', otherUser.id)
            .in('subject_id', subjectIds)
            .limit(1);
          subjectId = enrollments?.[0]?.subject_id;
        }
      } else {
        const { data } = await supabase
          .from('subject_students')
          .select('subject_id')
          .eq('student_id', profile.id)
          .eq('status', 'approved')
          .limit(1);
        subjectId = data?.[0]?.subject_id;
      }

      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create-individual',
          userId1: profile.id,
          userId2: otherUser.id,
          subjectId: subjectId || undefined,
        }),
      });
      const data = await res.json();

      if (data.error) {
        toast.error(data.error || 'فشل بدء المحادثة');
        return;
      }

      setShowNewDM(false);
      setSearchQuery('');
      setSearchResults([]);

      if (data.conversation?.id) {
        const convId = data.conversation.id;

        socket?.emit('notify-new-conversation', {
          targetUserId: otherUser.id,
          conversationId: convId,
          fromUser: { id: profile.id, name: profile.name },
          conversationType: 'individual',
        });

        joinRoom(convId);

        await openConversation(convId, {
          id: convId,
          type: 'individual',
          otherParticipant: otherUser,
        });
        fetchConversations();
      } else {
        toast.error('فشل إنشاء المحادثة');
      }
    } catch (err) {
      console.error('Start chat error:', err);
      toast.error('فشل بدء المحادثة');
    } finally {
      setCreatingChat(false);
    }
  };

  // ─── Sync total unread count to app store (for sidebar badge) ───
  // Only sync after conversations have loaded (prevents flashing to 0 on mount)
  useEffect(() => {
    if (loading) return;
    const total = conversations.reduce((sum, conv) => sum + (conv.unreadCount || 0), 0);
    setTotalChatUnread(total);
  }, [conversations, setTotalChatUnread, loading]);

  // =====================================================
  // Filter conversations
  // =====================================================
  const filteredConversations = conversations.filter((conv) => {
    if (!convFilter.trim()) return true;
    const q = convFilter.toLowerCase();
    const name = conv.type === 'group'
      ? conv.title || 'محادثة جماعية'
      : conv.otherParticipant?.name || 'محادثة خاصة';
    return name.toLowerCase().includes(q);
  });

  // =====================================================
  // Render message bubble
  // Own messages LEFT (emerald bg), others RIGHT (muted bg)
  // =====================================================
  const renderMessage = (msg: ChatMessage, index: number) => {
    const isOwn = msg.sender_id === profile.id;
    const senderName = formatNameWithTitle(
      msg.sender?.name || 'مستخدم',
      msg.sender?.role,
      msg.sender?.title_id,
      msg.sender?.gender
    );
    const showAvatar = !isOwn && (index === 0 || messages[index - 1]?.sender_id !== msg.sender_id);
    const isDeleted = (msg as Record<string, unknown>).is_deleted as boolean;
    const isEdited = (msg as Record<string, unknown>).is_edited as boolean;
    const isEditing = editingMessageId === msg.id;
    const isMenuOpen = messageMenuId === msg.id;

    return (
      <motion.div
        key={msg.id}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.15 }}
        className={`flex gap-2 ${isOwn ? 'justify-start' : 'justify-end'} items-end group px-3`}
      >
        {/* Other user avatar - shown above-left of the message */}
        {!isOwn && (
          <div className="shrink-0 self-start pt-1">
            {showAvatar ? (
              <UserAvatar name={senderName} avatarUrl={msg.sender?.avatar_url} size="xs" />
            ) : (
              <div className="w-7" />
            )}
          </div>
        )}

        <div className={`max-w-[75%] flex flex-col ${isOwn ? 'items-start' : 'items-end'} relative`}>
          {/* Sender name for group chats */}
          {!isOwn && showAvatar && activeConvInfo?.type === 'group' && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); openProfile(msg.sender_id); }}
              className="text-[10px] text-muted-foreground mb-0.5 font-medium px-1 hover:text-emerald-600 transition-colors"
            >
              {senderName}
            </button>
          )}

          {isEditing ? (
            <div className="flex flex-col gap-1.5 w-full min-w-[200px]">
              <input
                type="text"
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveEdit(msg.id);
                  if (e.key === 'Escape') handleCancelEdit();
                }}
                className="rounded-xl border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 transition-all"
                dir="rtl"
                autoFocus
              />
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => handleSaveEdit(msg.id)}
                  className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 transition-colors"
                >
                  <Check className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={handleCancelEdit}
                  className="flex h-7 w-7 items-center justify-center rounded-lg bg-muted text-muted-foreground hover:bg-muted/80 transition-colors"
                >
                  <XCircle className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ) : (
            <div className="relative">
              <div
                className={`rounded-2xl px-3.5 py-2 text-sm leading-relaxed ${
                  isDeleted
                    ? 'bg-muted/50 text-muted-foreground italic'
                    : isOwn
                      ? 'bg-emerald-600 text-white'
                      : 'bg-muted text-foreground'
                }`}
              >
                {isDeleted ? (
                  <span className="flex items-center gap-1.5">
                    <Trash2 className="h-3 w-3" />
                    تم حذف هذه الرسالة
                  </span>
                ) : (
                  msg.content
                )}
              </div>

              {/* Hover action menu for own messages */}
              {isOwn && !isDeleted && !isEditing && (
                <div className="absolute -top-1 start-full opacity-0 group-hover:opacity-100 transition-opacity ms-1">
                  <div className="relative" ref={isMenuOpen ? messageMenuRef : null}>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setMessageMenuId(isMenuOpen ? null : msg.id);
                      }}
                      className="flex h-6 w-6 items-center justify-center rounded-full bg-muted/80 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors shadow-sm"
                    >
                      <MoreHorizontal className="h-3.5 w-3.5" />
                    </button>

                    <AnimatePresence>
                      {isMenuOpen && (
                        <motion.div
                          initial={{ opacity: 0, scale: 0.9 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.9 }}
                          transition={{ duration: 0.12 }}
                          className="absolute start-0 top-7 z-20 bg-card border rounded-xl shadow-lg py-1 min-w-[120px]"
                        >
                          <button
                            onClick={() => handleStartEdit(msg)}
                            className="w-full flex items-center gap-2 px-3 py-2 text-xs text-foreground hover:bg-muted/50 transition-colors text-right"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                            تعديل
                          </button>
                          <button
                            onClick={() => {
                              setMessageMenuId(null);
                              setDeleteMessageId(msg.id);
                            }}
                            className="w-full flex items-center gap-2 px-3 py-2 text-xs text-red-600 hover:bg-red-50 transition-colors text-right"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            حذف
                          </button>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Timestamp & edited indicator */}
          <div className="flex items-center gap-1.5 mt-0.5 px-1">
            <span className="text-[10px] text-muted-foreground/50">
              {relativeTime(msg.created_at)}
            </span>
            {isEdited && !isDeleted && (
              <span className="text-[10px] text-emerald-500/60 font-medium">(معدّلة)</span>
            )}
          </div>
        </div>
      </motion.div>
    );
  };

  // =====================================================
  // Delete entire conversation
  // =====================================================
  const handleConfirmDeleteConversation = async () => {
    const convId = deleteConvId || activeConvId;
    if (!convId) return;

    setDeleteConvId(null); // Close confirmation dialog

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete-conversation', conversationId: convId, userId: profile.id }),
      });
      const data = await res.json();
      if (data.error) {
        toast.error(data.error);
        return;
      }

      // Leave the room
      leaveRoom(convId);

      // Remove from local state
      setConversations((prev) => prev.filter((c) => c.id !== convId));

      // Reset active conversation
      setActiveConvId(null);
      setActiveConvInfo(null);
      setMessages([]);
      setParticipants([]);
      setShowChat(false);

      toast.success('تم حذف المحادثة بنجاح');
    } catch (err) {
      console.error('Delete conversation error:', err);
      toast.error('فشل حذف المحادثة');
    }
  };

  // =====================================================
  // Loading state
  // =====================================================
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
        <p className="text-sm text-muted-foreground">جاري تحميل المحادثات...</p>
      </div>
    );
  }

  // =====================================================
  // Compute header info
  // =====================================================
  const chatHeaderName = activeConvInfo
    ? activeConvInfo.type === 'group'
      ? activeConvInfo.title || 'محادثة جماعية'
      : formatNameWithTitle(
          activeConvInfo.otherParticipant?.name || 'محادثة خاصة',
          activeConvInfo.otherParticipant?.role,
          activeConvInfo.otherParticipant?.title_id,
          activeConvInfo.otherParticipant?.gender
        )
    : '';

  const chatHeaderOnline = activeConvInfo?.type === 'individual' && activeConvInfo.otherParticipant?.id
    ? onlineUsers.has(activeConvInfo.otherParticipant.id)
    : false;

  const chatHeaderStatus = activeConvInfo?.type === 'individual' && activeConvInfo.otherParticipant?.id
    ? userStatuses.get(activeConvInfo.otherParticipant.id) || (chatHeaderOnline ? 'online' : 'offline')
    : '';

  // =====================================================
  // Main render
  // =====================================================
  return (
    <>
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="flex flex-col h-[calc(100vh-10rem)] min-h-[500px]"
      dir="rtl"
    >
      <div className="flex flex-1 min-h-0 gap-0 md:gap-3">

        {/* ============================================ */}
        {/* CONVERSATIONS LIST PANEL                     */}
        {/* ============================================ */}
        <div className={`w-full md:w-80 lg:w-96 shrink-0 flex flex-col border rounded-xl bg-card overflow-hidden ${showChat ? 'hidden md:flex' : 'flex'}`}>
          {/* ─── Header ─── */}
          <div className="shrink-0 p-4 border-b bg-card">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-100">
                  <MessageCircle className="h-4 w-4 text-emerald-700" />
                </div>
                <h2 className="text-base font-bold text-foreground">المحادثات</h2>
              </div>
              <div className="flex items-center gap-2">
                {/* Socket connection indicator */}
                <div className="flex items-center gap-1 px-2 py-1 rounded-md bg-muted/50" title={isConnected ? 'متصل بالسيرفر' : 'غير متصل - يتم التحديث تلقائياً'}>
                  {isConnected ? (
                    <Wifi className="h-3 w-3 text-emerald-500" />
                  ) : (
                    <WifiOff className="h-3 w-3 text-rose-400" />
                  )}
                  <span className="text-[10px] text-muted-foreground">
                    {isConnected ? 'متصل' : 'غير متصل'}
                  </span>
                </div>
                {/* New DM button */}
                <button
                  onClick={() => setShowNewDM(true)}
                  className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 transition-colors shadow-sm"
                  title="محادثة جديدة"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Search bar */}
            <div className="relative">
              <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <input
                type="text"
                value={convFilter}
                onChange={(e) => setConvFilter(e.target.value)}
                placeholder="بحث في المحادثات..."
                className="w-full rounded-lg border bg-muted/30 ps-9 pe-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all"
              />
              {convFilter && (
                <button
                  onClick={() => setConvFilter('')}
                  className="absolute end-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* ─── Conversations list ─── */}
          <div className="flex-1 min-h-0 overflow-y-auto">
            {convFetchError && !setupInfo ? (
              <div className="flex flex-col items-center justify-center py-12 text-center px-6">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-rose-50 border border-rose-200 mb-3">
                  <WifiOff className="h-7 w-7 text-rose-400" />
                </div>
                <p className="text-sm font-semibold text-foreground mb-1">خطأ في التحميل</p>
                <p className="text-xs text-muted-foreground mb-3">{convFetchError}</p>
                <button
                  onClick={() => { setConvFetchError(null); fetchConversations(); }}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-medium text-white hover:bg-emerald-700 transition-colors"
                >
                  <RefreshCw className="h-3 w-3" />
                  إعادة المحاولة
                </button>
              </div>
            ) : setupInfo ? (
              <div className="flex flex-col items-center justify-center py-12 text-center px-6">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-50 border border-amber-200 mb-3">
                  <MessageCircle className="h-7 w-7 text-amber-500" />
                </div>
                <p className="text-sm font-semibold text-foreground mb-1">المحادثات غير مفعلة</p>
                <p className="text-xs text-muted-foreground mb-3">جداول المحادثات لم يتم إنشاؤها في قاعدة البيانات بعد</p>
                {setupInfo.steps && (
                  <ol className="text-xs text-muted-foreground space-y-1 mb-3 text-right">
                    {setupInfo.steps.map((step, i) => (
                      <li key={i}>{step}</li>
                    ))}
                  </ol>
                )}
                {setupInfo.sqlEditorUrl && (
                  <a
                    href={setupInfo.sqlEditorUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-2 text-xs font-medium text-white hover:bg-amber-700 transition-colors mb-2"
                  >
                    فتح SQL Editor في Supabase
                  </a>
                )}
                <button
                  onClick={() => { setSetupInfo(null); fetchConversations(); }}
                  className="text-xs text-emerald-600 hover:text-emerald-700 font-medium transition-colors"
                >
                  إعادة المحاولة ←
                </button>
              </div>
            ) : conversations.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center px-6">
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-50 mb-4">
                  <MessageCircle className="h-8 w-8 text-emerald-400" />
                </div>
                <p className="text-sm font-semibold text-foreground mb-1">لا توجد محادثات</p>
                <p className="text-xs text-muted-foreground mb-4">ابدأ محادثة جديدة مع زملائك في المقرر</p>
                <button
                  onClick={() => setShowNewDM(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-medium text-white hover:bg-emerald-700 transition-colors"
                >
                  <Plus className="h-3.5 w-3.5" />
                  محادثة جديدة
                </button>
              </div>
            ) : filteredConversations.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center px-6">
                <Search className="h-8 w-8 text-muted-foreground/40 mb-2" />
                <p className="text-xs text-muted-foreground">لا توجد نتائج للبحث</p>
              </div>
            ) : (
              <div className="py-1">
                {filteredConversations.map((conv) => {
                  const isActive = conv.id === activeConvId;
                  const isGroup = conv.type === 'group';
                  const lastMsg = conv.lastMessage;
                  const unread = conv.unreadCount || 0;
                  const displayName = isGroup
                    ? conv.title || 'محادثة جماعية'
                    : formatNameWithTitle(
                        conv.otherParticipant?.name || 'محادثة خاصة',
                        conv.otherParticipant?.role,
                        conv.otherParticipant?.title_id,
                        conv.otherParticipant?.gender
                      );
                  const otherUserId = !isGroup ? conv.otherParticipant?.id : null;
                  const isOtherOnline = otherUserId ? onlineUsers.has(otherUserId) : false;
                  const otherStatus = otherUserId ? userStatuses.get(otherUserId) || (isOtherOnline ? 'online' : 'offline') : 'offline';

                  return (
                    <motion.button
                      key={conv.id}
                      variants={itemVariants}
                      onClick={() => openConversation(conv.id, {
                        id: conv.id,
                        type: conv.type,
                        title: conv.title,
                        otherParticipant: conv.otherParticipant,
                      })}
                      className={`w-full flex items-center gap-3 p-3 text-right transition-all hover:bg-muted/50 ${
                        isActive
                          ? 'bg-emerald-50 border-s-2 border-emerald-500'
                          : 'border-s-2 border-transparent'
                      }`}
                    >
                      {/* Avatar */}
                      <div className="shrink-0 relative">
                        {conv.type === 'group' ? (
                          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                            <Hash className="h-5 w-5" />
                          </div>
                        ) : (
                          <UserAvatar name={conv.otherParticipant?.name || displayName} avatarUrl={conv.otherParticipant?.avatar_url} size="md" />
                        )}
                        {/* Online/status indicator for individual chats */}
                        {!isGroup && otherUserId && (
                          <div className={`absolute -bottom-0.5 -start-0.5 h-3.5 w-3.5 rounded-full border-2 border-card ${
                            otherStatus === 'online' ? 'bg-emerald-500' :
                            otherStatus === 'away' ? 'bg-amber-400' :
                            otherStatus === 'busy' ? 'bg-rose-500' :
                            'bg-gray-300'
                          }`} />
                        )}
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <span className={`text-sm truncate ${isActive ? 'font-bold text-emerald-700' : 'font-semibold text-foreground'}`}>
                            {displayName}
                          </span>
                          <span className="text-[10px] text-muted-foreground shrink-0">
                            {lastMsg ? relativeTime(lastMsg.created_at) : ''}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-2 mt-0.5">
                          <p className="text-xs text-muted-foreground truncate">
                            {lastMsg
                              ? (lastMsg.content.length > 35 ? lastMsg.content.substring(0, 35) + '...' : lastMsg.content)
                              : 'لا توجد رسائل بعد'}
                          </p>
                          {unread > 0 && (
                            <span className="shrink-0 flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-500 text-white text-[10px] font-bold px-1.5 shadow-sm animate-pulse">
                              {unread > 99 ? '99+' : unread}
                            </span>
                          )}
                        </div>
                      </div>
                    </motion.button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* ============================================ */}
        {/* CHAT VIEW PANEL                              */}
        {/* ============================================ */}
        <div className={`flex-1 min-w-0 flex flex-col border rounded-xl bg-card overflow-hidden ${!showChat ? 'hidden md:flex' : 'flex'}`}>
          {activeConvId && activeConvInfo ? (
            <>
              {/* ─── Chat header ─── */}
              <div className="shrink-0 p-3 border-b bg-card flex items-center gap-3">
                {/* Back button (mobile) */}
                <button
                  onClick={() => setShowChat(false)}
                  className="md:hidden flex h-8 w-8 items-center justify-center rounded-lg hover:bg-muted transition-colors"
                >
                  <ArrowRight className="h-4 w-4" />
                </button>

                {/* Chat avatar & info */}
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <div className="shrink-0 relative">
                    {activeConvInfo.type === 'group' ? (
                      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                        <Hash className="h-4 w-4" />
                      </div>
                    ) : (
                      <UserAvatar name={chatHeaderName} avatarUrl={activeConvInfo.otherParticipant?.avatar_url} size="md" />
                    )}
                    {/* Online/status dot in header */}
                    {activeConvInfo.type === 'individual' && (
                      <div className={`absolute -bottom-0.5 -start-0.5 h-3 w-3 rounded-full border-2 border-card ${
                        chatHeaderStatus === 'online' ? 'bg-emerald-500' :
                        chatHeaderStatus === 'away' ? 'bg-amber-400' :
                        chatHeaderStatus === 'busy' ? 'bg-rose-500' :
                        'bg-gray-300'
                      }`} />
                    )}
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold text-foreground">{chatHeaderName}</h3>
                    <div className="flex items-center gap-1.5">
                      {activeConvInfo.type === 'individual' ? (
                        <span className="text-[10px] text-muted-foreground">
                          {chatHeaderStatus === 'online' ? 'متصل الآن' :
                           chatHeaderStatus === 'away' ? 'بعيد' :
                           chatHeaderStatus === 'busy' ? 'مشغول' :
                           'غير متصل'}
                        </span>
                      ) : (
                        <span className="text-[10px] text-muted-foreground">
                          {participants.length} مشارك
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Connection status + delete button in header */}
                <div className="flex items-center gap-1.5">
                  {/* Delete conversation button */}
                  <button
                    onClick={() => setDeleteConvId(activeConvId)}
                    className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-rose-50 hover:text-rose-600 transition-colors"
                    title="حذف المحادثة"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                  {isConnected ? (
                    <Wifi className="h-3.5 w-3.5 text-emerald-500" />
                  ) : (
                    <div className="flex items-center gap-1" title="يتم التحديث كل 5 ثوانٍ">
                      <WifiOff className="h-3.5 w-3.5 text-rose-400" />
                      <span className="text-[9px] text-rose-400 hidden sm:inline">تحديث تلقائي</span>
                    </div>
                  )}
                </div>
              </div>

              {/* ─── Messages area ─── */}
              <div
                ref={messagesContainerRef}
                className="flex-1 min-h-0 overflow-y-auto py-3 space-y-1.5"
                style={{ scrollbarGutter: 'stable' }}
              >
                {messagesLoading ? (
                  <div className="flex items-center justify-center py-16">
                    <Loader2 className="h-6 w-6 animate-spin text-emerald-600" />
                  </div>
                ) : messages.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 text-center px-6">
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-muted/50 mb-3">
                      <MessageCircle className="h-6 w-6 text-muted-foreground/40" />
                    </div>
                    <p className="text-sm text-muted-foreground">ابدأ المحادثة!</p>
                    <p className="text-xs text-muted-foreground/60 mt-1">أرسل أول رسالة في هذه المحادثة</p>
                  </div>
                ) : (
                  <>
                    {messages.map((msg, i) => renderMessage(msg, i))}
                    <div ref={messagesEndRef} />
                  </>
                )}
              </div>

              {/* ─── Typing indicator ─── */}
              <AnimatePresence>
                {typingUsers.size > 0 && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.15 }}
                  >
                    <TypingIndicator names={Array.from(typingUsers.values())} />
                  </motion.div>
                )}
              </AnimatePresence>

              {/* ─── Message input ─── */}
              <div className="shrink-0 p-3 border-t bg-card">
                <div className="flex items-end gap-2">
                  <input
                    type="text"
                    value={newMessage}
                    onChange={(e) => handleTyping(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleSend();
                      }
                    }}
                    placeholder="اكتب رسالة..."
                    className="flex-1 rounded-xl border bg-muted/30 px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all"
                    dir="rtl"
                    disabled={sending}
                  />
                  <button
                    onClick={handleSend}
                    disabled={!newMessage.trim() || sending}
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40 disabled:hover:bg-emerald-600 transition-colors"
                  >
                    {sending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>
            </>
          ) : (
            /* ─── Empty state: no conversation selected ─── */
            <div className="flex-1 flex flex-col items-center justify-center text-center px-6">
              <motion.div variants={slideInRight} className="flex flex-col items-center">
                <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-emerald-50 mb-4">
                  <MessageCircle className="h-10 w-10 text-emerald-400" />
                </div>
                <h3 className="text-lg font-semibold text-foreground mb-2">مرحباً بك في المحادثات</h3>
                <p className="text-sm text-muted-foreground max-w-[280px] mb-4">
                  اختر محادثة من القائمة أو ابدأ محادثة جديدة مع زملائك
                </p>
                <button
                  onClick={() => setShowNewDM(true)}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-emerald-700 transition-colors shadow-sm"
                >
                  <Plus className="h-4 w-4" />
                  محادثة جديدة
                </button>
              </motion.div>
            </div>
          )}
        </div>
      </div>

      {/* ============================================ */}
      {/* NEW DM DIALOG                                */}
      {/* ============================================ */}
      <AnimatePresence>
        {showNewDM && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
            onClick={() => { setShowNewDM(false); setSearchQuery(''); setSearchResults([]); }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              transition={{ duration: 0.15 }}
              className="w-full max-w-md bg-card rounded-2xl shadow-2xl border overflow-hidden"
              onClick={(e) => e.stopPropagation()}
              dir="rtl"
            >
              {/* Dialog header */}
              <div className="flex items-center justify-between p-4 border-b">
                <h3 className="text-base font-bold text-foreground">محادثة جديدة</h3>
                <button
                  onClick={() => { setShowNewDM(false); setSearchQuery(''); setSearchResults([]); }}
                  className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-muted transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Search input */}
              <div className="p-4 border-b">
                <div className="relative">
                  <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => handleSearchUsers(e.target.value)}
                    placeholder="ابحث بالاسم أو البريد الإلكتروني..."
                    className="w-full rounded-lg border bg-muted/30 ps-10 pe-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all"
                    autoFocus
                  />
                  {searching && (
                    <Loader2 className="absolute end-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
                  )}
                </div>
              </div>

              {/* Search results */}
              <div className="max-h-80 overflow-y-auto">
                {searchQuery && !searching && searchResults.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-8 text-center px-6">
                    <Search className="h-8 w-8 text-muted-foreground/30 mb-2" />
                    <p className="text-xs text-muted-foreground">لا يوجد مستخدمون مطابقون</p>
                  </div>
                ) : searchResults.length > 0 ? (
                  <div className="py-1">
                    {searchResults.map((user) => (
                      <button
                        key={user.id}
                        onClick={() => startIndividualChat(user)}
                        disabled={creatingChat}
                        className="w-full flex items-center gap-3 p-3 hover:bg-muted/50 transition-colors text-right disabled:opacity-50"
                      >
                        <div className="shrink-0 relative">
                          <UserAvatar name={user.name} avatarUrl={user.avatar_url} size="md" />
                          <div className={`absolute -bottom-0.5 -start-0.5 h-3 w-3 rounded-full border-2 border-card ${
                            onlineUsers.has(user.id) ? 'bg-emerald-500' : 'bg-gray-300'
                          }`} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-foreground truncate">{formatNameWithTitle(user.name, user.role, user.title_id, user.gender)}</p>
                          <p className="text-xs text-muted-foreground truncate">{user.email}</p>
                        </div>
                        {creatingChat && (
                          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                        )}
                      </button>
                    ))}
                  </div>
                ) : !searchQuery ? (
                  <div className="flex flex-col items-center justify-center py-8 text-center px-6">
                    <Search className="h-8 w-8 text-muted-foreground/30 mb-2" />
                    <p className="text-xs text-muted-foreground">اكتب للبحث عن مستخدم</p>
                  </div>
                ) : null}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>

    {/* ============================================ */}
    {/* DELETE MESSAGE CONFIRMATION DIALOG            */}
    {/* ============================================ */}
    <AlertDialog open={!!deleteMessageId} onOpenChange={(open) => { if (!open) setDeleteMessageId(null); }}>
      <AlertDialogContent dir="rtl">
        <AlertDialogHeader>
          <AlertDialogTitle>حذف الرسالة</AlertDialogTitle>
          <AlertDialogDescription>
            هل أنت متأكد من حذف هذه الرسالة؟ لا يمكن التراجع عن هذا الإجراء.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>إلغاء</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              if (deleteMessageId) handleDeleteMessage(deleteMessageId);
            }}
            className="bg-rose-600 text-white hover:bg-rose-700 focus:ring-rose-600"
          >
            حذف
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    {/* ============================================ */}
    {/* DELETE CONVERSATION CONFIRMATION DIALOG       */}
    {/* ============================================ */}
    <AlertDialog open={!!deleteConvId} onOpenChange={(open) => { if (!open) setDeleteConvId(null); }}>
      <AlertDialogContent dir="rtl">
        <AlertDialogHeader>
          <AlertDialogTitle>حذف المحادثة</AlertDialogTitle>
          <AlertDialogDescription>
            هل أنت متأكد من حذف هذه المحادثة؟ سيتم حذف جميع الرسائل ولا يمكن التراجع.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>إلغاء</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleConfirmDeleteConversation}
            className="bg-rose-600 text-white hover:bg-rose-700 focus:ring-rose-600"
          >
            حذف
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}

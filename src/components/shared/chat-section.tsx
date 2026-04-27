'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useSharedSocket, useSocketEvent } from '@/lib/socket';
import {
  MessageCircle,
  ArrowUp,
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
  Archive,
  ArchiveRestore,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import type { UserProfile, Conversation, ChatMessage, UserStatus } from '@/lib/types';
import UserAvatar, { formatNameWithTitle } from '@/components/shared/user-avatar';
import { useAppStore } from '@/stores/app-store';
import { useStatusStore, getStatusColor, getStatusLabel, isVisible } from '@/stores/status-store';
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
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

// =====================================================
// Props
// =====================================================
interface ChatSectionProps {
  profile: UserProfile;
  role: 'teacher' | 'student' | 'admin';
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
      <span className="text-xs text-emerald-600 font-medium animate-pulse">{label}</span>
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
  const { setChatUnreadCount } = useAppStore();

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

  // ─── Status store ───
  const { userStatuses, init: initStatusStore, getUserStatus, fetchUserStatuses } = useStatusStore();

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

  // ─── Conversation list filter ───
  const [convFilter, setConvFilter] = useState('');

  // ─── Mobile: show conversation list or chat view ───
  const [showChat, setShowChat] = useState(false);

  // ─── Unread tracking (local override for real-time updates) ───
  const [localUnread, setLocalUnread] = useState<Map<string, number>>(new Map());

  // ─── Archived conversations ───
  const [archivedConversations, setArchivedConversations] = useState<Conversation[]>([]);

  // ─── Confirmation dialog state ───
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean;
    title: string;
    description: string;
    onConfirm: () => void;
  }>({ open: false, title: '', description: '', onConfirm: () => {} });

  // ─── Archived section collapsible ───
  const [archivedOpen, setArchivedOpen] = useState(false);

  // ─── Conversation action menu ───
  const [convMenuId, setConvMenuId] = useState<string | null>(null);
  const convMenuRef = useRef<HTMLDivElement>(null);

  // ─── Chat header actions menu ───
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false);
  const headerMenuRef = useRef<HTMLDivElement>(null);

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
      setArchivedConversations(data.archivedConversations || []);
      return data.conversations || [];
    } catch (err) {
      console.error('Fetch conversations error:', err);
      setConvFetchError('فشل تحميل المحادثات');
      return [];
    } finally {
      setLoading(false);
    }
  }, [profile.id]);

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
        const existingIds = new Set(prev.map((m) => m.id));
        const newFromServer = serverMessages.filter((m) => !existingIds.has(m.id));
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
      // Poll every 5 seconds when socket is disconnected
      pollingRef.current = setInterval(pollMessages, 5000);
    }

    // Always poll every 15 seconds as backup
    backupPollingRef.current = setInterval(pollMessages, 15000);

    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
      if (backupPollingRef.current) clearInterval(backupPollingRef.current);
    };
  }, [isConnected, pollMessages]);

  // =====================================================
  // Initialize status store on mount
  // =====================================================
  useEffect(() => {
    initStatusStore();
  }, [initStatusStore]);

  // =====================================================
  // Fetch user statuses when conversations load
  // =====================================================
  useEffect(() => {
    if (conversations.length === 0) return;
    const userIds = conversations
      .filter(c => c.type === 'individual' && c.otherParticipant?.id)
      .map(c => c.otherParticipant!.id);
    if (userIds.length > 0) {
      fetchUserStatuses(userIds);
    }
  }, [conversations, fetchUserStatuses]);

  // =====================================================
  // Socket.io event subscriptions (using shared socket)
  // =====================================================

  // ─── New message (from room broadcast) ───
  useSocketEvent<ChatMessage>('new-message', (msg) => {
    const convId = msg.conversationId || (msg as Record<string, unknown>).conversation_id as string;
    const currentActiveId = activeConvIdRef.current;

    if (convId === currentActiveId) {
      setMessages((prev) => {
        // Check if we already have this message (by ID)
        if (prev.some((m) => m.id === msg.id)) return prev;
        // Also check if this is the server version of our optimistic message
        // (same sender, same content, within last 10 seconds)
        const isDuplicate = prev.some((m) =>
          m.id.startsWith('temp-') &&
          m.sender_id === msg.sender_id &&
          m.content === msg.content &&
          Date.now() - new Date(m.created_at).getTime() < 10000
        );
        if (isDuplicate) {
          // Replace the optimistic message with the server one
          return prev.map((m) =>
            m.id.startsWith('temp-') && m.sender_id === msg.sender_id && m.content === msg.content
              ? msg
              : m
          );
        }
        // Also check for duplicate content from same sender within 10 seconds
        // (handles case where optimistic msg was already replaced by API response)
        const isContentDuplicate = prev.some((m) =>
          m.id !== msg.id &&
          m.sender_id === msg.sender_id &&
          m.content === msg.content &&
          Math.abs(new Date(m.created_at).getTime() - new Date(msg.created_at).getTime()) < 10000
        );
        if (isContentDuplicate) return prev;
        return [...prev, msg];
      });
      // Mark as read since we're viewing this conversation
      fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'mark-read', conversationId: convId, userId: profile.id }),
      }).catch(() => {});
    } else {
      // Increment unread count for this conversation
      setLocalUnread((prev) => {
        const next = new Map(prev);
        next.set(convId, (next.get(convId) || 0) + 1);
        return next;
      });
    }
    // Always refresh conversation list for updated last message
    fetchConversations();
  });

  // ─── Chat notification (direct delivery, even if not in room) ───
  useSocketEvent<{
    conversationId: string;
    message: ChatMessage;
    senderName: string;
    content: string;
  }>('chat-notification', (data) => {
    const currentActiveId = activeConvIdRef.current;

    if (data.conversationId === currentActiveId) {
      setMessages((prev) => {
        // Check if we already have this message (by ID)
        if (prev.some((m) => m.id === data.message.id)) return prev;
        // Check if this is the server version of our optimistic message
        const isDuplicate = prev.some((m) =>
          m.id.startsWith('temp-') &&
          m.sender_id === data.message.sender_id &&
          m.content === data.message.content &&
          Date.now() - new Date(m.created_at).getTime() < 10000
        );
        if (isDuplicate) {
          return prev.map((m) =>
            m.id.startsWith('temp-') && m.sender_id === data.message.sender_id && m.content === data.message.content
              ? data.message
              : m
          );
        }
        // Also check for duplicate content from same sender within 10 seconds
        const isContentDuplicate = prev.some((m) =>
          m.id !== data.message.id &&
          m.sender_id === data.message.sender_id &&
          m.content === data.message.content &&
          Math.abs(new Date(m.created_at).getTime() - new Date(data.message.created_at).getTime()) < 10000
        );
        if (isContentDuplicate) return prev;
        return [...prev, data.message];
      });
      // Mark as read
      fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'mark-read', conversationId: data.conversationId, userId: profile.id }),
      }).catch(() => {});
    } else {
      // Show toast and increment unread
      toast(`رسالة جديدة من ${data.senderName}`, {
        description: data.content.substring(0, 60) + (data.content.length > 60 ? '...' : ''),
        icon: <Bell className="h-4 w-4 text-emerald-600" />,
        duration: 5000,
      });
      setLocalUnread((prev) => {
        const next = new Map(prev);
        next.set(data.conversationId, (next.get(data.conversationId) || 0) + 1);
        return next;
      });
    }

    fetchConversations();
  });

  // ─── New conversation notification ───
  useSocketEvent<{
    conversationId: string;
    fromUser: { id: string; name: string };
    conversationType: string;
  }>('new-conversation', (data) => {
    joinRoom(data.conversationId);
    // Only show toast about new conversation, don't increment unread count
    // since there are no messages yet
    toast(`محادثة جديدة من ${data.fromUser.name}`, {
      description: 'تم إنشاء محادثة جديدة',
      icon: <MessageCircle className="h-4 w-4 text-emerald-600" />,
      duration: 5000,
    });
    fetchConversations();
  });

  // ─── Message updated (edit) ───
  useSocketEvent<{ messageId: string; content: string; isEdited: boolean; editedAt?: string }>('message-updated', (data) => {
    setMessages((prev) =>
      prev.map((m) =>
        m.id === data.messageId
          ? { ...m, content: data.content, is_edited: data.isEdited, edited_at: data.editedAt || new Date().toISOString() }
          : m
      )
    );
  });

  // ─── Message deleted ───
  useSocketEvent<{ messageId: string }>('message-deleted', (data) => {
    setMessages((prev) =>
      prev.map((m) =>
        m.id === data.messageId
          ? { ...m, content: 'تم حذف هذه الرسالة', is_deleted: true }
          : m
      )
    );
  });

  // ─── Conversation updated ───
  useSocketEvent('conversation-updated', () => {
    fetchConversations();
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

  // ─── Online users & status tracking now handled by status store ───
  // (The status store listens for: online-users, user-online, user-offline, user-status-changed, user-statuses)

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
      if (convMenuRef.current && !convMenuRef.current.contains(e.target as Node)) {
        setConvMenuId(null);
      }
      if (headerMenuRef.current && !headerMenuRef.current.contains(e.target as Node)) {
        setHeaderMenuOpen(false);
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

    // Clear local unread for this conversation
    setLocalUnread((prev) => {
      const next = new Map(prev);
      next.delete(convId);
      return next;
    });

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
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete-message', messageId: msgId, userId: profile.id }),
      });
      const data = await res.json();
      if (data.error) {
        toast.error(data.error);
        return;
      }
      setMessages((prev) =>
        prev.map((m) =>
          m.id === msgId ? { ...m, content: 'تم حذف هذه الرسالة', is_deleted: true } : m
        )
      );
      socket?.emit('message-deleted', {
        conversationId: activeConvId,
        messageId: msgId,
      });
    } catch (err) {
      console.error('Delete message error:', err);
      toast.error('فشل حذف الرسالة');
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
        prev.map((m) => m.id === msgId ? { ...m, content: trimmed, is_edited: true, edited_at: new Date().toISOString() } : m)
      );
      socket?.emit('message-updated', {
        conversationId: activeConvId,
        messageId: msgId,
        content: trimmed,
        isEdited: true,
        editedAt: new Date().toISOString(),
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

        // Don't notify the other user about the new conversation yet.
        // The other user will only see this conversation when the first
        // actual message is sent (via chat-notification socket event).

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

  // =====================================================
  // Delete conversation (any type - uses is_hidden flag)
  // =====================================================
  const handleDeleteConversation = async (convId: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setConfirmDialog({
      open: true,
      title: 'حذف المحادثة',
      description: 'هل أنت متأكد من حذف هذه المحادثة؟',
      onConfirm: async () => {
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
          toast.success('تم حذف المحادثة');
          if (activeConvId === convId) {
            setActiveConvId(null);
            setActiveConvInfo(null);
            setMessages([]);
            setShowChat(false);
          }
          fetchConversations();
        } catch (err) {
          console.error('Delete conversation error:', err);
          toast.error('فشل حذف المحادثة');
        }
      },
    });
  };

  // =====================================================
  // Delete all conversations
  // =====================================================
  const handleDeleteAllConversations = async () => {
    if (conversations.length === 0) {
      toast.error('لا توجد محادثات لحذفها');
      return;
    }
    setConfirmDialog({
      open: true,
      title: 'حذف جميع المحادثات',
      description: 'هل أنت متأكد من حذف جميع المحادثات؟',
      onConfirm: async () => {
        try {
          const res = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'delete-all-conversations', userId: profile.id }),
          });
          const data = await res.json();
          if (data.error) {
            toast.error(data.error);
            return;
          }
          toast.success(`تم حذف ${data.deletedCount || 0} محادثة`);
          setActiveConvId(null);
          setActiveConvInfo(null);
          setMessages([]);
          setShowChat(false);
          fetchConversations();
        } catch (err) {
          console.error('Delete all conversations error:', err);
          toast.error('فشل حذف المحادثات');
        }
      },
    });
  };

  // =====================================================
  // Archive conversation
  // =====================================================
  const handleArchiveConversation = async (convId: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'archive-conversation', conversationId: convId, userId: profile.id }),
      });
      const data = await res.json();
      if (data.error) {
        toast.error(data.error);
        return;
      }
      toast.success('تم أرشفة المحادثة');
      if (activeConvId === convId) {
        setActiveConvId(null);
        setActiveConvInfo(null);
        setMessages([]);
        setShowChat(false);
      }
      fetchConversations();
    } catch (err) {
      console.error('Archive conversation error:', err);
      toast.error('فشل أرشفة المحادثة');
    }
  };

  // =====================================================
  // Unarchive conversation
  // =====================================================
  const handleUnarchiveConversation = async (convId: string) => {
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'unarchive-conversation', conversationId: convId, userId: profile.id }),
      });
      const data = await res.json();
      if (data.error) {
        toast.error(data.error);
        return;
      }
      toast.success('تم إلغاء أرشفة المحادثة');
      fetchConversations();
    } catch (err) {
      console.error('Unarchive conversation error:', err);
      toast.error('فشل إلغاء أرشفة المحادثة');
    }
  };

  // ─── Conversation participants cache for group avatars ───
  const [groupParticipants, setGroupParticipants] = useState<Map<string, UserProfile[]>>(new Map());

  // Fetch participants for group conversations to show stacked avatars
  useEffect(() => {
    const groupConvs = conversations.filter(c => c.type === 'group' && !groupParticipants.has(c.id));
    if (groupConvs.length === 0) return;

    Promise.all(
      groupConvs.map(async (conv) => {
        try {
          const res = await fetch(`/api/chat?action=participants&conversationId=${conv.id}`);
          const data = await res.json();
          const parts: UserProfile[] = (data.participants || [])
            .map((p: { users: UserProfile }) => p.users)
            .filter(Boolean);
          return { convId: conv.id, participants: parts };
        } catch {
          return null;
        }
      })
    ).then((results) => {
      const newMap = new Map(groupParticipants);
      results.filter(Boolean).forEach((r) => {
        if (r) newMap.set(r.convId, r.participants);
      });
      setGroupParticipants(newMap);
    });
  }, [conversations]);

  // =====================================================
  // Get effective unread count (server + local overrides)
  // =====================================================
  const getUnreadCount = useCallback((conv: Conversation): number => {
    const local = localUnread.get(conv.id);
    if (local !== undefined) return local;
    return conv.unreadCount || 0;
  }, [localUnread]);

  // =====================================================
  // Update global unread count for sidebar badge
  // =====================================================
  useEffect(() => {
    const totalUnread = conversations.reduce((sum, conv) => {
      // Don't count unread for archived conversations
      return sum + getUnreadCount(conv);
    }, 0);
    setChatUnreadCount(totalUnread);
  }, [conversations, localUnread, getUnreadCount, setChatUnreadCount]);

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
        {/* Other user avatar */}
        {!isOwn && (
          <div className="shrink-0 w-7">
            {showAvatar ? (
              <UserAvatar name={senderName} avatarUrl={msg.sender?.avatar_url} size="xs" />
            ) : null}
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
                            onClick={() => handleDeleteMessage(msg.id)}
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
              <span className="text-[10px] text-emerald-500/60 font-medium">
                {msg.edited_at ? `(معدّلة ${relativeTime(msg.edited_at)})` : '(معدّلة)'}
              </span>
            )}
          </div>
        </div>
      </motion.div>
    );
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

  const chatHeaderStatus: UserStatus = activeConvInfo?.type === 'individual' && activeConvInfo.otherParticipant?.id
    ? getUserStatus(activeConvInfo.otherParticipant.id)
    : 'offline';

  // =====================================================
  // Main render
  // =====================================================
  return (
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
                {/* Delete all conversations button */}
                {conversations.length > 0 && (
                  <button
                    onClick={handleDeleteAllConversations}
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:text-red-500 hover:bg-red-50 transition-colors"
                    title="حذف جميع المحادثات"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
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
                  const unread = getUnreadCount(conv);
                  const displayName = isGroup
                    ? conv.title || 'محادثة جماعية'
                    : formatNameWithTitle(
                        conv.otherParticipant?.name || 'محادثة خاصة',
                        conv.otherParticipant?.role,
                        conv.otherParticipant?.title_id,
                        conv.otherParticipant?.gender
                      );
                  const otherUserId = !isGroup ? conv.otherParticipant?.id : null;
                  const otherUserStatus: UserStatus = otherUserId ? getUserStatus(otherUserId) : 'offline';
                  const otherIsVisible = otherUserId ? isVisible(otherUserStatus) : false;

                  return (
                    <motion.div
                      key={conv.id}
                      variants={itemVariants}
                      onClick={() => openConversation(conv.id, {
                        id: conv.id,
                        type: conv.type,
                        title: conv.title,
                        otherParticipant: conv.otherParticipant,
                      })}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          openConversation(conv.id, {
                            id: conv.id,
                            type: conv.type,
                            title: conv.title,
                            otherParticipant: conv.otherParticipant,
                          });
                        }
                      }}
                      className={`w-full flex items-center gap-3 p-3 text-right transition-all hover:bg-muted/50 cursor-pointer ${
                        isActive
                          ? 'bg-emerald-50 border-s-2 border-emerald-500'
                          : 'border-s-2 border-transparent'
                      }`}
                    >
                      {/* Avatar */}
                      <div className="shrink-0 relative">
                        {conv.type === 'group' ? (
                          (() => {
                            const gParts = groupParticipants.get(conv.id);
                            if (gParts && gParts.length >= 2) {
                              const shownParts = gParts.slice(0, 3);
                              return (
                                <div className="relative h-10 w-10">
                                  {shownParts.map((p, idx) => (
                                    <div
                                      key={p.id}
                                      className="absolute"
                                      style={{
                                        top: idx === 0 ? 0 : idx === 1 ? 0 : 14,
                                        right: idx === 0 ? 0 : idx === 1 ? 14 : 7,
                                        zIndex: 3 - idx,
                                      }}
                                    >
                                      <UserAvatar
                                        name={p.name || ''}
                                        avatarUrl={p.avatar_url}
                                        size="xs"
                                      />
                                    </div>
                                  ))}
                                </div>
                              );
                            }
                            return (
                              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                                <Hash className="h-5 w-5" />
                              </div>
                            );
                          })()
                        ) : (
                          <UserAvatar name={conv.otherParticipant?.name || displayName} avatarUrl={conv.otherParticipant?.avatar_url} size="md" />
                        )}
                        {/* Status indicator for individual chats */}
                        {!isGroup && otherUserId && (
                          <div className={`absolute -bottom-0.5 -start-0.5 h-3.5 w-3.5 rounded-full border-2 border-card ${
                            getStatusColor(otherUserStatus)
                          } ${otherUserStatus === 'online' ? 'animate-pulse' : ''}`} />
                        )}
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <span className={`text-sm truncate ${isActive ? 'font-bold text-emerald-700' : 'font-semibold text-foreground'}`}>
                            {displayName}
                          </span>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <span className="text-[10px] text-muted-foreground">
                              {lastMsg ? relativeTime(lastMsg.created_at) : ''}
                            </span>
                            {/* Conversation actions menu */}
                            <div className="relative" ref={convMenuId === conv.id ? convMenuRef : null}>
                              <button
                                onClick={(e) => { e.stopPropagation(); setConvMenuId(convMenuId === conv.id ? null : conv.id); }}
                                className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground/60 hover:text-foreground hover:bg-muted transition-colors"
                                title="المزيد"
                              >
                                <MoreHorizontal className="h-3 w-3" />
                              </button>
                              <AnimatePresence>
                                {convMenuId === conv.id && (
                                  <motion.div
                                    initial={{ opacity: 0, scale: 0.9 }}
                                    animate={{ opacity: 1, scale: 1 }}
                                    exit={{ opacity: 0, scale: 0.9 }}
                                    transition={{ duration: 0.1 }}
                                    className="absolute end-0 top-6 z-30 bg-card border rounded-xl shadow-lg py-1 min-w-[130px]"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    <button
                                      onClick={() => { setConvMenuId(null); handleArchiveConversation(conv.id); }}
                                      className="w-full flex items-center gap-2 px-3 py-2 text-xs text-foreground hover:bg-muted/50 transition-colors text-right"
                                    >
                                      <Archive className="h-3.5 w-3.5" />
                                      أرشفة
                                    </button>
                                    <button
                                      onClick={() => { setConvMenuId(null); handleDeleteConversation(conv.id); }}
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
                        </div>
                        <div className="flex items-center justify-between gap-2 mt-0.5">
                          <p className="text-xs text-muted-foreground truncate">
                            {lastMsg
                              ? (lastMsg.content.length > 35 ? lastMsg.content.substring(0, 35) + '...' : lastMsg.content)
                              : 'لا توجد رسائل بعد'}
                          </p>
                          {unread > 0 && (
                            <span className="shrink-0 flex h-5 min-w-5 items-center justify-center rounded-full bg-emerald-600 text-white text-[10px] font-bold px-1.5">
                              {unread > 99 ? '99+' : unread}
                            </span>
                          )}
                        </div>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            )}

            {/* ─── Archived conversations section ─── */}
            {archivedConversations.length > 0 && (
              <Collapsible open={archivedOpen} onOpenChange={setArchivedOpen} className="border-t">
                <CollapsibleTrigger className="w-full flex items-center justify-between px-4 py-2.5 text-right hover:bg-muted/30 transition-colors">
                  <div className="flex items-center gap-2">
                    <Archive className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-xs font-semibold text-muted-foreground">
                      المؤرشفة ({archivedConversations.length})
                    </span>
                  </div>
                  {archivedOpen ? (
                    <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
                  ) : (
                    <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                  )}
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="py-1">
                    {archivedConversations.map((conv) => {
                      const isGroup = conv.type === 'group';
                      const displayName = isGroup
                        ? conv.title || 'محادثة جماعية'
                        : formatNameWithTitle(
                            conv.otherParticipant?.name || 'محادثة خاصة',
                            conv.otherParticipant?.role,
                            conv.otherParticipant?.title_id,
                            conv.otherParticipant?.gender
                          );
                      const lastMsg = conv.lastMessage;

                      return (
                        <div
                          key={conv.id}
                          className="flex items-center gap-3 p-3 text-right hover:bg-muted/30 transition-colors opacity-60"
                        >
                          <div className="shrink-0">
                            {isGroup ? (
                              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                                <Hash className="h-5 w-5" />
                              </div>
                            ) : (
                              <UserAvatar name={conv.otherParticipant?.name || displayName} avatarUrl={conv.otherParticipant?.avatar_url} size="md" />
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-sm font-semibold text-foreground truncate">{displayName}</span>
                              <div className="flex items-center gap-1 shrink-0">
                                {lastMsg && (
                                  <span className="text-[10px] text-muted-foreground">
                                    {relativeTime(lastMsg.created_at)}
                                  </span>
                                )}
                                <button
                                  onClick={() => handleUnarchiveConversation(conv.id)}
                                  className="flex h-5 w-5 items-center justify-center rounded text-emerald-600/60 hover:text-emerald-600 hover:bg-emerald-50 transition-colors"
                                  title="إلغاء الأرشفة"
                                >
                                  <ArchiveRestore className="h-3 w-3" />
                                </button>
                              </div>
                            </div>
                            <p className="text-xs text-muted-foreground truncate mt-0.5">
                              {lastMsg
                                ? (lastMsg.content.length > 35 ? lastMsg.content.substring(0, 35) + '...' : lastMsg.content)
                                : 'لا توجد رسائل بعد'}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </CollapsibleContent>
              </Collapsible>
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
                {/* Back button (all screen sizes) - exits chat and shows welcome area */}
                <button
                  onClick={() => {
                    setShowChat(false);
                    setActiveConvId(null);
                    setActiveConvInfo(null);
                    setMessages([]);
                  }}
                  className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-muted transition-colors"
                >
                  <ArrowRight className="h-4 w-4" />
                </button>

                {/* Chat avatar & info */}
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <div className="shrink-0 relative">
                    {activeConvInfo.type === 'group' ? (
                      (() => {
                        const gParts = groupParticipants.get(activeConvInfo.id);
                        if (gParts && gParts.length >= 2) {
                          const shownParts = gParts.slice(0, 3);
                          return (
                            <div className="relative h-9 w-9">
                              {shownParts.map((p, idx) => (
                                <div
                                  key={p.id}
                                  className="absolute"
                                  style={{
                                    top: idx === 0 ? 0 : idx === 1 ? 0 : 12,
                                    right: idx === 0 ? 0 : idx === 1 ? 12 : 6,
                                    zIndex: 3 - idx,
                                  }}
                                >
                                  <UserAvatar name={p.name || ''} avatarUrl={p.avatar_url} size="xs" />
                                </div>
                              ))}
                            </div>
                          );
                        }
                        return (
                          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                            <Hash className="h-4 w-4" />
                          </div>
                        );
                      })()
                    ) : (
                      <UserAvatar name={chatHeaderName} avatarUrl={activeConvInfo.otherParticipant?.avatar_url} size="md" />
                    )}
                    {/* Online dot in header */}
                    {activeConvInfo.type === 'individual' && (
                      <div className={`absolute -bottom-0.5 -start-0.5 h-3 w-3 rounded-full border-2 border-card ${
                        getStatusColor(chatHeaderStatus)
                      } ${chatHeaderStatus === 'online' ? 'animate-pulse' : ''}`} />
                    )}
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold text-foreground truncate">{chatHeaderName}</h3>
                    <div className="flex items-center gap-1.5">
                      {activeConvInfo.type === 'individual' ? (
                        <span className={`text-[10px] font-medium ${chatHeaderStatus === 'online' ? 'text-emerald-600' : chatHeaderStatus === 'busy' ? 'text-amber-600' : chatHeaderStatus === 'away' ? 'text-orange-600' : 'text-muted-foreground'}`}>
                          {getStatusLabel(chatHeaderStatus)}
                        </span>
                      ) : (
                        <span className="text-[10px] text-muted-foreground">
                          {participants.length} مشارك
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Connection status in header */}
                <div className="flex items-center gap-1">
                  {isConnected ? (
                    <Wifi className="h-3.5 w-3.5 text-emerald-500" />
                  ) : (
                    <div className="flex items-center gap-1" title="يتم التحديث كل 5 ثوانٍ">
                      <WifiOff className="h-3.5 w-3.5 text-rose-400" />
                      <span className="text-[9px] text-rose-400 hidden sm:inline">تحديث تلقائي</span>
                    </div>
                  )}
                </div>

                {/* More actions menu */}
                <div className="relative" ref={headerMenuRef}>
                  <button
                    onClick={() => setHeaderMenuOpen(!headerMenuOpen)}
                    className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-muted transition-colors"
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </button>
                  <AnimatePresence>
                    {headerMenuOpen && (
                      <motion.div
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.9 }}
                        transition={{ duration: 0.12 }}
                        className="absolute end-0 top-9 z-30 bg-card border rounded-xl shadow-lg py-1 min-w-[140px]"
                      >
                        <button
                          onClick={() => { setHeaderMenuOpen(false); handleArchiveConversation(activeConvId!); }}
                          className="w-full flex items-center gap-2 px-3 py-2 text-xs text-foreground hover:bg-muted/50 transition-colors text-right"
                        >
                          <Archive className="h-3.5 w-3.5" />
                          أرشفة
                        </button>
                        <button
                          onClick={() => { setHeaderMenuOpen(false); handleDeleteConversation(activeConvId!); }}
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

              {/* ─── Messages area ─── */}
              <div
                ref={messagesContainerRef}
                className="flex-1 min-h-0 overflow-y-auto py-3 space-y-1.5 sm:static"
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

              {/* ─── Message input (pinned at bottom) ─── */}
              <div className="shrink-0 p-3 border-t bg-card sm:relative sticky bottom-0 z-10">
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
                      <ArrowUp className="h-4 w-4" />
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
                            getUserStatus(user.id) === 'online' ? 'bg-emerald-500' : 'bg-gray-300'
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

      {/* ============================================ */}
      {/* CONFIRMATION DIALOG                          */}
      {/* ============================================ */}
      <AlertDialog
        open={confirmDialog.open}
        onOpenChange={(open) => {
          if (!open) setConfirmDialog((prev) => ({ ...prev, open: false }));
        }}
      >
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-right">
              <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0" />
              {confirmDialog.title}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-right">
              {confirmDialog.description}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-row gap-2 justify-start">
            <AlertDialogCancel className="rounded-lg">إلغاء</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                confirmDialog.onConfirm();
                setConfirmDialog((prev) => ({ ...prev, open: false }));
              }}
              className="rounded-lg bg-red-600 text-white hover:bg-red-700"
            >
              حذف
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </motion.div>
  );
}

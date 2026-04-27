'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useSharedSocket, useSocketEvent } from '@/lib/socket';
import { useStatusStore } from '@/stores/status-store';
import {
  MessageCircle,
  ArrowUp,
  Loader2,
  Users,
  Hash,
  Trash2,
  Pencil,
  Check,
  XCircle,
  Bell,
  WifiOff,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import type { UserProfile, Subject, ChatMessage } from '@/lib/types';
import UserAvatar, { formatNameWithTitle } from '@/components/shared/user-avatar';
import { useAppStore } from '@/stores/app-store';

// -------------------------------------------------------
// Props
// -------------------------------------------------------
interface ChatTabProps {
  profile: UserProfile;
  role: 'teacher' | 'student';
  subjectId: string;
  subject: Subject;
  teacherName: string;
}

// -------------------------------------------------------
// Animation variants
// -------------------------------------------------------
const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.04 } },
};

const itemVariants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.3, ease: 'easeOut' } },
};

// -------------------------------------------------------
// Relative time helper
// -------------------------------------------------------
function relativeTime(dateStr: string): string {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return '';
  const diff = Date.now() - date.getTime();
  if (diff < 0) return 'الآن';
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'الآن';
  if (mins < 60) return `منذ ${mins} دقيقة`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `منذ ${hours} ساعة`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `منذ ${days} يوم`;
  return date.toLocaleDateString('ar-SA', { month: 'short', day: 'numeric' });
}

// -------------------------------------------------------
// Main Component
// -------------------------------------------------------
export default function ChatTab({ profile, role, subjectId, subject }: ChatTabProps) {
  const { openProfile } = useAppStore();
  // State
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [participants, setParticipants] = useState<{ user_id: string; users: UserProfile }[]>([]);
  const [typingUsers, setTypingUsers] = useState<Map<string, string>>(new Map());
  const [setupInfo, setSetupInfo] = useState<{ sqlEditorUrl?: string; steps?: string[] } | null>(null);

  // Status store
  const { init: initStatusStore } = useStatusStore();

  // Message edit state
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');

  // Message action menu
  const [messageMenuId, setMessageMenuId] = useState<string | null>(null);

  // Shared socket — replaces local socket creation
  const { socket, isConnected, joinRoom } = useSharedSocket();

  // Refs
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const typingTimeoutRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const messageMenuRef = useRef<HTMLDivElement>(null);
  const conversationIdRef = useRef<string | null>(null);

  // Keep ref in sync
  useEffect(() => { conversationIdRef.current = conversationId; }, [conversationId]);

  // Re-join room when socket reconnects (critical for real-time delivery)
  useEffect(() => {
    if (isConnected && conversationId) {
      joinRoom(conversationId);
    }
  }, [isConnected, conversationId, joinRoom]);

  // -------------------------------------------------------
  // Initialize conversation
  // -------------------------------------------------------
  const initConversation = useCallback(async () => {
    setLoading(true);
    try {
      // Ensure group conversation exists
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'ensure-group',
          subjectId,
          teacherId: role === 'teacher' ? profile.id : undefined,
        }),
      });
      const data = await res.json();

      if (data.conversation?.id) {
        const convId = data.conversation.id;
        setConversationId(convId);

        // KEY FIX: Join the conversation room on the shared socket
        // so we receive real-time broadcasts for this conversation
        joinRoom(convId);

        // Fetch messages
        const msgRes = await fetch(`/api/chat?action=messages&conversationId=${convId}&limit=50`);
        const msgData = await msgRes.json();
        setMessages(msgData.messages || []);

        // Fetch participants
        const partRes = await fetch(`/api/chat?action=participants&conversationId=${convId}`);
        const partData = await partRes.json();
        setParticipants(partData.participants || []);

        // Mark as read
        await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'mark-read', conversationId: convId, userId: profile.id }),
        });
      } else {
        // Chat tables might not exist yet - fetch setup info
        setConversationId(null);
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
          // Ignore setup check errors
        }
      }
    } catch (err) {
      console.error('Init conversation error:', err);
    } finally {
      setLoading(false);
    }
  }, [subjectId, profile.id, role, joinRoom]);

  // -------------------------------------------------------
  // Backup polling — only when socket is disconnected
  // -------------------------------------------------------
  const pollMessages = useCallback(async () => {
    const convId = conversationIdRef.current;
    if (!convId) return;

    try {
      const res = await fetch(`/api/chat?action=messages&conversationId=${convId}&limit=50`);
      if (!res.ok) return;
      const data = await res.json();
      const serverMessages: ChatMessage[] = data.messages || [];

      setMessages((prev) => {
        const newFromServer = serverMessages.filter((m) => !prev.some((existing) => existing.id === m.id));
        if (newFromServer.length === 0) return prev;

        const seen = new Set<string>();
        return [...prev, ...newFromServer]
          .filter((m) => {
            if (seen.has(m.id)) return false;
            seen.add(m.id);
            return true;
          })
          .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      });
    } catch (err) {
      console.error('Poll messages error:', err);
    }
  }, []);

  // Backup polling — always poll every 10s as fallback, more frequently when disconnected
  useEffect(() => {
    if (!conversationId) return;

    // Fast poll when disconnected, slow poll as backup when connected
    const interval = setInterval(pollMessages, isConnected ? 15000 : 5000);
    return () => clearInterval(interval);
  }, [isConnected, conversationId, pollMessages]);

  // -------------------------------------------------------
  // Socket event listeners via useSocketEvent
  // (auto-cleanup, always uses latest handler via refs)
  // -------------------------------------------------------

  // ─── New message (from room broadcast) ───
  useSocketEvent<ChatMessage>('new-message', (msg) => {
    const msgConvId = msg.conversationId || (msg as Record<string, unknown>).conversation_id as string;
    const currentConvId = conversationIdRef.current;

    if (msgConvId === currentConvId) {
      setMessages((prev) => {
        // Check if we already have this message (by ID)
        if (prev.some((m) => m.id === msg.id)) return prev;
        // Check if this is the server version of our optimistic message
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
          ).sort(
            (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
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
        return [...prev, msg].sort(
          (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        );
      });
      // Auto mark-as-read since we're viewing this conversation
      if (msg.sender_id !== profile.id && currentConvId) {
        fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'mark-read', conversationId: currentConvId, userId: profile.id }),
        }).catch(() => {});
      }
    }
  });

  // ─── Chat notification (direct delivery fallback) ───
  useSocketEvent<{
    conversationId: string;
    message: ChatMessage;
    senderName: string;
    content: string;
  }>('chat-notification', (data) => {
    const currentConvId = conversationIdRef.current;
    if (data.conversationId === currentConvId) {
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
          ).sort(
            (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
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
        return [...prev, data.message].sort(
          (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        );
      });
      // Auto mark-as-read since we're viewing this conversation
      if (data.message.sender_id !== profile.id && currentConvId) {
        fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'mark-read', conversationId: currentConvId, userId: profile.id }),
        }).catch(() => {});
      }
    } else {
      // Show toast notification for messages in other conversations
      toast(`رسالة جديدة من ${data.senderName}`, {
        description: data.content.substring(0, 60) + (data.content.length > 60 ? '...' : ''),
        icon: <Bell className="h-4 w-4 text-emerald-600" />,
        duration: 5000,
      });
    }
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

  // ─── User typing ───
  useSocketEvent<{ conversationId: string; userId: string; userName: string }>('user-typing', (data) => {
    if (data.conversationId === conversationIdRef.current && data.userId !== profile.id) {
      setTypingUsers((prev) => new Map(prev).set(data.userId, data.userName));
      // Clear after 3 seconds
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

  // ─── User stop typing ───
  useSocketEvent<{ conversationId: string; userId: string }>('user-stop-typing', (data) => {
    if (data.conversationId === conversationIdRef.current) {
      setTypingUsers((prev) => {
        const next = new Map(prev);
        next.delete(data.userId);
        return next;
      });
    }
  });

  // Initialize status store
  useEffect(() => {
    initStatusStore();
  }, [initStatusStore]);

  // ─── Online users tracking now handled by status store ───

  // -------------------------------------------------------
  // Initialize on mount
  // -------------------------------------------------------
  useEffect(() => {
    initConversation();
  }, [initConversation]);

  // -------------------------------------------------------
  // Auto-scroll to bottom
  // -------------------------------------------------------
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, typingUsers]);

  // -------------------------------------------------------
  // Close message menu on outside click
  // -------------------------------------------------------
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (messageMenuRef.current && !messageMenuRef.current.contains(e.target as Node)) {
        setMessageMenuId(null);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // -------------------------------------------------------
  // Send message
  // -------------------------------------------------------
  const handleSend = async () => {
    const content = newMessage.trim();
    if (!content || !conversationId || sending) return;

    setSending(true);
    const tempId = `temp-${Date.now()}`;

    // Optimistic: add message immediately
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

    // Emit via Socket.io for real-time
    // Get participant IDs for direct delivery to recipients
    const participantIds = participants.map(p => p.user_id);

    socket?.emit('send-message', {
      conversationId,
      senderId: profile.id,
      senderName: profile.name,
      content,
      tempId,
      participantIds,
    });

    // Save to database
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'send-message',
          conversationId,
          senderId: profile.id,
          content,
        }),
      });
      const data = await res.json();

      // Replace optimistic message with real one
      if (data.message?.id) {
        setMessages((prev) =>
          prev.map((m) => m.id === tempId ? { ...m, id: data.message.id } : m)
        );
      }
    } catch (err) {
      console.error('Send message error:', err);
      toast.error('فشل إرسال الرسالة');
      // Remove optimistic message on error
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      setNewMessage(content);
    } finally {
      setSending(false);
    }
  };

  // -------------------------------------------------------
  // Delete message
  // -------------------------------------------------------
  const handleDeleteMessage = async (msgId: string) => {
    setMessageMenuId(null);
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'delete-message',
          messageId: msgId,
          userId: profile.id,
        }),
      });
      const data = await res.json();
      if (data.error) {
        toast.error(data.error);
        return;
      }
      // Optimistic update
      setMessages((prev) =>
        prev.map((m) =>
          m.id === msgId ? { ...m, content: 'تم حذف هذه الرسالة', is_deleted: true } : m
        )
      );
      // Notify via socket
      socket?.emit('message-deleted', {
        conversationId,
        messageId: msgId,
      });
    } catch (err) {
      console.error('Delete message error:', err);
      toast.error('فشل حذف الرسالة');
    }
  };

  // -------------------------------------------------------
  // Edit message
  // -------------------------------------------------------
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
        body: JSON.stringify({
          action: 'edit-message',
          messageId: msgId,
          userId: profile.id,
          content: trimmed,
        }),
      });
      const data = await res.json();
      if (data.error) {
        toast.error(data.error);
        return;
      }
      // Optimistic update
      setMessages((prev) =>
        prev.map((m) =>
          m.id === msgId ? { ...m, content: trimmed, is_edited: true, edited_at: new Date().toISOString() } : m
        )
      );
      // Notify via socket
      socket?.emit('message-updated', {
        conversationId,
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

  // -------------------------------------------------------
  // Handle typing
  // -------------------------------------------------------
  const handleTyping = (value: string) => {
    setNewMessage(value);
    if (socket && conversationId) {
      if (value.trim()) {
        socket.emit('typing', {
          conversationId,
          userId: profile.id,
          userName: profile.name,
        });
      } else {
        socket.emit('stop-typing', {
          conversationId,
          userId: profile.id,
        });
      }
    }
  };

  // -------------------------------------------------------
  // Render message bubble — OWN messages LEFT, others RIGHT
  // -------------------------------------------------------
  const renderMessage = (msg: ChatMessage, index: number) => {
    const isOwn = msg.sender_id === profile.id;
    const senderName = formatNameWithTitle(msg.sender?.name || 'مستخدم', msg.sender?.role, msg.sender?.title_id, msg.sender?.gender);
    const showAvatar = !isOwn && (index === 0 || messages[index - 1]?.sender_id !== msg.sender_id);
    const isDeleted = (msg as Record<string, unknown>).is_deleted as boolean;
    const isEdited = (msg as Record<string, unknown>).is_edited as boolean;
    const isEditing = editingMessageId === msg.id;
    const isMenuOpen = messageMenuId === msg.id;

    return (
      <motion.div
        key={msg.id}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        className={`flex gap-2.5 ${isOwn ? 'flex-row' : 'flex-row-reverse'} items-end group`}
      >
        {/* Avatar */}
        {!isOwn && (
          <div className="shrink-0 w-8">
            {showAvatar ? (
              <UserAvatar name={senderName} avatarUrl={msg.sender?.avatar_url} size="sm" />
            ) : (
              <div className="w-8" />
            )}
          </div>
        )}

        {/* Message bubble */}
        <div className={`max-w-[75%] ${isOwn ? 'items-start' : 'items-end'} flex flex-col relative`}>
          {/* Sender name (for others) */}
          {!isOwn && showAvatar && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); openProfile(msg.sender_id); }}
              className="text-[11px] text-muted-foreground mb-1 ml-1 font-medium hover:text-emerald-600 transition-colors"
            >
              {senderName}
            </button>
          )}

          {/* Editing mode */}
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
            <div
              className={`rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed shadow-sm ${
                isDeleted
                  ? 'bg-muted/50 text-muted-foreground italic rounded-bl-md rounded-br-md'
                  : isOwn
                    ? 'bg-emerald-600 text-white rounded-bl-md'
                    : 'bg-muted text-foreground rounded-br-md'
              }`}
            >
              {isDeleted ? (
                <span className="flex items-center gap-1.5">
                  <Trash2 className="h-3.5 w-3.5" />
                  تم حذف هذه الرسالة
                </span>
              ) : (
                msg.content
              )}
            </div>
          )}

          {/* Time + edited indicator */}
          <div className={`flex items-center gap-1.5 mt-1 ${isOwn ? 'mr-1' : 'ml-1'}`}>
            <span className="text-[10px] text-muted-foreground/60">
              {relativeTime(msg.created_at)}
            </span>
            {isEdited && !isDeleted && (
              <span className="text-[10px] text-emerald-500/70 font-medium">
                {msg.edited_at ? `(معدّلة ${relativeTime(msg.edited_at)})` : '(معدّلة)'}
              </span>
            )}
          </div>

          {/* Message actions for own messages */}
          {isOwn && !isDeleted && !isEditing && (
            <div className={`absolute ${isOwn ? '-left-1' : '-right-1'} top-0 opacity-0 group-hover:opacity-100 transition-opacity`}>
              <div className="relative" ref={isMenuOpen ? messageMenuRef : null}>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setMessageMenuId(isMenuOpen ? null : msg.id);
                  }}
                  className="flex h-6 w-6 items-center justify-center rounded-full bg-muted/80 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors shadow-sm"
                >
                  <span className="text-xs leading-none">⋯</span>
                </button>
                
                <AnimatePresence>
                  {isMenuOpen && (
                    <motion.div
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.9 }}
                      transition={{ duration: 0.15 }}
                      className={`absolute ${isOwn ? 'left-0' : 'right-0'} top-7 z-20 bg-card border rounded-xl shadow-lg py-1 min-w-[120px]`}
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
      </motion.div>
    );
  };

  // -------------------------------------------------------
  // Loading state
  // -------------------------------------------------------
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
        <p className="text-sm text-muted-foreground">جاري تحميل المحادثة...</p>
      </div>
    );
  }

  // -------------------------------------------------------
  // No conversation (tables not set up)
  // -------------------------------------------------------
  if (!conversationId) {
    return (
      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        className="flex flex-col items-center justify-center py-20"
      >
        <motion.div variants={itemVariants} className="flex flex-col items-center text-center">
          <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-emerald-50 border border-emerald-100 mb-5">
            <MessageCircle className="h-10 w-10 text-emerald-400" />
          </div>
          <h3 className="text-lg font-bold text-foreground mb-2">المحادثة الجماعية</h3>
          <p className="text-sm text-muted-foreground max-w-sm leading-relaxed">
            محادثة جماعية لكل المسجلين في مقرر &quot;{subject.name}&quot;
          </p>
          {setupInfo ? (
            <div className="mt-5 max-w-sm w-full space-y-3">
              <div className="rounded-xl border bg-amber-50 border-amber-200 p-4 text-right">
                <p className="text-sm font-semibold text-amber-800 mb-2">⚠️ جداول المحادثات لسه متعملتش</p>
                <p className="text-xs text-amber-700 mb-3">لازم تشغّل SQL في Supabase عشان المحادثات تشتغل</p>
                {setupInfo.steps && (
                  <ol className="text-xs text-amber-700 space-y-1.5 mb-3">
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
                    className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-2 text-xs font-medium text-white hover:bg-amber-700 transition-colors"
                  >
                    فتح SQL Editor في Supabase
                  </a>
                )}
              </div>
              <button
                onClick={() => initConversation()}
                className="text-xs text-emerald-600 hover:text-emerald-700 font-medium transition-colors"
              >
                إعادة المحاولة ←
              </button>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground/60 mt-3">
              جاري التحقق من إعداد المحادثات...
            </p>
          )}
        </motion.div>
      </motion.div>
    );
  }

  // -------------------------------------------------------
  // Main chat UI
  // -------------------------------------------------------
  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="flex flex-col h-[calc(100vh-16rem)] min-h-[400px]"
    >
      {/* Header */}
      <motion.div variants={itemVariants} className="shrink-0 flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-100">
            <Hash className="h-5 w-5 text-emerald-600" />
          </div>
          <div>
            <h3 className="text-base font-bold text-foreground">محادثة المقرر</h3>
            <p className="text-xs text-muted-foreground flex items-center gap-1.5">
              <Users className="h-3 w-3" />
              {participants.length} مشارك
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {!isConnected && (
            <WifiOff className="h-3 w-3 text-amber-500" />
          )}
          <div className={`h-2 w-2 rounded-full ${isConnected ? 'bg-emerald-500' : 'bg-rose-400'}`} />
          <span className="text-[10px] text-muted-foreground">
            {isConnected ? 'متصل' : 'غير متصل'}
          </span>
        </div>
      </motion.div>

      {/* Messages area */}
      <div className="flex-1 min-h-0 overflow-y-auto rounded-xl border bg-card/50 p-4 space-y-3 scrollbar-thin">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center py-10">
            <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-br from-emerald-50 to-emerald-100 border border-emerald-200/50 mb-5 shadow-sm">
              <MessageCircle className="h-10 w-10 text-emerald-500" />
            </div>
            <h4 className="text-base font-bold text-foreground mb-1.5">ابدأ المحادثة!</h4>
            <p className="text-sm text-muted-foreground max-w-[250px] leading-relaxed">
              كن أول من يرسل رسالة في محادثة مقرر &quot;{subject.name}&quot;
            </p>
            <div className="flex items-center gap-1.5 mt-4 text-xs text-muted-foreground/60">
              <Users className="h-3.5 w-3.5" />
              <span>{participants.length} مشارك في هذه المحادثة</span>
            </div>
          </div>
        ) : (
          <>
            {messages.map((msg, index) => renderMessage(msg, index))}
            <div ref={messagesEndRef} />
          </>
        )}

        {/* Typing indicator */}
        <AnimatePresence>
          {typingUsers.size > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 4 }}
              className="flex items-center gap-2 text-xs text-muted-foreground"
            >
              <div className="flex gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
              <span>
                {Array.from(typingUsers.values()).join('، ')} يكتب...
              </span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Message input - sticky at bottom, raised ~20px */}
      <div className="shrink-0 mt-3 pt-2 flex items-end gap-2 sticky bottom-0 z-10 bg-background pb-5">
        <div className="flex-1 relative">
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
            placeholder="اكتب رسالتك..."
            className="w-full rounded-xl border bg-background px-4 py-3 pr-4 pl-12 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 transition-all"
            dir="rtl"
            disabled={sending}
          />
        </div>
        <button
          onClick={handleSend}
          disabled={!newMessage.trim() || sending}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-600 text-white shadow-sm hover:bg-emerald-700 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
        >
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
        </button>
      </div>
    </motion.div>
  );
}

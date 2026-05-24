'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useSharedSocket, useSocketEvent, joinTypingPresence, leaveTypingPresence, broadcastTypingState, getTypingUsers, onTypingBroadcast } from '@/lib/socket';
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
  Wifi,
  WifiOff,
  RefreshCw,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { RealtimeChannel } from '@supabase/supabase-js';
import { toast } from 'sonner';
import type { UserProfile, Subject, ChatMessage } from '@/lib/types';
import UserAvatar, { formatNameWithTitle } from '@/components/shared/user-avatar';
import { useAppStore } from '@/stores/app-store';
import { useI18n } from '@/lib/i18n/context';

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
  visible: { opacity: 1, y: 0, transition: { duration: 0.3, ease: 'easeOut' as const } },
};

// -------------------------------------------------------
// Relative time helper
// -------------------------------------------------------
function relativeTime(dateStr: string, t: (key: string, params?: Record<string, string | number>) => string, locale: string): string {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return '';
  const diff = Date.now() - date.getTime();
  if (diff < 0) return t('common.justNow');
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return t('common.justNow');
  if (mins < 60) return t('common.minutesAgo', { n: mins });
  const hours = Math.floor(mins / 60);
  if (hours < 24) return t('common.hoursAgo', { n: hours });
  const days = Math.floor(hours / 24);
  if (days < 7) return t('common.daysAgo', { n: days });
  return date.toLocaleDateString(locale, { month: 'short', day: 'numeric' });
}

// -------------------------------------------------------
// Main Component
// -------------------------------------------------------
export default function ChatTab({ profile, role, subjectId, subject }: ChatTabProps) {
  const { t, dir, locale } = useI18n();
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

  // Typing presence refs
  const typingPresenceConvIdRef = useRef<string | null>(null);
  const typingPresencePollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Status store
  const { init: initStatusStore } = useStatusStore();

  // Message edit state
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');

  // Message action menu
  const [messageMenuId, setMessageMenuId] = useState<string | null>(null);

  // Shared socket — replaces local socket creation
  const { socket, status, isConnected, isRealtimeMode, joinRoom } = useSharedSocket();

  // Refs
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const typingTimeoutRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const messageMenuRef = useRef<HTMLDivElement>(null);
  const conversationIdRef = useRef<string | null>(null);
  const realtimeChannelRef = useRef<RealtimeChannel | null>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Keep ref in sync
  useEffect(() => { conversationIdRef.current = conversationId; }, [conversationId]);

  // Re-join room when socket reconnects (critical for real-time delivery)
  useEffect(() => {
    if (isConnected && conversationId) {
      joinRoom(conversationId);
    }
  }, [isConnected, conversationId, joinRoom]);

  // ─── Supabase Realtime: PRIMARY real-time delivery for chat-tab ───
  // This is critical on Vercel where Socket.IO is unavailable
  useEffect(() => {
    if (pollingRef.current) clearInterval(pollingRef.current);

    try {
      if (!realtimeChannelRef.current) {
        const channel = supabase
          .channel('chat-tab-realtime')
          .on(
            'postgres_changes',
            { event: 'INSERT', schema: 'public', table: 'messages' },
            (payload) => {
              const newMsg = payload.new as Record<string, unknown>;
              const convId = (newMsg.conversation_id as string) || null;
              if (!convId || convId !== conversationIdRef.current) return;

              // Skip own messages (already added optimistically)
              if (newMsg.sender_id === profile.id) return;

              // ── FAST PATH: Use Realtime payload directly (no extra HTTP round-trip) ──
              const fastMsg: ChatMessage = {
                id: newMsg.id as string,
                sender_id: newMsg.sender_id as string,
                content: newMsg.content as string,
                created_at: newMsg.created_at as string,
                is_deleted: false,
                is_edited: false,
                sender: null,
              };

              setMessages((prev) => {
                if (prev.some((m) => m.id === fastMsg.id)) return prev;
                const isContentDuplicate = prev.some((m) =>
                  m.sender_id === fastMsg.sender_id &&
                  m.content === fastMsg.content &&
                  Math.abs(new Date(m.created_at).getTime() - new Date(fastMsg.created_at).getTime()) < 10000
                );
                if (isContentDuplicate) return prev;
                return [...prev, fastMsg];
              });

              // ── ASYNC: Enrich with sender info in the background ──
              fetch(`/api/chat?action=messages&conversationId=${convId}&limit=1`)
                .then(r => r.json())
                .then(data => {
                  const serverMessages: ChatMessage[] = data.messages || [];
                  const fullMsg = serverMessages.find(
                    (m: ChatMessage) => m.id === (newMsg.id as string)
                  );
                  if (!fullMsg) return;
                  setMessages((prev) =>
                    prev.map((m) => m.id === fullMsg.id ? fullMsg : m)
                  );
                })
                .catch(() => {});
            }
          )
          .on(
            'postgres_changes',
            { event: 'UPDATE', schema: 'public', table: 'messages' },
            (payload) => {
              const updated = payload.new as Record<string, unknown>;
              const msgId = updated.id as string;
              if (!msgId) return;

              setMessages((prev) =>
                prev.map((m) => {
                  if (m.id !== msgId) return m;
                  return {
                    ...m,
                    content: (updated.content as string) || m.content,
                    is_edited: (updated.is_edited as boolean) ?? m.is_edited,
                    is_deleted: (updated.is_deleted as boolean) ?? m.is_deleted,
                    edited_at: (updated.edited_at as string) || m.edited_at,
                  };
                })
              );
            }
          )
          .subscribe((subStatus) => {
            console.log('[Chat Tab Realtime] subscription status:', subStatus);
          });

        realtimeChannelRef.current = channel;
      }
    } catch (err) {
      console.error('[Chat Tab Realtime] setup error:', err);
    }

    // Polling backup
    if (!isConnected) {
      pollingRef.current = setInterval(() => {
        if (conversationIdRef.current) {
          fetch(`/api/chat?action=messages&conversationId=${conversationIdRef.current}&limit=50`)
            .then(r => r.json())
            .then(data => {
              if (data.messages) setMessages(data.messages);
            })
            .catch(() => {});
        }
      }, 8000);
    }

    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
      if (realtimeChannelRef.current) {
        try {
          supabase.removeChannel(realtimeChannelRef.current);
        } catch { /* Ignore */ }
        realtimeChannelRef.current = null;
      }
    };
  }, [isConnected, profile.id]);

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

  // ─── Helper: normalize incoming socket message to ChatMessage shape ───
  const normalizeSocketMsg = useCallback((raw: Record<string, unknown>): ChatMessage => {
    const senderId = (raw.sender_id as string) || (raw.senderId as string) || '';
    const convId = (raw.conversation_id as string) || (raw.conversationId as string) || '';
    const createdAt = (raw.created_at as string) || (raw.createdAt as string) || new Date().toISOString();
    const senderObj = raw.sender as ChatMessage['sender'] | undefined;
    const senderName = (raw.sender_name as string) || (raw.senderName as string) || '';

    return {
      id: (raw.id as string) || '',
      sender_id: senderId,
      content: (raw.content as string) || '',
      created_at: createdAt,
      is_deleted: (raw.is_deleted as boolean) ?? false,
      is_edited: (raw.is_edited as boolean) ?? false,
      edited_at: (raw.edited_at as string) || undefined,
      sender: senderObj || (senderName ? { id: senderId, name: senderName } : null),
      conversation_id: convId,
      conversationId: convId,
    } as ChatMessage;
  }, []);

  // ─── New message (from room broadcast) ───
  useSocketEvent<Record<string, unknown>>('new-message', (rawMsg) => {
    try {
      const msg = normalizeSocketMsg(rawMsg);
      const msgConvId = msg.conversation_id || msg.conversationId;
      const currentConvId = conversationIdRef.current;

      if (msgConvId === currentConvId) {
        setMessages((prev) => {
          // Check if we already have this message (by ID)
          if (prev.some((m) => m.id === msg.id && !m.id.startsWith('temp-'))) return prev;
          // Check if this is the server version of our optimistic message
          const isDuplicate = prev.some((m) =>
            m.id.startsWith('temp-') &&
            m.sender_id === msg.sender_id &&
            m.content === msg.content &&
            Date.now() - new Date(m.created_at).getTime() < 10000
          );
          if (isDuplicate) {
            return prev.map((m) =>
              m.id.startsWith('temp-') && m.sender_id === msg.sender_id && m.content === msg.content
                ? msg
                : m
            ).sort(
              (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
            );
          }
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
    } catch (err) {
      console.error('[Socket] new-message handler error (chat-tab):', err);
    }
  });

  // ─── Chat notification (direct delivery fallback) ───
  useSocketEvent<Record<string, unknown>>('chat-notification', (data) => {
    try {
      const currentConvId = conversationIdRef.current;
      const convId = (data.conversationId as string) || (data.conversation_id as string) || '';

      // Build a ChatMessage from either data.message or the top-level fields
      let msg: ChatMessage;
      if (data.message && typeof data.message === 'object') {
        msg = normalizeSocketMsg(data.message as Record<string, unknown>);
      } else {
        msg = normalizeSocketMsg(data as Record<string, unknown>);
      }

      if (convId === currentConvId) {
        setMessages((prev) => {
          // Check if we already have this message (by ID)
          if (prev.some((m) => m.id === msg.id && !m.id.startsWith('temp-'))) return prev;
          // Check if this is the server version of our optimistic message
          const isDuplicate = prev.some((m) =>
            m.id.startsWith('temp-') &&
            m.sender_id === msg.sender_id &&
            m.content === msg.content &&
            Date.now() - new Date(m.created_at).getTime() < 10000
          );
          if (isDuplicate) {
            return prev.map((m) =>
              m.id.startsWith('temp-') && m.sender_id === msg.sender_id && m.content === msg.content
                ? msg
                : m
            ).sort(
              (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
            );
          }
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
      } else {
        // Show toast notification for messages in other conversations
        const senderName = (data.senderName as string) || msg.sender?.name || t('common.user');
        const content = (data.content as string) || msg.content || '';
        toast(t('chat.newMessageFrom', { name: senderName }), {
          description: content.substring(0, 60) + (content.length > 60 ? '...' : ''),
          icon: <Bell className="h-4 w-4 text-sky-700 dark:text-sky-300" />,
          duration: 5000,
        });
      }
    } catch (err) {
      console.error('[Socket] chat-notification handler error (chat-tab):', err);
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
          ? { ...m, content: t('chat.messageDeleted'), is_deleted: true }
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

  // Initialize status store + typing presence when conversation is ready
  useEffect(() => {
    initStatusStore();
  }, [initStatusStore]);

  // ─── Setup typing presence when conversationId is available ───
  useEffect(() => {
    if (!conversationId) return;

    // Join Supabase Presence + Broadcast channel for typing indicators
    const presenceConvId = joinTypingPresence(conversationId, profile.id, profile.name);
    typingPresenceConvIdRef.current = presenceConvId;

    if (typingPresencePollRef.current) clearInterval(typingPresencePollRef.current);
    if (presenceConvId) {
      // ── PRIMARY: Listen for instant typing broadcasts ──
      const unsubBroadcast = onTypingBroadcast(conversationId, (data) => {
        if (data.userId === profile.id) return;
        if (data.conversationId !== conversationId) return;

        if (data.isTyping) {
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
        } else {
          setTypingUsers((prev) => {
            const next = new Map(prev);
            next.delete(data.userId);
            return next;
          });
          const existing = typingTimeoutRef.current.get(data.userId);
          if (existing) clearTimeout(existing);
          typingTimeoutRef.current.delete(data.userId);
        }
      });

      // ── BACKUP: Poll presence state every 3 seconds ──
      typingPresencePollRef.current = setInterval(() => {
        const typing = getTypingUsers(conversationId, profile.id);
        setTypingUsers((prev) => {
          const next = new Map<string, string>();
          for (const t of typing) {
            next.set(t.userId, t.userName);
          }
          for (const [key, value] of prev) {
            if (!next.has(key) && typingTimeoutRef.current.has(key)) {
              next.set(key, value);
            }
          }
          return next;
        });
      }, 3000); // Slower polling since broadcast is primary now
    }

    return () => {
      if (typingPresencePollRef.current) clearInterval(typingPresencePollRef.current);
      leaveTypingPresence(conversationId);
    };
  }, [conversationId, profile.id, profile.name]);

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

    if (socket?.connected) {
      socket.emit('send-message', {
        conversationId,
        senderId: profile.id,
        senderName: profile.name,
        content,
        tempId,
        messageId: tempId,     // explicit messageId for server
        participantIds,
        createdAt: optimisticMsg.created_at,
      });
    }

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
      toast.error(t('chat.toastSendFailed'));
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
          m.id === msgId ? { ...m, content: t('chat.messageDeleted'), is_deleted: true } : m
        )
      );
      // Notify via socket
      if (socket?.connected) {
        socket.emit('message-deleted', {
          conversationId,
          messageId: msgId,
        });
      }
    } catch (err) {
      console.error('Delete message error:', err);
      toast.error(t('chat.toastDeleteFailed'));
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
      if (socket?.connected) {
        socket.emit('message-updated', {
          conversationId,
          messageId: msgId,
          content: trimmed,
          isEdited: true,
          editedAt: new Date().toISOString(),
        });
      }
      setEditingMessageId(null);
      setEditContent('');
    } catch (err) {
      console.error('Edit message error:', err);
      toast.error(t('chat.toastEditFailed'));
    }
  };

  // -------------------------------------------------------
  // Handle typing (with debounce to avoid rate limiting)
  // -------------------------------------------------------
  const typingDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleTyping = (value: string) => {
    setNewMessage(value);
    if (conversationId) {
      if (value.trim()) {
        // Socket.IO first (no rate limit)
        if (socket?.connected) {
          socket.emit('typing', {
            conversationId,
            userId: profile.id,
            userName: profile.name,
          });
        }
        // Supabase: debounce to avoid rate limiting
        if (typingDebounceRef.current) clearTimeout(typingDebounceRef.current);
        typingDebounceRef.current = setTimeout(() => {
          broadcastTypingState(conversationId!, profile.id, profile.name, true);
        }, 300);
      } else {
        if (typingDebounceRef.current) clearTimeout(typingDebounceRef.current);
        if (socket?.connected) {
          socket.emit('stop-typing', {
            conversationId,
            userId: profile.id,
          });
        }
        broadcastTypingState(conversationId, profile.id, profile.name, false);
      }
    }
  };

  // -------------------------------------------------------
  // Render message bubble — OWN messages LEFT, others RIGHT
  // -------------------------------------------------------
  const renderMessage = (msg: ChatMessage, index: number) => {
    const isOwn = msg.sender_id === profile.id;
    const senderName = formatNameWithTitle(msg.sender?.name || t('common.user'), msg.sender?.role, msg.sender?.title_id, msg.sender?.gender, t);
    const showAvatar = !isOwn && (index === 0 || messages[index - 1]?.sender_id !== msg.sender_id);
    const isDeleted = (msg as unknown as Record<string, unknown>).is_deleted as boolean;
    const isEdited = (msg as unknown as Record<string, unknown>).is_edited as boolean;
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
              className="text-[11px] text-muted-foreground mb-1 me-1 font-medium hover:text-sky-700 transition-colors"
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
                className="rounded-xl border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-sky-600/30 focus:border-sky-600 transition-all"
                dir={dir}
                autoFocus
              />
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => handleSaveEdit(msg.id)}
                  className="flex h-7 w-7 items-center justify-center rounded-lg bg-sky-700 text-white hover:bg-sky-800 transition-colors"
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
                    ? 'bg-sky-700 text-white rounded-bl-md'
                    : 'bg-muted text-foreground rounded-br-md'
              }`}
            >
              {isDeleted ? (
                <span className="flex items-center gap-1.5">
                  <Trash2 className="h-3.5 w-3.5" />
                  {t('chat.messageDeleted')}
                </span>
              ) : (
                msg.content
              )}
            </div>
          )}

          {/* Time + edited indicator */}
          <div className={`flex items-center gap-1.5 mt-1 ${isOwn ? 'ms-1' : 'me-1'}`}>
            <span className="text-[10px] text-muted-foreground/60">
              {relativeTime(msg.created_at, t, locale)}
            </span>
            {isEdited && !isDeleted && (
              <span className="text-[10px] text-sky-600/70 font-medium">
                {msg.edited_at ? t('chat.editedWithTime', { time: relativeTime(msg.edited_at, t, locale) }) : t('chat.edited')}
              </span>
            )}
          </div>

          {/* Message actions for own messages */}
          {isOwn && !isDeleted && !isEditing && (
            <div className={`absolute ${isOwn ? '-start-1' : '-end-1'} top-0 opacity-0 group-hover:opacity-100 transition-opacity`}>
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
                      exit={{ opacity: 0, scale: 0.9, pointerEvents: 'none' as const }}
                      transition={{ duration: 0.15 }}
                      className={`absolute ${isOwn ? 'start-0' : 'end-0'} top-7 z-20 bg-card border rounded-xl shadow-lg py-1 min-w-[120px]`}
                    >
                      <button
                        onClick={() => handleStartEdit(msg)}
                        className="w-full flex items-center gap-2 px-3 py-2 text-xs text-foreground hover:bg-muted/50 transition-colors text-end"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        {t('common.edit')}
                      </button>
                      <button
                        onClick={() => handleDeleteMessage(msg.id)}
                        className="w-full flex items-center gap-2 px-3 py-2 text-xs text-red-600 hover:bg-red-50 transition-colors text-end"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        {t('common.delete')}
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
        <Loader2 className="h-8 w-8 animate-spin text-sky-700 dark:text-sky-300" />
        <p className="text-sm text-muted-foreground">{t('chat.loadingChat')}</p>
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
          <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-sky-50 dark:bg-sky-950/30 border border-sky-100 mb-5">
            <MessageCircle className="h-10 w-10 text-sky-400" />
          </div>
          <h3 className="text-lg font-bold text-foreground mb-2">{t('chat.title')}</h3>
          <p className="text-sm text-muted-foreground max-w-sm leading-relaxed">
            {t('chat.groupChatDesc', { name: subject.name })}
          </p>
          {setupInfo ? (
            <div className="mt-5 max-w-sm w-full space-y-3">
              <div className="rounded-xl border bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800 p-4 text-end">
                <p className="text-sm font-semibold text-amber-800 dark:text-amber-200 mb-2">{t('chat.chatTablesNotExist')}</p>
                <p className="text-xs text-amber-700 dark:text-amber-300 mb-3">{t('chat.chatTablesHint')}</p>
                {setupInfo.steps && (
                  <ol className="text-xs text-amber-700 dark:text-amber-300 space-y-1.5 mb-3">
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
                    {t('chat.openSqlEditor')}
                  </a>
                )}
              </div>
              <button
                onClick={() => initConversation()}
                className="text-xs text-sky-700 dark:text-sky-300 hover:text-sky-800 font-medium transition-colors"
              >
                {t('chat.retrySetup')}
              </button>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground/60 mt-3">
              {t('chat.checkingSetup')}
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
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-100 dark:bg-sky-900/50">
            <Hash className="h-5 w-5 text-sky-700 dark:text-sky-300" />
          </div>
          <div>
            <h3 className="text-base font-bold text-foreground">{t('chat.courseChat')}</h3>
            <p className="text-xs text-muted-foreground flex items-center gap-1.5">
              <Users className="h-3 w-3" />
              {t('chat.participantCount', { count: participants.length })}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {status === 'connecting' && (
            <RefreshCw className="h-3 w-3 text-amber-500 animate-spin" />
          )}
          {status === 'disconnected' && (
            <WifiOff className="h-3 w-3 text-rose-400" />
          )}
          <div className={`h-2 w-2 rounded-full ${
            status === 'connected' || status === 'realtime' ? 'bg-sky-600'
              : status === 'connecting' ? 'bg-amber-400 animate-pulse'
              : 'bg-rose-400'
          }`} />
          <span className="text-[10px] text-muted-foreground">
            {status === 'connected' || status === 'realtime' ? t('chat.connected')
              : status === 'connecting' ? t('chat.connecting')
              : t('chat.disconnected')}
          </span>
        </div>
      </motion.div>

      {/* Messages area */}
      <div className="flex-1 min-h-0 overflow-y-auto rounded-xl border bg-card/50 p-4 space-y-3 scrollbar-thin">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center py-10">
            <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-br from-sky-50 to-sky-100 border border-sky-200/50 mb-5 shadow-sm">
              <MessageCircle className="h-10 w-10 text-sky-600 dark:text-sky-400" />
            </div>
            <h4 className="text-base font-bold text-foreground mb-1.5">{t('chat.startConversation')}</h4>
            <p className="text-sm text-muted-foreground max-w-[250px] leading-relaxed">
              {t('chat.beFirstToSend', { name: subject.name })}
            </p>
            <div className="flex items-center gap-1.5 mt-4 text-xs text-muted-foreground/60">
              <Users className="h-3.5 w-3.5" />
              <span>{t('chat.participantsInChat', { count: participants.length })}</span>
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
              exit={{ opacity: 0, y: 4, pointerEvents: 'none' as const }}
              className="flex items-center gap-2 px-3 py-2 rounded-lg bg-sky-50/80 dark:bg-sky-950/30 border border-sky-100"
            >
              <div className="flex gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-sky-600 animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-1.5 h-1.5 rounded-full bg-sky-600 animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-1.5 h-1.5 rounded-full bg-sky-600 animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
              <span className="text-xs text-sky-800 dark:text-sky-200 font-medium">
                {t('chat.typingNow', { names: Array.from(typingUsers.values()).join(t('common.listSeparator')) })}
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
            placeholder={t('chat.placeholder')}
            className="w-full rounded-xl border bg-background px-4 py-3 pe-4 ps-12 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-sky-600/30 focus:border-sky-600 transition-all"
            dir={dir}
            disabled={sending}
          />
        </div>
        <button
          onClick={handleSend}
          disabled={!newMessage.trim() || sending}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-sky-700 text-white shadow-sm hover:bg-sky-800 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
        >
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
        </button>
      </div>
    </motion.div>
  );
}

'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useSharedSocket, useSocketEvent, joinTypingPresence, leaveTypingPresence, broadcastTypingState, getTypingUsers, onTypingBroadcast, type TypingPresenceState } from '@/lib/socket';
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
import { RealtimeChannel } from '@supabase/supabase-js';
import { toast } from 'sonner';
import type { UserProfile, Conversation, ChatMessage, UserStatus } from '@/lib/types';
import UserAvatar, { formatNameWithTitle } from '@/components/shared/user-avatar';
import ReportButton from '@/components/reports/report-button';
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
import { useI18n } from '@/lib/i18n/context';

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
  visible: { opacity: 1, y: 0, transition: { duration: 0.25, ease: 'easeOut' as const } },
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
      ? `${names[0]} يكتب الآن`
      : names.length === 2
        ? `${names[0]} و ${names[1]} يكتبان الآن`
        : `${names[0]} وآخرون يكتبون الآن`;

  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-sky-50/80 border border-sky-100">
      <div className="flex items-center gap-1">
        <span className="h-1.5 w-1.5 rounded-full bg-sky-600 animate-bounce" style={{ animationDelay: '0ms' }} />
        <span className="h-1.5 w-1.5 rounded-full bg-sky-600 animate-bounce" style={{ animationDelay: '150ms' }} />
        <span className="h-1.5 w-1.5 rounded-full bg-sky-600 animate-bounce" style={{ animationDelay: '300ms' }} />
      </div>
      <span className="text-xs text-sky-800 font-medium">{label}...</span>
    </div>
  );
}

// =====================================================
// Main Component
// =====================================================
export default function ChatSection({ profile, role }: ChatSectionProps) {
  const { t, dir } = useI18n();
  // ─── Shared socket ───
  const { socket, status, isConnected, isRealtimeMode, joinRoom, leaveRoom, joinAllRooms } = useSharedSocket();
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

  // ─── Locally hidden/deleted conversation IDs (to suppress notifications) ───
  const hiddenConvIdsRef = useRef<Set<string>>(new Set());

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
  const typingPresenceConvIdRef = useRef<string | null>(null);
  const typingPresencePollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const messageMenuRef = useRef<HTMLDivElement>(null);
  const activeConvIdRef = useRef<string | null>(null);
  const conversationsRef = useRef<Conversation[]>([]);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const backupPollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const convPollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastPollTimeRef = useRef<number>(0);
  const realtimeChannelRef = useRef<RealtimeChannel | null>(null);
  const convRealtimeChannelRef = useRef<RealtimeChannel | null>(null);

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

      // Clean up hidden conversation IDs that are now visible again
      // (e.g., the other user sent a message, reviving the conversation)
      const visibleConvIds = new Set((data.conversations || []).map((c: Conversation) => c.id));
      const archivedConvIds = new Set((data.archivedConversations || []).map((c: Conversation) => c.id));
      for (const hiddenId of hiddenConvIdsRef.current) {
        if (visibleConvIds.has(hiddenId) || archivedConvIds.has(hiddenId)) {
          hiddenConvIdsRef.current.delete(hiddenId);
        }
      }

      return data.conversations || [];
    } catch (err) {
      console.error('Fetch conversations error:', err);
      setConvFetchError('فشل تحميل المحادثات');
      return [];
    } finally {
      setLoading(false);
    }
  }, [profile.id]);

  // ─── Debounced conversation refresh ───
  // Prevents multiple rapid fetchConversations calls (e.g. from multiple Realtime events)
  const convRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const debouncedFetchConversations = useCallback(() => {
    if (convRefreshTimerRef.current) clearTimeout(convRefreshTimerRef.current);
    convRefreshTimerRef.current = setTimeout(() => {
      fetchConversations();
    }, 1000);
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

  // ─── Supabase Realtime: PRIMARY real-time delivery ───
  // CRITICAL: This subscription is INDEPENDENT of Socket.IO connection state.
  // Previously, it was in the same useEffect as polling (with isConnected/isRealtimeMode
  // in the dependency array). When Socket.IO status changed, the effect re-ran, tearing
  // down the Realtime channel and recreating it — causing message delivery gaps during
  // the transition. Now, the Realtime subscription only depends on profile.id, so it
  // persists across Socket.IO state changes.
  useEffect(() => {
    // ─── Messages channel: INSERT + UPDATE ───
    try {
      if (!realtimeChannelRef.current) {
        const channel = supabase
          .channel('chat-messages-realtime')
          .on(
            'postgres_changes',
            {
              event: 'INSERT',
              schema: 'public',
              table: 'messages',
            },
            (payload) => {
              const newMsg = payload.new as Record<string, unknown>;
              const convId = (newMsg.conversation_id as string) || null;
              if (!convId) return;

              // Skip our own messages (already handled optimistically)
              if (newMsg.sender_id === profile.id) return;

              const currentActiveId = activeConvIdRef.current;

              // ── FAST PATH: Use the Realtime payload directly ──
              const fastMsg: ChatMessage = {
                id: newMsg.id as string,
                sender_id: newMsg.sender_id as string,
                content: newMsg.content as string,
                created_at: newMsg.created_at as string,
                is_deleted: false,
                is_edited: false,
                sender: null,
              };

              if (convId === currentActiveId) {
                setMessages((prev) => {
                  if (prev.some((m) => m.id === fastMsg.id)) return prev;
                  const isDuplicate = prev.some((m) =>
                    m.id.startsWith('temp-') &&
                    m.sender_id === fastMsg.sender_id &&
                    m.content === fastMsg.content &&
                    Date.now() - new Date(m.created_at).getTime() < 10000
                  );
                  if (isDuplicate) {
                    return prev.map((m) =>
                      m.id.startsWith('temp-') && m.sender_id === fastMsg.sender_id && m.content === fastMsg.content
                        ? fastMsg
                        : m
                    );
                  }
                  const isContentDuplicate = prev.some((m) =>
                    m.id !== fastMsg.id &&
                    m.sender_id === fastMsg.sender_id &&
                    m.content === fastMsg.content &&
                    Math.abs(new Date(m.created_at).getTime() - new Date(fastMsg.created_at).getTime()) < 10000
                  );
                  if (isContentDuplicate) return prev;
                  return [...prev, fastMsg];
                });
                // Mark as read
                fetch('/api/chat', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ action: 'mark-read', conversationId: convId, userId: profile.id }),
                }).catch(() => {});

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
              } else {
                // Message in a different conversation — show toast notification
                if (hiddenConvIdsRef.current.has(convId)) {
                  debouncedFetchConversations();
                  return;
                }
                toast(`رسالة جديدة`, {
                  description: fastMsg.content.substring(0, 60) + (fastMsg.content.length > 60 ? '...' : ''),
                  icon: <Bell className="h-4 w-4 text-sky-700" />,
                  duration: 5000,
                });
                setLocalUnread((prev) => {
                  const next = new Map(prev);
                  next.set(convId, (next.get(convId) || 0) + 1);
                  return next;
                });

                // Enrich toast with sender name asynchronously
                fetch(`/api/chat?action=messages&conversationId=${convId}&limit=1`)
                  .then(r => r.json())
                  .then(data => {
                    const serverMessages: ChatMessage[] = data.messages || [];
                    const fullMsg = serverMessages.find(
                      (m: ChatMessage) => m.id === (newMsg.id as string)
                    );
                    if (fullMsg?.sender?.name) {
                      toast(`رسالة جديدة من ${fullMsg.sender.name}`, {
                        description: fullMsg.content.substring(0, 60) + (fullMsg.content.length > 60 ? '...' : ''),
                        icon: <Bell className="h-4 w-4 text-sky-700" />,
                        duration: 5000,
                        id: `msg-${convId}`,
                      });
                    }
                  })
                  .catch(() => {});
              }
              debouncedFetchConversations();
            }
        )
        // ─── Also listen for message updates (edits/deletes) ───
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'messages',
          },
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
          console.log('[Chat Realtime] subscription status:', subStatus);
          // Auto-reconnect on channel error
          if (subStatus === 'CHANNEL_ERROR' || subStatus === 'TIMED_OUT') {
            console.warn('[Chat Realtime] Channel error, will retry in 3s...');
            setTimeout(() => {
              if (realtimeChannelRef.current) {
                try {
                  supabase.removeChannel(realtimeChannelRef.current);
                } catch { /* ignore */ }
                realtimeChannelRef.current = null;
                // Re-trigger the effect by re-subscribing
                const retryChannel = supabase.channel('chat-messages-realtime');
                // The channel will be fully set up on next mount
                // For now, just clear the ref so the next render recreates it
                realtimeChannelRef.current = null;
              }
            }, 3000);
          }
        });

        realtimeChannelRef.current = channel;
      }
    } catch (err) {
      console.error('[Chat Realtime] setup error:', err);
    }

    // ─── Supabase Realtime: Listen for new conversations ───
    try {
      if (!convRealtimeChannelRef.current) {
        const convChannel = supabase
          .channel('chat-conversations-realtime')
          .on(
            'postgres_changes',
            {
              event: 'INSERT',
              schema: 'public',
              table: 'conversation_participants',
              filter: `user_id=eq.${profile.id}`,
            },
            () => {
              debouncedFetchConversations();
            }
          )
          .on(
            'postgres_changes',
            {
              event: 'UPDATE',
              schema: 'public',
              table: 'conversation_participants',
              filter: `user_id=eq.${profile.id}`,
            },
            () => {
              debouncedFetchConversations();
            }
          )
          .on(
            'postgres_changes',
            {
              event: 'DELETE',
              schema: 'public',
              table: 'conversation_participants',
            },
            (payload) => {
              const deleted = payload.old as Record<string, unknown>;
              if (deleted?.user_id === profile.id) {
                debouncedFetchConversations();
              }
            }
          )
          .subscribe((subStatus) => {
            console.log('[Chat Conv Realtime] subscription status:', subStatus);
          });

        convRealtimeChannelRef.current = convChannel;
      }
    } catch (err) {
      console.error('[Chat Conv Realtime] setup error:', err);
    }

    // Cleanup only on unmount — NOT on Socket.IO state changes
    return () => {
      if (realtimeChannelRef.current) {
        try {
          supabase.removeChannel(realtimeChannelRef.current);
        } catch {
          // Ignore cleanup errors
        }
        realtimeChannelRef.current = null;
      }
      if (convRealtimeChannelRef.current) {
        try {
          supabase.removeChannel(convRealtimeChannelRef.current);
        } catch {
          // Ignore cleanup errors
        }
        convRealtimeChannelRef.current = null;
      }
    };
  // IMPORTANT: Only depend on profile.id — NOT on isConnected/isRealtimeMode
  // This prevents the Realtime subscription from being torn down when Socket.IO state changes
  }, [profile.id, debouncedFetchConversations]);

  // ─── Polling: lightweight backup for reliability ───
  // This is separate from the Realtime subscription so that polling intervals
  // can adjust based on Socket.IO connection state WITHOUT disrupting the
  // persistent Realtime channel.
  useEffect(() => {
    // Clear existing intervals
    if (pollingRef.current) clearInterval(pollingRef.current);
    if (backupPollingRef.current) clearInterval(backupPollingRef.current);
    if (convPollingRef.current) clearInterval(convPollingRef.current);

    // When disconnected: poll messages every 8 seconds
    // In Realtime mode: poll messages every 12 seconds as backup
    // In Socket.IO mode: poll messages every 15 seconds as backup
    if (!isConnected) {
      pollingRef.current = setInterval(pollMessages, 8000);
    } else if (isRealtimeMode) {
      backupPollingRef.current = setInterval(pollMessages, 12000);
    } else {
      backupPollingRef.current = setInterval(pollMessages, 15000);
    }

    // Poll conversations every 15 seconds
    convPollingRef.current = setInterval(fetchConversations, 15000);

    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
      if (backupPollingRef.current) clearInterval(backupPollingRef.current);
      if (convPollingRef.current) clearInterval(convPollingRef.current);
    };
  }, [isConnected, isRealtimeMode, pollMessages, fetchConversations]);

  // =====================================================
  // Initialize status store on mount with userId
  // =====================================================
  useEffect(() => {
    if (profile.id) {
      initStatusStore(profile.id);
    }
  }, [initStatusStore, profile.id]);

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

  // ─── Helper: normalize incoming socket message to ChatMessage shape ───
  // Socket.IO messages may use camelCase (senderId) or snake_case (sender_id).
  // This helper ensures we always have a valid ChatMessage for the UI.
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
      // Keep these for conversation matching convenience
      conversation_id: convId,
      conversationId: convId,
    } as ChatMessage;
  }, []);

  // ─── Helper: add or merge a message into the messages list ───
  const addMessageToList = useCallback((msg: ChatMessage, currentActiveId: string | null) => {
    const convId = msg.conversation_id || (msg as unknown as Record<string, unknown>).conversationId as string;
    if (!convId) return;

    if (convId === currentActiveId) {
      setMessages((prev) => {
        // Already have this exact message? Skip.
        if (prev.some((m) => m.id === msg.id && !m.id.startsWith('temp-'))) return prev;
        // Replace optimistic (temp-) message with the confirmed one
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
          );
        }
        // Skip content-duplicate from same sender within 10s
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
    debouncedFetchConversations();
  }, [profile.id, debouncedFetchConversations]);

  // ─── New message (from room broadcast) ───
  useSocketEvent<Record<string, unknown>>('new-message', (rawMsg) => {
    try {
      const msg = normalizeSocketMsg(rawMsg);
      addMessageToList(msg, activeConvIdRef.current);
    } catch (err) {
      console.error('[Socket] new-message handler error:', err);
      // Fallback: refresh from server
      debouncedFetchConversations();
    }
  });

  // ─── Chat notification (direct delivery, even if not in room) ───
  useSocketEvent<Record<string, unknown>>('chat-notification', (data) => {
    try {
      const currentActiveId = activeConvIdRef.current;
      const convId = (data.conversationId as string) || (data.conversation_id as string) || '';

      // The server sends: { conversationId, message, senderName, content }
      // Build a ChatMessage from either data.message or the top-level fields
      let msg: ChatMessage;
      if (data.message && typeof data.message === 'object') {
        msg = normalizeSocketMsg(data.message as Record<string, unknown>);
      } else {
        // Legacy/fallback: construct from top-level fields
        msg = normalizeSocketMsg(data as Record<string, unknown>);
      }

      if (convId === currentActiveId) {
        addMessageToList(msg, currentActiveId);
      } else {
        // Show toast and increment unread
        const senderName = (data.senderName as string) || msg.sender?.name || 'مستخدم';
        const content = (data.content as string) || msg.content || '';
        toast(`رسالة جديدة من ${senderName}`, {
          description: content.substring(0, 60) + (content.length > 60 ? '...' : ''),
          icon: <Bell className="h-4 w-4 text-sky-700" />,
          duration: 5000,
        });
        setLocalUnread((prev) => {
          const next = new Map(prev);
          next.set(convId, (next.get(convId) || 0) + 1);
          return next;
        });
      }

      debouncedFetchConversations();
    } catch (err) {
      console.error('[Socket] chat-notification handler error:', err);
      debouncedFetchConversations();
    }
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
      icon: <MessageCircle className="h-4 w-4 text-sky-700" />,
      duration: 5000,
    });
    debouncedFetchConversations();
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

    // Remove from hidden set since user is actively opening this conversation
    hiddenConvIdsRef.current.delete(convId);

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

    // ── OPTIMISTIC: Pre-populate messages from conversation list data ──
    // This prevents the "message appears in list but not in chat box" issue
    // by showing the last message immediately before the full HTTP fetch completes.
    const existingConv = conversationsRef.current.find(c => c.id === convId);
    if (existingConv?.lastMessage) {
      const lm = existingConv.lastMessage;
      setMessages([{
        id: lm.id,
        sender_id: lm.sender_id,
        content: lm.content,
        created_at: lm.created_at,
        is_deleted: false,
        is_edited: false,
        sender: null,
      }]);
    } else {
      setMessages([]);
    }

    // Clear local unread for this conversation
    setLocalUnread((prev) => {
      const next = new Map(prev);
      next.delete(convId);
      return next;
    });

    // Join room
    joinRoom(convId);

    // Leave previous typing presence channel
    if (typingPresenceConvIdRef.current) {
      leaveTypingPresence(typingPresenceConvIdRef.current);
    }

    // Join Supabase Presence + Broadcast channel for typing indicators
    const presenceConvId = joinTypingPresence(convId, profile.id, profile.name);
    typingPresenceConvIdRef.current = presenceConvId;

    // ── PRIMARY: Listen for instant typing broadcasts ──
    // This is much faster than polling Presence state (which has ~1-2s latency)
    if (typingPresencePollRef.current) clearInterval(typingPresencePollRef.current);
    if (presenceConvId) {
      // Register broadcast listener for instant typing events
      const unsubBroadcast = onTypingBroadcast(convId, (data) => {
        if (data.userId === profile.id) return;
        if (data.conversationId !== convId) return;

        if (data.isTyping) {
          setTypingUsers((prev) => new Map(prev).set(data.userId, data.userName));
          // Clear after 3 seconds if no new typing event
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
      // This catches typing events that might be missed by broadcast
      typingPresencePollRef.current = setInterval(() => {
        const typing = getTypingUsers(convId, profile.id);
        setTypingUsers((prev) => {
          const next = new Map<string, string>();
          for (const t of typing) {
            next.set(t.userId, t.userName);
          }
          // Preserve any broadcast-based typing users that are still active
          for (const [key, value] of prev) {
            if (!next.has(key)) {
              if (typingTimeoutRef.current.has(key)) {
                next.set(key, value);
              }
            }
          }
          return next;
        });
      }, 3000); // Slower polling since broadcast is primary now
    }

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

    // For pending conversations (before first message), the other participant
    // may not be in the participants list yet. Include them manually so the
    // socket server can deliver the chat-notification directly.
    const otherParticipantId = activeConvInfo?.otherParticipant?.id;
    if (otherParticipantId && !participantIds.includes(otherParticipantId)) {
      participantIds.push(otherParticipantId);
    }

    if (socket?.connected) {
      socket.emit('send-message', {
        conversationId: activeConvId,
        senderId: profile.id,
        senderName: profile.name,
        content,
        tempId,
        messageId: tempId,     // explicit messageId for server
        participantIds,
        createdAt: optimisticMsg.created_at,
      });
    }

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

      // Refresh participants list (the pending recipient may have just been added)
      const partRes = await fetch(`/api/chat?action=participants&conversationId=${activeConvId}`);
      const partData = await partRes.json();
      if (partData.participants) {
        setParticipants(partData.participants);
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
      if (socket?.connected) {
        socket.emit('message-deleted', {
          conversationId: activeConvId,
          messageId: msgId,
        });
      }
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
      if (socket?.connected) {
        socket.emit('message-updated', {
          conversationId: activeConvId,
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
      toast.error('فشل تعديل الرسالة');
    }
  };

  // =====================================================
  // Handle typing (with debounce to avoid rate limiting)
  // =====================================================
  const typingDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleTyping = (value: string) => {
    setNewMessage(value);
    if (activeConvId) {
      if (value.trim()) {
        // Socket.IO: emit immediately (no rate limit concern)
        if (socket?.connected) {
          socket.emit('typing', {
            conversationId: activeConvId,
            userId: profile.id,
            userName: profile.name,
          });
        }
        // Supabase: debounce to avoid rate limiting (max once per 500ms)
        if (typingDebounceRef.current) clearTimeout(typingDebounceRef.current);
        typingDebounceRef.current = setTimeout(() => {
          broadcastTypingState(activeConvId!, profile.id, profile.name, true);
        }, 300);
      } else {
        // Stop typing: clear debounce and send immediately
        if (typingDebounceRef.current) clearTimeout(typingDebounceRef.current);
        if (socket?.connected) {
          socket.emit('stop-typing', {
            conversationId: activeConvId,
            userId: profile.id,
          });
        }
        broadcastTypingState(activeConvId, profile.id, profile.name, false);
      }
    }
  };

  // =====================================================
  // Search users for new DM
  // - Teacher/Admin: search globally by name + email (no restrictions)
  // - Student: search by name within enrolled courses (coursemates)
  //            + search globally by email (any user on the platform)
  // =====================================================
  const handleSearchUsers = useCallback(async (query: string) => {
    setSearchQuery(query);
    if (!query.trim()) {
      setSearchResults([]);
      return;
    }

    setSearching(true);
    try {
      const allResults: UserProfile[] = [];

      if (role === 'teacher' || role === 'admin') {
        // ─── Teacher / Admin: global search by name + email ───
        try {
          const res = await fetch(`/api/chat?action=search-users-global&query=${encodeURIComponent(query)}&userId=${profile.id}&mode=all`);
          const data = await res.json();
          if (data.users) {
            (data.users as UserProfile[]).forEach((u: UserProfile) => allResults.push(u));
          }
        } catch (err) {
          console.error('Global search error:', err);
        }
      } else {
        // ─── Student: search by name within courses + global email search ───

        // 1. Search by name within enrolled courses (coursemates)
        let subjectIds: string[] = [];
        const { data: enrollmentData } = await supabase
          .from('subject_students')
          .select('subject_id')
          .eq('student_id', profile.id)
          .eq('status', 'approved');
        subjectIds = (enrollmentData || []).map((s: { subject_id: string }) => s.subject_id);

        if (subjectIds.length > 0) {
          const searchPromises = subjectIds.map(sid =>
            fetch(`/api/chat?action=search-users&subjectId=${sid}&query=${encodeURIComponent(query)}&userId=${profile.id}`)
              .then(r => r.json())
              .then(d => d.users || [])
          );

          const courseResults = await Promise.all(searchPromises);
          courseResults.flat().forEach((u: UserProfile) => allResults.push(u));
        }

        // 2. Always search globally by email (students can find anyone by email)
        try {
          const res = await fetch(`/api/chat?action=search-users-global&query=${encodeURIComponent(query)}&userId=${profile.id}&mode=email`);
          const data = await res.json();
          if (data.users) {
            (data.users as UserProfile[]).forEach((u: UserProfile) => allResults.push(u));
          }
        } catch (err) {
          console.error('Global email search error:', err);
        }
      }

      // Deduplicate by user ID
      const unique = Array.from(new Map(allResults.map((u: UserProfile) => [u.id, u])).values());
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
          // Track this conversation as locally hidden to suppress notifications
          hiddenConvIdsRef.current.add(convId);
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
          // Track all conversation IDs as locally hidden to suppress notifications
          conversations.forEach(c => hiddenConvIdsRef.current.add(c.id));
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
  // Own messages LEFT (sky bg), others RIGHT (muted bg)
  // =====================================================
  const renderMessage = (msg: ChatMessage, index: number) => {
    const isOwn = msg.sender_id === profile.id;
    const senderName = formatNameWithTitle(
      msg.sender?.name || 'مستخدم',
      msg.sender?.role,
      msg.sender?.title_id,
      msg.sender?.gender,
      t
    );
    const showAvatar = !isOwn && (index === 0 || messages[index - 1]?.sender_id !== msg.sender_id);
    const isDeleted = (msg as unknown as Record<string, unknown>).is_deleted as boolean;
    const isEdited = (msg as unknown as Record<string, unknown>).is_edited as boolean;
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
              className="text-[10px] text-muted-foreground mb-0.5 font-medium px-1 hover:text-sky-700 transition-colors"
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
            <div className="relative">
              <div
                className={`rounded-2xl px-3.5 py-2 text-sm leading-relaxed ${
                  isDeleted
                    ? 'bg-muted/50 text-muted-foreground italic'
                    : isOwn
                      ? 'bg-sky-700 text-white'
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
                          exit={{ opacity: 0, scale: 0.9, pointerEvents: 'none' as const }}
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

              {/* Hover report button for other users' messages */}
              {!isOwn && !isDeleted && (
                <div className="absolute -top-1 start-full opacity-0 group-hover:opacity-100 transition-opacity ms-1">
                  <ReportButton targetType="message" targetId={msg.id} compact />
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
              <span className="text-[10px] text-sky-600/60 font-medium">
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
        <Loader2 className="h-8 w-8 animate-spin text-sky-700" />
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
          activeConvInfo.otherParticipant?.gender,
          t
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
      dir={dir}
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
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-100">
                  <MessageCircle className="h-4 w-4 text-sky-800" />
                </div>
                <h2 className="text-base font-bold text-foreground">{t('chat.title')}</h2>
              </div>
              <div className="flex items-center gap-2">
                {/* Connection indicator */}
                <div className="flex items-center gap-1 px-2 py-1 rounded-md bg-muted/50" title={
                  status === 'connected' ? 'متصل عبر Socket.IO'
                    : status === 'realtime' ? 'متصل عبر Realtime'
                    : status === 'connecting' ? 'جاري الاتصال...'
                    : 'غير متصل'
                }>
                  {status === 'connected' || status === 'realtime' ? (
                    <Wifi className="h-3 w-3 text-sky-600" />
                  ) : status === 'connecting' ? (
                    <RefreshCw className="h-3 w-3 text-amber-500 animate-spin" />
                  ) : (
                    <WifiOff className="h-3 w-3 text-rose-400" />
                  )}
                  <span className="text-[10px] text-muted-foreground">
                    {status === 'connected' || status === 'realtime' ? 'متصل'
                      : status === 'connecting' ? 'جاري الاتصال...'
                      : 'غير متصل'}
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
                  className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-700 text-white hover:bg-sky-800 transition-colors shadow-sm"
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
                className="w-full rounded-lg border bg-muted/30 ps-9 pe-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-sky-600/20 focus:border-sky-600 transition-all"
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
                  className="inline-flex items-center gap-1.5 rounded-lg bg-sky-700 px-3 py-2 text-xs font-medium text-white hover:bg-sky-800 transition-colors"
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
                  className="text-xs text-sky-700 hover:text-sky-800 font-medium transition-colors"
                >
                  إعادة المحاولة ←
                </button>
              </div>
            ) : conversations.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center px-6">
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-sky-50 mb-4">
                  <MessageCircle className="h-8 w-8 text-sky-400" />
                </div>
                <p className="text-sm font-semibold text-foreground mb-1">لا توجد محادثات</p>
                <p className="text-xs text-muted-foreground mb-4">ابدأ محادثة جديدة مع زملائك في المقرر</p>
                <button
                  onClick={() => setShowNewDM(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-sky-700 px-4 py-2 text-xs font-medium text-white hover:bg-sky-800 transition-colors"
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
                        conv.otherParticipant?.gender,
                        t
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
                          ? 'bg-sky-50 border-s-2 border-sky-600'
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
                              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-sky-100 text-sky-800">
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
                          <span className={`text-sm truncate ${isActive ? 'font-bold text-sky-800' : 'font-semibold text-foreground'}`}>
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
                                    exit={{ opacity: 0, scale: 0.9, pointerEvents: 'none' as const }}
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
                              : t('chat.noMessages')}
                          </p>
                          {unread > 0 && (
                            <span className="shrink-0 flex h-5 min-w-5 items-center justify-center rounded-full bg-sky-700 text-white text-[10px] font-bold px-1.5">
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
                            conv.otherParticipant?.gender,
                            t
                          );
                      const lastMsg = conv.lastMessage;

                      return (
                        <div
                          key={conv.id}
                          className="flex items-center gap-3 p-3 text-right hover:bg-muted/30 transition-colors opacity-60"
                        >
                          <div className="shrink-0">
                            {isGroup ? (
                              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-sky-100 text-sky-800">
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
                                  className="flex h-5 w-5 items-center justify-center rounded text-sky-700/60 hover:text-sky-700 hover:bg-sky-50 transition-colors"
                                  title="إلغاء الأرشفة"
                                >
                                  <ArchiveRestore className="h-3 w-3" />
                                </button>
                              </div>
                            </div>
                            <p className="text-xs text-muted-foreground truncate mt-0.5">
                              {lastMsg
                                ? (lastMsg.content.length > 35 ? lastMsg.content.substring(0, 35) + '...' : lastMsg.content)
                                : t('chat.noMessages')}
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
                          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-sky-100 text-sky-800">
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
                        <span className={`text-[10px] font-medium ${chatHeaderStatus === 'online' ? 'text-sky-700' : chatHeaderStatus === 'busy' ? 'text-amber-600' : chatHeaderStatus === 'away' ? 'text-orange-600' : 'text-muted-foreground'}`}>
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
                  {status === 'connected' || status === 'realtime' ? (
                    <Wifi className="h-3.5 w-3.5 text-sky-600" />
                  ) : status === 'connecting' ? (
                    <RefreshCw className="h-3.5 w-3.5 text-amber-500 animate-spin" />
                  ) : (
                    <div className="flex items-center gap-1" title="يتم التحديث تلقائياً">
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
                        exit={{ opacity: 0, scale: 0.9, pointerEvents: 'none' as const }}
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
                    <Loader2 className="h-6 w-6 animate-spin text-sky-700" />
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
                    placeholder={t('chat.placeholder')}
                    className="flex-1 rounded-xl border bg-muted/30 px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-sky-600/20 focus:border-sky-600 transition-all"
                    dir={dir}
                    disabled={sending}
                  />
                  <button
                    onClick={handleSend}
                    disabled={!newMessage.trim() || sending}
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-sky-700 text-white hover:bg-sky-800 disabled:opacity-40 disabled:hover:bg-sky-700 transition-colors"
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
                <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-sky-50 mb-4">
                  <MessageCircle className="h-10 w-10 text-sky-400" />
                </div>
                <h3 className="text-lg font-semibold text-foreground mb-2">مرحباً بك في المحادثات</h3>
                <p className="text-sm text-muted-foreground max-w-[280px] mb-4">
                  اختر محادثة من القائمة أو ابدأ محادثة جديدة مع زملائك
                </p>
                <button
                  onClick={() => setShowNewDM(true)}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-sky-700 px-5 py-2.5 text-sm font-medium text-white hover:bg-sky-800 transition-colors shadow-sm"
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
            exit={{ opacity: 0, pointerEvents: 'none' as const }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
            onClick={() => { setShowNewDM(false); setSearchQuery(''); setSearchResults([]); }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10, pointerEvents: 'none' as const }}
              transition={{ duration: 0.15 }}
              className="w-full max-w-md bg-card rounded-2xl shadow-2xl border overflow-hidden"
              onClick={(e) => e.stopPropagation()}
              dir={dir}
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
                    placeholder={
                      role === 'student'
                        ? 'ابحث بالاسم (زملاء المقرر) أو البريد الإلكتروني (الجميع)...'
                        : 'ابحث بالاسم أو البريد الإلكتروني...'
                    }
                    className="w-full rounded-lg border bg-muted/30 ps-10 pe-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-sky-600/20 focus:border-sky-600 transition-all"
                    autoFocus
                  />
                  {searching && (
                    <Loader2 className="absolute end-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
                  )}
                </div>
                {role === 'student' && (
                  <p className="mt-1.5 text-[10px] text-muted-foreground leading-relaxed">
                    🔍 البحث بالاسم: زملاء مقرراتك فقط · البحث بالبريد: جميع المستخدمين
                  </p>
                )}
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
                            getUserStatus(user.id) === 'online' ? 'bg-sky-600' : 'bg-gray-300'
                          }`} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-foreground truncate">{formatNameWithTitle(user.name, user.role, user.title_id, user.gender, t)}</p>
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
        <AlertDialogContent dir={dir}>
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

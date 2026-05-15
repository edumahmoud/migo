// =====================================================
// Global Message Worker
// =====================================================
// Provides a component-independent Supabase Realtime subscription
// for new messages. This ensures messages are received even when
// the ChatSection component is not mounted or between re-renders.
//
// Uses a simple event emitter pattern so any part of the app can
// subscribe to new message events without coupling to a specific
// component lifecycle.
// =====================================================

import { supabase } from '@/lib/supabase';
import { RealtimeChannel } from '@supabase/supabase-js';

// ─── Types ───
export interface NewMessageEvent {
  id: string;
  sender_id: string;
  conversation_id: string;
  content: string;
  created_at: string;
  is_deleted: boolean;
  is_edited: boolean;
}

type MessageListener = (msg: NewMessageEvent) => void;

// ─── Module-level state ───
let channel: RealtimeChannel | null = null;
let userId: string | null = null;
let listeners: Set<MessageListener> = new Set();
let subscribed = false;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

// ─── Public API ───

/**
 * Initialize the global message worker for a given user.
 * Safe to call multiple times — will not duplicate subscriptions.
 */
export function initMessageWorker(currentUserId: string): void {
  // If already initialized for this user, skip
  if (channel && userId === currentUserId && subscribed) return;

  // Clean up any existing subscription
  destroyMessageWorker();

  userId = currentUserId;

  try {
    channel = supabase
      .channel('global-message-worker')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
        },
        (payload) => {
          const newMsg = payload.new as Record<string, unknown>;
          if (!newMsg) return;

          // Skip own messages — they're already handled optimistically in the UI
          if (newMsg.sender_id === currentUserId) return;

          const event: NewMessageEvent = {
            id: newMsg.id as string,
            sender_id: newMsg.sender_id as string,
            conversation_id: (newMsg.conversation_id as string) || '',
            content: newMsg.content as string,
            created_at: newMsg.created_at as string,
            is_deleted: false,
            is_edited: false,
          };

          // Notify all listeners
          listeners.forEach((fn) => {
            try {
              fn(event);
            } catch (err) {
              console.error('[MessageWorker] Listener error:', err);
            }
          });
        }
      )
      .subscribe((status) => {
        console.log('[MessageWorker] Subscription status:', status);
        if (status === 'SUBSCRIBED') {
          subscribed = true;
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          subscribed = false;
          // Auto-retry after 5 seconds
          if (retryTimer) clearTimeout(retryTimer);
          retryTimer = setTimeout(() => {
            console.log('[MessageWorker] Retrying subscription...');
            if (userId) {
              initMessageWorker(userId);
            }
          }, 5000);
        }
      });
  } catch (err) {
    console.error('[MessageWorker] Setup error:', err);
  }
}

/**
 * Subscribe to new message events.
 * Returns an unsubscribe function.
 */
export function onNewMessage(listener: MessageListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Destroy the global message worker and clean up resources.
 */
export function destroyMessageWorker(): void {
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  if (channel) {
    try {
      supabase.removeChannel(channel);
    } catch {
      // Ignore cleanup errors
    }
    channel = null;
  }
  userId = null;
  subscribed = false;
  listeners.clear();
}

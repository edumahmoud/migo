import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { getAllUserSettings, setArchived, setHidden } from './conversation-store';
import { authenticateRequest, requireAdmin, authErrorResponse, verifyOwnership } from '@/lib/auth-helpers';
import { notifyUsers } from '@/lib/notifications-service';

/**
 * Chat API Route
 * 
 * GET: Fetch conversations or messages
 * POST: Send message, create conversation, mark as read, delete/edit message, archive/hide conversation
 */

// =====================================================
// Socket.IO Server Notification Helper
// =====================================================
// After inserting a message into the DB, we also notify the
// Socket.IO server so it can broadcast to connected clients.
// This makes message delivery work even when the sender's
// browser socket is disconnected (e.g., in Realtime mode).

const SOCKET_SERVER_URL = process.env.NEXT_PUBLIC_CHAT_SERVICE_URL || 'http://localhost:3003';
// EMIT_SECRET must be set via environment variable. No default fallback.
// If not set, the Socket.IO server will reject the request.
const EMIT_SECRET = process.env.EMIT_SECRET;

async function notifySocketServer(payload: {
  event: string;
  data: Record<string, unknown>;
  participantIds?: string[];
  targetRoomId?: string;
  excludeSocketId?: string;
}): Promise<void> {
  if (!EMIT_SECRET) {
    console.warn('[Chat API] EMIT_SECRET not configured — skipping Socket.IO notification');
    return;
  }
  try {
    await fetch(`${SOCKET_SERVER_URL}/api/emit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Emit-Secret': EMIT_SECRET,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000), // 5-second timeout
    });
  } catch (err) {
    // Non-critical — the message is already in the DB, Realtime/polling will deliver it
    console.warn('[Chat API] Failed to notify Socket.IO server:', err);
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');

  try {
    // Authenticate all GET requests
    const authResult = await authenticateRequest(request);
    if (!authResult.success) {
      return authErrorResponse(authResult);
    }

    switch (action) {
      case 'conversations': {
        const userId = searchParams.get('userId');
        const includeArchived = searchParams.get('includeArchived') === 'true';
        if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 });

        // Verify the authenticated user matches the requested userId
        const ownershipError = verifyOwnership(authResult.user.id, userId);
        if (ownershipError) {
          return authErrorResponse(ownershipError);
        }

        // Step 1: Get all conversation IDs the user is part of (not hidden)
        // Try selecting is_hidden and is_archived columns; fall back gracefully if they don't exist
        let participationsQuery = supabaseServer
          .from('conversation_participants')
          .select('conversation_id, last_read_at, is_hidden, is_archived')
          .eq('user_id', userId);

        let { data: participations, error: pError } = await participationsQuery;

        // If is_hidden/is_archived columns don't exist, retry without them
        // and merge with file-based fallback store
        if (pError && (pError.message.includes('is_hidden') || pError.message.includes('is_archived'))) {
          const fallback = await supabaseServer
            .from('conversation_participants')
            .select('conversation_id, last_read_at')
            .eq('user_id', userId);
          participations = fallback.data as { conversation_id: any; last_read_at: any; is_hidden: any; is_archived: any; }[] | null;
          pError = fallback.error;
          // Merge with file-based fallback store for archive/hidden state
          if (participations) {
            const userSettings = getAllUserSettings(userId);
            participations = participations.map((p: Record<string, unknown>) => {
              const settings = userSettings.get((p as { conversation_id: string }).conversation_id);
              return {
                ...p,
                is_hidden: settings?.is_hidden || false,
                is_archived: settings?.is_archived || false,
              } as { conversation_id: any; last_read_at: any; is_hidden: any; is_archived: any; };
            });
          }
        }

        if (pError) {
          console.error('[Chat API] Conversations fetch error:', pError);
          return NextResponse.json({ error: 'فشل في جلب المحادثات' }, { status: 500 });
        }

        if (!participations || participations.length === 0) {
          return NextResponse.json({ conversations: [], archivedConversations: [] });
        }

        // Filter out hidden conversations and separate archived ones
        const visibleParticipations = participations.filter(
          (p: Record<string, unknown>) => !(p as Record<string, unknown>).is_hidden
        );
        const activeParticipations = visibleParticipations.filter(
          (p: Record<string, unknown>) => includeArchived || !(p as Record<string, unknown>).is_archived
        );
        const archivedParticipations = visibleParticipations.filter(
          (p: Record<string, unknown>) => (p as Record<string, unknown>).is_archived
        );

        // Step 2: Get all conversation details for those IDs
        const convIds = activeParticipations.map((p: { conversation_id: string }) => p.conversation_id);
        const lastReadMap = new Map<string, string | null>();
        activeParticipations.forEach((p: { conversation_id: string; last_read_at: string | null }) => {
          lastReadMap.set(p.conversation_id, p.last_read_at);
        });

        const { data: convsData, error: convsError } = await supabaseServer
          .from('conversations')
          .select('id, type, subject_id, title, created_at, updated_at')
          .in('id', convIds);

        if (convsError) {
          console.error('[Chat API] Conversations fetch error:', convsError);
          return NextResponse.json({ error: 'فشل في جلب المحادثات' }, { status: 500 });
        }

        // Step 3: Batch fetch data for all conversations (N+1 fix)
        // Instead of querying per-conversation (150-250 queries for 50 convs),
        // we use batch queries (~5 queries total) and group results in memory.

        // 3a: Batch fetch last messages for all conversations
        const lastMessageMap = new Map<string, Record<string, unknown>>();
        if (convIds.length > 0) {
          const { data: allLastMessages } = await supabaseServer
            .from('messages')
            .select('id, sender_id, content, created_at, conversation_id')
            .in('conversation_id', convIds)
            .order('created_at', { ascending: false });

          // Group by conversation_id and take the first (latest) for each
          if (allLastMessages) {
            for (const msg of allLastMessages) {
              const msgConvId = (msg as Record<string, unknown>).conversation_id as string;
              if (!lastMessageMap.has(msgConvId)) {
                lastMessageMap.set(msgConvId, msg as Record<string, unknown>);
              }
            }
          }
        }

        // 3b: Batch fetch unread message counts
        // We fetch all messages not sent by the current user across all conversations,
        // then count in JavaScript based on per-conversation lastReadAt
        const unreadCountMap = new Map<string, number>();
        if (convIds.length > 0) {
          const { data: allUnreadMessages } = await supabaseServer
            .from('messages')
            .select('id, conversation_id, sender_id, created_at')
            .in('conversation_id', convIds)
            .neq('sender_id', userId);

          if (allUnreadMessages) {
            for (const msg of allUnreadMessages) {
              const msgConvId = (msg as Record<string, unknown>).conversation_id as string;
              const msgCreatedAt = (msg as Record<string, unknown>).created_at as string;
              const lastReadAt = lastReadMap.get(msgConvId);

              // Count as unread if: no lastReadAt OR message is newer than lastReadAt
              if (!lastReadAt || msgCreatedAt > lastReadAt) {
                unreadCountMap.set(msgConvId, (unreadCountMap.get(msgConvId) || 0) + 1);
              }
            }
          }
        }

        // 3c: Batch fetch other participants for individual chats
        const individualConvIds = (convsData || [])
          .filter((conv: Record<string, unknown>) => conv.type === 'individual')
          .map((conv: Record<string, unknown>) => conv.id as string);

        const otherParticipantMap = new Map<string, Record<string, unknown>>();

        if (individualConvIds.length > 0) {
          const { data: allParticipants } = await supabaseServer
            .from('conversation_participants')
            .select('conversation_id, user_id')
            .in('conversation_id', individualConvIds)
            .neq('user_id', userId);

          if (allParticipants && allParticipants.length > 0) {
            // Get unique user IDs
            const otherUserIds = [...new Set(
              allParticipants.map((p: Record<string, unknown>) => p.user_id as string)
            )];

            // Batch fetch user profiles
            const { data: otherUsers } = await supabaseServer
              .from('users')
              .select('id, name, email, avatar_url, title_id, gender, role')
              .in('id', otherUserIds);

            const userMap = new Map<string, Record<string, unknown>>();
            if (otherUsers) {
              for (const u of otherUsers) {
                userMap.set((u as Record<string, unknown>).id as string, u as Record<string, unknown>);
              }
            }

            // Map conversation_id → other participant
            for (const p of allParticipants) {
              const pConvId = (p as Record<string, unknown>).conversation_id as string;
              const pUserId = (p as Record<string, unknown>).user_id as string;
              const userData = userMap.get(pUserId);
              if (userData) {
                otherParticipantMap.set(pConvId, userData);
              }
            }
          }

          // Handle pending conversations (title starts with 'pending:')
          // These are individual chats where the recipient isn't yet a participant
          const pendingConvs = (convsData || [])
            .filter((conv: Record<string, unknown>) =>
              conv.type === 'individual' &&
              (conv.title as string)?.startsWith('pending:')
            ) as Record<string, unknown>[];

          // Only fetch pending users for conversations where we didn't already find a participant
          const pendingConvUserIds: { convId: string; userId: string }[] = [];
          for (const conv of pendingConvs) {
            const convId = conv.id as string;
            if (!otherParticipantMap.has(convId)) {
              const pendingRecipientId = (conv.title as string).replace('pending:', '');
              if (pendingRecipientId) {
                pendingConvUserIds.push({ convId, userId: pendingRecipientId });
              }
            }
          }

          if (pendingConvUserIds.length > 0) {
            const pendingIds = [...new Set(pendingConvUserIds.map(p => p.userId))];
            const { data: pendingUsers } = await supabaseServer
              .from('users')
              .select('id, name, email, avatar_url, title_id, gender, role')
              .in('id', pendingIds);

            if (pendingUsers) {
              const pendingUserMap = new Map<string, Record<string, unknown>>();
              for (const u of pendingUsers) {
                pendingUserMap.set((u as Record<string, unknown>).id as string, u as Record<string, unknown>);
              }
              for (const { convId, userId: pendingUserId } of pendingConvUserIds) {
                const userData = pendingUserMap.get(pendingUserId);
                if (userData) {
                  otherParticipantMap.set(convId, userData);
                }
              }
            }
          }
        }

        // 3d: Build conversation objects without per-item queries
        const conversations = (convsData || []).map((conv: Record<string, unknown>) => {
          const convId = conv.id as string;
          return {
            id: convId,
            type: conv.type,
            subjectId: conv.subject_id,
            title: conv.title,
            createdAt: conv.created_at,
            updatedAt: conv.updated_at,
            lastReadAt: lastReadMap.get(convId) || null,
            lastMessage: lastMessageMap.get(convId) || null,
            unreadCount: unreadCountMap.get(convId) || 0,
            otherParticipant: otherParticipantMap.get(convId) || null,
          };
        });

        // Sort by updated_at (most recent first)
        const sorted = conversations
          .filter(Boolean)
          .sort((a, b) => new Date((b as Record<string, unknown>).updatedAt as string || (b as Record<string, unknown>).createdAt as string).getTime() - new Date((a as Record<string, unknown>).updatedAt as string || (a as Record<string, unknown>).createdAt as string).getTime());

        // Also fetch archived conversations details (batched — same N+1 fix)
        let archivedConversations: unknown[] = [];
        if (archivedParticipations.length > 0) {
          const archivedConvIds = archivedParticipations.map((p: { conversation_id: string }) => p.conversation_id);
          const archivedLastReadMap = new Map<string, string | null>();
          archivedParticipations.forEach((p: { conversation_id: string; last_read_at: string | null }) => {
            archivedLastReadMap.set(p.conversation_id, p.last_read_at);
          });

          const { data: archivedConvsData } = await supabaseServer
            .from('conversations')
            .select('id, type, subject_id, title, created_at, updated_at')
            .in('id', archivedConvIds);

          if (archivedConvsData && archivedConvsData.length > 0) {
            // Batch: Get the latest message for all archived conversations
            const archivedLastMessageMap = new Map<string, Record<string, unknown>>();
            const { data: allArchivedLastMessages } = await supabaseServer
              .from('messages')
              .select('id, sender_id, content, created_at, conversation_id')
              .in('conversation_id', archivedConvIds)
              .order('created_at', { ascending: false });

            if (allArchivedLastMessages) {
              for (const msg of allArchivedLastMessages) {
                const msgConvId = (msg as Record<string, unknown>).conversation_id as string;
                if (!archivedLastMessageMap.has(msgConvId)) {
                  archivedLastMessageMap.set(msgConvId, msg as Record<string, unknown>);
                }
              }
            }

            // Batch: Get other participants for individual archived chats
            const archivedIndividualConvIds = archivedConvsData
              .filter((conv: Record<string, unknown>) => conv.type === 'individual')
              .map((conv: Record<string, unknown>) => conv.id as string);

            const archivedOtherParticipantMap = new Map<string, Record<string, unknown>>();

            if (archivedIndividualConvIds.length > 0) {
              const { data: allArchivedParticipants } = await supabaseServer
                .from('conversation_participants')
                .select('conversation_id, user_id')
                .in('conversation_id', archivedIndividualConvIds)
                .neq('user_id', userId);

              if (allArchivedParticipants && allArchivedParticipants.length > 0) {
                const archivedOtherUserIds = [...new Set(
                  allArchivedParticipants.map((p: Record<string, unknown>) => p.user_id as string)
                )];

                const { data: archivedOtherUsers } = await supabaseServer
                  .from('users')
                  .select('id, name, email, avatar_url, title_id, gender, role')
                  .in('id', archivedOtherUserIds);

                const archivedUserMap = new Map<string, Record<string, unknown>>();
                if (archivedOtherUsers) {
                  for (const u of archivedOtherUsers) {
                    archivedUserMap.set((u as Record<string, unknown>).id as string, u as Record<string, unknown>);
                  }
                }

                for (const p of allArchivedParticipants) {
                  const pConvId = (p as Record<string, unknown>).conversation_id as string;
                  const pUserId = (p as Record<string, unknown>).user_id as string;
                  const userData = archivedUserMap.get(pUserId);
                  if (userData) {
                    archivedOtherParticipantMap.set(pConvId, userData);
                  }
                }
              }

              // Handle pending archived conversations (title starts with 'pending:')
              const archivedPendingConvs = archivedConvsData
                .filter((conv: Record<string, unknown>) =>
                  conv.type === 'individual' &&
                  (conv.title as string)?.startsWith('pending:')
                ) as Record<string, unknown>[];

              const archivedPendingConvUserIds: { convId: string; userId: string }[] = [];
              for (const conv of archivedPendingConvs) {
                const convId = conv.id as string;
                if (!archivedOtherParticipantMap.has(convId)) {
                  const pendingRecipientId = (conv.title as string).replace('pending:', '');
                  if (pendingRecipientId) {
                    archivedPendingConvUserIds.push({ convId, userId: pendingRecipientId });
                  }
                }
              }

              if (archivedPendingConvUserIds.length > 0) {
                const archivedPendingIds = [...new Set(archivedPendingConvUserIds.map(p => p.userId))];
                const { data: archivedPendingUsers } = await supabaseServer
                  .from('users')
                  .select('id, name, email, avatar_url, title_id, gender, role')
                  .in('id', archivedPendingIds);

                if (archivedPendingUsers) {
                  const archivedPendingUserMap = new Map<string, Record<string, unknown>>();
                  for (const u of archivedPendingUsers) {
                    archivedPendingUserMap.set((u as Record<string, unknown>).id as string, u as Record<string, unknown>);
                  }
                  for (const { convId, userId: pendingUserId } of archivedPendingConvUserIds) {
                    const userData = archivedPendingUserMap.get(pendingUserId);
                    if (userData) {
                      archivedOtherParticipantMap.set(convId, userData);
                    }
                  }
                }
              }
            }

            // Build archived conversation objects without per-item queries
            archivedConversations = archivedConvsData.map((conv: Record<string, unknown>) => {
              const convId = conv.id as string;
              return {
                id: convId,
                type: conv.type,
                subjectId: conv.subject_id,
                title: conv.title,
                createdAt: conv.created_at,
                updatedAt: conv.updated_at,
                lastReadAt: archivedLastReadMap.get(convId) || null,
                lastMessage: archivedLastMessageMap.get(convId) || null,
                unreadCount: 0,
                otherParticipant: archivedOtherParticipantMap.get(convId) || null,
                isArchived: true,
              };
            });

            archivedConversations.sort((a, b) =>
              new Date((b as Record<string, unknown>).updatedAt as string || (b as Record<string, unknown>).createdAt as string).getTime() -
              new Date((a as Record<string, unknown>).updatedAt as string || (a as Record<string, unknown>).createdAt as string).getTime()
            );
          }
        }

        return NextResponse.json({ conversations: sorted, archivedConversations });
      }

      case 'messages': {
        const conversationId = searchParams.get('conversationId');
        const limit = parseInt(searchParams.get('limit') || '50');

        if (!conversationId) return NextResponse.json({ error: 'conversationId required' }, { status: 400 });

        // Fetch messages
        const { data: messages, error } = await supabaseServer
          .from('messages')
          .select('id, sender_id, content, created_at, is_deleted, is_edited, edited_at')
          .eq('conversation_id', conversationId)
          .order('created_at', { ascending: false })
          .limit(limit);

        if (error) {
          console.error('[Chat API] Messages fetch error:', error);
          return NextResponse.json({ error: 'فشل في جلب الرسائل' }, { status: 500 });
        }

        // Enrich with sender info
        const enrichedMessages = await Promise.all(
          (messages || []).map(async (msg: Record<string, unknown>) => {
            const { data: sender } = await supabaseServer
              .from('users')
              .select('id, name, email, avatar_url, title_id, gender, role')
              .eq('id', msg.sender_id as string)
              .single();
            return { ...msg, sender: sender || null };
          })
        );

        return NextResponse.json({ messages: enrichedMessages.reverse() });
      }

      case 'group-conversation': {
        const subjectId = searchParams.get('subjectId');
        if (!subjectId) return NextResponse.json({ error: 'subjectId required' }, { status: 400 });

        const { data } = await supabaseServer
          .from('conversations')
          .select('*')
          .eq('subject_id', subjectId)
          .eq('type', 'group')
          .maybeSingle();

        return NextResponse.json({ conversation: data || null });
      }

      case 'participants': {
        const conversationId = searchParams.get('conversationId');
        if (!conversationId) return NextResponse.json({ error: 'conversationId required' }, { status: 400 });

        const { data: parts } = await supabaseServer
          .from('conversation_participants')
          .select('user_id, joined_at, last_read_at')
          .eq('conversation_id', conversationId);

        // Enrich with user info
        const participants = await Promise.all(
          (parts || []).map(async (p: Record<string, unknown>) => {
            const { data: user } = await supabaseServer
              .from('users')
              .select('id, name, email, avatar_url, title_id, gender, role')
              .eq('id', p.user_id as string)
              .single();
            return { ...p, users: user || null };
          })
        );

        return NextResponse.json({ participants });
      }

      case 'search-users': {
        const subjectId = searchParams.get('subjectId');
        const query = searchParams.get('query');
        const userId = searchParams.get('userId');

        if (!query) return NextResponse.json({ error: 'query required' }, { status: 400 });

        // ── Role-based access: verify the user is allowed to search within this subject ──
        if (subjectId && userId) {
          const { data: authProfile } = await supabaseServer
            .from('users')
            .select('role')
            .eq('id', authResult.user.id)
            .maybeSingle();
          const requesterRole = (authProfile?.role as string) || '';

          if (requesterRole === 'student') {
            // Student must be enrolled in this subject to search it
            const { data: enrollment } = await supabaseServer
              .from('subject_students')
              .select('subject_id')
              .eq('student_id', userId)
              .eq('subject_id', subjectId)
              .eq('status', 'approved')
              .maybeSingle();
            if (!enrollment) {
              return NextResponse.json({ error: 'غير مسموح لك بالبحث في هذا المقرر' }, { status: 403 });
            }
          } else if (requesterRole === 'teacher') {
            // Teacher must own this subject to search it
            const { data: subject } = await supabaseServer
              .from('subjects')
              .select('teacher_id')
              .eq('id', subjectId)
              .maybeSingle();
            if (!subject || subject.teacher_id !== userId) {
              return NextResponse.json({ error: 'غير مسموح لك بالبحث في هذا المقرر' }, { status: 403 });
            }
          }
          // Admin: no restrictions
        }

        let allUsers: Record<string, unknown>[] = [];

        // If subjectId is provided, search within that course (name + email)
        if (subjectId) {
          // Search users enrolled in the same subject
          const { data: enrollments } = await supabaseServer
            .from('subject_students')
            .select('student_id')
            .eq('subject_id', subjectId);

          // Get student details
          const studentIds = (enrollments || []).map((e: { student_id: string }) => e.student_id);
          let studentUsers: Record<string, unknown>[] = [];
          if (studentIds.length > 0) {
            const { data } = await supabaseServer
              .from('users')
              .select('id, name, email, avatar_url, title_id, gender, role')
              .in('id', studentIds);
            studentUsers = (data || []) as Record<string, unknown>[];
          }

          // Also get the teacher
          const { data: subjectData } = await supabaseServer
            .from('subjects')
            .select('teacher_id')
            .eq('id', subjectId)
            .single();

          let teacherUser: Record<string, unknown> | null = null;
          if (subjectData?.teacher_id) {
            const { data } = await supabaseServer
              .from('users')
              .select('id, name, email, avatar_url, title_id, gender, role')
              .eq('id', subjectData.teacher_id)
              .single();
            teacherUser = data as Record<string, unknown> || null;
          }

          allUsers = [
            ...studentUsers,
            teacherUser,
          ]
            .filter((u): u is Record<string, unknown> => u != null)
            .filter((u) => u.id !== userId)
            .filter((u) =>
              (u.name as string || '').toLowerCase().includes(query.toLowerCase()) ||
              (u.email as string || '').toLowerCase().includes(query.toLowerCase())
            );
        }

        // Remove duplicates
        const unique = Array.from(new Map(allUsers.map((u: Record<string, unknown>) => [u.id, u])).values());

        return NextResponse.json({ users: unique });
      }

      case 'search-users-global': {
        const query = searchParams.get('query');
        const userId = searchParams.get('userId');
        const searchMode = searchParams.get('mode') || 'all'; // 'all' | 'email' | 'name'

        if (!query) return NextResponse.json({ error: 'query required' }, { status: 400 });

        // ─── Enforce role-based messaging visibility ───
        // Student:  can ONLY message course teacher(s) and classmates (no global search)
        // Teacher:  can message other teachers + students in their courses
        // Admin/Supervisor: can message ALL teachers and students (not other admins)
        const { data: authUserProfile } = await supabaseServer
          .from('users')
          .select('role')
          .eq('id', authResult.user.id)
          .maybeSingle();

        const userRole = (authUserProfile?.role as string) || '';

        // ── Students: restricted to course-scoped search only ──
        // They should NOT be able to use global search at all.
        // Their search is handled by the 'search-users' action (per-subject).
        if (userRole === 'student') {
          // Students must use course-scoped search — return empty from global
          return NextResponse.json({ users: [] });
        }

        // Sanitize query for SQL LIKE (escape % and _)
        const sanitizedQuery = query.replace(/%/g, '\\%').replace(/_/g, '\\_');

        // ── Teachers: only other teachers + students in their courses ──
        if (userRole === 'teacher') {
          // 1. Search other teachers (by name + email)
          let teacherResults: Record<string, unknown>[] = [];
          if (searchMode === 'all' || searchMode === 'name') {
            const { data, error: tNameError } = await supabaseServer
              .from('users')
              .select('id, name, email, avatar_url, title_id, gender, role')
              .ilike('name', `%${sanitizedQuery}%`)
              .neq('id', userId || '')
              .eq('role', 'teacher')
              .limit(20);
            if (tNameError) {
              console.error('[Chat API] Global search (teacher name) error:', tNameError);
            } else {
              teacherResults = (data || []) as Record<string, unknown>[];
            }
          }
          if (searchMode === 'all' || searchMode === 'email') {
            const { data, error: tEmailError } = await supabaseServer
              .from('users')
              .select('id, name, email, avatar_url, title_id, gender, role')
              .ilike('email', `%${sanitizedQuery}%`)
              .neq('id', userId || '')
              .eq('role', 'teacher')
              .limit(20);
            if (tEmailError) {
              console.error('[Chat API] Global search (teacher email) error:', tEmailError);
            } else {
              teacherResults = [...teacherResults, ...(data || []) as Record<string, unknown>[]];
            }
          }

          // 2. Search students in teacher's courses
          const { data: teacherSubjects } = await supabaseServer
            .from('subjects')
            .select('id')
            .eq('teacher_id', userId || '');

          let studentResults: Record<string, unknown>[] = [];
          if (teacherSubjects && teacherSubjects.length > 0) {
            const teacherSubjectIds = teacherSubjects.map((s: { id: string }) => s.id);
            const { data: enrollments } = await supabaseServer
              .from('subject_students')
              .select('student_id')
              .in('subject_id', teacherSubjectIds);

            const studentIds = (enrollments || []).map((e: { student_id: string }) => e.student_id);
            if (studentIds.length > 0) {
              // Deduplicate student IDs
              const uniqueStudentIds = [...new Set(studentIds)];
              const { data: students } = await supabaseServer
                .from('users')
                .select('id, name, email, avatar_url, title_id, gender, role')
                .in('id', uniqueStudentIds)
                .neq('id', userId || '')
                .limit(50);

              if (students) {
                // Filter by query (name or email)
                const q = sanitizedQuery.toLowerCase();
                studentResults = (students as Record<string, unknown>[]).filter(
                  (u) => (u.name as string || '').toLowerCase().includes(q) ||
                         (u.email as string || '').toLowerCase().includes(q)
                );
              }
            }
          }

          // Merge, deduplicate, and return
          const merged = [...teacherResults, ...studentResults];
          const unique = Array.from(new Map(merged.map((u: Record<string, unknown>) => [u.id, u])).values());
          return NextResponse.json({ users: unique });
        }

        // ── Admin/Supervisor: all teachers + students (exclude other admins/supervisors) ──
        let emailResults: Record<string, unknown>[] = [];
        let nameResults: Record<string, unknown>[] = [];

        if (searchMode === 'all' || searchMode === 'email') {
          const { data, error: emailError } = await supabaseServer
            .from('users')
            .select('id, name, email, avatar_url, title_id, gender, role')
            .ilike('email', `%${sanitizedQuery}%`)
            .neq('id', userId || '')
            .in('role', ['teacher', 'student'])
            .limit(20);
          if (emailError) {
            console.error('[Chat API] Global search (email) error:', emailError);
          } else {
            emailResults = (data || []) as Record<string, unknown>[];
          }
        }

        if (searchMode === 'all' || searchMode === 'name') {
          const { data, error: nameError } = await supabaseServer
            .from('users')
            .select('id, name, email, avatar_url, title_id, gender, role')
            .ilike('name', `%${sanitizedQuery}%`)
            .neq('id', userId || '')
            .in('role', ['teacher', 'student'])
            .limit(20);
          if (nameError) {
            console.error('[Chat API] Global search (name) error:', nameError);
          } else {
            nameResults = (data || []) as Record<string, unknown>[];
          }
        }

        // Merge and deduplicate by user ID
        const merged = [...emailResults, ...nameResults];
        const unique = Array.from(new Map(merged.map((u: Record<string, unknown>) => [u.id, u])).values());

        return NextResponse.json({ users: unique });
      }

      default:
        return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }
  } catch (error) {
    console.error('[Chat API] GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action } = body;

    // 'migrate-chat-columns' requires admin; all other actions require authentication
    let authUserId: string;
    if (action === 'migrate-chat-columns') {
      const adminResult = await requireAdmin(request);
      if (!adminResult.success) {
        return authErrorResponse(adminResult);
      }
      authUserId = adminResult.user.id;
    } else {
      const authResult = await authenticateRequest(request);
      if (!authResult.success) {
        return authErrorResponse(authResult);
      }
      authUserId = authResult.user.id;
    }

    switch (action) {
      case 'send-message': {
        const { conversationId, senderId, content } = body;
        if (!conversationId || !senderId || !content) {
          return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
        }

        // Verify the authenticated user is the sender
        const senderOwnershipError = verifyOwnership(authUserId, senderId);
        if (senderOwnershipError) {
          return authErrorResponse(senderOwnershipError);
        }

        // ── Activate pending conversation if this is the first message ──
        // When a DM is created, the recipient is added as a HIDDEN participant
        // (is_hidden=true) so they don't see an empty conversation in their list.
        // On first message send, we reveal them (is_hidden=false) and clear the
        // pending title so they can see the conversation and receive Realtime events.
        const { data: convInfo } = await supabaseServer
          .from('conversations')
          .select('id, type, title')
          .eq('id', conversationId)
          .maybeSingle();

        if (convInfo?.title && (convInfo.title as string).startsWith('pending:')) {
          const pendingRecipientId = (convInfo.title as string).replace('pending:', '');
          if (pendingRecipientId) {
            // Reveal the hidden recipient (is_hidden = false) so they can see the conversation
            // If they're not a participant yet (fallback mode), add them.
            const { error: revealError } = await supabaseServer
              .from('conversation_participants')
              .upsert({
                conversation_id: conversationId,
                user_id: pendingRecipientId,
                is_hidden: false,
              }, { onConflict: 'conversation_id,user_id' });

            if (revealError) {
              // is_hidden column might not exist — try without it
              console.warn('[Chat API] is_hidden column missing in send-message, trying fallback');
              const { error: fallbackError } = await supabaseServer
                .from('conversation_participants')
                .upsert({
                  conversation_id: conversationId,
                  user_id: pendingRecipientId,
                }, { onConflict: 'conversation_id,user_id' });

              if (fallbackError) {
                console.error('[Chat API] Add/reveal pending participant error:', fallbackError);
              } else {
                // Use file-based fallback for hidden state
                setHidden(pendingRecipientId, conversationId, false);
                console.log('[Chat API] Activated pending conversation (fallback):', conversationId, 'recipient:', pendingRecipientId);
              }
            } else {
              console.log('[Chat API] Activated pending conversation:', conversationId, 'recipient:', pendingRecipientId);
            }

            // Clear the pending title marker
            await supabaseServer
              .from('conversations')
              .update({ title: null })
              .eq('id', conversationId);
          }
        }

        // Insert message
        const { data: message, error: msgError } = await supabaseServer
          .from('messages')
          .insert({
            conversation_id: conversationId,
            sender_id: senderId,
            content: content.trim(),
          })
          .select()
          .single();

        if (msgError) {
          console.error('[Chat API] Send message error:', msgError);
          return NextResponse.json({ error: 'فشل إرسال الرسالة' }, { status: 500 });
        }

        // Update conversation's updated_at
        await supabaseServer
          .from('conversations')
          .update({ updated_at: new Date().toISOString() })
          .eq('id', conversationId);

        // Get sender info
        const { data: sender } = await supabaseServer
          .from('users')
          .select('id, name, email, avatar_url, title_id, gender, role')
          .eq('id', senderId)
          .single();

        // ── Notify Socket.IO server to broadcast the message ──
        // This is critical for real-time delivery when the sender's
        // browser socket is disconnected (e.g., in Realtime/fallback mode).
        // Fetch participant IDs for the conversation first.
        try {
          const { data: convParticipants } = await supabaseServer
            .from('conversation_participants')
            .select('user_id')
            .eq('conversation_id', conversationId);

          const otherParticipantIds = (convParticipants || [])
            .map((p: { user_id: string }) => p.user_id)
            .filter((pid: string) => pid !== senderId);

          // Fire-and-forget: notify the Socket.IO server
          notifySocketServer({
            event: 'send-message',
            data: {
              conversationId,
              senderId,
              senderName: (sender as Record<string, unknown>)?.name as string || '',
              content: content.trim(),
              messageId: (message as Record<string, unknown>)?.id as string,
              createdAt: (message as Record<string, unknown>)?.created_at as string,
              participantIds: otherParticipantIds,
            },
            participantIds: otherParticipantIds,
          });

          // ── Send push notification for chat messages (PWA mobile) ──
          // This creates an in-app notification + push notification so that
          // users who are not actively viewing the chat still get notified
          // on their mobile devices via the PWA service worker.
          const senderName = (sender as Record<string, unknown>)?.name as string || 'مستخدم';
          const messagePreview = content.trim().substring(0, 100);
          notifyUsers(
            otherParticipantIds,
            'chat',
            `رسالة جديدة من ${senderName}`,
            messagePreview,
            `chat:${conversationId}`,
          ).catch((err) => {
            // Non-critical — the message is already in the DB
            console.warn('[Chat API] Failed to send push notification for chat message:', err);
          });
        } catch (notifyErr) {
          // Non-critical — the message is already in the DB
          console.warn('[Chat API] Failed to fetch participants for Socket.IO notification:', notifyErr);
        }

        return NextResponse.json({ message, sender: sender || null });
      }

      case 'create-individual': {
        const { userId1, userId2, subjectId } = body;
        if (!userId1 || !userId2) {
          return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
        }

        // Verify the authenticated user is userId1
        const createOwnershipError = verifyOwnership(authUserId, userId1);
        if (createOwnershipError) {
          return authErrorResponse(createOwnershipError);
        }

        // ── Role-based messaging authorization ──
        // Student:  can only message course teacher(s) and classmates
        // Teacher:  can only message other teachers + students in their courses
        // Admin/Supervisor: can message any teacher or student
        const { data: initiatorProfile } = await supabaseServer
          .from('users')
          .select('role')
          .eq('id', userId1)
          .maybeSingle();
        const initiatorRole = (initiatorProfile?.role as string) || '';

        if (initiatorRole === 'student') {
          // Student can only message: course teacher(s) or classmates
          const { data: studentEnrollments } = await supabaseServer
            .from('subject_students')
            .select('subject_id')
            .eq('student_id', userId1)
            .eq('status', 'approved');
          const enrolledSubjectIds = (studentEnrollments || []).map((e: { subject_id: string }) => e.subject_id);

          let isAuthorized = false;
          if (enrolledSubjectIds.length > 0) {
            // Check if userId2 is the teacher of any of the student's courses
            const { data: teacherSubjects } = await supabaseServer
              .from('subjects')
              .select('id')
              .eq('teacher_id', userId2)
              .in('id', enrolledSubjectIds);
            if (teacherSubjects && teacherSubjects.length > 0) {
              isAuthorized = true;
            }

            // Check if userId2 is a classmate (enrolled in same course)
            if (!isAuthorized) {
              const { data: classmateEnrollments } = await supabaseServer
                .from('subject_students')
                .select('subject_id')
                .eq('student_id', userId2)
                .eq('status', 'approved')
                .in('subject_id', enrolledSubjectIds);
              if (classmateEnrollments && classmateEnrollments.length > 0) {
                isAuthorized = true;
              }
            }
          }

          if (!isAuthorized) {
            return NextResponse.json({ error: 'غير مسموح لك بمراسلة هذا المستخدم' }, { status: 403 });
          }
        } else if (initiatorRole === 'teacher') {
          // Teacher can message: other teachers OR students in their courses
          const { data: targetProfile } = await supabaseServer
            .from('users')
            .select('role')
            .eq('id', userId2)
            .maybeSingle();
          const targetRole = (targetProfile?.role as string) || '';

          if (targetRole === 'teacher') {
            // Teachers can always message other teachers — authorized
          } else if (targetRole === 'student') {
            // Check if this student is enrolled in any of the teacher's courses
            const { data: teacherSubjects } = await supabaseServer
              .from('subjects')
              .select('id')
              .eq('teacher_id', userId1);
            if (teacherSubjects && teacherSubjects.length > 0) {
              const teacherSubjectIds = teacherSubjects.map((s: { id: string }) => s.id);
              const { data: studentEnrollment } = await supabaseServer
                .from('subject_students')
                .select('subject_id')
                .eq('student_id', userId2)
                .in('subject_id', teacherSubjectIds)
                .limit(1);
              if (!studentEnrollment || studentEnrollment.length === 0) {
                return NextResponse.json({ error: 'غير مسموح لك بمراسلة هذا المستخدم' }, { status: 403 });
              }
            } else {
              // Teacher has no courses — cannot message any student
              return NextResponse.json({ error: 'غير مسموح لك بمراسلة هذا المستخدم' }, { status: 403 });
            }
          } else {
            // Cannot message admins/supervisors
            return NextResponse.json({ error: 'غير مسموح لك بمراسلة هذا المستخدم' }, { status: 403 });
          }
        }
        // Admin/supervisor: no restrictions (can message any teacher or student)

        // ── Check 1: Fully established conversation (both participants) ──
        const { data: existingParts } = await supabaseServer
          .from('conversation_participants')
          .select('conversation_id')
          .eq('user_id', userId1);

        const existingConvIds = (existingParts || []).map((p: { conversation_id: string }) => p.conversation_id);
        let individualConvs: Record<string, unknown>[] = [];
        if (existingConvIds.length > 0) {
          const { data } = await supabaseServer
            .from('conversations')
            .select('id, type, subject_id, title')
            .in('id', existingConvIds)
            .eq('type', 'individual');
          individualConvs = (data || []) as Record<string, unknown>[];
        }

        // Check each individual conversation to see if userId2 is also a participant
        for (const conv of individualConvs) {
          const convId = conv.id as string;
          const convTitle = (conv.title as string) || '';

          // Skip pending conversations — they are handled by Check 2 and Check 3
          if (convTitle.startsWith('pending:')) continue;

          const { data: otherPart } = await supabaseServer
            .from('conversation_participants')
            .select('user_id')
            .eq('conversation_id', convId)
            .eq('user_id', userId2);

          if (otherPart && otherPart.length > 0) {
            if (conv?.subject_id === subjectId || (!conv?.subject_id && !subjectId) || !subjectId) {
              // ── Revive soft-deleted (hidden) conversation ──
              // If the requesting user previously deleted this conversation (is_hidden=true),
              // unhide them so they can see it again.
              const { data: myPart } = await supabaseServer
                .from('conversation_participants')
                .select('is_hidden')
                .eq('conversation_id', convId)
                .eq('user_id', userId1)
                .maybeSingle();

              if (myPart?.is_hidden) {
                const { error: unhideError } = await supabaseServer
                  .from('conversation_participants')
                  .update({ is_hidden: false })
                  .eq('conversation_id', convId)
                  .eq('user_id', userId1);
                if (unhideError) {
                  // is_hidden column might not exist — use file fallback
                  setHidden(userId1, convId, false);
                }
              }
              return NextResponse.json({ conversation: conv, existed: true });
            }
          }
        }

        // ── Check 2: Pending conversation created by userId1 for userId2 ──
        // (userId1 opened a chat with userId2 before but never sent a message)
        for (const conv of individualConvs) {
          const convTitle = conv.title || (conv as Record<string, unknown>).title as string;
          if (convTitle === `pending:${userId2}`) {
            // Found userId1's own pending conversation — reuse it
            return NextResponse.json({ conversation: conv, existed: true });
          }
        }

        // ── Check 3: Pending conversation created by userId2 for userId1 ──
        // (userId2 opened a chat with userId1 before but never sent a message)
        const { data: otherUserParts } = await supabaseServer
          .from('conversation_participants')
          .select('conversation_id')
          .eq('user_id', userId2);

        const otherConvIds = (otherUserParts || []).map((p: { conversation_id: string }) => p.conversation_id);
        if (otherConvIds.length > 0) {
          const { data: pendingConvs } = await supabaseServer
            .from('conversations')
            .select('id, type, subject_id, title')
            .in('id', otherConvIds)
            .eq('type', 'individual')
            .eq('title', `pending:${userId1}`);

          if (pendingConvs && pendingConvs.length > 0) {
            // Found userId2's pending conversation for userId1
            // With the is_hidden pattern, userId1 is already a participant but hidden.
            // Reveal them (is_hidden=false) and clear the pending title so both users
            // can see the conversation — both have explicitly opened each other's chat.
            const existingConv = pendingConvs[0] as Record<string, unknown>;
            const existingConvId = existingConv.id as string;

            // Reveal userId1 (set is_hidden = false)
            const { error: revealError } = await supabaseServer
              .from('conversation_participants')
              .update({ is_hidden: false })
              .eq('conversation_id', existingConvId)
              .eq('user_id', userId1);

            if (revealError) {
              // is_hidden column might not exist — try upsert without it
              console.warn('[Chat API] Check 3: is_hidden column missing, using upsert fallback');
              await supabaseServer
                .from('conversation_participants')
                .upsert({
                  conversation_id: existingConvId,
                  user_id: userId1,
                }, { onConflict: 'conversation_id,user_id' });
              setHidden(userId1, existingConvId, false);
            }

            // Clear the pending title
            await supabaseServer
              .from('conversations')
              .update({ title: null })
              .eq('id', existingConvId);

            const activatedConv = { ...existingConv, title: null };
            return NextResponse.json({ conversation: activatedConv, existed: true });
          }
        }

        // ── No existing conversation found — create a new one ──
        // We add BOTH users as participants:
        //   - Initiator (userId1): is_hidden = false  → visible in their list
        //   - Recipient  (userId2): is_hidden = true   → HIDDEN until first message
        // The pending title "pending:${userId2}" tracks that the recipient is hidden.
        // When the first message is sent, is_hidden is set to false for the recipient.
        const { data: newConv, error: createError } = await supabaseServer
          .from('conversations')
          .insert({
            type: 'individual',
            subject_id: subjectId || null,
            title: `pending:${userId2}`,
          })
          .select()
          .single();

        if (createError || !newConv) {
          console.error('[Chat API] Create conversation error:', createError);
          return NextResponse.json({ error: 'فشل إنشاء المحادثة' }, { status: 500 });
        }

        // Add BOTH users as participants (initiator visible, recipient hidden)
        const { error: partInsertError } = await supabaseServer
          .from('conversation_participants')
          .insert([
            { conversation_id: newConv.id, user_id: userId1, is_hidden: false },
            { conversation_id: newConv.id, user_id: userId2, is_hidden: true },
          ]);

        if (partInsertError) {
          // is_hidden column might not exist — fall back to only adding the initiator
          // (recipient will NOT be a participant, which prevents them from seeing the conversation)
          console.warn('[Chat API] is_hidden column may not exist, falling back to initiator-only participant');
          await supabaseServer
            .from('conversation_participants')
            .insert({ conversation_id: newConv.id, user_id: userId1 });
        }

        return NextResponse.json({ conversation: newConv, existed: false });
      }

      case 'mark-read': {
        const { conversationId, userId } = body;
        if (!conversationId || !userId) {
          return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
        }

        // Verify the authenticated user matches userId
        const markReadOwnershipError = verifyOwnership(authUserId, userId);
        if (markReadOwnershipError) {
          return authErrorResponse(markReadOwnershipError);
        }

        await supabaseServer
          .from('conversation_participants')
          .update({ last_read_at: new Date().toISOString() })
          .eq('conversation_id', conversationId)
          .eq('user_id', userId);

        return NextResponse.json({ success: true });
      }

      case 'ensure-group': {
        const { subjectId, teacherId } = body;
        if (!subjectId) {
          return NextResponse.json({ error: 'subjectId required' }, { status: 400 });
        }

        // Check if group conversation exists
        const { data: existing } = await supabaseServer
          .from('conversations')
          .select('*')
          .eq('subject_id', subjectId)
          .eq('type', 'group')
          .maybeSingle();

        if (existing) {
          return NextResponse.json({ conversation: existing, existed: true });
        }

        // Get subject name for title
        const { data: subject } = await supabaseServer
          .from('subjects')
          .select('name')
          .eq('id', subjectId)
          .single();

        const title = subject?.name ? `${subject.name} - محادثة المقرر` : 'محادثة المقرر';

        // Create group conversation
        const { data: newConv, error: createError } = await supabaseServer
          .from('conversations')
          .insert({
            type: 'group',
            subject_id: subjectId,
            title,
          })
          .select()
          .single();

        if (createError || !newConv) {
          console.error('[Chat API] Create group error:', createError);
          return NextResponse.json({ error: 'فشل إنشاء محادثة المقرر' }, { status: 500 });
        }

        // Add teacher as participant
        if (teacherId) {
          await supabaseServer
            .from('conversation_participants')
            .insert({ conversation_id: newConv.id, user_id: teacherId });
        }

        // Add all enrolled students as participants
        const { data: students } = await supabaseServer
          .from('subject_students')
          .select('student_id')
          .eq('subject_id', subjectId);

        if (students && students.length > 0) {
          const participants = students.map((s: { student_id: string }) => ({
            conversation_id: newConv.id,
            user_id: s.student_id,
          }));
          await supabaseServer
            .from('conversation_participants')
            .insert(participants);
        }

        return NextResponse.json({ conversation: newConv, existed: false });
      }

      case 'delete-message': {
        const { messageId, userId } = body;
        if (!messageId || !userId) {
          return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
        }

        // Verify the authenticated user matches userId
        const deleteMsgOwnershipError = verifyOwnership(authUserId, userId);
        if (deleteMsgOwnershipError) {
          return authErrorResponse(deleteMsgOwnershipError);
        }

        // Verify the user is the sender
        const { data: msg } = await supabaseServer
          .from('messages')
          .select('id, sender_id, conversation_id')
          .eq('id', messageId)
          .single();

        if (!msg) {
          return NextResponse.json({ error: 'الرسالة غير موجودة' }, { status: 404 });
        }

        if (msg.sender_id !== userId) {
          return NextResponse.json({ error: 'لا يمكنك حذف رسالة لا تخصك' }, { status: 403 });
        }

        // Try to update with is_deleted column
        const { error: updateError } = await supabaseServer
          .from('messages')
          .update({
            content: 'تم حذف هذه الرسالة',
            is_deleted: true,
          })
          .eq('id', messageId);

        // If is_deleted column doesn't exist, just update content
        if (updateError) {
          await supabaseServer
            .from('messages')
            .update({ content: 'تم حذف هذه الرسالة' })
            .eq('id', messageId);
        }

        return NextResponse.json({ success: true, messageId });
      }

      case 'edit-message': {
        const { messageId, userId, content } = body;
        if (!messageId || !userId || !content?.trim()) {
          return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
        }

        // Verify the authenticated user matches userId
        const editMsgOwnershipError = verifyOwnership(authUserId, userId);
        if (editMsgOwnershipError) {
          return authErrorResponse(editMsgOwnershipError);
        }

        // Verify the user is the sender
        const { data: msg } = await supabaseServer
          .from('messages')
          .select('id, sender_id, is_deleted')
          .eq('id', messageId)
          .single();

        if (!msg) {
          return NextResponse.json({ error: 'الرسالة غير موجودة' }, { status: 404 });
        }

        if (msg.sender_id !== userId) {
          return NextResponse.json({ error: 'لا يمكنك تعديل رسالة لا تخصك' }, { status: 403 });
        }

        if (msg.is_deleted) {
          return NextResponse.json({ error: 'لا يمكنك تعديل رسالة محذوفة' }, { status: 400 });
        }

        // Try to update with is_edited and edited_at columns
        const { error: updateError } = await supabaseServer
          .from('messages')
          .update({
            content: content.trim(),
            is_edited: true,
            edited_at: new Date().toISOString(),
          })
          .eq('id', messageId);

        // If edited_at column doesn't exist, retry without it
        if (updateError) {
          const { error: retryError } = await supabaseServer
            .from('messages')
            .update({
              content: content.trim(),
              is_edited: true,
            })
            .eq('id', messageId);

          if (retryError) {
            // If is_edited also doesn't exist, just update content
            await supabaseServer
              .from('messages')
              .update({ content: content.trim() })
              .eq('id', messageId);
          }
        }

        return NextResponse.json({ success: true, messageId, content: content.trim() });
      }

      case 'delete-conversation': {
        const { conversationId, userId } = body;
        if (!conversationId || !userId) {
          return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
        }

        // Verify the authenticated user matches userId
        const deleteConvOwnershipError = verifyOwnership(authUserId, userId);
        if (deleteConvOwnershipError) {
          return authErrorResponse(deleteConvOwnershipError);
        }

        // Verify the user is a participant
        const { data: participation, error: partError } = await supabaseServer
          .from('conversation_participants')
          .select('user_id')
          .eq('conversation_id', conversationId)
          .eq('user_id', userId)
          .maybeSingle();

        if (partError) {
          console.error('[Chat API] Delete conv - participant check error:', partError);
        }

        if (!participation) {
          // User is not a participant — the conversation may have already been deleted.
          // Return success anyway so the client can clean up its local state.
          console.log('[Chat API] Delete conv - user not participant, returning success');
          return NextResponse.json({ success: true });
        }

        // For individual conversations: delete messages and the entire conversation
        // This ensures a fresh start if the same two users chat again
        const { data: convInfo } = await supabaseServer
          .from('conversations')
          .select('type')
          .eq('id', conversationId)
          .maybeSingle();

        if (convInfo?.type === 'individual') {
          // ── Soft-delete for individual conversations ──
          // Hide the conversation for this user ONLY (is_hidden=true).
          // The other participant can still see the conversation and all messages.
          // If both users later open each other's chat again, the conversation is revived.
          const { error: hideError } = await supabaseServer
            .from('conversation_participants')
            .update({ is_hidden: true })
            .eq('conversation_id', conversationId)
            .eq('user_id', userId);

          if (hideError) {
            // is_hidden column might not exist — fall back to removing only this user's participant record
            // DO NOT delete messages, other participants, or the conversation itself
            console.warn('[Chat API] is_hidden column missing for individual conv delete, removing participant record only');
            const { error: deletePartError } = await supabaseServer
              .from('conversation_participants')
              .delete()
              .eq('conversation_id', conversationId)
              .eq('user_id', userId);

            if (deletePartError) {
              console.error('[Chat API] Delete participant error:', deletePartError);
              return NextResponse.json({ error: 'فشل حذف المحادثة' }, { status: 500 });
            }

            // Use file-based fallback for hidden state
            setHidden(userId, conversationId, true);
          }

          console.log('[Chat API] Delete conv - individual conversation hidden for user:', conversationId, userId);
        } else {
          // For group conversations: use soft-delete (hide for this user only)
          // Other participants should still see the group chat
          const { error: hideError } = await supabaseServer
            .from('conversation_participants')
            .update({ is_hidden: true })
            .eq('conversation_id', conversationId)
            .eq('user_id', userId);

          if (hideError) {
            // If is_hidden column doesn't exist, fall back to removing participant
            console.warn('[Chat API] is_hidden column missing, falling back to participant removal');
            const { error: deleteError } = await supabaseServer
              .from('conversation_participants')
              .delete()
              .eq('conversation_id', conversationId)
              .eq('user_id', userId);
            if (deleteError) {
              console.error('[Chat API] Delete conversation error:', deleteError);
              return NextResponse.json({ error: 'فشل حذف المحادثة' }, { status: 500 });
            }
          }

          console.log('[Chat API] Delete conv - group conversation hidden for user:', conversationId, userId);
        }

        return NextResponse.json({ success: true });
      }

      case 'delete-all-conversations': {
        const { userId } = body;
        if (!userId) {
          return NextResponse.json({ error: 'userId required' }, { status: 400 });
        }

        // Verify the authenticated user matches userId
        const deleteAllOwnershipError = verifyOwnership(authUserId, userId);
        if (deleteAllOwnershipError) {
          return authErrorResponse(deleteAllOwnershipError);
        }

        // Get all conversations for this user
        const { data: participations } = await supabaseServer
          .from('conversation_participants')
          .select('conversation_id')
          .eq('user_id', userId);

        if (!participations || participations.length === 0) {
          return NextResponse.json({ success: true, deletedCount: 0 });
        }

        const convIds = participations.map((p: { conversation_id: string }) => p.conversation_id);

        // Separate individual vs group conversations
        const { data: convsData } = await supabaseServer
          .from('conversations')
          .select('id, type')
          .in('id', convIds);

        const individualConvIds = (convsData || [])
          .filter((c: { type: string }) => c.type === 'individual')
          .map((c: { id: string }) => c.id);
        const groupConvIds = (convsData || [])
          .filter((c: { type: string }) => c.type !== 'individual')
          .map((c: { id: string }) => c.id);

        // For individual conversations: soft-delete (hide for this user only)
        // The other participant can still see the conversation and all messages
        if (individualConvIds.length > 0) {
          const { error: hideError } = await supabaseServer
            .from('conversation_participants')
            .update({ is_hidden: true })
            .eq('user_id', userId)
            .in('conversation_id', individualConvIds);

          if (hideError) {
            // is_hidden column might not exist — fall back to removing only this user's participant records
            console.warn('[Chat API] is_hidden column missing for bulk individual delete, removing participant records only');
            await supabaseServer
              .from('conversation_participants')
              .delete()
              .eq('user_id', userId)
              .in('conversation_id', individualConvIds);

            // Use file-based fallback for hidden state
            for (const convId of individualConvIds) {
              setHidden(userId, convId, true);
            }
          }
        }

        // For group conversations: soft-delete (hide for this user only)
        if (groupConvIds.length > 0) {
          const { error: hideError } = await supabaseServer
            .from('conversation_participants')
            .update({ is_hidden: true })
            .eq('user_id', userId)
            .in('conversation_id', groupConvIds);

          if (hideError) {
            // Fallback: remove participant record
            await supabaseServer
              .from('conversation_participants')
              .delete()
              .eq('user_id', userId)
              .in('conversation_id', groupConvIds);
          }
        }

        return NextResponse.json({ success: true, deletedCount: convIds.length });
      }

      case 'archive-conversation': {
        const { conversationId, userId } = body;
        if (!conversationId || !userId) {
          return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
        }

        // Verify the authenticated user matches userId
        const archiveOwnershipError = verifyOwnership(authUserId, userId);
        if (archiveOwnershipError) {
          return authErrorResponse(archiveOwnershipError);
        }

        // Try database column first, fall back to file-based store
        const { error: archiveError } = await supabaseServer
          .from('conversation_participants')
          .update({ is_archived: true })
          .eq('conversation_id', conversationId)
          .eq('user_id', userId);

        if (archiveError) {
          // Column likely doesn't exist — use file-based fallback
          if (archiveError.message.includes('is_archived') || archiveError.message.includes('does not exist') || archiveError.message.includes('column')) {
            console.log('[Chat API] is_archived column missing, using file-based fallback');
            setArchived(userId, conversationId, true);
            return NextResponse.json({ success: true });
          }
          console.error('[Chat API] Archive conversation error:', archiveError);
          return NextResponse.json({ error: 'فشل أرشفة المحادثة' }, { status: 500 });
        }

        return NextResponse.json({ success: true });
      }

      case 'unarchive-conversation': {
        const { conversationId, userId } = body;
        if (!conversationId || !userId) {
          return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
        }

        // Verify the authenticated user matches userId
        const unarchiveOwnershipError = verifyOwnership(authUserId, userId);
        if (unarchiveOwnershipError) {
          return authErrorResponse(unarchiveOwnershipError);
        }

        // Try database column first, fall back to file-based store
        const { error: unarchiveError } = await supabaseServer
          .from('conversation_participants')
          .update({ is_archived: false })
          .eq('conversation_id', conversationId)
          .eq('user_id', userId);

        if (unarchiveError) {
          // Column likely doesn't exist — use file-based fallback
          if (unarchiveError.message.includes('is_archived') || unarchiveError.message.includes('does not exist') || unarchiveError.message.includes('column')) {
            console.log('[Chat API] is_archived column missing, using file-based fallback');
            setArchived(userId, conversationId, false);
            return NextResponse.json({ success: true });
          }
          console.error('[Chat API] Unarchive conversation error:', unarchiveError);
          return NextResponse.json({ error: 'فشل إلغاء أرشفة المحادثة' }, { status: 500 });
        }

        return NextResponse.json({ success: true });
      }

      case 'migrate-chat-columns': {
        // This action attempts to add is_hidden and is_archived columns
        // Note: Supabase client SDK doesn't support ALTER TABLE, so this needs to be done via SQL
        // We'll just check if the columns exist and report back
        const { error: checkHidden } = await supabaseServer
          .from('conversation_participants')
          .select('is_hidden')
          .limit(1);
        const { error: checkArchived } = await supabaseServer
          .from('conversation_participants')
          .select('is_archived')
          .limit(1);

        return NextResponse.json({
          is_hidden_exists: !checkHidden,
          is_archived_exists: !checkArchived,
          sql: `
-- Run this SQL in Supabase SQL Editor to add the required columns:
ALTER TABLE conversation_participants ADD COLUMN IF NOT EXISTS is_hidden BOOLEAN DEFAULT FALSE;
ALTER TABLE conversation_participants ADD COLUMN IF NOT EXISTS is_archived BOOLEAN DEFAULT FALSE;
          `.trim(),
        });
      }

      default:
        return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }
  } catch (error) {
    console.error('[Chat API] POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

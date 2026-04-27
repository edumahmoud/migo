import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';

/**
 * Chat API Route
 * 
 * GET: Fetch conversations or messages
 * POST: Send message, create conversation, mark as read, delete/edit message, archive/hide conversation
 */

// Helper: try to add columns if they don't exist
async function ensureColumns() {
  try {
    // Try selecting is_hidden from conversation_participants to check if column exists
    const { error } = await supabaseServer
      .from('conversation_participants')
      .select('is_hidden')
      .limit(1);
    if (error && error.message.includes('does not exist')) {
      console.log('[Chat API] is_hidden column missing, attempting to add...');
      // We can't ALTER TABLE via the client SDK, so log a message
      // The columns need to be added manually or via migration
    }
  } catch {
    // Ignore
  }
}
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');

  try {
    switch (action) {
      case 'conversations': {
        const userId = searchParams.get('userId');
        const includeArchived = searchParams.get('includeArchived') === 'true';
        if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 });

        // Step 1: Get all conversation IDs the user is part of (not hidden)
        // Try selecting is_hidden and is_archived columns; fall back gracefully if they don't exist
        let participationsQuery = supabaseServer
          .from('conversation_participants')
          .select('conversation_id, last_read_at, is_hidden, is_archived')
          .eq('user_id', userId);

        let { data: participations, error: pError } = await participationsQuery;

        // If is_hidden/is_archived columns don't exist, retry without them
        if (pError && (pError.message.includes('is_hidden') || pError.message.includes('is_archived'))) {
          const fallback = await supabaseServer
            .from('conversation_participants')
            .select('conversation_id, last_read_at')
            .eq('user_id', userId);
          participations = fallback.data;
          pError = fallback.error;
          // Add default values for missing columns
          if (participations) {
            participations = participations.map((p: Record<string, unknown>) => ({
              ...p,
              is_hidden: false,
              is_archived: false,
            }));
          }
        }

        if (pError) {
          console.error('[Chat API] Conversations error:', pError);
          return NextResponse.json({ error: pError.message }, { status: 500 });
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
          return NextResponse.json({ error: convsError.message }, { status: 500 });
        }

        // Step 3: For each conversation, get last message and unread count
        const conversations = await Promise.all(
          (convsData || []).map(async (conv: Record<string, unknown>) => {
            const convId = conv.id as string;
            const lastReadAt = lastReadMap.get(convId) || null;

            // Get last message
            const { data: lastMsgs } = await supabaseServer
              .from('messages')
              .select('id, sender_id, content, created_at')
              .eq('conversation_id', convId)
              .order('created_at', { ascending: false })
              .limit(1);

            // Get unread count
            let unreadCount = 0;
            if (lastReadAt) {
              const { count } = await supabaseServer
                .from('messages')
                .select('id', { count: 'exact', head: true })
                .eq('conversation_id', convId)
                .gt('created_at', lastReadAt)
                .neq('sender_id', userId);
              unreadCount = count || 0;
            } else {
              const { count } = await supabaseServer
                .from('messages')
                .select('id', { count: 'exact', head: true })
                .eq('conversation_id', convId)
                .neq('sender_id', userId);
              unreadCount = count || 0;
            }

            // Get other participant for individual chats
            let otherParticipant = null;
            if (conv.type === 'individual') {
              const { data: otherParts } = await supabaseServer
                .from('conversation_participants')
                .select('user_id')
                .eq('conversation_id', convId)
                .neq('user_id', userId)
                .limit(1);

              if (otherParts && otherParts.length > 0) {
                const otherUserId = (otherParts[0] as { user_id: string }).user_id;
                const { data: otherUser } = await supabaseServer
                  .from('users')
                  .select('id, name, email, avatar_url, title_id, gender, role')
                  .eq('id', otherUserId)
                  .single();
                otherParticipant = otherUser || null;
              }
            }

            return {
              id: convId,
              type: conv.type,
              subjectId: conv.subject_id,
              title: conv.title,
              createdAt: conv.created_at,
              updatedAt: conv.updated_at,
              lastReadAt,
              lastMessage: lastMsgs?.[0] || null,
              unreadCount,
              otherParticipant,
            };
          })
        );

        // Sort by updated_at (most recent first)
        const sorted = conversations
          .filter(Boolean)
          .sort((a, b) => new Date((b as Record<string, unknown>).updatedAt as string || (b as Record<string, unknown>).createdAt as string).getTime() - new Date((a as Record<string, unknown>).updatedAt as string || (a as Record<string, unknown>).createdAt as string).getTime());

        // Also fetch archived conversations details
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
            archivedConversations = await Promise.all(
              archivedConvsData.map(async (conv: Record<string, unknown>) => {
                const convId = conv.id as string;
                const lastReadAt = archivedLastReadMap.get(convId) || null;
                const { data: lastMsgs } = await supabaseServer
                  .from('messages')
                  .select('id, sender_id, content, created_at')
                  .eq('conversation_id', convId)
                  .order('created_at', { ascending: false })
                  .limit(1);
                let otherParticipant = null;
                if (conv.type === 'individual') {
                  const { data: otherParts } = await supabaseServer
                    .from('conversation_participants')
                    .select('user_id')
                    .eq('conversation_id', convId)
                    .neq('user_id', userId)
                    .limit(1);
                  if (otherParts && otherParts.length > 0) {
                    const otherUserId = (otherParts[0] as { user_id: string }).user_id;
                    const { data: otherUser } = await supabaseServer
                      .from('users')
                      .select('id, name, email, avatar_url, title_id, gender, role')
                      .eq('id', otherUserId)
                      .single();
                    otherParticipant = otherUser || null;
                  }
                }
                return {
                  id: convId,
                  type: conv.type,
                  subjectId: conv.subject_id,
                  title: conv.title,
                  createdAt: conv.created_at,
                  updatedAt: conv.updated_at,
                  lastReadAt,
                  lastMessage: lastMsgs?.[0] || null,
                  unreadCount: 0,
                  otherParticipant,
                  isArchived: true,
                };
              })
            );
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
          console.error('[Chat API] Messages error:', error);
          return NextResponse.json({ error: error.message }, { status: 500 });
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

        if (!subjectId || !query) return NextResponse.json({ error: 'subjectId and query required' }, { status: 400 });

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

        const allUsers = [
          ...studentUsers,
          teacherUser,
        ]
          .filter(Boolean)
          .filter((u: Record<string, unknown>) => u.id !== userId)
          .filter((u: Record<string, unknown>) =>
            (u.name as string || '').toLowerCase().includes(query.toLowerCase()) ||
            (u.email as string || '').toLowerCase().includes(query.toLowerCase())
          );

        // Remove duplicates
        const unique = Array.from(new Map(allUsers.map((u: Record<string, unknown>) => [u.id, u])).values());

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

    switch (action) {
      case 'send-message': {
        const { conversationId, senderId, content } = body;
        if (!conversationId || !senderId || !content) {
          return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
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

        return NextResponse.json({ message, sender: sender || null });
      }

      case 'create-individual': {
        const { userId1, userId2, subjectId } = body;
        if (!userId1 || !userId2) {
          return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
        }

        // Check if conversation already exists between these two users
        const { data: existingParts } = await supabaseServer
          .from('conversation_participants')
          .select('conversation_id')
          .eq('user_id', userId1);

        // Get the actual conversation details for those IDs
        const existingConvIds = (existingParts || []).map((p: { conversation_id: string }) => p.conversation_id);
        let individualConvs: Record<string, unknown>[] = [];
        if (existingConvIds.length > 0) {
          const { data } = await supabaseServer
            .from('conversations')
            .select('id, type, subject_id')
            .in('id', existingConvIds)
            .eq('type', 'individual');
          individualConvs = (data || []) as Record<string, unknown>[];
        }

        // Check each individual conversation to see if userId2 is also a participant
        for (const conv of individualConvs) {
          const convId = conv.id as string;

          const { data: otherPart } = await supabaseServer
            .from('conversation_participants')
            .select('user_id')
            .eq('conversation_id', convId)
            .eq('user_id', userId2);

          if (otherPart && otherPart.length > 0) {
            if (conv?.subject_id === subjectId || (!conv?.subject_id && !subjectId) || !subjectId) {
              return NextResponse.json({ conversation: conv, existed: true });
            }
          }
        }

        // Create new individual conversation
        const { data: newConv, error: createError } = await supabaseServer
          .from('conversations')
          .insert({
            type: 'individual',
            subject_id: subjectId || null,
          })
          .select()
          .single();

        if (createError || !newConv) {
          console.error('[Chat API] Create conversation error:', createError);
          return NextResponse.json({ error: 'فشل إنشاء المحادثة' }, { status: 500 });
        }

        // Add both users as participants
        await supabaseServer
          .from('conversation_participants')
          .insert([
            { conversation_id: newConv.id, user_id: userId1 },
            { conversation_id: newConv.id, user_id: userId2 },
          ]);

        return NextResponse.json({ conversation: newConv, existed: false });
      }

      case 'mark-read': {
        const { conversationId, userId } = body;
        if (!conversationId || !userId) {
          return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
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

        // Verify the user is a participant
        const { data: participation } = await supabaseServer
          .from('conversation_participants')
          .select('user_id')
          .eq('conversation_id', conversationId)
          .eq('user_id', userId)
          .single();

        if (!participation) {
          return NextResponse.json({ error: 'لست مشاركاً في هذه المحادثة' }, { status: 403 });
        }

        // Soft delete: set is_hidden = true for this user (don't delete the participant record)
        // This way the other user is not affected
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

        return NextResponse.json({ success: true });
      }

      case 'delete-all-conversations': {
        const { userId } = body;
        if (!userId) {
          return NextResponse.json({ error: 'userId required' }, { status: 400 });
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

        // Soft delete: set is_hidden = true for all user's conversations
        const { error: hideError } = await supabaseServer
          .from('conversation_participants')
          .update({ is_hidden: true })
          .eq('user_id', userId)
          .in('conversation_id', convIds);

        if (hideError) {
          // Fallback: try deleting individual conversations only
          const { data: individualConvs } = await supabaseServer
            .from('conversations')
            .select('id')
            .in('id', convIds)
            .eq('type', 'individual');

          if (!individualConvs || individualConvs.length === 0) {
            return NextResponse.json({ success: true, deletedCount: 0 });
          }

          const individualConvIds = individualConvs.map((c: { id: string }) => c.id);

          const { error: deleteError } = await supabaseServer
            .from('conversation_participants')
            .delete()
            .eq('user_id', userId)
            .in('conversation_id', individualConvIds);

          if (deleteError) {
            console.error('[Chat API] Delete all conversations error:', deleteError);
            return NextResponse.json({ error: 'فشل حذف المحادثات' }, { status: 500 });
          }

          return NextResponse.json({ success: true, deletedCount: individualConvIds.length });
        }

        return NextResponse.json({ success: true, deletedCount: convIds.length });
      }

      case 'archive-conversation': {
        const { conversationId, userId } = body;
        if (!conversationId || !userId) {
          return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
        }

        // Set is_archived = true for this user
        const { error: archiveError } = await supabaseServer
          .from('conversation_participants')
          .update({ is_archived: true })
          .eq('conversation_id', conversationId)
          .eq('user_id', userId);

        if (archiveError) {
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

        // Set is_archived = false for this user
        const { error: unarchiveError } = await supabaseServer
          .from('conversation_participants')
          .update({ is_archived: false })
          .eq('conversation_id', conversationId)
          .eq('user_id', userId);

        if (unarchiveError) {
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

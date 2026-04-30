import { NextRequest, NextResponse } from 'next/server';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

function getAdminHeaders() {
  return {
    'apikey': SERVICE_ROLE_KEY,
    'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation',
  };
}

const CHAT_TABLES_SQL = `
-- =====================================================
-- ATTENDO CHAT SYSTEM - Database Schema
-- =====================================================

-- 1. Conversations table
CREATE TABLE IF NOT EXISTS public.conversations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  type VARCHAR(20) NOT NULL DEFAULT 'group' CHECK (type IN ('group', 'individual')),
  subject_id UUID REFERENCES public.subjects(id) ON DELETE CASCADE,
  title VARCHAR(255),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Conversation participants table
CREATE TABLE IF NOT EXISTS public.conversation_participants (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  joined_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_read_at TIMESTAMP WITH TIME ZONE,
  UNIQUE(conversation_id, user_id)
);

-- 3. Messages table
CREATE TABLE IF NOT EXISTS public.messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  is_deleted BOOLEAN DEFAULT FALSE,
  is_edited BOOLEAN DEFAULT FALSE,
  edited_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add columns to existing messages table (if they don't exist)
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT FALSE;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS is_edited BOOLEAN DEFAULT FALSE;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS edited_at TIMESTAMP WITH TIME ZONE;

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_conversations_subject ON public.conversations(subject_id);
CREATE INDEX IF NOT EXISTS idx_conversations_type ON public.conversations(type);
CREATE INDEX IF NOT EXISTS idx_conversation_participants_user ON public.conversation_participants(user_id);
CREATE INDEX IF NOT EXISTS idx_conversation_participants_conv ON public.conversation_participants(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON public.messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_created ON public.messages(created_at);
CREATE INDEX IF NOT EXISTS idx_messages_sender ON public.messages(sender_id);

-- Enable RLS
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

-- RLS Policies for conversations
DROP POLICY IF EXISTS "Users can view their conversations" ON public.conversations;
CREATE POLICY "Users can view their conversations" ON public.conversations
  FOR SELECT USING (
    id IN (SELECT conversation_id FROM public.conversation_participants WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Users can create conversations" ON public.conversations;
CREATE POLICY "Users can create conversations" ON public.conversations
  FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Users can update their conversations" ON public.conversations;
CREATE POLICY "Users can update their conversations" ON public.conversations
  FOR UPDATE USING (
    id IN (SELECT conversation_id FROM public.conversation_participants WHERE user_id = auth.uid())
  );

-- RLS Policies for conversation_participants
DROP POLICY IF EXISTS "Users can view their own participants" ON public.conversation_participants;
CREATE POLICY "Users can view their own participants" ON public.conversation_participants
  FOR SELECT USING (
    conversation_id IN (SELECT conversation_id FROM public.conversation_participants WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Users can add participants" ON public.conversation_participants;
CREATE POLICY "Users can add participants" ON public.conversation_participants
  FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Users can update their own participation" ON public.conversation_participants;
CREATE POLICY "Users can update their own participation" ON public.conversation_participants
  FOR UPDATE USING (user_id = auth.uid());

-- RLS Policies for messages
DROP POLICY IF EXISTS "Users can view messages in their conversations" ON public.messages;
CREATE POLICY "Users can view messages in their conversations" ON public.messages
  FOR SELECT USING (
    conversation_id IN (SELECT conversation_id FROM public.conversation_participants WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Participants can send messages" ON public.messages;
CREATE POLICY "Participants can send messages" ON public.messages
  FOR INSERT WITH CHECK (
    conversation_id IN (SELECT conversation_id FROM public.conversation_participants WHERE user_id = auth.uid())
  );

-- Allow users to update their own messages (for edit/delete)
DROP POLICY IF EXISTS "Users can update their own messages" ON public.messages;
CREATE POLICY "Users can update their own messages" ON public.messages
  FOR UPDATE USING (sender_id = auth.uid());

-- Grant permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON public.conversations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.conversation_participants TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.messages TO authenticated;

GRANT SELECT, INSERT, UPDATE ON public.conversations TO anon;
GRANT SELECT, INSERT, UPDATE ON public.conversation_participants TO anon;
GRANT SELECT, INSERT, UPDATE ON public.messages TO anon;

-- Function to auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update conversations.updated_at
DROP TRIGGER IF EXISTS update_conversations_updated_at ON public.conversations;
CREATE TRIGGER update_conversations_updated_at
  BEFORE UPDATE ON public.conversations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Function to auto-create group conversation when a subject is created
CREATE OR REPLACE FUNCTION public.auto_create_group_conversation()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.conversations (type, subject_id, title)
  VALUES ('group', NEW.id, NEW.name || ' - محادثة المقرر');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_subject_created ON public.subjects;
CREATE TRIGGER on_subject_created
  AFTER INSERT ON public.subjects
  FOR EACH ROW EXECUTE FUNCTION public.auto_create_group_conversation();

-- Function to auto-add user to group conversation when enrolled
CREATE OR REPLACE FUNCTION public.auto_add_to_group_conversation()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'approved' OR (NEW.status IS NULL AND OLD IS NULL) THEN
    INSERT INTO public.conversation_participants (conversation_id, user_id)
    SELECT c.id, NEW.student_id
    FROM public.conversations c
    WHERE c.subject_id = NEW.subject_id AND c.type = 'group'
    ON CONFLICT (conversation_id, user_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_student_enrolled ON public.subject_students;
CREATE TRIGGER on_student_enrolled
  AFTER INSERT OR UPDATE OF status ON public.subject_students
  FOR EACH ROW
  WHEN (NEW.status = 'approved' OR (NEW.status IS NULL))
  EXECUTE FUNCTION public.auto_add_to_group_conversation();

-- Also add teacher to group conversation
CREATE OR REPLACE FUNCTION public.auto_add_teacher_to_conversation()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.conversation_participants (conversation_id, user_id)
  SELECT c.id, NEW.teacher_id
  FROM public.conversations c
  WHERE c.subject_id = NEW.id AND c.type = 'group'
  ON CONFLICT (conversation_id, user_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_subject_created_add_teacher ON public.subjects;
CREATE TRIGGER on_subject_created_add_teacher
  AFTER INSERT ON public.subjects
  FOR EACH ROW EXECUTE FUNCTION public.auto_add_teacher_to_conversation();

-- Auto-add existing subjects' teachers to conversations (backfill)
INSERT INTO public.conversation_participants (conversation_id, user_id)
SELECT c.id, s.teacher_id
FROM public.conversations c
JOIN public.subjects s ON s.id = c.subject_id
WHERE c.type = 'group'
ON CONFLICT (conversation_id, user_id) DO NOTHING;

-- Auto-add existing enrolled students to conversations (backfill)
INSERT INTO public.conversation_participants (conversation_id, user_id)
SELECT c.id, ss.student_id
FROM public.conversations c
JOIN public.subject_students ss ON ss.subject_id = c.subject_id
WHERE c.type = 'group' AND (ss.status = 'approved' OR ss.status IS NULL)
ON CONFLICT (conversation_id, user_id) DO NOTHING;

`.trim();

/**
 * GET: Check if chat tables exist and return SQL + setup info
 */
export async function GET() {
  const projectRef = SUPABASE_URL.replace('https://', '').replace('.supabase.co', '');
  
  // Check if tables exist
  let tablesExist = false;
  try {
    const checkRes = await fetch(
      `${SUPABASE_URL}/rest/v1/conversations?select=id&limit=1`,
      { headers: getAdminHeaders() }
    );
    tablesExist = checkRes.ok;
  } catch {
    tablesExist = false;
  }

  if (tablesExist) {
    // Ensure group conversations exist for all subjects
    await ensureGroupConversations();
    
    return NextResponse.json({
      status: 'ready',
      message: 'جداول المحادثات جاهزة! ✅',
      tablesExist: true,
    });
  }

  return NextResponse.json({
    status: 'pending',
    message: 'جداول المحادثات لسه متعملتش. شغّل الـ SQL في Supabase SQL Editor',
    tablesExist: false,
    sql: CHAT_TABLES_SQL,
    sqlEditorUrl: `https://supabase.com/dashboard/project/${projectRef}/sql/new`,
    steps: [
      '1. افتح لينك الـ SQL Editor',
      '2. انسخ الـ SQL و حطه في المحرر',
      '3. دوس Run',
      '4. ارجع افتح المحادثات تاني',
    ],
  });
}

/**
 * POST: Check and ensure group conversations exist for all subjects
 */
export async function POST() {
  let tablesExist = false;
  try {
    const checkRes = await fetch(
      `${SUPABASE_URL}/rest/v1/conversations?select=id&limit=1`,
      { headers: getAdminHeaders() }
    );
    tablesExist = checkRes.ok;
  } catch {
    tablesExist = false;
  }

  if (!tablesExist) {
    const projectRef = SUPABASE_URL.replace('https://', '').replace('.supabase.co', '');
    return NextResponse.json({
      success: false,
      error: 'Chat tables do not exist',
      sqlEditorUrl: `https://supabase.com/dashboard/project/${projectRef}/sql/new`,
      sql: CHAT_TABLES_SQL,
    }, { status: 400 });
  }

  // Tables exist - ensure group conversations for all subjects
  await ensureGroupConversations();

  return NextResponse.json({
    success: true,
    message: 'Chat tables ready, group conversations ensured',
  });
}

/**
 * Ensure group conversations exist for all subjects and all participants are added
 */
async function ensureGroupConversations() {
  try {
    // Get all subjects
    const subjectsRes = await fetch(
      `${SUPABASE_URL}/rest/v1/subjects?select=id,name,teacher_id`,
      { headers: getAdminHeaders() }
    );
    const subjects = await subjectsRes.json();

    for (const subject of subjects || []) {
      // Check if group conversation exists for this subject
      const convRes = await fetch(
        `${SUPABASE_URL}/rest/v1/conversations?select=id&type=eq.group&subject_id=eq.${subject.id}`,
        { headers: getAdminHeaders() }
      );
      const existingConvs = await convRes.json();

      if (!existingConvs?.length) {
        // Create group conversation
        const createRes = await fetch(`${SUPABASE_URL}/rest/v1/conversations`, {
          method: 'POST',
          headers: getAdminHeaders(),
          body: JSON.stringify({
            type: 'group',
            subject_id: subject.id,
            title: `${subject.name} - محادثة المقرر`,
          }),
        });
        const newConv = await createRes.json();

        if (newConv?.id || (Array.isArray(newConv) && newConv[0]?.id)) {
          const convId = Array.isArray(newConv) ? newConv[0].id : newConv.id;

          // Add teacher as participant
          if (subject.teacher_id) {
            await fetch(`${SUPABASE_URL}/rest/v1/conversation_participants`, {
              method: 'POST',
              headers: { ...getAdminHeaders(), 'Prefer': 'return=minimal' },
              body: JSON.stringify({
                conversation_id: convId,
                user_id: subject.teacher_id,
              }),
            });
          }

          // Add all enrolled students
          const studentsRes = await fetch(
            `${SUPABASE_URL}/rest/v1/subject_students?select=student_id&subject_id=eq.${subject.id}&or=(status.eq.approved,status.is.null)`,
            { headers: getAdminHeaders() }
          );
          const students = await studentsRes.json();

          if (students?.length) {
            const participants = students.map((s: { student_id: string }) => ({
              conversation_id: convId,
              user_id: s.student_id,
            }));
            await fetch(`${SUPABASE_URL}/rest/v1/conversation_participants`, {
              method: 'POST',
              headers: { ...getAdminHeaders(), 'Prefer': 'return=minimal' },
              body: JSON.stringify(participants),
            });
          }
        }
      }
    }
  } catch (err) {
    console.error('[Chat Setup] Error ensuring group conversations:', err);
  }
}

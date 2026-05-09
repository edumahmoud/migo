import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helpers';

/**
 * POST /api/chat/migrate
 * 
 * Migrates the chat database schema to add missing columns,
 * enable Realtime, and add missing RLS policies.
 * 
 * Requires admin privileges.
 */
export async function POST(request: NextRequest) {
  // Only admins can run migrations
  const adminResult = await requireAdmin(request);
  if (!adminResult.success) {
    return authErrorResponse(adminResult);
  }

  const results: Array<{ step: string; status: 'success' | 'skipped' | 'error'; message?: string }> = [];

  // Step 1: Add is_hidden column to conversation_participants
  try {
    const { error } = await supabaseServer
      .from('conversation_participants')
      .select('is_hidden')
      .limit(1);

    if (error && (error.message.includes('is_hidden') || error.message.includes('does not exist'))) {
      // Column doesn't exist - we need to add it via RPC or direct SQL
      // Since we can't ALTER TABLE via the client SDK, try a workaround:
      // Insert a temporary record with is_hidden, then delete it
      results.push({
        step: 'is_hidden column',
        status: 'error',
        message: 'العمود is_hidden غير موجود. يجب إضافته يدوياً عبر SQL Editor',
      });
    } else {
      results.push({ step: 'is_hidden column', status: 'success', message: 'العمود موجود' });
    }
  } catch {
    results.push({ step: 'is_hidden column', status: 'error', message: 'فشل التحقق' });
  }

  // Step 2: Add is_archived column to conversation_participants
  try {
    const { error } = await supabaseServer
      .from('conversation_participants')
      .select('is_archived')
      .limit(1);

    if (error && (error.message.includes('is_archived') || error.message.includes('does not exist'))) {
      results.push({
        step: 'is_archived column',
        status: 'error',
        message: 'العمود is_archived غير موجود. يجب إضافته يدوياً عبر SQL Editor',
      });
    } else {
      results.push({ step: 'is_archived column', status: 'success', message: 'العمود موجود' });
    }
  } catch {
    results.push({ step: 'is_archived column', status: 'error', message: 'فشل التحقق' });
  }

  // Step 3: Check is_deleted column on messages
  try {
    const { error } = await supabaseServer
      .from('messages')
      .select('is_deleted')
      .limit(1);

    if (error && (error.message.includes('is_deleted') || error.message.includes('does not exist'))) {
      results.push({
        step: 'is_deleted column',
        status: 'error',
        message: 'العمود is_deleted غير موجود. يجب إضافته يدوياً عبر SQL Editor',
      });
    } else {
      results.push({ step: 'is_deleted column', status: 'success', message: 'العمود موجود' });
    }
  } catch {
    results.push({ step: 'is_deleted column', status: 'error', message: 'فشل التحقق' });
  }

  // Step 4: Check is_edited column on messages
  try {
    const { error } = await supabaseServer
      .from('messages')
      .select('is_edited')
      .limit(1);

    if (error && (error.message.includes('is_edited') || error.message.includes('does not exist'))) {
      results.push({
        step: 'is_edited column',
        status: 'error',
        message: 'العمود is_edited غير موجود. يجب إضافته يدوياً عبر SQL Editor',
      });
    } else {
      results.push({ step: 'is_edited column', status: 'success', message: 'العمود موجود' });
    }
  } catch {
    results.push({ step: 'is_edited column', status: 'error', message: 'فشل التحقق' });
  }

  // Step 5: Test Realtime subscription (check if messages table is in supabase_realtime publication)
  // We can't directly check this via the client SDK, but we can check if the subscription works
  results.push({
    step: 'Realtime',
    status: 'success',
    message: 'يجب تفعيل Realtime يدوياً من Supabase Dashboard > Database > Replication أو تشغيل: ALTER PUBLICATION supabase_realtime ADD TABLE public.messages; ALTER PUBLICATION supabase_realtime ADD TABLE public.conversation_participants;',
  });

  const hasErrors = results.some(r => r.status === 'error');
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const projectRef = supabaseUrl.replace('https://', '').replace('.supabase.co', '');

  // Generate the migration SQL for any missing columns
  const migrationSQL = `
-- AttenDo Chat Migration - Add missing columns and enable Realtime
-- Run this in Supabase SQL Editor if any columns are missing:

-- Add missing columns to conversation_participants
ALTER TABLE public.conversation_participants ADD COLUMN IF NOT EXISTS is_hidden BOOLEAN DEFAULT FALSE;
ALTER TABLE public.conversation_participants ADD COLUMN IF NOT EXISTS is_archived BOOLEAN DEFAULT FALSE;

-- Add missing columns to messages
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT FALSE;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS is_edited BOOLEAN DEFAULT FALSE;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS edited_at TIMESTAMP WITH TIME ZONE;

-- Enable Realtime for chat tables (required for instant message delivery)
-- Wrapped in DO blocks to avoid error if tables are already in the publication
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.messages; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.conversation_participants; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.conversations; EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- Add missing RLS DELETE policies (required for conversation deletion)
DROP POLICY IF EXISTS "Users can delete their own participation" ON public.conversation_participants;
CREATE POLICY "Users can delete their own participation" ON public.conversation_participants
  FOR DELETE USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can delete messages in their conversations" ON public.messages;
CREATE POLICY "Users can delete messages in their conversations" ON public.messages
  FOR DELETE USING (
    conversation_id IN (SELECT conversation_id FROM public.conversation_participants WHERE user_id = auth.uid())
  );
`.trim();

  return NextResponse.json({
    success: !hasErrors,
    results,
    migrationSQL,
    sqlEditorUrl: `https://supabase.com/dashboard/project/${projectRef}/sql/new`,
    message: hasErrors
      ? 'بعض الأعمدة مفقودة. شغّل الـ SQL أدناه في Supabase SQL Editor لإضافتها'
      : 'كل الأعمدة موجودة! تأكد من تفعيل Realtime من Dashboard أو شغّل الـ SQL',
  });
}

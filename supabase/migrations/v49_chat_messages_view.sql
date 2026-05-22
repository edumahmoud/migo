-- =====================================================
-- v49: Create chat_messages as a view alias for messages table
--
-- PROBLEM: The reports system references "public.chat_messages"
-- in triggers, API routes, and migration files, but the actual
-- table in the database is named "public.messages" (created in
-- COMPLETE_SCHEMA.sql). This causes errors like:
--   ERROR: relation "public.chat_messages" does not exist
--
-- FIX: Create "chat_messages" as an updatable view on "messages"
-- so all existing references work without changes.
-- =====================================================

-- Create view that maps chat_messages → messages
CREATE OR REPLACE VIEW public.chat_messages AS
SELECT
  id,
  conversation_id,
  sender_id,
  content,
  is_deleted,
  is_edited,
  edited_at,
  created_at
FROM public.messages;

-- Make the view updatable (INSERT/UPDATE/DELETE pass through to messages)
CREATE OR REPLACE RULE chat_messages_insert AS ON INSERT TO public.chat_messages
  DO INSTEAD INSERT INTO public.messages (id, conversation_id, sender_id, content, is_deleted, is_edited, edited_at, created_at)
  VALUES (NEW.id, NEW.conversation_id, NEW.sender_id, NEW.content, NEW.is_deleted, NEW.is_edited, NEW.edited_at, NEW.created_at);

CREATE OR REPLACE RULE chat_messages_update AS ON UPDATE TO public.chat_messages
  DO INSTEAD UPDATE public.messages SET
    conversation_id = NEW.conversation_id,
    sender_id = NEW.sender_id,
    content = NEW.content,
    is_deleted = NEW.is_deleted,
    is_edited = NEW.is_edited,
    edited_at = NEW.edited_at
  WHERE id = OLD.id;

CREATE OR REPLACE RULE chat_messages_delete AS ON DELETE TO public.chat_messages
  DO INSTEAD DELETE FROM public.messages WHERE id = OLD.id;

-- Grant same permissions as the messages table
GRANT SELECT, INSERT, UPDATE, DELETE ON public.chat_messages TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.chat_messages TO anon;

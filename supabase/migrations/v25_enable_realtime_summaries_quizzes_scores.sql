-- Migration v25: Enable Realtime for summaries, quizzes, scores, and conversation_participants
-- These tables were missing from the supabase_realtime publication,
-- causing realtime subscriptions to silently fail and fall back to slow polling.

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.summaries;
  RAISE NOTICE 'summaries table added to supabase_realtime publication';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'summaries may already be in supabase_realtime: %', SQLERRM;
END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.quizzes;
  RAISE NOTICE 'quizzes table added to supabase_realtime publication';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'quizzes may already be in supabase_realtime: %', SQLERRM;
END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.scores;
  RAISE NOTICE 'scores table added to supabase_realtime publication';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'scores may already be in supabase_realtime: %', SQLERRM;
END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.conversation_participants;
  RAISE NOTICE 'conversation_participants table added to supabase_realtime publication';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'conversation_participants may already be in supabase_realtime: %', SQLERRM;
END $$;

-- Also ensure REPLICA IDENTITY is set to FULL for tables that need old row data in DELETE events
-- (Supabase Realtime needs this to deliver DELETE payloads with the deleted row's data)
ALTER TABLE public.summaries REPLICA IDENTITY FULL;
ALTER TABLE public.quizzes REPLICA IDENTITY FULL;
ALTER TABLE public.scores REPLICA IDENTITY FULL;
ALTER TABLE public.conversation_participants REPLICA IDENTITY FULL;

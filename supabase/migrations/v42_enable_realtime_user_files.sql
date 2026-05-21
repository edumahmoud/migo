-- =====================================================
-- v42: Enable Realtime for user_files and file_shares tables
-- This enables instant UI updates when files are deleted, renamed, or shared
-- =====================================================

-- Add user_files to the supabase_realtime publication if not already a member
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
    AND schemaname = 'public'
    AND tablename = 'user_files'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.user_files;
  END IF;
END $$;

-- Add file_shares to the supabase_realtime publication if not already a member
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
    AND schemaname = 'public'
    AND tablename = 'file_shares'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.file_shares;
  END IF;
END $$;

-- Ensure subject_files is also in realtime (should already be, but idempotent check)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
    AND schemaname = 'public'
    AND tablename = 'subject_files'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.subject_files;
  END IF;
END $$;

-- Set replica identity to FULL for user_files and file_shares so DELETE events include old row data
-- This is required for the Realtime payload.old to contain the `id` field
ALTER TABLE public.user_files REPLICA IDENTITY FULL;
ALTER TABLE public.file_shares REPLICA IDENTITY FULL;

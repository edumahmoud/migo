-- =====================================================
-- Migration: Enable Realtime for Subjects Table
-- Run this in Supabase SQL Editor to enable realtime
-- updates for the subjects table
-- =====================================================

-- Add subjects table to the realtime publication
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.subjects;
  RAISE NOTICE 'subjects table added to supabase_realtime publication';
EXCEPTION 
  WHEN others THEN
    RAISE NOTICE 'subjects table may already be in supabase_realtime publication: %', SQLERRM;
END $$;

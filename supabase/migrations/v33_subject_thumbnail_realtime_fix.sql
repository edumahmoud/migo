-- =====================================================
-- v33: Add thumbnail_url to subjects + Fix Realtime for subject_videos DELETE
-- =====================================================

-- 1. Add thumbnail_url column to subjects table
ALTER TABLE public.subjects ADD COLUMN IF NOT EXISTS thumbnail_url TEXT;

-- 2. Enable REPLICA IDENTITY FULL on subject_videos
-- This ensures DELETE events include ALL columns (not just PK) in payload.old,
-- so the Realtime filter `subject_id=eq.{id}` works for DELETE events.
ALTER TABLE public.subject_videos REPLICA IDENTITY FULL;

-- 3. Enable REPLICA IDENTITY FULL on subjects too (for future Realtime on subjects)
ALTER TABLE public.subjects REPLICA IDENTITY FULL;

-- 4. Allow uploading subject thumbnails to video-files bucket (or user-files)
-- We reuse the existing video-files bucket since it already has proper RLS.
-- The storage path will be: {userId}/thumbnails/{subjectId}/{filename}
-- No new bucket needed — existing policies cover this path pattern.

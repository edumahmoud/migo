-- =====================================================
-- v31: Create dedicated video-files storage bucket (500MB limit)
-- =====================================================
-- Root cause of "Payload too large" error:
--   The user-files bucket had a 50MiB file_size_limit which
--   is too small for video files. This migration creates a
--   separate bucket specifically for videos with a 500MB limit.
-- =====================================================

-- 1. Create the video-files bucket with 500MB limit
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('video-files', 'video-files', true, 524288000)  -- 500 * 1024 * 1024
ON CONFLICT (id) DO UPDATE
SET file_size_limit = 524288000, public = true;

-- =====================================================
-- 2. RLS policies for video-files bucket
-- =====================================================

-- Teachers can upload videos (INSERT)
-- Path pattern: {userId}/videos/{subjectId}/{filename}
DROP POLICY IF EXISTS "Teachers can upload videos" ON storage.objects;
CREATE POLICY "Teachers can upload videos" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'video-files'
    AND auth.uid()::text = (storage.foldername(name))[1]
    AND EXISTS (
      SELECT 1 FROM public.subjects
      WHERE teacher_id = auth.uid()
    )
  );

-- Users can read own uploaded videos
DROP POLICY IF EXISTS "Users can read own videos" ON storage.objects;
CREATE POLICY "Users can read own videos" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'video-files'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

-- Authenticated users can read videos from subjects they have access to
DROP POLICY IF EXISTS "Authenticated users can read subject videos" ON storage.objects;
CREATE POLICY "Authenticated users can read subject videos" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'video-files'
    AND (
      -- Teacher who owns the subject can read
      EXISTS (
        SELECT 1 FROM public.subject_videos sv
        JOIN public.subjects s ON sv.subject_id = s.id
        WHERE s.teacher_id = auth.uid()
        AND sv.video_url::text LIKE '%' || name::text || '%'
      )
      OR
      -- Students enrolled in the subject can read
      EXISTS (
        SELECT 1 FROM public.subject_videos sv
        JOIN public.subject_students ss ON sv.subject_id = ss.subject_id
        WHERE ss.student_id = auth.uid()
        AND sv.video_url::text LIKE '%' || name::text || '%'
      )
    )
  );

-- Users can update own videos
DROP POLICY IF EXISTS "Users can update own videos" ON storage.objects;
CREATE POLICY "Users can update own videos" ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'video-files'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

-- Users can delete own videos
DROP POLICY IF EXISTS "Users can delete own videos" ON storage.objects;
CREATE POLICY "Users can delete own videos" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'video-files'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

-- Admins can manage all videos
DROP POLICY IF EXISTS "Admins can manage all videos" ON storage.objects;
CREATE POLICY "Admins can manage all videos" ON storage.objects
  FOR ALL USING (
    bucket_id = 'video-files'
    AND public.is_admin()
  );

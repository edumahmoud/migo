-- =====================================================
-- v61: Create lesson-images storage bucket with RLS policies
-- =====================================================
-- Root cause of images not appearing for students:
--   The lesson-images bucket was never created in any
--   migration. This caused uploads to fail and images
--   to be inaccessible even if somehow uploaded.
-- =====================================================

-- 1. Create the lesson-images bucket (public, 10MB limit)
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('lesson-images', 'lesson-images', true, 10485760)  -- 10 * 1024 * 1024
ON CONFLICT (id) DO UPDATE
SET file_size_limit = 10485760, public = true;

-- =====================================================
-- 2. RLS policies for lesson-images bucket
-- =====================================================

-- Teachers can upload lesson images (INSERT)
-- Path pattern: lessons/{subjectId}/{userId}/{timestamp}_{filename}
CREATE POLICY "Teachers can upload lesson images" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'lesson-images'
    AND auth.uid()::text = (storage.foldername(name))[2]
    AND EXISTS (
      SELECT 1 FROM public.subjects
      WHERE teacher_id = auth.uid()
    )
  );

-- Anyone can read lesson images (public bucket, but policy needed for RLS)
CREATE POLICY "Anyone can read lesson images" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'lesson-images'
  );

-- Teachers can update their own lesson images
CREATE POLICY "Teachers can update own lesson images" ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'lesson-images'
    AND auth.uid()::text = (storage.foldername(name))[2]
  );

-- Teachers can delete their own lesson images
CREATE POLICY "Teachers can delete own lesson images" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'lesson-images'
    AND auth.uid()::text = (storage.foldername(name))[2]
  );

-- Admins can manage all lesson images
CREATE POLICY "Admins can manage all lesson images" ON storage.objects
  FOR ALL USING (
    bucket_id = 'lesson-images'
    AND public.is_admin()
  );

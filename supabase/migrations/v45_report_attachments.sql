-- =====================================================
-- v45: Add attachments column to reports & report_messages
--      for image evidence support
-- =====================================================

-- 1. Add attachments to reports (JSONB array of {url, name, type})
ALTER TABLE public.reports
  ADD COLUMN IF NOT EXISTS attachments JSONB DEFAULT '[]'::jsonb;

-- 2. Add attachments to report_messages
ALTER TABLE public.report_messages
  ADD COLUMN IF NOT EXISTS attachments JSONB DEFAULT '[]'::jsonb;

-- 3. Ensure the report-evidence storage bucket exists
INSERT INTO storage.buckets (id, name, public)
VALUES ('report-evidence', 'report-evidence', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- 4. RLS policy: anyone authenticated can upload
DROP POLICY IF EXISTS "Authenticated users can upload evidence" ON storage.objects;
CREATE POLICY "Authenticated users can upload evidence" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'report-evidence' AND auth.role() = 'authenticated');

-- 5. RLS policy: anyone can read (public bucket)
DROP POLICY IF EXISTS "Anyone can read evidence" ON storage.objects;
CREATE POLICY "Anyone can read evidence" ON storage.objects
  FOR SELECT USING (bucket_id = 'report-evidence');

-- 6. RLS policy: only the uploader can delete their own evidence
DROP POLICY IF EXISTS "Users can delete own evidence" ON storage.objects;
CREATE POLICY "Users can delete own evidence" ON storage.objects
  FOR DELETE USING (bucket_id = 'report-evidence' AND auth.uid()::text = (storage.foldername(name))[1]);

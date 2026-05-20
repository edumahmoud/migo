-- =====================================================
-- v32: Add view_count to subject_videos + edit comment policy + RPC for views
-- =====================================================

-- 1. Add view_count column to subject_videos
ALTER TABLE public.subject_videos
ADD COLUMN IF NOT EXISTS view_count INTEGER DEFAULT 0 NOT NULL;

-- 2. Add index on view_count for sorting
CREATE INDEX IF NOT EXISTS idx_subject_videos_view_count ON public.subject_videos(view_count DESC);

-- 3. Add RLS policy for users to update their own comments (edit)
DROP POLICY IF EXISTS "Users can update own comments" ON public.video_comments;
CREATE POLICY "Users can update own comments" ON public.video_comments
  FOR UPDATE USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 4. RPC function to increment video view count (called from client)
CREATE OR REPLACE FUNCTION public.increment_video_view(video_id UUID)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
AS $$
  UPDATE public.subject_videos
  SET view_count = view_count + 1
  WHERE id = video_id;
$$;

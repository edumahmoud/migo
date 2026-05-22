-- =====================================================
-- v34: Unique video views per user + Comments Realtime + Comment moderation
-- =====================================================

-- 1. Create video_views table for unique view tracking
CREATE TABLE IF NOT EXISTS public.video_views (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  video_id UUID NOT NULL REFERENCES public.subject_videos(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  UNIQUE(video_id, user_id)
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_video_views_video_id ON public.video_views(video_id);
CREATE INDEX IF NOT EXISTS idx_video_views_user_id ON public.video_views(user_id);

-- RLS on video_views
ALTER TABLE public.video_views ENABLE ROW LEVEL SECURITY;

-- Anyone authenticated can insert their own view
DROP POLICY IF EXISTS "Users can insert own view" ON public.video_views;
CREATE POLICY "Users can insert own view" ON public.video_views
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Anyone can check views (for count display)
DROP POLICY IF EXISTS "Anyone can select views" ON public.video_views;
CREATE POLICY "Anyone can select views" ON public.video_views
  FOR SELECT USING (true);

-- 2. Replace increment_video_view with record_video_view (unique per user)
DROP FUNCTION IF EXISTS public.increment_video_view(UUID);

CREATE OR REPLACE FUNCTION public.record_video_view(p_video_id UUID, p_user_id UUID)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  inserted boolean;
BEGIN
  -- Try to insert a unique (video_id, user_id) row
  -- If it already exists, do nothing (UNIQUE constraint handles it)
  INSERT INTO public.video_views (video_id, user_id)
  VALUES (p_video_id, p_user_id)
  ON CONFLICT (video_id, user_id) DO NOTHING;

  -- Check if a row was actually inserted (first view)
  inserted := FOUND;

  -- Increment view_count only on first view
  IF inserted THEN
    UPDATE public.subject_videos
    SET view_count = view_count + 1
    WHERE id = p_video_id;
  END IF;

  RETURN inserted;
END;
$$;

-- 3. Enable REPLICA IDENTITY FULL on video_comments
-- This ensures DELETE events include ALL columns in payload.old,
-- so Realtime filters work for DELETE events.
-- Also makes UPDATE events include old values for proper surgical updates.
ALTER TABLE public.video_comments REPLICA IDENTITY FULL;

-- 4. Add comment moderation columns
ALTER TABLE public.video_comments
  ADD COLUMN IF NOT EXISTS is_flagged BOOLEAN DEFAULT false NOT NULL,
  ADD COLUMN IF NOT EXISTS flagged_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS flagged_by UUID REFERENCES public.users(id) ON DELETE SET NULL;

-- Index for flagged comments (admin queries)
CREATE INDEX IF NOT EXISTS idx_video_comments_flagged ON public.video_comments(is_flagged) WHERE is_flagged = true;

-- 5. Allow admins to flag/unflag comments via RLS
-- Admins and teachers (of the subject) can update comments for moderation
DROP POLICY IF EXISTS "Admins can update any comment" ON public.video_comments;
CREATE POLICY "Admins can update any comment" ON public.video_comments
  FOR UPDATE USING (
    -- User editing their own comment
    auth.uid() = user_id
    OR
    -- Admins can update any comment (flag/unflag)
    EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role IN ('admin', 'superadmin'))
  )
  WITH CHECK (
    auth.uid() = user_id
    OR
    EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role IN ('admin', 'superadmin'))
  );

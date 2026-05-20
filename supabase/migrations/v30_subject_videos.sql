-- =====================================================
-- v30: Subject Videos + Video Comments Tables
-- Adds dedicated video management with comments for course pages
-- =====================================================

-- Subject Videos table
CREATE TABLE IF NOT EXISTS public.subject_videos (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  subject_id UUID NOT NULL REFERENCES public.subjects(id) ON DELETE CASCADE,
  uploaded_by UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  video_url TEXT NOT NULL,
  video_type TEXT NOT NULL DEFAULT 'video/mp4',
  video_size BIGINT NOT NULL DEFAULT 0,
  thumbnail_url TEXT,
  duration INTEGER, -- duration in seconds
  comments_enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_subject_videos_subject_id ON public.subject_videos(subject_id);
CREATE INDEX IF NOT EXISTS idx_subject_videos_uploaded_by ON public.subject_videos(uploaded_by);
CREATE INDEX IF NOT EXISTS idx_subject_videos_created_at ON public.subject_videos(created_at DESC);

-- Video Comments table
CREATE TABLE IF NOT EXISTS public.video_comments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  video_id UUID NOT NULL REFERENCES public.subject_videos(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_video_comments_video_id ON public.video_comments(video_id);
CREATE INDEX IF NOT EXISTS idx_video_comments_user_id ON public.video_comments(user_id);
CREATE INDEX IF NOT EXISTS idx_video_comments_created_at ON public.video_comments(created_at DESC);

-- Enable RLS
ALTER TABLE public.subject_videos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.video_comments ENABLE ROW LEVEL SECURITY;

-- RLS Policies for subject_videos
CREATE POLICY "Teachers can view videos in their subjects" ON public.subject_videos
  FOR SELECT USING (
    subject_id IN (SELECT public.get_teacher_subject_ids(auth.uid()))
  );
CREATE POLICY "Students can view videos in enrolled subjects" ON public.subject_videos
  FOR SELECT USING (
    subject_id IN (SELECT public.get_student_subject_ids(auth.uid()))
  );
CREATE POLICY "Teachers can create videos" ON public.subject_videos
  FOR INSERT WITH CHECK (
    subject_id IN (SELECT public.get_teacher_subject_ids(auth.uid()))
  );
CREATE POLICY "Teachers can update videos" ON public.subject_videos
  FOR UPDATE USING (
    subject_id IN (SELECT public.get_teacher_subject_ids(auth.uid()))
  );
CREATE POLICY "Teachers can delete videos" ON public.subject_videos
  FOR DELETE USING (
    subject_id IN (SELECT public.get_teacher_subject_ids(auth.uid()))
  );

-- RLS Policies for video_comments
CREATE POLICY "Users can view comments on videos they can see" ON public.video_comments
  FOR SELECT USING (
    video_id IN (SELECT id FROM public.subject_videos WHERE
      subject_id IN (SELECT public.get_teacher_subject_ids(auth.uid()))
      OR subject_id IN (SELECT public.get_student_subject_ids(auth.uid()))
    )
  );
CREATE POLICY "Authenticated users can create comments" ON public.video_comments
  FOR INSERT WITH CHECK (
    auth.uid() = user_id AND
    video_id IN (SELECT id FROM public.subject_videos WHERE
      subject_id IN (SELECT public.get_teacher_subject_ids(auth.uid()))
      OR subject_id IN (SELECT public.get_student_subject_ids(auth.uid()))
    )
  );
CREATE POLICY "Users can delete own comments" ON public.video_comments
  FOR DELETE USING (user_id = auth.uid());
CREATE POLICY "Teachers can delete any comment on their subject videos" ON public.video_comments
  FOR DELETE USING (
    video_id IN (SELECT id FROM public.subject_videos WHERE
      subject_id IN (SELECT public.get_teacher_subject_ids(auth.uid()))
    )
  );

-- Enable Realtime for subject_videos and video_comments
ALTER PUBLICATION supabase_realtime ADD TABLE public.subject_videos;
ALTER PUBLICATION supabase_realtime ADD TABLE public.video_comments;

-- Auto-update trigger for subject_videos
CREATE OR REPLACE FUNCTION public.update_subject_videos_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_subject_videos_updated_at ON public.subject_videos;
CREATE TRIGGER trg_subject_videos_updated_at
  BEFORE UPDATE ON public.subject_videos
  FOR EACH ROW EXECUTE FUNCTION public.update_subject_videos_updated_at();

-- Auto-update trigger for video_comments
CREATE OR REPLACE FUNCTION public.update_video_comments_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_video_comments_updated_at ON public.video_comments;
CREATE TRIGGER trg_video_comments_updated_at
  BEFORE UPDATE ON public.video_comments
  FOR EACH ROW EXECUTE FUNCTION public.update_video_comments_updated_at();

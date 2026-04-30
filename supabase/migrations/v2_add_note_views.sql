CREATE TABLE IF NOT EXISTS public.note_views (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  note_id UUID NOT NULL REFERENCES public.lecture_notes(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  viewed_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  UNIQUE(note_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_note_views_note_id ON public.note_views(note_id);
CREATE INDEX IF NOT EXISTS idx_note_views_user_id ON public.note_views(user_id);

ALTER TABLE public.note_views ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view note views" ON public.note_views;
CREATE POLICY "Users can view note views" ON public.note_views
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "Users can insert own note views" ON public.note_views;
CREATE POLICY "Users can insert own note views" ON public.note_views
  FOR INSERT WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can delete own note views" ON public.note_views;
CREATE POLICY "Users can delete own note views" ON public.note_views
  FOR DELETE USING (user_id = auth.uid());

GRANT SELECT, INSERT, DELETE ON public.note_views TO anon, authenticated;

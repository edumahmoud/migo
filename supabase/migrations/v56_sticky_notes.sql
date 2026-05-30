-- Migration: Add sticky_notes table for app-level sticky notes
-- These notes float across the entire app, not tied to a specific course

CREATE TABLE IF NOT EXISTS public.sticky_notes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  subject_id UUID REFERENCES public.subjects(id) ON DELETE SET NULL,
  content TEXT NOT NULL,
  color TEXT DEFAULT 'amber',
  position_x INTEGER DEFAULT 20,
  position_y INTEGER DEFAULT 80,
  is_minimized BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sticky_notes_user_id ON public.sticky_notes(user_id);
CREATE INDEX IF NOT EXISTS idx_sticky_notes_subject_id ON public.sticky_notes(subject_id);

ALTER TABLE public.sticky_notes ENABLE ROW LEVEL SECURITY;

-- Users can only see and manage their own sticky notes
DROP POLICY IF EXISTS "Users can view own sticky notes" ON public.sticky_notes;
CREATE POLICY "Users can view own sticky notes" ON public.sticky_notes
  FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can create own sticky notes" ON public.sticky_notes;
CREATE POLICY "Users can create own sticky notes" ON public.sticky_notes
  FOR INSERT WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can update own sticky notes" ON public.sticky_notes;
CREATE POLICY "Users can update own sticky notes" ON public.sticky_notes
  FOR UPDATE USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can delete own sticky notes" ON public.sticky_notes;
CREATE POLICY "Users can delete own sticky notes" ON public.sticky_notes
  FOR DELETE USING (user_id = auth.uid());

-- Also fix: Add 'sticky' to lecture_notes visibility if it has a CHECK constraint
-- First, try to drop any existing CHECK constraint on visibility
DO $$
BEGIN
  -- Try to drop the constraint if it exists
  ALTER TABLE public.lecture_notes DROP CONSTRAINT IF EXISTS lecture_notes_visibility_check;
  -- Also try the default name Postgres gives
  ALTER TABLE public.lecture_notes DROP CONSTRAINT IF EXISTS lecture_notes_visibility_check1;
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

-- Ensure the visibility column can hold 'sticky'
-- If the column is VARCHAR without constraint, this is a no-op
-- If it has an enum, we may need to alter it
ALTER TABLE public.lecture_notes ALTER COLUMN visibility TYPE TEXT;

-- Update RLS policy for students to also see sticky notes
DROP POLICY IF EXISTS "Students can view public notes in enrolled subjects" ON public.lecture_notes;
CREATE POLICY "Students can view public notes in enrolled subjects" ON public.lecture_notes
  FOR SELECT USING (
    ((visibility = 'public' OR visibility = 'sticky') AND public.is_lecture_student(lecture_id, auth.uid()))
    OR user_id = auth.uid()
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.sticky_notes TO anon, authenticated;

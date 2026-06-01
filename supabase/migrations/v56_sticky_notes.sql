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

-- Also fix: Add 'sticky' to lecture_notes visibility
-- IMPORTANT: Must drop ALL policies that reference the visibility column FIRST,
-- before altering its type, then re-create them after.

-- Step 1: Drop policies that depend on the visibility column
DROP POLICY IF EXISTS "Students can view public notes in enrolled subjects" ON public.lecture_notes;

-- Step 2: Drop any CHECK constraints on visibility
DO $$
BEGIN
  ALTER TABLE public.lecture_notes DROP CONSTRAINT IF EXISTS lecture_notes_visibility_check;
  ALTER TABLE public.lecture_notes DROP CONSTRAINT IF EXISTS lecture_notes_visibility_check1;
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

-- Step 3: Now safe to alter the column type
ALTER TABLE public.lecture_notes ALTER COLUMN visibility TYPE TEXT;

-- Step 4: Re-create the RLS policy with 'sticky' support
CREATE POLICY "Students can view public notes in enrolled subjects" ON public.lecture_notes
  FOR SELECT USING (
    ((visibility = 'public' OR visibility = 'sticky') AND public.is_lecture_student(lecture_id, auth.uid()))
    OR user_id = auth.uid()
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.sticky_notes TO anon, authenticated;

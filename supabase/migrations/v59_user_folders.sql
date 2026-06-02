-- v59: Add user_folders table and folder_id column to user_files
-- Enables folder organization in the "My Files" section

-- Create user_folders table
CREATE TABLE IF NOT EXISTS public.user_folders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for fast lookup by user
CREATE INDEX IF NOT EXISTS idx_user_folders_user_id ON public.user_folders(user_id);

-- Add folder_id column to user_files (nullable — null means root level)
ALTER TABLE public.user_files
  ADD COLUMN IF NOT EXISTS folder_id UUID REFERENCES public.user_folders(id) ON DELETE SET NULL;

-- Index for fast lookup by folder
CREATE INDEX IF NOT EXISTS idx_user_files_folder_id ON public.user_files(folder_id);

-- RLS policies for user_folders
ALTER TABLE public.user_folders ENABLE ROW LEVEL SECURITY;

-- Users can view their own folders
CREATE POLICY "Users can view own folders"
  ON public.user_folders FOR SELECT
  USING (user_id = auth.uid());

-- Users can create folders for themselves
CREATE POLICY "Users can create own folders"
  ON public.user_folders FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- Users can update their own folders
CREATE POLICY "Users can update own folders"
  ON public.user_folders FOR UPDATE
  USING (user_id = auth.uid());

-- Users can delete their own folders
CREATE POLICY "Users can delete own folders"
  ON public.user_folders FOR DELETE
  USING (user_id = auth.uid());

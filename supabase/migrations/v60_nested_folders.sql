-- v60: Add parent_folder_id to user_folders for nested folder support
-- Enables navigating into folders within the folder picker modal

-- Add parent_folder_id column (nullable — null means root level folder)
ALTER TABLE public.user_folders
  ADD COLUMN IF NOT EXISTS parent_folder_id UUID REFERENCES public.user_folders(id) ON DELETE CASCADE;

-- Index for fast lookup by parent
CREATE INDEX IF NOT EXISTS idx_user_folders_parent_id ON public.user_folders(parent_folder_id);

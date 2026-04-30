-- Migration: Add visibility column to user_files table
-- This allows distinguishing public files from private files in personal files

-- Add visibility column to user_files
ALTER TABLE user_files
ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'private'
CHECK (visibility IN ('public', 'private'));

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_user_files_visibility ON user_files(visibility);

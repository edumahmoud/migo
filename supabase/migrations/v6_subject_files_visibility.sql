-- Migration: Add visibility column to subject_files table
-- This allows distinguishing public files (teacher-uploaded, visible to all)
-- from private files (student-uploaded, visible only to the uploader)

-- Add visibility column to subject_files
ALTER TABLE subject_files
ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'public'
CHECK (visibility IN ('public', 'private'));

-- Update RLS policy for subject_files to respect visibility
-- Students can see: public files + their own private files
-- Teachers can see: all files in their subjects

-- First, drop existing SELECT policies if they exist
DROP POLICY IF EXISTS "Students can view subject files" ON subject_files;
DROP POLICY IF EXISTS "Teachers can view their subject files" ON subject_files;
DROP POLICY IF EXISTS "Anyone can view subject files" ON subject_files;

-- New RLS policy: users can see public files in their enrolled/owned subjects,
-- plus their own private files
CREATE POLICY "Users can view visible subject files" ON subject_files
  FOR SELECT
  USING (
    -- Public files: visible to anyone in the subject
    (visibility = 'public' AND (
      subject_id IN (SELECT id FROM subjects WHERE teacher_id = auth.uid())
      OR
      subject_id IN (SELECT subject_id FROM subject_students WHERE student_id = auth.uid())
    ))
    OR
    -- Private files: only visible to the uploader
    (visibility = 'private' AND uploaded_by = auth.uid())
  );

-- Also add a user_file_id column to link subject_files back to user_files
-- This allows cascading deletes when a personal file is deleted
ALTER TABLE subject_files
ADD COLUMN IF NOT EXISTS user_file_id UUID REFERENCES user_files(id) ON DELETE CASCADE;

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_subject_files_user_file_id ON subject_files(user_file_id);
CREATE INDEX IF NOT EXISTS idx_subject_files_visibility ON subject_files(visibility);

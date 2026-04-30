-- Add status column to subject_students for enrollment approval flow
-- Default is 'approved' so existing enrollments remain active

ALTER TABLE subject_students
ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'approved'
CHECK (status IN ('pending', 'approved', 'rejected'));

-- Create index for faster pending lookups
CREATE INDEX IF NOT EXISTS idx_subject_students_status ON subject_students(subject_id, status);

-- Drop existing policies that might conflict
DROP POLICY IF EXISTS "Students can request enrollment" ON subject_students;
DROP POLICY IF EXISTS "Teachers can manage enrollment status" ON subject_students;
DROP POLICY IF EXISTS "Teachers can remove students" ON subject_students;
DROP POLICY IF EXISTS "View enrollments" ON subject_students;

-- Policy: Students can insert their own enrollment (pending only)
-- OR teachers can insert students into their own subjects (any status, defaults to 'approved')
CREATE POLICY "Insert enrollment"
  ON subject_students
  FOR INSERT
  WITH CHECK (
    (student_id = auth.uid() AND status = 'pending')
    OR
    (subject_id IN (SELECT id FROM subjects WHERE teacher_id = auth.uid()))
  );

-- Policy: Teachers can update enrollment status for their subjects
CREATE POLICY "Teachers can manage enrollment status"
  ON subject_students
  FOR UPDATE
  USING (
    subject_id IN (SELECT id FROM subjects WHERE teacher_id = auth.uid())
  )
  WITH CHECK (
    subject_id IN (SELECT id FROM subjects WHERE teacher_id = auth.uid())
  );

-- Policy: Teachers can delete students from their subjects, or students can remove themselves
CREATE POLICY "Teachers can remove students"
  ON subject_students
  FOR DELETE
  USING (
    subject_id IN (SELECT id FROM subjects WHERE teacher_id = auth.uid())
    OR student_id = auth.uid()
  );

-- Policy: Anyone can view enrollments for subjects they belong to
CREATE POLICY "View enrollments"
  ON subject_students
  FOR SELECT
  USING (
    student_id = auth.uid()
    OR subject_id IN (SELECT id FROM subjects WHERE teacher_id = auth.uid())
  );

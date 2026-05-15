-- =====================================================
-- V9: Add status column to teacher_student_links
-- Allows approval flow: pending → approved/rejected
-- =====================================================

-- 1. Add status column with default 'approved' so existing links remain active
ALTER TABLE public.teacher_student_links
ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'approved'
CHECK (status IN ('pending', 'approved', 'rejected'));

-- 2. Set all existing links to 'approved' (they were created before approval system)
UPDATE public.teacher_student_links SET status = 'approved' WHERE status = 'approved';

-- 3. Add index on status for faster queries
CREATE INDEX IF NOT EXISTS idx_tsl_status ON public.teacher_student_links(teacher_id, status);

-- 4. Drop old INSERT policy and replace with one that defaults to 'pending' for students
DROP POLICY IF EXISTS "Students can create links" ON public.teacher_student_links;
CREATE POLICY "Students can create links" ON public.teacher_student_links
  FOR INSERT WITH CHECK (
    student_id = auth.uid() AND status IN ('pending', 'approved')
  );

-- 5. Add policy: Teachers can update status of links to their account
DROP POLICY IF EXISTS "Teachers can update link status" ON public.teacher_student_links;
CREATE POLICY "Teachers can update link status" ON public.teacher_student_links
  FOR UPDATE USING (teacher_id = auth.uid());

-- 6. Update SELECT policies so teachers can see pending/rejected too
-- (existing "Teachers can see own student links" already uses teacher_id = auth.uid() which covers all statuses)

-- 7. Students can delete their own pending or rejected links
DROP POLICY IF EXISTS "Students can delete own links" ON public.teacher_student_links;
CREATE POLICY "Students can delete own links" ON public.teacher_student_links
  FOR DELETE USING (
    student_id = auth.uid() AND status IN ('pending', 'rejected')
  );

-- 8. Teachers can delete (reject/remove) links to their account
DROP POLICY IF EXISTS "Teachers can delete student links" ON public.teacher_student_links;
CREATE POLICY "Teachers can delete student links" ON public.teacher_student_links
  FOR DELETE USING (teacher_id = auth.uid());

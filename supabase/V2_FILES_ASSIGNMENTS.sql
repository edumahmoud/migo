-- =====================================================
-- Examy - Files, Assignments & Submissions Schema
-- =====================================================
-- Idempotent migration: safe to re-run (uses DROP IF EXISTS + CREATE IF NOT EXISTS)
-- Depends on existing tables: users, subjects, subject_students
-- Note: 'assignments' table MUST be created BEFORE 'user_files'
--       because user_files.assignment_id references assignments.id

-- =====================================================
-- 1. Assignments table (must be created before user_files)
-- =====================================================
CREATE TABLE IF NOT EXISTS public.assignments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  subject_id UUID NOT NULL REFERENCES public.subjects(id) ON DELETE CASCADE,
  teacher_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  due_date DATE,
  max_score INTEGER DEFAULT 100,
  allow_file_submission BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- =====================================================
-- 2. User Files table
-- =====================================================
CREATE TABLE IF NOT EXISTS public.user_files (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_type TEXT NOT NULL,
  file_size BIGINT NOT NULL DEFAULT 0,
  file_url TEXT NOT NULL,
  assignment_id UUID REFERENCES public.assignments(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Add assignment_id column if it doesn't exist (for upgrading from older schema)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'user_files' AND column_name = 'assignment_id'
  ) THEN
    ALTER TABLE public.user_files ADD COLUMN assignment_id UUID REFERENCES public.assignments(id) ON DELETE SET NULL;
  END IF;
END $$;

-- =====================================================
-- 3. File Shares table
-- =====================================================
CREATE TABLE IF NOT EXISTS public.file_shares (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  file_id UUID NOT NULL REFERENCES public.user_files(id) ON DELETE CASCADE,
  shared_by UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  shared_with UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  permission TEXT NOT NULL DEFAULT 'view' CHECK (permission IN ('view', 'edit', 'download')),
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  UNIQUE(file_id, shared_with)
);

-- Add permission column if it doesn't exist (for upgrading from older schema)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'file_shares' AND column_name = 'permission'
  ) THEN
    ALTER TABLE public.file_shares ADD COLUMN permission TEXT NOT NULL DEFAULT 'view' CHECK (permission IN ('view', 'edit', 'download'));
  END IF;
END $$;

-- =====================================================
-- 4. Subject Files table (course files attached to subjects)
-- =====================================================
CREATE TABLE IF NOT EXISTS public.subject_files (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  subject_id UUID NOT NULL REFERENCES public.subjects(id) ON DELETE CASCADE,
  uploaded_by UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_type TEXT NOT NULL,
  file_size BIGINT NOT NULL DEFAULT 0,
  file_url TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- =====================================================
-- 5. Submissions table
-- =====================================================
CREATE TABLE IF NOT EXISTS public.submissions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  assignment_id UUID NOT NULL REFERENCES public.assignments(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  content TEXT,
  file_id UUID REFERENCES public.user_files(id) ON DELETE SET NULL,
  score INTEGER,
  feedback TEXT,
  status TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'graded', 'returned')),
  submitted_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  graded_at TIMESTAMPTZ,
  UNIQUE(assignment_id, student_id)
);

-- =====================================================
-- Indexes (all use IF NOT EXISTS - safe to re-run)
-- =====================================================
CREATE INDEX IF NOT EXISTS idx_assignments_subject_id ON public.assignments(subject_id);
CREATE INDEX IF NOT EXISTS idx_assignments_teacher_id ON public.assignments(teacher_id);
CREATE INDEX IF NOT EXISTS idx_user_files_user_id ON public.user_files(user_id);
CREATE INDEX IF NOT EXISTS idx_user_files_assignment_id ON public.user_files(assignment_id);
CREATE INDEX IF NOT EXISTS idx_file_shares_file_id ON public.file_shares(file_id);
CREATE INDEX IF NOT EXISTS idx_file_shares_shared_by ON public.file_shares(shared_by);
CREATE INDEX IF NOT EXISTS idx_file_shares_shared_with ON public.file_shares(shared_with);
CREATE INDEX IF NOT EXISTS idx_subject_files_subject_id ON public.subject_files(subject_id);
CREATE INDEX IF NOT EXISTS idx_subject_files_uploaded_by ON public.subject_files(uploaded_by);
CREATE INDEX IF NOT EXISTS idx_submissions_assignment_id ON public.submissions(assignment_id);
CREATE INDEX IF NOT EXISTS idx_submissions_student_id ON public.submissions(student_id);
CREATE INDEX IF NOT EXISTS idx_submissions_status ON public.submissions(status);

-- =====================================================
-- Enable RLS on all tables (idempotent)
-- =====================================================
ALTER TABLE public.assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.file_shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subject_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.submissions ENABLE ROW LEVEL SECURITY;

-- =====================================================
-- RLS Policies for assignments
-- (DROP IF EXISTS first to make idempotent)
-- =====================================================
DROP POLICY IF EXISTS "Teachers can view assignments in own subjects" ON public.assignments;
CREATE POLICY "Teachers can view assignments in own subjects" ON public.assignments
  FOR SELECT USING (
    subject_id IN (SELECT id FROM public.subjects WHERE teacher_id = auth.uid())
  );

DROP POLICY IF EXISTS "Students can view assignments in enrolled subjects" ON public.assignments;
CREATE POLICY "Students can view assignments in enrolled subjects" ON public.assignments
  FOR SELECT USING (
    subject_id IN (SELECT subject_id FROM public.subject_students WHERE student_id = auth.uid())
  );

DROP POLICY IF EXISTS "Teachers can create assignments" ON public.assignments;
CREATE POLICY "Teachers can create assignments" ON public.assignments
  FOR INSERT WITH CHECK (teacher_id = auth.uid());

DROP POLICY IF EXISTS "Teachers can update own assignments" ON public.assignments;
CREATE POLICY "Teachers can update own assignments" ON public.assignments
  FOR UPDATE USING (teacher_id = auth.uid());

DROP POLICY IF EXISTS "Teachers can delete own assignments" ON public.assignments;
CREATE POLICY "Teachers can delete own assignments" ON public.assignments
  FOR DELETE USING (teacher_id = auth.uid());

-- Also drop legacy policy names from old migration
DROP POLICY IF EXISTS "Teachers can view own assignments" ON public.assignments;

-- =====================================================
-- RLS Policies for user_files
-- =====================================================
DROP POLICY IF EXISTS "Users can view own files" ON public.user_files;
CREATE POLICY "Users can view own files" ON public.user_files
  FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can view files shared with them" ON public.user_files;
CREATE POLICY "Users can view files shared with them" ON public.user_files
  FOR SELECT USING (
    id IN (SELECT file_id FROM public.file_shares WHERE shared_with = auth.uid())
  );

DROP POLICY IF EXISTS "Teachers can view files linked to their assignments" ON public.user_files;
CREATE POLICY "Teachers can view files linked to their assignments" ON public.user_files
  FOR SELECT USING (
    assignment_id IN (
      SELECT a.id FROM public.assignments a
      JOIN public.subjects s ON a.subject_id = s.id
      WHERE s.teacher_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can upload files" ON public.user_files;
CREATE POLICY "Users can upload files" ON public.user_files
  FOR INSERT WITH CHECK (user_id = auth.uid());

-- Legacy policy name from old migration
DROP POLICY IF EXISTS "Users can create own files" ON public.user_files;

DROP POLICY IF EXISTS "Users can update own files" ON public.user_files;
CREATE POLICY "Users can update own files" ON public.user_files
  FOR UPDATE USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can delete own files" ON public.user_files;
CREATE POLICY "Users can delete own files" ON public.user_files
  FOR DELETE USING (user_id = auth.uid());

-- =====================================================
-- RLS Policies for file_shares
-- =====================================================
DROP POLICY IF EXISTS "Users can view shares for their files" ON public.file_shares;
CREATE POLICY "Users can view shares for their files" ON public.file_shares
  FOR SELECT USING (
    shared_by = auth.uid() OR shared_with = auth.uid()
  );

-- Legacy policy name from old migration
DROP POLICY IF EXISTS "Users can view shares they are part of" ON public.file_shares;

DROP POLICY IF EXISTS "Users can share own files" ON public.file_shares;
CREATE POLICY "Users can share own files" ON public.file_shares
  FOR INSERT WITH CHECK (shared_by = auth.uid());

-- Legacy policy name from old migration
DROP POLICY IF EXISTS "Users can create shares for own files" ON public.file_shares;

DROP POLICY IF EXISTS "File owners can update shares" ON public.file_shares;
CREATE POLICY "File owners can update shares" ON public.file_shares
  FOR UPDATE USING (
    file_id IN (SELECT id FROM public.user_files WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "File owners can delete shares" ON public.file_shares;
CREATE POLICY "File owners can delete shares" ON public.file_shares
  FOR DELETE USING (
    shared_by = auth.uid() OR shared_with = auth.uid()
  );

-- Legacy policy name from old migration
DROP POLICY IF EXISTS "Users can delete shares they created" ON public.file_shares;

-- =====================================================
-- RLS Policies for subject_files
-- =====================================================
DROP POLICY IF EXISTS "Teachers can view files in own subjects" ON public.subject_files;
CREATE POLICY "Teachers can view files in own subjects" ON public.subject_files
  FOR SELECT USING (
    subject_id IN (SELECT id FROM public.subjects WHERE teacher_id = auth.uid())
  );

DROP POLICY IF EXISTS "Students can view files in enrolled subjects" ON public.subject_files;
CREATE POLICY "Students can view files in enrolled subjects" ON public.subject_files
  FOR SELECT USING (
    subject_id IN (SELECT subject_id FROM public.subject_students WHERE student_id = auth.uid())
  );

DROP POLICY IF EXISTS "Teachers can upload files to own subjects" ON public.subject_files;
CREATE POLICY "Teachers can upload files to own subjects" ON public.subject_files
  FOR INSERT WITH CHECK (
    subject_id IN (SELECT id FROM public.subjects WHERE teacher_id = auth.uid())
  );

DROP POLICY IF EXISTS "Teachers can update files in own subjects" ON public.subject_files;
CREATE POLICY "Teachers can update files in own subjects" ON public.subject_files
  FOR UPDATE USING (
    subject_id IN (SELECT id FROM public.subjects WHERE teacher_id = auth.uid())
  );

-- Legacy policy name from old migration
DROP POLICY IF EXISTS "Teachers can delete files from own subjects" ON public.subject_files;

DROP POLICY IF EXISTS "Teachers can delete files in own subjects" ON public.subject_files;
CREATE POLICY "Teachers can delete files in own subjects" ON public.subject_files
  FOR DELETE USING (
    subject_id IN (SELECT id FROM public.subjects WHERE teacher_id = auth.uid())
  );

-- =====================================================
-- RLS Policies for submissions
-- =====================================================
DROP POLICY IF EXISTS "Teachers can view submissions for their assignments" ON public.submissions;
CREATE POLICY "Teachers can view submissions for their assignments" ON public.submissions
  FOR SELECT USING (
    assignment_id IN (
      SELECT a.id FROM public.assignments a
      JOIN public.subjects s ON a.subject_id = s.id
      WHERE s.teacher_id = auth.uid()
    )
  );

-- Legacy policy names from old migration
DROP POLICY IF EXISTS "Teachers can view submissions for their assignments" ON public.submissions;
DROP POLICY IF EXISTS "Students can view own submissions" ON public.submissions;
CREATE POLICY "Students can view own submissions" ON public.submissions
  FOR SELECT USING (student_id = auth.uid());

DROP POLICY IF EXISTS "Students can create submissions" ON public.submissions;
CREATE POLICY "Students can create submissions" ON public.submissions
  FOR INSERT WITH CHECK (student_id = auth.uid());

DROP POLICY IF EXISTS "Students can update own ungraded submissions" ON public.submissions;
CREATE POLICY "Students can update own ungraded submissions" ON public.submissions
  FOR UPDATE USING (student_id = auth.uid() AND status = 'submitted');

-- Legacy policy name from old migration
DROP POLICY IF EXISTS "Students can update own submissions" ON public.submissions;

DROP POLICY IF EXISTS "Teachers can grade submissions for their assignments" ON public.submissions;
CREATE POLICY "Teachers can grade submissions for their assignments" ON public.submissions
  FOR UPDATE USING (
    assignment_id IN (
      SELECT a.id FROM public.assignments a
      JOIN public.subjects s ON a.subject_id = s.id
      WHERE s.teacher_id = auth.uid()
    )
  );

-- Legacy policy name from old migration
DROP POLICY IF EXISTS "Teachers can grade submissions" ON public.submissions;

-- =====================================================
-- Grant permissions
-- =====================================================
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;

-- =====================================================
-- Enable realtime (idempotent - will fail silently if already added)
-- =====================================================
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.assignments;
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.submissions;
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.subject_files;
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.user_files;
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

-- =====================================================
-- Supabase Storage bucket for user files
-- =====================================================
INSERT INTO storage.buckets (id, name, public) VALUES ('user-files', 'user-files', true) ON CONFLICT DO NOTHING;

-- Update existing bucket to public if it was created as private
UPDATE storage.buckets SET public = true WHERE id = 'user-files';

-- Storage policies for user-files bucket (DROP IF EXISTS first for idempotency)
DROP POLICY IF EXISTS "Users can upload files" ON storage.objects;
CREATE POLICY "Users can upload files" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'user-files' AND auth.uid()::text = (storage.foldername(name))[1]);

-- Allow teachers to upload to courses/ or subjects/ paths for course materials
DROP POLICY IF EXISTS "Teachers can upload course files" ON storage.objects;
CREATE POLICY "Teachers can upload course files" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'user-files' AND 
    (storage.foldername(name))[1] IN ('courses', 'subjects') AND
    EXISTS (SELECT 1 FROM public.subjects WHERE teacher_id = auth.uid())
  );

DROP POLICY IF EXISTS "Users can read own files" ON storage.objects;
CREATE POLICY "Users can read own files" ON storage.objects
  FOR SELECT USING (bucket_id = 'user-files' AND auth.uid()::text = (storage.foldername(name))[1]);

-- Allow authenticated users to read course/subject files
DROP POLICY IF EXISTS "Authenticated users can read course files" ON storage.objects;
CREATE POLICY "Authenticated users can read course files" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'user-files' AND 
    (storage.foldername(name))[1] IN ('courses', 'subjects')
  );

DROP POLICY IF EXISTS "Users can update own files" ON storage.objects;
CREATE POLICY "Users can update own files" ON storage.objects
  FOR UPDATE USING (bucket_id = 'user-files' AND auth.uid()::text = (storage.foldername(name))[1]);

DROP POLICY IF EXISTS "Users can delete own files" ON storage.objects;
CREATE POLICY "Users can delete own files" ON storage.objects
  FOR DELETE USING (bucket_id = 'user-files' AND auth.uid()::text = (storage.foldername(name))[1]);

DROP POLICY IF EXISTS "Teachers can read subject files" ON storage.objects;
CREATE POLICY "Teachers can read subject files" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'user-files' AND 
    EXISTS (
      SELECT 1 FROM public.subject_files sf
      JOIN public.subjects s ON sf.subject_id = s.id
      WHERE s.teacher_id = auth.uid() AND sf.file_url::text LIKE '%' || name::text || '%'
    )
  );

DROP POLICY IF EXISTS "Students can read subject files" ON storage.objects;
CREATE POLICY "Students can read subject files" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'user-files' AND 
    EXISTS (
      SELECT 1 FROM public.subject_files sf
      JOIN public.subject_students ss ON sf.subject_id = ss.subject_id
      WHERE ss.student_id = auth.uid() AND sf.file_url::text LIKE '%' || name::text || '%'
    )
  );

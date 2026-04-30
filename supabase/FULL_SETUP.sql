-- =====================================================
-- EXAMY - COMPLETE DATABASE SETUP SQL (CLEAN INSTALL)
-- Run in Supabase SQL Editor (Dashboard > SQL Editor > New Query)
-- ⚠️  Part 0 DROPS ALL existing tables (clean slate)
-- =====================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =====================================================
-- PART 0: CLEAN SLATE - Drop all tables (reverse dependency order)
-- ⚠️  REMOVE THIS SECTION IF YOU WANT TO KEEP EXISTING DATA!
-- =====================================================

DROP VIEW IF EXISTS public.teacher_student_performance CASCADE;

DROP TABLE IF EXISTS public.banned_users CASCADE;
DROP TABLE IF EXISTS public.announcements CASCADE;
DROP TABLE IF EXISTS public.user_sessions CASCADE;
DROP TABLE IF EXISTS public.notifications CASCADE;
DROP TABLE IF EXISTS public.attendance_records CASCADE;
DROP TABLE IF EXISTS public.attendance_sessions CASCADE;
DROP TABLE IF EXISTS public.submissions CASCADE;
DROP TABLE IF EXISTS public.subject_files CASCADE;
DROP TABLE IF EXISTS public.file_shares CASCADE;
DROP TABLE IF EXISTS public.user_files CASCADE;
DROP TABLE IF EXISTS public.assignments CASCADE;
DROP TABLE IF EXISTS public.note_views CASCADE;
DROP TABLE IF EXISTS public.lecture_notes CASCADE;
DROP TABLE IF EXISTS public.lectures CASCADE;
DROP TABLE IF EXISTS public.subject_teachers CASCADE;
DROP TABLE IF EXISTS public.subject_students CASCADE;
DROP TABLE IF EXISTS public.subjects CASCADE;
DROP TABLE IF EXISTS public.scores CASCADE;
DROP TABLE IF EXISTS public.quizzes CASCADE;
DROP TABLE IF EXISTS public.summaries CASCADE;
DROP TABLE IF EXISTS public.teacher_student_links CASCADE;
DROP TABLE IF EXISTS public.users CASCADE;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

-- Clean storage policies
DROP POLICY IF EXISTS "Users can upload files" ON storage.objects;
DROP POLICY IF EXISTS "Teachers can upload course files" ON storage.objects;
DROP POLICY IF EXISTS "Users can read own files" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can read course files" ON storage.objects;
DROP POLICY IF EXISTS "Users can update own files" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete own files" ON storage.objects;
DROP POLICY IF EXISTS "Teachers can read subject files" ON storage.objects;
DROP POLICY IF EXISTS "Students can read subject files" ON storage.objects;

-- =====================================================
-- PART 1: USERS (no dependencies - must be first)
-- =====================================================

CREATE TABLE public.users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('student', 'teacher', 'admin', 'superadmin')),
  teacher_code TEXT UNIQUE,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_users_teacher_code ON public.users(teacher_code) WHERE teacher_code IS NOT NULL;
CREATE INDEX idx_users_role ON public.users(role);

-- =====================================================
-- PART 2: TEACHER-STUDENT LINKS (depends on: users)
-- =====================================================

CREATE TABLE public.teacher_student_links (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  teacher_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(teacher_id, student_id)
);

CREATE INDEX idx_tsl_teacher ON public.teacher_student_links(teacher_id);
CREATE INDEX idx_tsl_student ON public.teacher_student_links(student_id);

-- =====================================================
-- PART 3: SUMMARIES (depends on: users)
-- =====================================================

CREATE TABLE public.summaries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  original_content TEXT NOT NULL,
  summary_content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_summaries_user ON public.summaries(user_id);

-- =====================================================
-- PART 4: SUBJECTS (depends on: users)
-- =====================================================

CREATE TABLE public.subjects (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  teacher_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  color TEXT DEFAULT '#10b981',
  join_code TEXT UNIQUE DEFAULT upper(substring(md5(random()::text) from 1 for 6)),
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE INDEX idx_subjects_teacher_id ON public.subjects(teacher_id);

-- =====================================================
-- PART 4b: SUBJECT_TEACHERS (depends on: subjects, users)
-- =====================================================

CREATE TABLE public.subject_teachers (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  subject_id UUID NOT NULL REFERENCES public.subjects(id) ON DELETE CASCADE,
  teacher_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'co_teacher' CHECK (role IN ('owner', 'co_teacher')),
  added_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  UNIQUE(subject_id, teacher_id)
);

CREATE INDEX idx_subject_teachers_subject_id ON public.subject_teachers(subject_id);
CREATE INDEX idx_subject_teachers_teacher_id ON public.subject_teachers(teacher_id);
CREATE INDEX idx_subject_teachers_role ON public.subject_teachers(role);

-- =====================================================
-- PART 5: SUBJECT_STUDENTS (depends on: subjects, users)
-- =====================================================

CREATE TABLE public.subject_students (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  subject_id UUID NOT NULL REFERENCES public.subjects(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  UNIQUE(subject_id, student_id)
);

CREATE INDEX idx_subject_students_subject_id ON public.subject_students(subject_id);
CREATE INDEX idx_subject_students_student_id ON public.subject_students(student_id);

-- =====================================================
-- PART 6: LECTURES (depends on: subjects)
-- =====================================================

CREATE TABLE public.lectures (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  subject_id UUID NOT NULL REFERENCES public.subjects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  lecture_date TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE INDEX idx_lectures_subject_id ON public.lectures(subject_id);

-- =====================================================
-- PART 7: QUIZZES (depends on: users, summaries, subjects)
-- =====================================================

CREATE TABLE public.quizzes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  duration INTEGER,
  scheduled_date TEXT,
  scheduled_time TEXT,
  summary_id UUID REFERENCES public.summaries(id) ON DELETE SET NULL,
  questions JSONB NOT NULL DEFAULT '[]',
  show_results BOOLEAN DEFAULT true,
  allow_retake BOOLEAN DEFAULT false,
  is_finished BOOLEAN DEFAULT false,
  subject_id UUID REFERENCES public.subjects(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_quizzes_user ON public.quizzes(user_id);

-- =====================================================
-- PART 8: SCORES (depends on: users, quizzes)
-- =====================================================

CREATE TABLE public.scores (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  student_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  teacher_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  quiz_id UUID NOT NULL REFERENCES public.quizzes(id) ON DELETE CASCADE,
  quiz_title TEXT NOT NULL,
  score INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL DEFAULT 0,
  user_answers JSONB NOT NULL DEFAULT '[]',
  completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_scores_student ON public.scores(student_id);
CREATE INDEX idx_scores_teacher ON public.scores(teacher_id);
CREATE INDEX idx_scores_quiz ON public.scores(quiz_id);

-- =====================================================
-- PART 9: LECTURE_NOTES (depends on: lectures, users)
-- =====================================================

CREATE TABLE public.lecture_notes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  lecture_id UUID NOT NULL REFERENCES public.lectures(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('public', 'private')),
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE INDEX idx_lecture_notes_lecture_id ON public.lecture_notes(lecture_id);
CREATE INDEX idx_lecture_notes_user_id ON public.lecture_notes(user_id);

-- =====================================================
-- PART 10: NOTE_VIEWS (depends on: lecture_notes, users)
-- =====================================================

CREATE TABLE public.note_views (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  note_id UUID NOT NULL REFERENCES public.lecture_notes(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  viewed_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  UNIQUE(note_id, user_id)
);

CREATE INDEX idx_note_views_note_id ON public.note_views(note_id);
CREATE INDEX idx_note_views_user_id ON public.note_views(user_id);

-- =====================================================
-- PART 11: ASSIGNMENTS (depends on: subjects, users)
-- =====================================================

CREATE TABLE public.assignments (
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

CREATE INDEX idx_assignments_subject_id ON public.assignments(subject_id);
CREATE INDEX idx_assignments_teacher_id ON public.assignments(teacher_id);

-- =====================================================
-- PART 12: USER_FILES (depends on: users, assignments)
-- =====================================================

CREATE TABLE public.user_files (
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

CREATE INDEX idx_user_files_user_id ON public.user_files(user_id);
CREATE INDEX idx_user_files_assignment_id ON public.user_files(assignment_id);

-- =====================================================
-- PART 13: FILE_SHARES (depends on: user_files, users)
-- =====================================================

CREATE TABLE public.file_shares (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  file_id UUID NOT NULL REFERENCES public.user_files(id) ON DELETE CASCADE,
  shared_by UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  shared_with UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  permission TEXT NOT NULL DEFAULT 'view' CHECK (permission IN ('view', 'edit', 'download')),
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  UNIQUE(file_id, shared_with)
);

CREATE INDEX idx_file_shares_file_id ON public.file_shares(file_id);
CREATE INDEX idx_file_shares_shared_by ON public.file_shares(shared_by);
CREATE INDEX idx_file_shares_shared_with ON public.file_shares(shared_with);

-- =====================================================
-- PART 14: SUBJECT_FILES (depends on: subjects, users)
-- =====================================================

CREATE TABLE public.subject_files (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  subject_id UUID NOT NULL REFERENCES public.subjects(id) ON DELETE CASCADE,
  uploaded_by UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_type TEXT NOT NULL,
  file_size BIGINT NOT NULL DEFAULT 0,
  file_url TEXT NOT NULL,
  description TEXT,
  category TEXT DEFAULT 'أخرى',
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE INDEX idx_subject_files_subject_id ON public.subject_files(subject_id);
CREATE INDEX idx_subject_files_uploaded_by ON public.subject_files(uploaded_by);

-- =====================================================
-- PART 15: SUBMISSIONS (depends on: assignments, users, user_files)
-- =====================================================

CREATE TABLE public.submissions (
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

CREATE INDEX idx_submissions_assignment_id ON public.submissions(assignment_id);
CREATE INDEX idx_submissions_student_id ON public.submissions(student_id);
CREATE INDEX idx_submissions_status ON public.submissions(status);

-- =====================================================
-- PART 16: ATTENDANCE_SESSIONS (depends on: lectures, users, subjects)
-- =====================================================

CREATE TABLE public.attendance_sessions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  lecture_id UUID NOT NULL REFERENCES public.lectures(id) ON DELETE CASCADE,
  teacher_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  subject_id UUID NOT NULL REFERENCES public.subjects(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'ended')),
  started_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX idx_one_active_session_per_teacher
  ON public.attendance_sessions(teacher_id) WHERE status = 'active';

CREATE INDEX idx_attendance_sessions_lecture_id ON public.attendance_sessions(lecture_id);
CREATE INDEX idx_attendance_sessions_teacher_id ON public.attendance_sessions(teacher_id);
CREATE INDEX idx_attendance_sessions_subject_id ON public.attendance_sessions(subject_id);
CREATE INDEX idx_attendance_sessions_status ON public.attendance_sessions(status);

-- =====================================================
-- PART 17: ATTENDANCE_RECORDS (depends on: attendance_sessions, users)
-- =====================================================

CREATE TABLE public.attendance_records (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES public.attendance_sessions(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  checked_in_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  UNIQUE(session_id, student_id)
);

CREATE INDEX idx_attendance_records_session_id ON public.attendance_records(session_id);
CREATE INDEX idx_attendance_records_student_id ON public.attendance_records(student_id);

-- =====================================================
-- PART 18: NOTIFICATIONS (depends on: users)
-- =====================================================

CREATE TABLE public.notifications (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('assignment', 'grade', 'enrollment', 'file', 'system', 'attendance')),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  read BOOLEAN NOT NULL DEFAULT false,
  link TEXT,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE INDEX idx_notifications_user_id ON public.notifications(user_id);
CREATE INDEX idx_notifications_user_unread ON public.notifications(user_id) WHERE read = false;
CREATE INDEX idx_notifications_type ON public.notifications(type);
CREATE INDEX idx_notifications_created_at ON public.notifications(created_at DESC);

-- =====================================================
-- PART 19: USER_SESSIONS (depends on: users)
-- =====================================================

CREATE TABLE public.user_sessions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  device_fingerprint TEXT NOT NULL,
  ip_address TEXT,
  location TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_activity TIMESTAMPTZ DEFAULT now() NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE INDEX idx_user_sessions_user_id ON public.user_sessions(user_id);
CREATE INDEX idx_user_sessions_is_active ON public.user_sessions(is_active);
CREATE INDEX idx_user_sessions_device_fingerprint ON public.user_sessions(device_fingerprint);
CREATE INDEX idx_user_sessions_last_activity ON public.user_sessions(last_activity);

-- =====================================================
-- PART 20: ANNOUNCEMENTS (depends on: users)
-- =====================================================

CREATE TABLE public.announcements (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  is_active BOOLEAN DEFAULT true NOT NULL,
  priority TEXT DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  created_by UUID REFERENCES public.users(id),
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE INDEX idx_announcements_active ON public.announcements(is_active);
CREATE INDEX idx_announcements_created_at ON public.announcements(created_at DESC);

-- =====================================================
-- PART 21: BANNED_USERS (no FK dependencies)
-- =====================================================

CREATE TABLE public.banned_users (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  banned_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  reason TEXT
);

CREATE INDEX idx_banned_users_email ON public.banned_users(email);

-- =====================================================
-- PART 22: ENABLE ROW LEVEL SECURITY (ALL TABLES)
-- =====================================================

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teacher_student_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.summaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subjects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subject_teachers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subject_students ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lectures ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quizzes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lecture_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.note_views ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.file_shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subject_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.banned_users ENABLE ROW LEVEL SECURITY;

-- =====================================================
-- PART 23: RLS POLICIES
-- =====================================================

-- ===== USERS =====
CREATE POLICY "Users can read own profile" ON public.users
  FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can insert own profile" ON public.users
  FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "Users can update own profile" ON public.users
  FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Teachers can read linked students" ON public.users
  FOR SELECT USING (
    id IN (SELECT student_id FROM public.teacher_student_links WHERE teacher_id = auth.uid())
  );
CREATE POLICY "Anyone authenticated can find teachers" ON public.users
  FOR SELECT USING (role = 'teacher' AND teacher_code IS NOT NULL);

-- ===== TEACHER-STUDENT LINKS =====
CREATE POLICY "Teachers can see own student links" ON public.teacher_student_links
  FOR SELECT USING (teacher_id = auth.uid());
CREATE POLICY "Students can see own teacher links" ON public.teacher_student_links
  FOR SELECT USING (student_id = auth.uid());
CREATE POLICY "Students can create links" ON public.teacher_student_links
  FOR INSERT WITH CHECK (student_id = auth.uid());
CREATE POLICY "Students can delete own links" ON public.teacher_student_links
  FOR DELETE USING (student_id = auth.uid());

-- ===== SUMMARIES =====
CREATE POLICY "Users can read own summaries" ON public.summaries
  FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "Teachers can read linked student summaries" ON public.summaries
  FOR SELECT USING (
    user_id IN (SELECT student_id FROM public.teacher_student_links WHERE teacher_id = auth.uid())
  );
CREATE POLICY "Users can create own summaries" ON public.summaries
  FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users can delete own summaries" ON public.summaries
  FOR DELETE USING (user_id = auth.uid());

-- ===== SUBJECTS =====
CREATE POLICY "Teachers can view own subjects" ON public.subjects
  FOR SELECT USING (
    teacher_id = auth.uid()
    OR id IN (SELECT subject_id FROM public.subject_teachers WHERE teacher_id = auth.uid())
  );
CREATE POLICY "Students can view enrolled subjects" ON public.subjects
  FOR SELECT USING (
    id IN (SELECT public.get_student_subject_ids(auth.uid()))
  );
CREATE POLICY "Teachers can create subjects" ON public.subjects
  FOR INSERT WITH CHECK (teacher_id = auth.uid());
CREATE POLICY "Teachers can update own subjects" ON public.subjects
  FOR UPDATE USING (teacher_id = auth.uid());
CREATE POLICY "Teachers can delete own subjects" ON public.subjects
  FOR DELETE USING (teacher_id = auth.uid());

-- ===== SUBJECT_TEACHERS =====
CREATE POLICY "Teachers can view subject_teachers in their subjects" ON public.subject_teachers
  FOR SELECT USING (
    subject_id IN (SELECT public.get_teacher_subject_ids(auth.uid()))
  );
CREATE POLICY "Students can view subject_teachers in enrolled subjects" ON public.subject_teachers
  FOR SELECT USING (
    subject_id IN (SELECT public.get_student_subject_ids(auth.uid()))
  );
CREATE POLICY "Subject owner can add co-teachers" ON public.subject_teachers
  FOR INSERT WITH CHECK (
    subject_id IN (SELECT id FROM public.subjects WHERE teacher_id = auth.uid())
  );
CREATE POLICY "Subject owner can remove co-teachers" ON public.subject_teachers
  FOR DELETE USING (
    subject_id IN (SELECT id FROM public.subjects WHERE teacher_id = auth.uid())
  );
CREATE POLICY "Co-teachers can remove themselves" ON public.subject_teachers
  FOR DELETE USING (
    teacher_id = auth.uid() AND role = 'co_teacher'
  );

-- ===== SUBJECT_STUDENTS =====
CREATE POLICY "Teachers can view enrollments in their subjects" ON public.subject_students
  FOR SELECT USING (
    subject_id IN (SELECT public.get_teacher_subject_ids(auth.uid()))
  );
CREATE POLICY "Students can view own enrollments" ON public.subject_students
  FOR SELECT USING (student_id = auth.uid());
CREATE POLICY "Teachers can enroll students" ON public.subject_students
  FOR INSERT WITH CHECK (
    subject_id IN (SELECT public.get_teacher_subject_ids(auth.uid()))
  );
CREATE POLICY "Teachers can remove students" ON public.subject_students
  FOR DELETE USING (
    subject_id IN (SELECT public.get_teacher_subject_ids(auth.uid()))
  );

-- ===== LECTURES =====
CREATE POLICY "Teachers can view lectures in own subjects" ON public.lectures
  FOR SELECT USING (
    subject_id IN (SELECT public.get_teacher_subject_ids(auth.uid()))
  );
CREATE POLICY "Students can view lectures in enrolled subjects" ON public.lectures
  FOR SELECT USING (
    subject_id IN (SELECT public.get_student_subject_ids(auth.uid()))
  );
CREATE POLICY "Teachers can create lectures" ON public.lectures
  FOR INSERT WITH CHECK (
    subject_id IN (SELECT public.get_teacher_subject_ids(auth.uid()))
  );
CREATE POLICY "Teachers can update lectures" ON public.lectures
  FOR UPDATE USING (
    subject_id IN (SELECT public.get_teacher_subject_ids(auth.uid()))
  );
CREATE POLICY "Teachers can delete lectures" ON public.lectures
  FOR DELETE USING (
    subject_id IN (SELECT public.get_teacher_subject_ids(auth.uid()))
  );

-- ===== QUIZZES =====
CREATE POLICY "Users can read own quizzes" ON public.quizzes
  FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "Students can read teacher quizzes" ON public.quizzes
  FOR SELECT USING (
    user_id IN (SELECT teacher_id FROM public.teacher_student_links WHERE student_id = auth.uid())
  );
CREATE POLICY "Users can create own quizzes" ON public.quizzes
  FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users can update own quizzes" ON public.quizzes
  FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "Users can delete own quizzes" ON public.quizzes
  FOR DELETE USING (user_id = auth.uid());

-- ===== SCORES =====
CREATE POLICY "Students can read own scores" ON public.scores
  FOR SELECT USING (student_id = auth.uid());
CREATE POLICY "Teachers can read own quiz scores" ON public.scores
  FOR SELECT USING (teacher_id = auth.uid());
CREATE POLICY "Students can create own scores" ON public.scores
  FOR INSERT WITH CHECK (student_id = auth.uid());
CREATE POLICY "Teachers can delete own quiz scores" ON public.scores
  FOR DELETE USING (teacher_id = auth.uid());

-- ===== LECTURE_NOTES =====
CREATE POLICY "Teachers can view all notes in their subjects" ON public.lecture_notes
  FOR SELECT USING (
    public.is_lecture_teacher(lecture_id, auth.uid())
  );
CREATE POLICY "Students can view public notes in enrolled subjects" ON public.lecture_notes
  FOR SELECT USING (
    (visibility = 'public' AND public.is_lecture_student(lecture_id, auth.uid())) OR user_id = auth.uid()
  );
CREATE POLICY "Users can create notes" ON public.lecture_notes
  FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users can update own notes" ON public.lecture_notes
  FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "Users can delete own notes" ON public.lecture_notes
  FOR DELETE USING (user_id = auth.uid());

-- ===== NOTE_VIEWS =====
CREATE POLICY "Users can view note views" ON public.note_views
  FOR SELECT USING (true);
CREATE POLICY "Users can insert own note views" ON public.note_views
  FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users can delete own note views" ON public.note_views
  FOR DELETE USING (user_id = auth.uid());

-- ===== ASSIGNMENTS =====
CREATE POLICY "Teachers can view assignments in own subjects" ON public.assignments
  FOR SELECT USING (
    subject_id IN (SELECT public.get_teacher_subject_ids(auth.uid()))
  );
CREATE POLICY "Students can view assignments in enrolled subjects" ON public.assignments
  FOR SELECT USING (
    subject_id IN (SELECT public.get_student_subject_ids(auth.uid()))
  );
CREATE POLICY "Teachers can create assignments" ON public.assignments
  FOR INSERT WITH CHECK (teacher_id = auth.uid());
CREATE POLICY "Teachers can update own assignments" ON public.assignments
  FOR UPDATE USING (teacher_id = auth.uid());
CREATE POLICY "Teachers can delete own assignments" ON public.assignments
  FOR DELETE USING (teacher_id = auth.uid());

-- ===== USER_FILES =====
CREATE POLICY "Users can view own files" ON public.user_files
  FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "Users can view files shared with them" ON public.user_files
  FOR SELECT USING (
    id IN (SELECT file_id FROM public.file_shares WHERE shared_with = auth.uid())
  );
CREATE POLICY "Teachers can view files linked to their assignments" ON public.user_files
  FOR SELECT USING (
    assignment_id IN (
      SELECT a.id FROM public.assignments a
      WHERE a.subject_id IN (SELECT public.get_teacher_subject_ids(auth.uid()))
    )
  );
CREATE POLICY "Users can upload files" ON public.user_files
  FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users can update own files" ON public.user_files
  FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "Users can delete own files" ON public.user_files
  FOR DELETE USING (user_id = auth.uid());

-- ===== FILE_SHARES =====
CREATE POLICY "Users can view shares for their files" ON public.file_shares
  FOR SELECT USING (shared_by = auth.uid() OR shared_with = auth.uid());
CREATE POLICY "Users can share own files" ON public.file_shares
  FOR INSERT WITH CHECK (shared_by = auth.uid());
CREATE POLICY "File owners can update shares" ON public.file_shares
  FOR UPDATE USING (
    file_id IN (SELECT id FROM public.user_files WHERE user_id = auth.uid())
  );
CREATE POLICY "File owners can delete shares" ON public.file_shares
  FOR DELETE USING (shared_by = auth.uid() OR shared_with = auth.uid());

-- ===== SUBJECT_FILES =====
CREATE POLICY "Teachers can view files in own subjects" ON public.subject_files
  FOR SELECT USING (
    subject_id IN (SELECT public.get_teacher_subject_ids(auth.uid()))
  );
CREATE POLICY "Students can view files in enrolled subjects" ON public.subject_files
  FOR SELECT USING (
    subject_id IN (SELECT public.get_student_subject_ids(auth.uid()))
  );
CREATE POLICY "Teachers can upload files to own subjects" ON public.subject_files
  FOR INSERT WITH CHECK (
    subject_id IN (SELECT public.get_teacher_subject_ids(auth.uid()))
  );
CREATE POLICY "Teachers can update files in own subjects" ON public.subject_files
  FOR UPDATE USING (
    subject_id IN (SELECT public.get_teacher_subject_ids(auth.uid()))
  );
CREATE POLICY "Teachers can delete files in own subjects" ON public.subject_files
  FOR DELETE USING (
    subject_id IN (SELECT public.get_teacher_subject_ids(auth.uid()))
  );

-- ===== SUBMISSIONS =====
CREATE POLICY "Teachers can view submissions for their assignments" ON public.submissions
  FOR SELECT USING (
    assignment_id IN (
      SELECT a.id FROM public.assignments a
      WHERE a.subject_id IN (SELECT public.get_teacher_subject_ids(auth.uid()))
    )
  );
CREATE POLICY "Students can view own submissions" ON public.submissions
  FOR SELECT USING (student_id = auth.uid());
CREATE POLICY "Students can create submissions" ON public.submissions
  FOR INSERT WITH CHECK (student_id = auth.uid());
CREATE POLICY "Students can update own ungraded submissions" ON public.submissions
  FOR UPDATE USING (student_id = auth.uid() AND status = 'submitted');
CREATE POLICY "Teachers can grade submissions for their assignments" ON public.submissions
  FOR UPDATE USING (
    assignment_id IN (
      SELECT a.id FROM public.assignments a
      WHERE a.subject_id IN (SELECT public.get_teacher_subject_ids(auth.uid()))
    )
  );

-- ===== ATTENDANCE_SESSIONS =====
CREATE POLICY "Teachers can view own attendance sessions" ON public.attendance_sessions
  FOR SELECT USING (teacher_id = auth.uid());
CREATE POLICY "Students can view attendance sessions in enrolled subjects" ON public.attendance_sessions
  FOR SELECT USING (
    subject_id IN (SELECT public.get_student_subject_ids(auth.uid()))
  );
CREATE POLICY "Teachers can create attendance sessions" ON public.attendance_sessions
  FOR INSERT WITH CHECK (
    teacher_id = auth.uid()
  );
CREATE POLICY "Teachers can update own attendance sessions" ON public.attendance_sessions
  FOR UPDATE USING (teacher_id = auth.uid());
CREATE POLICY "Teachers can delete own attendance sessions" ON public.attendance_sessions
  FOR DELETE USING (teacher_id = auth.uid());

-- ===== ATTENDANCE_RECORDS =====
CREATE POLICY "Teachers can view attendance records for own sessions" ON public.attendance_records
  FOR SELECT USING (
    session_id IN (SELECT id FROM public.attendance_sessions WHERE teacher_id = auth.uid())
  );
CREATE POLICY "Students can view own attendance records" ON public.attendance_records
  FOR SELECT USING (student_id = auth.uid());
CREATE POLICY "Students can check in to attendance" ON public.attendance_records
  FOR INSERT WITH CHECK (
    student_id = auth.uid()
  );
CREATE POLICY "Teachers can delete attendance records for own sessions" ON public.attendance_records
  FOR DELETE USING (
    session_id IN (SELECT id FROM public.attendance_sessions WHERE teacher_id = auth.uid())
  );

-- ===== NOTIFICATIONS =====
CREATE POLICY "Users can view own notifications" ON public.notifications
  FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "System can create notifications" ON public.notifications
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Users can update own notifications" ON public.notifications
  FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "Users can delete own notifications" ON public.notifications
  FOR DELETE USING (user_id = auth.uid());

-- ===== USER_SESSIONS =====
CREATE POLICY "Users can view own sessions" ON public.user_sessions
  FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "Users can create own sessions" ON public.user_sessions
  FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users can update own sessions" ON public.user_sessions
  FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "Users can delete own sessions" ON public.user_sessions
  FOR DELETE USING (user_id = auth.uid());

-- ===== ANNOUNCEMENTS =====
CREATE POLICY "Anyone can read active announcements" ON public.announcements
  FOR SELECT USING (true);
CREATE POLICY "Admins can manage announcements" ON public.announcements
  FOR ALL USING (true);

-- ===== BANNED_USERS =====
CREATE POLICY "Admins can manage banned users" ON public.banned_users
  FOR ALL USING (true);

-- =====================================================
-- PART 24: GRANT PERMISSIONS
-- =====================================================

GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;

GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;

ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO authenticated;

GRANT SELECT, INSERT, DELETE ON public.note_views TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.announcements TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.banned_users TO anon, authenticated;

-- =====================================================
-- PART 25: FUNCTIONS & TRIGGERS
-- =====================================================

-- ── SECURITY DEFINER helpers (prevent RLS infinite recursion) ──
-- These functions bypass RLS when checking relationships between tables,
-- preventing circular references between subjects ↔ subject_students policies.

CREATE OR REPLACE FUNCTION public.is_subject_teacher(subject_id UUID, teacher_id UUID)
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.subjects WHERE id = subject_id AND subjects.teacher_id = teacher_id
    UNION ALL
    SELECT 1 FROM public.subject_teachers WHERE subject_teachers.subject_id = subject_id AND subject_teachers.teacher_id = teacher_id
  );
$$;

CREATE OR REPLACE FUNCTION public.is_subject_student(subject_id UUID, student_id UUID)
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.subject_students WHERE subject_students.subject_id = subject_id AND subject_students.student_id = student_id);
$$;

CREATE OR REPLACE FUNCTION public.get_teacher_subject_ids(teacher_id UUID)
RETURNS SETOF UUID LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM public.subjects WHERE subjects.teacher_id = teacher_id
  UNION
  SELECT subject_id FROM public.subject_teachers WHERE subject_teachers.teacher_id = teacher_id;
$$;

CREATE OR REPLACE FUNCTION public.get_student_subject_ids(student_id UUID)
RETURNS SETOF UUID LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT subject_id FROM public.subject_students WHERE subject_students.student_id = student_id;
$$;

CREATE OR REPLACE FUNCTION public.is_lecture_teacher(lecture_id UUID, teacher_id UUID)
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.lectures l
    JOIN public.subjects s ON l.subject_id = s.id
    WHERE l.id = lecture_id AND s.teacher_id = teacher_id
    UNION ALL
    SELECT 1 FROM public.lectures l
    JOIN public.subject_teachers st ON l.subject_id = st.subject_id
    WHERE l.id = lecture_id AND st.teacher_id = teacher_id
  );
$$;

CREATE OR REPLACE FUNCTION public.is_lecture_student(lecture_id UUID, student_id UUID)
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.lectures l JOIN public.subject_students ss ON l.subject_id = ss.subject_id WHERE l.id = lecture_id AND ss.student_id = student_id);
$$;

GRANT EXECUTE ON FUNCTION public.is_subject_teacher(UUID, UUID) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.is_subject_student(UUID, UUID) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.get_teacher_subject_ids(UUID) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.get_student_subject_ids(UUID) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.is_lecture_teacher(UUID, UUID) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.is_lecture_student(UUID, UUID) TO authenticated, anon;

-- ── Regular triggers ──

-- Auto-generate teacher code for new teachers
CREATE OR REPLACE FUNCTION public.generate_teacher_code()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.role = 'teacher' AND NEW.teacher_code IS NULL THEN
    NEW.teacher_code := UPPER(SUBSTRING(MD5(RANDOM()::TEXT) FROM 1 FOR 6));
    WHILE EXISTS (SELECT 1 FROM public.users WHERE teacher_code = NEW.teacher_code) LOOP
      NEW.teacher_code := UPPER(SUBSTRING(MD5(RANDOM()::TEXT) FROM 1 FOR 6));
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_generate_teacher_code
  BEFORE INSERT ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.generate_teacher_code();

-- Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER trg_attendance_sessions_updated_at
  BEFORE UPDATE ON public.attendance_sessions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- Auth trigger: Auto-create profile when new user signs up
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  user_count integer;
BEGIN
  -- Count existing users to check if this is the first user
  SELECT COUNT(*) INTO user_count FROM public.users;
  
  -- First user becomes superadmin, all others get their specified role (default: student)
  INSERT INTO public.users (id, email, name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    CASE 
      WHEN user_count = 0 THEN 'superadmin'
      ELSE COALESCE(NEW.raw_user_meta_data->>'role', 'student')
    END
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Auto-insert owner into subject_teachers when a subject is created
CREATE OR REPLACE FUNCTION public.auto_insert_subject_owner()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.subject_teachers (subject_id, teacher_id, role)
  VALUES (NEW.id, NEW.teacher_id, 'owner')
  ON CONFLICT (subject_id, teacher_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_auto_insert_subject_owner
  AFTER INSERT ON public.subjects
  FOR EACH ROW EXECUTE FUNCTION public.auto_insert_subject_owner();

-- =====================================================
-- PART 26: VIEWS
-- =====================================================

CREATE OR REPLACE VIEW public.teacher_student_performance AS
SELECT 
  u.id AS student_id,
  u.name AS student_name,
  u.email AS student_email,
  s.id AS score_id,
  s.quiz_id,
  s.quiz_title,
  s.score,
  s.total,
  s.completed_at,
  ROUND((s.score::DECIMAL / NULLIF(s.total, 0)) * 100) AS percentage
FROM public.users u
JOIN public.teacher_student_links tsl ON u.id = tsl.student_id
JOIN public.scores s ON u.id = s.student_id
WHERE s.teacher_id = tsl.teacher_id;

-- =====================================================
-- PART 27: ENABLE REALTIME
-- =====================================================

DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.lecture_notes; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.lectures; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.subjects; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.subject_students; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.assignments; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.submissions; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.subject_files; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.user_files; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.attendance_sessions; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.attendance_records; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.subject_teachers; EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- =====================================================
-- PART 28: SUPABASE STORAGE BUCKET & POLICIES
-- =====================================================

INSERT INTO storage.buckets (id, name, public) VALUES ('user-files', 'user-files', true) ON CONFLICT DO NOTHING;
UPDATE storage.buckets SET public = true WHERE id = 'user-files';

CREATE POLICY "Users can upload files" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'user-files' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Teachers can upload course files" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'user-files' AND 
    (storage.foldername(name))[1] IN ('courses', 'subjects') AND
    EXISTS (SELECT 1 FROM public.subjects WHERE teacher_id = auth.uid())
  );

CREATE POLICY "Users can read own files" ON storage.objects
  FOR SELECT USING (bucket_id = 'user-files' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Authenticated users can read course files" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'user-files' AND 
    (storage.foldername(name))[1] IN ('courses', 'subjects')
  );

CREATE POLICY "Users can update own files" ON storage.objects
  FOR UPDATE USING (bucket_id = 'user-files' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can delete own files" ON storage.objects
  FOR DELETE USING (bucket_id = 'user-files' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Teachers can read subject files" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'user-files' AND 
    EXISTS (
      SELECT 1 FROM public.subject_files sf
      JOIN public.subjects s ON sf.subject_id = s.id
      WHERE s.teacher_id = auth.uid() AND sf.file_url::text LIKE '%' || name::text || '%'
    )
  );

CREATE POLICY "Students can read subject files" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'user-files' AND 
    EXISTS (
      SELECT 1 FROM public.subject_files sf
      JOIN public.subject_students ss ON sf.subject_id = ss.subject_id
      WHERE ss.student_id = auth.uid() AND sf.file_url::text LIKE '%' || name::text || '%'
    )
  );

-- =====================================================
-- ✅ DONE! All 21 tables, RLS policies, triggers, views, realtime & storage set up.
-- =====================================================

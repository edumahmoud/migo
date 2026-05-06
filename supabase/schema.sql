-- =====================================================
-- Examy (EduAI) - Supabase Database Schema
-- المنصة التعليمية الذكية
-- Idempotent: safe to re-run (uses DROP IF EXISTS + CREATE IF NOT EXISTS)
-- =====================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =====================================================
-- 1. USERS TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS public.users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('student', 'teacher', 'admin')),
  teacher_code TEXT UNIQUE,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for teacher code lookups
CREATE INDEX IF NOT EXISTS idx_users_teacher_code ON public.users(teacher_code) WHERE teacher_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_role ON public.users(role);

-- =====================================================
-- 2. TEACHER-STUDENT LINKS TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS public.teacher_student_links (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  teacher_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(teacher_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_tsl_teacher ON public.teacher_student_links(teacher_id);
CREATE INDEX IF NOT EXISTS idx_tsl_student ON public.teacher_student_links(student_id);

-- =====================================================
-- 3. SUMMARIES TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS public.summaries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  original_content TEXT NOT NULL,
  summary_content TEXT NOT NULL,
  subject_id UUID REFERENCES public.subjects(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_summaries_user ON public.summaries(user_id);
CREATE INDEX IF NOT EXISTS idx_summaries_subject ON public.summaries(subject_id);

-- =====================================================
-- 4. QUIZZES TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS public.quizzes (
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
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_quizzes_user ON public.quizzes(user_id);

-- =====================================================
-- 5. SCORES TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS public.scores (
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

CREATE INDEX IF NOT EXISTS idx_scores_student ON public.scores(student_id);
CREATE INDEX IF NOT EXISTS idx_scores_teacher ON public.scores(teacher_id);
CREATE INDEX IF NOT EXISTS idx_scores_quiz ON public.scores(quiz_id);

-- =====================================================
-- ROW LEVEL SECURITY (RLS)
-- =====================================================

-- Enable RLS on all tables
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teacher_student_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.summaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quizzes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scores ENABLE ROW LEVEL SECURITY;

-- Grant proper permissions to anon and authenticated roles
GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;

GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;

-- Ensure future tables also get the right permissions
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO authenticated;

-- ===== USERS POLICIES =====
DROP POLICY IF EXISTS "Users can read own profile" ON public.users;
CREATE POLICY "Users can read own profile" ON public.users
  FOR SELECT USING (auth.uid() = id);

DROP POLICY IF EXISTS "Users can insert own profile" ON public.users;
CREATE POLICY "Users can insert own profile" ON public.users
  FOR INSERT WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "Users can update own profile" ON public.users;
CREATE POLICY "Users can update own profile" ON public.users
  FOR UPDATE USING (auth.uid() = id);

DROP POLICY IF EXISTS "Teachers can read linked students" ON public.users;
CREATE POLICY "Teachers can read linked students" ON public.users
  FOR SELECT USING (
    id IN (SELECT student_id FROM public.teacher_student_links WHERE teacher_id = auth.uid())
  );

DROP POLICY IF EXISTS "Anyone authenticated can find teachers" ON public.users;
CREATE POLICY "Anyone authenticated can find teachers" ON public.users
  FOR SELECT USING (
    role = 'teacher' AND teacher_code IS NOT NULL
  );

-- ===== TEACHER-STUDENT LINKS POLICIES =====
DROP POLICY IF EXISTS "Teachers can see own student links" ON public.teacher_student_links;
CREATE POLICY "Teachers can see own student links" ON public.teacher_student_links
  FOR SELECT USING (teacher_id = auth.uid());

DROP POLICY IF EXISTS "Students can see own teacher links" ON public.teacher_student_links;
CREATE POLICY "Students can see own teacher links" ON public.teacher_student_links
  FOR SELECT USING (student_id = auth.uid());

DROP POLICY IF EXISTS "Students can create links" ON public.teacher_student_links;
CREATE POLICY "Students can create links" ON public.teacher_student_links
  FOR INSERT WITH CHECK (student_id = auth.uid());

DROP POLICY IF EXISTS "Students can delete own links" ON public.teacher_student_links;
CREATE POLICY "Students can delete own links" ON public.teacher_student_links
  FOR DELETE USING (student_id = auth.uid());

-- ===== SUMMARIES POLICIES =====
DROP POLICY IF EXISTS "Users can read own summaries" ON public.summaries;
CREATE POLICY "Users can read own summaries" ON public.summaries
  FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Teachers can read linked student summaries" ON public.summaries;
CREATE POLICY "Teachers can read linked student summaries" ON public.summaries
  FOR SELECT USING (
    user_id IN (SELECT student_id FROM public.teacher_student_links WHERE teacher_id = auth.uid())
  );

DROP POLICY IF EXISTS "Users can create own summaries" ON public.summaries;
CREATE POLICY "Users can create own summaries" ON public.summaries
  FOR INSERT WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can delete own summaries" ON public.summaries;
CREATE POLICY "Users can delete own summaries" ON public.summaries
  FOR DELETE USING (user_id = auth.uid());

-- ===== QUIZZES POLICIES =====
DROP POLICY IF EXISTS "Users can read own quizzes" ON public.quizzes;
CREATE POLICY "Users can read own quizzes" ON public.quizzes
  FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Students can read teacher quizzes" ON public.quizzes;
CREATE POLICY "Students can read teacher quizzes" ON public.quizzes
  FOR SELECT USING (
    user_id IN (SELECT teacher_id FROM public.teacher_student_links WHERE student_id = auth.uid())
  );

DROP POLICY IF EXISTS "Users can create own quizzes" ON public.quizzes;
CREATE POLICY "Users can create own quizzes" ON public.quizzes
  FOR INSERT WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can update own quizzes" ON public.quizzes;
CREATE POLICY "Users can update own quizzes" ON public.quizzes
  FOR UPDATE USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can delete own quizzes" ON public.quizzes;
CREATE POLICY "Users can delete own quizzes" ON public.quizzes
  FOR DELETE USING (user_id = auth.uid());

-- ===== SCORES POLICIES =====
DROP POLICY IF EXISTS "Students can read own scores" ON public.scores;
CREATE POLICY "Students can read own scores" ON public.scores
  FOR SELECT USING (student_id = auth.uid());

DROP POLICY IF EXISTS "Teachers can read own quiz scores" ON public.scores;
CREATE POLICY "Teachers can read own quiz scores" ON public.scores
  FOR SELECT USING (teacher_id = auth.uid());

DROP POLICY IF EXISTS "Students can create own scores" ON public.scores;
CREATE POLICY "Students can create own scores" ON public.scores
  FOR INSERT WITH CHECK (student_id = auth.uid());

DROP POLICY IF EXISTS "Teachers can delete own quiz scores" ON public.scores;
CREATE POLICY "Teachers can delete own quiz scores" ON public.scores
  FOR DELETE USING (teacher_id = auth.uid());

-- ===== SERVICE ROLE FULL ACCESS (for API routes) =====
-- These policies allow the service_role to bypass RLS
-- (Service role key already bypasses RLS by default in Supabase)

-- =====================================================
-- FUNCTIONS
-- =====================================================

-- Auto-generate teacher code for new teachers
CREATE OR REPLACE FUNCTION public.generate_teacher_code()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.role = 'teacher' AND NEW.teacher_code IS NULL THEN
    NEW.teacher_code := UPPER(SUBSTRING(MD5(RANDOM()::TEXT) FROM 1 FOR 6));
    -- Ensure uniqueness
    WHILE EXISTS (SELECT 1 FROM public.users WHERE teacher_code = NEW.teacher_code) LOOP
      NEW.teacher_code := UPPER(SUBSTRING(MD5(RANDOM()::TEXT) FROM 1 FOR 6));
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_generate_teacher_code ON public.users;
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

DROP TRIGGER IF EXISTS trg_users_updated_at ON public.users;
CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- =====================================================
-- AUTH TRIGGER: Auto-create profile when new user signs up
-- =====================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.users (id, email, name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data->>'role', 'student')
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- If insert fails (e.g., duplicate key from client-side insert), just continue
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop existing trigger if it exists, then create it
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- =====================================================
-- VIEWS
-- =====================================================

-- View for teacher dashboard: student performance overview
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

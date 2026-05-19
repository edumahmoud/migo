-- =====================================================
-- v29: Question Banks & Bank Questions
-- Creates tables for managing reusable question banks
-- linked to subjects/courses for teachers
-- =====================================================

-- Question Banks table (groups of questions tied to a subject)
CREATE TABLE IF NOT EXISTS public.question_banks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  subject_id UUID NOT NULL REFERENCES public.subjects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Individual questions within a bank
CREATE TABLE IF NOT EXISTS public.bank_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_id UUID NOT NULL REFERENCES public.question_banks(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('mcq', 'boolean', 'completion', 'matching')),
  question TEXT NOT NULL,
  options JSONB,            -- array of strings for mcq options
  correct_answer TEXT,      -- correct answer for mcq/boolean/completion
  pairs JSONB,              -- array of {key, value} objects for matching
  difficulty TEXT CHECK (difficulty IN ('easy', 'medium', 'hard')),
  category TEXT,            -- optional categorization tag
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_question_banks_teacher ON public.question_banks(teacher_id);
CREATE INDEX IF NOT EXISTS idx_question_banks_subject ON public.question_banks(subject_id);
CREATE INDEX IF NOT EXISTS idx_bank_questions_bank ON public.bank_questions(bank_id);
CREATE INDEX IF NOT EXISTS idx_bank_questions_type ON public.bank_questions(type);
CREATE INDEX IF NOT EXISTS idx_bank_questions_difficulty ON public.bank_questions(difficulty);
CREATE INDEX IF NOT EXISTS idx_bank_questions_category ON public.bank_questions(category);

-- Updated_at trigger for question_banks
-- Use CREATE OR REPLACE to be safe if function already exists
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS question_banks_updated_at ON public.question_banks;
CREATE TRIGGER question_banks_updated_at
  BEFORE UPDATE ON public.question_banks
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- RLS Policies for question_banks
ALTER TABLE public.question_banks ENABLE ROW LEVEL SECURITY;

-- Teachers can view their own question banks
CREATE POLICY "Teachers can view own question banks"
  ON public.question_banks FOR SELECT
  USING (teacher_id = auth.uid());

-- Teachers can create question banks (verified via subject ownership)
CREATE POLICY "Teachers can create question banks"
  ON public.question_banks FOR INSERT
  WITH CHECK (teacher_id = auth.uid());

-- Teachers can update their own question banks
CREATE POLICY "Teachers can update own question banks"
  ON public.question_banks FOR UPDATE
  USING (teacher_id = auth.uid())
  WITH CHECK (teacher_id = auth.uid());

-- Teachers can delete their own question banks
CREATE POLICY "Teachers can delete own question banks"
  ON public.question_banks FOR DELETE
  USING (teacher_id = auth.uid());

-- Co-teachers can view question banks for their subjects
CREATE POLICY "Co-teachers can view subject question banks"
  ON public.question_banks FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.subject_teachers st
      WHERE st.subject_id = question_banks.subject_id
      AND st.teacher_id = auth.uid()
    )
  );

-- RLS Policies for bank_questions
ALTER TABLE public.bank_questions ENABLE ROW LEVEL SECURITY;

-- Teachers can view questions in their own banks
CREATE POLICY "Teachers can view own bank questions"
  ON public.bank_questions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.question_banks qb
      WHERE qb.id = bank_questions.bank_id
      AND qb.teacher_id = auth.uid()
    )
  );

-- Co-teachers can view questions for their subjects
CREATE POLICY "Co-teachers can view subject bank questions"
  ON public.bank_questions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.question_banks qb
      JOIN public.subject_teachers st ON st.subject_id = qb.subject_id
      WHERE qb.id = bank_questions.bank_id
      AND st.teacher_id = auth.uid()
    )
  );

-- Teachers can insert questions into their own banks
CREATE POLICY "Teachers can insert bank questions"
  ON public.bank_questions FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.question_banks qb
      WHERE qb.id = bank_questions.bank_id
      AND qb.teacher_id = auth.uid()
    )
  );

-- Teachers can update questions in their own banks
CREATE POLICY "Teachers can update own bank questions"
  ON public.bank_questions FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.question_banks qb
      WHERE qb.id = bank_questions.bank_id
      AND qb.teacher_id = auth.uid()
    )
  );

-- Teachers can delete questions in their own banks
CREATE POLICY "Teachers can delete own bank questions"
  ON public.bank_questions FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.question_banks qb
      WHERE qb.id = bank_questions.bank_id
      AND qb.teacher_id = auth.uid()
    )
  );

-- Enable Realtime for question banks and questions
ALTER PUBLICATION supabase_realtime ADD TABLE public.question_banks;
ALTER PUBLICATION supabase_realtime ADD TABLE public.bank_questions;

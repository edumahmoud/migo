-- =====================================================
-- v130: Sequential role-specific codes with prefix + preserve/restore
--
-- GOALS:
-- 1. Replace random teacher_code / student_code generation with
--    sequential prefix-based codes:
--      - Teachers:  T-1, T-2, T-3, ...
--      - Students:  S-1, S-2, S-3, ...
--      - Agents:    A-1, A-2, A-3, ... (new registration_code column)
-- 2. Add previous_*_code columns to preserve codes when a user's
--    role changes away from teacher/student/agent, so the code can
--    be restored if the user returns to that role later.
-- 3. Prevent code reuse: when generating a new code, check both the
--    active code column AND the previous_*_code column to ensure
--    no collision with a preserved code.
-- 4. Concurrency-safe code generation using Sequences + advisory lock.
--
-- NOTES:
-- - Existing codes (random 6-8 char) are NOT touched. Only new users
--   (or role changes that generate a new code) get the sequential format.
-- - The prefix format is T-<seq>, S-<seq>, A-<seq> (no zero-padding,
--   per user request — just the raw sequence number).
-- =====================================================

-- -------------------------------------------------------------
-- 1. Add new columns for registration_code + previous_*_code preservation
-- -------------------------------------------------------------

-- registration_code for registration_agent role (new — for future use)
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS registration_code TEXT UNIQUE;

CREATE INDEX IF NOT EXISTS idx_users_registration_code
  ON public.users(registration_code) WHERE registration_code IS NOT NULL;

-- previous_teacher_code: preserves teacher_code when role changes away from teacher
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS previous_teacher_code TEXT;

-- previous_student_code: preserves student_code when role changes away from student
-- (student_code is universal login in v110, so we may not null it on role
--  change — but the column exists for future use / audit trail)
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS previous_student_code TEXT;

-- previous_registration_code: preserves registration_code when role changes
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS previous_registration_code TEXT;

-- -------------------------------------------------------------
-- 2. Create sequences for sequential code generation
-- -------------------------------------------------------------

CREATE SEQUENCE IF NOT EXISTS public.teacher_code_seq
  AS BIGINT START 1 INCREMENT 1 NO CYCLE;

CREATE SEQUENCE IF NOT EXISTS public.student_code_seq
  AS BIGINT START 1 INCREMENT 1 NO CYCLE;

CREATE SEQUENCE IF NOT EXISTS public.registration_code_seq
  AS BIGINT START 1 INCREMENT 1 NO CYCLE;

-- -------------------------------------------------------------
-- 3. Helper function: generate a unique sequential code with prefix
--    Checks BOTH the active column AND the previous_*_code column
--    to prevent reuse of preserved codes.
--    Uses a transaction-level advisory lock to serialize concurrent
--    code generation (prevents two simultaneous requests from getting
--    the same sequence value in a race).
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.generate_sequential_code(
  p_prefix TEXT,
  p_seq_name TEXT,
  p_active_column TEXT,
  p_previous_column TEXT
)
RETURNS TEXT AS $$
DECLARE
  v_seq_val BIGINT;
  v_code TEXT;
  v_exists BOOLEAN;
  v_attempts INTEGER := 0;
BEGIN
  -- Acquire transaction-level advisory lock to serialize code generation.
  -- Key: hash of the prefix (deterministic per code type).
  PERFORM pg_advisory_xact_lock(hashtext(p_prefix));

  LOOP
    -- Get next sequence value
    EXECUTE format('SELECT nextval(%L)', p_seq_name) INTO v_seq_val;
    v_code := p_prefix || '-' || v_seq_val::TEXT;

    -- Check if code exists in active column
    EXECUTE format(
      'SELECT EXISTS(SELECT 1 FROM public.users WHERE %I = $1)',
      p_active_column
    ) INTO v_exists USING v_code;

    IF v_exists THEN
      v_attempts := v_attempts + 1;
      IF v_attempts > 100 THEN
        RAISE EXCEPTION 'Could not generate unique % code after 100 attempts', p_prefix;
      END IF;
      CONTINUE;
    END IF;

    -- Check if code exists in previous column (prevent reuse of preserved codes)
    IF p_previous_column IS NOT NULL THEN
      EXECUTE format(
        'SELECT EXISTS(SELECT 1 FROM public.users WHERE %I = $1)',
        p_previous_column
      ) INTO v_exists USING v_code;

      IF v_exists THEN
        v_attempts := v_attempts + 1;
        IF v_attempts > 100 THEN
          RAISE EXCEPTION 'Could not generate unique % code after 100 attempts (previous column collision)', p_prefix;
        END IF;
        CONTINUE;
      END IF;
    END IF;

    -- Code is unique in both columns — return it
    RETURN v_code;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- -------------------------------------------------------------
-- 4. Replace generate_teacher_code() trigger with sequential version
--    Fires on INSERT only (matches original trigger).
--    Only generates a new code if teacher_code IS NULL.
--    If previous_teacher_code exists (user returning to teacher role),
--    the change-role API will set teacher_code = previous_teacher_code
--    BEFORE this trigger runs (via UPDATE, not INSERT), so this trigger
--    won't fire. This trigger is a fallback for new INSERTs.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.generate_teacher_code()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.role = 'teacher' AND NEW.teacher_code IS NULL THEN
    -- Don't generate if there's a preserved code (the API will restore it)
    IF NEW.previous_teacher_code IS NOT NULL THEN
      NEW.teacher_code := NEW.previous_teacher_code;
      NEW.previous_teacher_code := NULL;  -- clear after restore
    ELSE
      NEW.teacher_code := public.generate_sequential_code(
        'T', 'public.teacher_code_seq', 'teacher_code', 'previous_teacher_code'
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Re-create the trigger (drop old, create new — same name, same timing)
DROP TRIGGER IF EXISTS trg_generate_teacher_code ON public.users;
CREATE TRIGGER trg_generate_teacher_code
  BEFORE INSERT OR UPDATE OF role ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.generate_teacher_code();

-- -------------------------------------------------------------
-- 5. Replace generate_student_code() trigger with sequential version
--    Fires on INSERT OR UPDATE OF role, student_code.
--    Only generates a new code if student_code IS NULL.
--    If previous_student_code exists, restore it.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.generate_student_code()
RETURNS TRIGGER AS $$
BEGIN
  -- v110: Generate a code for ANY user who doesn't have one
  -- (student_code is used as universal login code)
  IF NEW.student_code IS NULL THEN
    IF NEW.previous_student_code IS NOT NULL THEN
      NEW.student_code := NEW.previous_student_code;
      NEW.previous_student_code := NULL;
    ELSE
      NEW.student_code := public.generate_sequential_code(
        'S', 'public.student_code_seq', 'student_code', 'previous_student_code'
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Re-create the trigger
DROP TRIGGER IF EXISTS trg_generate_student_code ON public.users;
CREATE TRIGGER trg_generate_student_code
  BEFORE INSERT OR UPDATE OF role, student_code ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.generate_student_code();

-- -------------------------------------------------------------
-- 6. Create registration_code trigger (new — for registration_agent role)
--    Fires on INSERT OR UPDATE OF role.
--    Only generates if role = 'registration_agent' AND registration_code IS NULL.
--    If previous_registration_code exists, restore it.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.generate_registration_code()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.role = 'registration_agent' AND NEW.registration_code IS NULL THEN
    IF NEW.previous_registration_code IS NOT NULL THEN
      NEW.registration_code := NEW.previous_registration_code;
      NEW.previous_registration_code := NULL;
    ELSE
      NEW.registration_code := public.generate_sequential_code(
        'A', 'public.registration_code_seq', 'registration_code', 'previous_registration_code'
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_generate_registration_code ON public.users;
CREATE TRIGGER trg_generate_registration_code
  BEFORE INSERT OR UPDATE OF role ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.generate_registration_code();

-- -------------------------------------------------------------
-- 7. Comments for documentation
-- -------------------------------------------------------------
COMMENT ON COLUMN public.users.previous_teacher_code IS 'v130: Preserved teacher_code when user role changes away from teacher. Used to restore the same code if user returns to teacher role.';
COMMENT ON COLUMN public.users.previous_student_code IS 'v130: Preserved student_code when user role changes away from student. Used to restore the same code if user returns to student role.';
COMMENT ON COLUMN public.users.registration_code IS 'v130: Sequential code for registration_agent role (A-1, A-2, ...). For future use.';
COMMENT ON COLUMN public.users.previous_registration_code IS 'v130: Preserved registration_code when user role changes away from registration_agent.';
COMMENT ON SEQUENCE public.teacher_code_seq IS 'v130: Sequence for generating teacher codes (T-1, T-2, ...)';
COMMENT ON SEQUENCE public.student_code_seq IS 'v130: Sequence for generating student codes (S-1, S-2, ...)';
COMMENT ON SEQUENCE public.registration_code_seq IS 'v130: Sequence for generating registration agent codes (A-1, A-2, ...)';

-- =============================================================
-- v134_paid_sections.sql
-- AttenDo LMS — Paid sections / locked sections feature
--
-- Background:
--   The platform admin can lock ANY student/teacher section (summaries,
--   questionBank, scormLibrary, videos, files, etc.) and make it a
--   paid feature. Users see a lock icon; clicking it shows an
--   activation-request page. The admin processes requests manually
--   (payment integration will be added later).
--
--   Each section has INDEPENDENT pricing per role (student vs teacher)
--   and a USAGE LIMIT (max summaries+AI-quizzes per period, counting
--   deleted items as part of the total).
--
-- Tables:
--   1. locked_sections_config — per-section lock settings + pricing + limits
--   2. section_activation_requests — user-submitted activation requests
--   3. user_section_unlocks — active unlocks per user/section
--   4. global_section_unlocks — time-limited global opens (all / new_users)
-- =============================================================

-- ─── 1. locked_sections_config ───
CREATE TABLE IF NOT EXISTS public.locked_sections_config (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  section_key             TEXT NOT NULL UNIQUE,
  section_label           TEXT NOT NULL,
  -- Which roles are locked
  student_locked          BOOLEAN NOT NULL DEFAULT false,
  teacher_locked          BOOLEAN NOT NULL DEFAULT false,
  -- Pricing per role (independent)
  student_monthly_price   NUMERIC(10,2) NOT NULL DEFAULT 0,
  student_yearly_price    NUMERIC(10,2) NOT NULL DEFAULT 0,
  teacher_monthly_price   NUMERIC(10,2) NOT NULL DEFAULT 0,
  teacher_yearly_price    NUMERIC(10,2) NOT NULL DEFAULT 0,
  currency                TEXT NOT NULL DEFAULT 'EGP',
  -- Usage limit (applies to BOTH summaries + AI-generated quizzes)
  -- NULL = unlimited, 0 = blocked entirely, N = max N items per period
  student_max_usage       INTEGER,
  teacher_max_usage       INTEGER,
  usage_period_days       INTEGER NOT NULL DEFAULT 30,
  -- 'summaries' = count summaries.user_id
  -- 'quiz_attempts' = count scores.student_id
  -- 'combined' = summaries + AI quizzes (quizzes.user_id where summary_id IS NOT NULL)
  -- NULL = no usage metric for this section
  usage_metric            TEXT CHECK (usage_metric IN ('summaries','quiz_attempts','combined') OR usage_metric IS NULL),
  is_active               BOOLEAN NOT NULL DEFAULT true,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.locked_sections_config ENABLE ROW LEVEL SECURITY;

-- Anyone can read (needed to know which sections are locked).
-- Only admins can write (via service-role API).
CREATE POLICY "Anyone can read locked_sections_config"
  ON public.locked_sections_config FOR SELECT
  USING (true);

CREATE OR REPLACE FUNCTION public.update_locked_sections_config_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_locked_sections_config_updated_at ON public.locked_sections_config;
CREATE TRIGGER trg_locked_sections_config_updated_at
  BEFORE UPDATE ON public.locked_sections_config
  FOR EACH ROW EXECUTE FUNCTION public.update_locked_sections_config_updated_at();

-- ─── 2. section_activation_requests ───
CREATE TABLE IF NOT EXISTS public.section_activation_requests (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  user_role       TEXT NOT NULL CHECK (user_role IN ('student','teacher')),
  section_key     TEXT NOT NULL,
  plan_type       TEXT NOT NULL CHECK (plan_type IN ('monthly','yearly')),
  -- Snapshot of user data at request time (so admin sees it even if
  -- the user later changes their profile).
  user_name       TEXT,
  user_email      TEXT,
  user_phone      TEXT,
  notes           TEXT,
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','approved','rejected','expired')),
  -- Which admin is assigned to handle this request (NULL = unassigned).
  -- The superadmin can assign requests to specific admins.
  assigned_to     UUID REFERENCES public.users(id) ON DELETE SET NULL,
  processed_by    UUID REFERENCES public.users(id) ON DELETE SET NULL,
  processed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_section_requests_status
  ON public.section_activation_requests(status);
CREATE INDEX IF NOT EXISTS idx_section_requests_assigned
  ON public.section_activation_requests(assigned_to);
CREATE INDEX IF NOT EXISTS idx_section_requests_user
  ON public.section_activation_requests(user_id);

ALTER TABLE public.section_activation_requests ENABLE ROW LEVEL SECURITY;

-- Users can read their own requests; admins can read all.
CREATE POLICY "Users read own section requests"
  ON public.section_activation_requests FOR SELECT
  USING (student_id = auth.uid() OR public.is_admin());
-- Users can create their own requests.
CREATE POLICY "Users create own section requests"
  ON public.section_activation_requests FOR INSERT
  WITH CHECK (user_id = auth.uid());
-- Only admins can update (approve/reject/assign).
CREATE POLICY "Admins update section requests"
  ON public.section_activation_requests FOR UPDATE
  USING (public.is_admin());

CREATE OR REPLACE FUNCTION public.update_section_requests_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_section_requests_updated_at ON public.section_activation_requests;
CREATE TRIGGER trg_section_requests_updated_at
  BEFORE UPDATE ON public.section_activation_requests
  FOR EACH ROW EXECUTE FUNCTION public.update_section_requests_updated_at();

-- ─── 3. user_section_unlocks ───
CREATE TABLE IF NOT EXISTS public.user_section_unlocks (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  section_key         TEXT NOT NULL,
  plan_type           TEXT NOT NULL CHECK (plan_type IN ('monthly','yearly','manual_trial')),
  started_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at          TIMESTAMPTZ NOT NULL,
  activation_method   TEXT NOT NULL DEFAULT 'manual'
                      CHECK (activation_method IN ('manual','payment','global_trial','new_user_trial')),
  request_id          UUID REFERENCES public.section_activation_requests(id) ON DELETE SET NULL,
  is_active           BOOLEAN NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One active unlock per (user, section).
CREATE UNIQUE INDEX IF NOT EXISTS uniq_user_section_active
  ON public.user_section_unlocks(user_id, section_key)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_user_section_unlocks_user
  ON public.user_section_unlocks(user_id);
CREATE INDEX IF NOT EXISTS idx_user_section_unlocks_expires
  ON public.user_section_unlocks(expires_at) WHERE is_active = true;

ALTER TABLE public.user_section_unlocks ENABLE ROW LEVEL SECURITY;

-- Users can read their own unlocks; admins can read all.
CREATE POLICY "Users read own section unlocks"
  ON public.user_section_unlocks FOR SELECT
  USING (user_id = auth.uid() OR public.is_admin());

-- ─── 4. global_section_unlocks ───
CREATE TABLE IF NOT EXISTS public.global_section_unlocks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  section_key     TEXT NOT NULL,
  scope           TEXT NOT NULL CHECK (scope IN ('all','new_users')),
  duration_days   INTEGER NOT NULL,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ NOT NULL,
  created_by      UUID REFERENCES public.users(id) ON DELETE SET NULL,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_global_unlocks_active
  ON public.global_section_unlocks(section_key) WHERE is_active = true;

ALTER TABLE public.global_section_unlocks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read global_section_unlocks"
  ON public.global_section_unlocks FOR SELECT
  USING (true);

-- ─── Seed default config rows for all lockable sections ───
-- These are created as NOT locked by default. The admin enables locks
-- via the paid-services UI.
INSERT INTO public.locked_sections_config (section_key, section_label, usage_metric) VALUES
  ('summaries',     'التلخيصات',     'combined'),
  ('questionBank',  'بنك الأسئلة',   NULL),
  ('scormLibrary',  'مكتبة SCORM',   NULL),
  ('videos',        'الفيديوهات',    NULL),
  ('files',         'الملفات',       NULL),
  ('assignments',   'الواجبات',      NULL),
  ('tracking',      'تتبع الأداء',   NULL),
  ('analytics',     'التحليلات',     NULL),
  ('calendar',      'التقويم',       NULL),
  ('todos',         'المهام',        NULL)
ON CONFLICT (section_key) DO NOTHING;

COMMENT ON TABLE public.locked_sections_config IS
  'v134: Per-section lock config with role-based pricing + usage limits.';
COMMENT ON TABLE public.section_activation_requests IS
  'v134: User-submitted activation requests for locked sections.';
COMMENT ON TABLE public.user_section_unlocks IS
  'v134: Active section unlocks per user (manual/payment/trial).';
COMMENT ON TABLE public.global_section_unlocks IS
  'v134: Time-limited global opens (all users / new users only).';

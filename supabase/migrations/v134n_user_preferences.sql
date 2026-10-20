-- =============================================================
-- v134n_user_preferences.sql
-- AttenDo LMS — User theme preferences (Mantine migration)
--
-- Stores per-user theme identity (8 colors) + mode (light/dark/system).
-- Synced across devices when the user logs in.
--
-- Design decisions:
--   - Separate table (not columns on `users`) for future extensibility
--     (locale, notification prefs, density, etc.).
--   - One row per user (UNIQUE on user_id).
--   - Defaults: theme_identity='sky', theme_mode='system'.
--   - RLS: users can read/write only their own row.
-- =============================================================

CREATE TABLE IF NOT EXISTS public.user_preferences (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL UNIQUE REFERENCES public.users(id) ON DELETE CASCADE,
  theme_identity  TEXT NOT NULL DEFAULT 'sky'
                  CHECK (theme_identity IN ('sky','emerald','violet','amber','teal','indigo','slate','rose')),
  theme_mode      TEXT NOT NULL DEFAULT 'system'
                  CHECK (theme_mode IN ('light','dark','system')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_preferences_user
  ON public.user_preferences(user_id);

-- ─── RLS ───
ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own preferences" ON public.user_preferences;
CREATE POLICY "Users read own preferences"
  ON public.user_preferences FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users upsert own preferences" ON public.user_preferences;
CREATE POLICY "Users upsert own preferences"
  ON public.user_preferences FOR INSERT
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users update own preferences" ON public.user_preferences;
CREATE POLICY "Users update own preferences"
  ON public.user_preferences FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Admins read all preferences" ON public.user_preferences;
CREATE POLICY "Admins read all preferences"
  ON public.user_preferences FOR SELECT
  USING (public.is_admin());

-- ─── Permissions ───
GRANT SELECT, INSERT, UPDATE ON public.user_preferences TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;

-- ─── Realtime ───
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.user_preferences;
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

-- ─── updated_at trigger ───
CREATE OR REPLACE FUNCTION public.update_user_preferences_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_user_preferences_updated_at ON public.user_preferences;
CREATE TRIGGER trg_user_preferences_updated_at
  BEFORE UPDATE ON public.user_preferences
  FOR EACH ROW EXECUTE FUNCTION public.update_user_preferences_updated_at();

-- ─── Verify ───
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'user_preferences'
ORDER BY ordinal_position;

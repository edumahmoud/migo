-- =============================================================
-- v133_admin_security.sql
-- AttenDo LMS — Admin destructive-action security
--
-- Background:
--   The superadmin needs a "data management" section in the admin
--   portal that can wipe platform data (users, financials, academic
--   content, etc.). This is an extremely dangerous capability, so it
--   requires a SEPARATE password distinct from the account login
--   password. This migration creates the table that stores the
--   bcrypt hash of that destructive-action password.
--
-- Design:
--   * Single-row table (enforced by unique index on a constant).
--   * Stores `destruct_password_hash` (bcrypt) + `set_by` (user id)
--     + `set_at` + `updated_at`.
--   * RLS enabled — only service role can read/write (the hash must
--     NEVER be exposed to the client). The API route uses supabaseServer
--     (service role) to read + verify.
--   * No SELECT policy for anon/authenticated — the hash is invisible
--     to all client-side requests.
-- =============================================================

CREATE TABLE IF NOT EXISTS public.admin_security (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Enforce single row: a unique index on a constant value.
  singleton       BOOLEAN NOT NULL DEFAULT true,
  destruct_password_hash TEXT NOT NULL,
  set_by          UUID REFERENCES public.users(id) ON DELETE SET NULL,
  set_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enforce only one row can ever exist.
CREATE UNIQUE INDEX IF NOT EXISTS admin_security_singleton_idx
  ON public.admin_security (singleton)
  WHERE singleton = true;

ALTER TABLE public.admin_security ENABLE ROW LEVEL SECURITY;

-- No SELECT/INSERT/UPDATE/DELETE policies for anon or authenticated
-- roles → only the service role (supabaseServer) can access this table.
-- The API routes use supabaseServer which bypasses RLS.

-- Auto-update updated_at trigger.
CREATE OR REPLACE FUNCTION public.update_admin_security_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_admin_security_updated_at ON public.admin_security;
CREATE TRIGGER trg_admin_security_updated_at
  BEFORE UPDATE ON public.admin_security
  FOR EACH ROW EXECUTE FUNCTION public.update_admin_security_updated_at();

COMMENT ON TABLE public.admin_security IS
  'v133: Stores the bcrypt hash of the superadmin destructive-action password. Single row. RLS-enabled (service-role only).';

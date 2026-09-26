-- =============================================================
-- v80_financial_summary_rpc.sql
-- AttenDo LMS — Phase 12: Financial Admin Dashboard
--
-- Creates a SQL RPC function `get_financial_summary` that performs
-- server-side aggregation over the financial_ledger table.
--
-- Critical design rules:
--   1. The summary MUST be computed by the DB, NOT by the API
--      route via `rows.reduce()`. This guarantees the summary is
--      independent of pagination (the dashboard's summary reflects
--      ALL matching rows, even if only 25 are returned per page).
--   2. `net_platform_revenue = SUM(platform_share) - SUM(gateway_fee)`.
--      This is the platform's NET revenue (NOT gross - gateway_fee).
--   3. `SECURITY DEFINER` allows the function to be invoked by
--      authenticated users without granting them direct SELECT on
--      financial_ledger. However:
--        - `SET search_path = public` prevents search_path injection.
--        - The function is invoked from the API route only AFTER
--          `requireAdmin()` succeeds. The function itself does
--          NOT enforce admin authorization — the API layer does.
--   4. Parameters accept NULL = no filter on that dimension.
--   5. `p_to_date` semantics: caller passes the start-of-NEXT-day
--      (e.g., for `to_date=2026-09-26`, caller passes
--      `2026-09-27T00:00:00Z`). The function uses `created_at < p_to_date`
--      to include the entire calendar day.
-- =============================================================

CREATE OR REPLACE FUNCTION public.get_financial_summary(
  p_from_date  TIMESTAMPTZ DEFAULT NULL,
  p_to_date    TIMESTAMPTZ DEFAULT NULL,
  p_teacher_id UUID        DEFAULT NULL,
  p_subject_id UUID        DEFAULT NULL,
  p_gateway_id UUID        DEFAULT NULL,
  p_status     TEXT        DEFAULT NULL
) RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'total_gross',           COALESCE(SUM(gross_amount), 0),
    'total_platform_share',  COALESCE(SUM(platform_share), 0),
    'total_teacher_share',   COALESCE(SUM(teacher_share), 0),
    'total_gateway_fees',    COALESCE(SUM(gateway_fee), 0),
    -- Net Platform Revenue = platform_share - gateway_fee (NOT gross - gateway_fee).
    -- Computed as SUM(platform_share) - SUM(gateway_fee) so we don't
    -- recompute per-row; this matches the spec exactly.
    'net_platform_revenue',  COALESCE(SUM(platform_share), 0) - COALESCE(SUM(gateway_fee), 0),
    'transaction_count',     COUNT(*),
    'paid_count',            COUNT(*) FILTER (WHERE status = 'paid'),
    'settled_count',         COUNT(*) FILTER (WHERE status = 'settled'),
    'refunded_count',        COUNT(*) FILTER (WHERE status = 'refunded'),
    'reversed_count',        COUNT(*) FILTER (WHERE status = 'reversed'),
    'pending_count',         COUNT(*) FILTER (WHERE status = 'pending'),
    'failed_count',          COUNT(*) FILTER (WHERE status = 'failed')
  )
  FROM public.financial_ledger
  WHERE (p_from_date IS NULL OR created_at >= p_from_date)
    AND (p_to_date   IS NULL OR created_at <  p_to_date)
    AND (p_teacher_id IS NULL OR teacher_id = p_teacher_id)
    AND (p_subject_id IS NULL OR subject_id = p_subject_id)
    AND (p_gateway_id IS NULL OR gateway_id = p_gateway_id)
    AND (p_status     IS NULL OR status     = p_status);
$$;

-- ─── RPC Authorization ─────────────────────────────────────
-- Phase 12 Final Audit (security hardening):
--
--   The RPC returns AGGREGATE platform-wide financial totals
--   (gross, platform_share, teacher_share, gateway_fees, status
--   breakdown). It MUST NOT be callable directly by `anon` or
--   `authenticated` users — that would allow students/teachers
--   to bypass `requireAdmin()` and read platform-wide financials.
--
--   The ONLY intended caller is the Admin API route
--   `/api/admin/financial-ledger`, which uses the service-role
--   client (bypasses RLS) AFTER `requireAdmin()` succeeds.
--
--   Therefore:
--     1. REVOKE EXECUTE from anon + authenticated (defensive —
--        in case v80 was previously deployed with the broader
--        grants; REVOKE is idempotent).
--     2. GRANT EXECUTE to service_role ONLY.
--
--   The function itself (SECURITY DEFINER + SET search_path = public)
--   remains UNCHANGED. Only the GRANT/REVOKE scope changes.
-- ─────────────────────────────────────────────────────────

-- Defensive: revoke any previously-granted EXECUTE to anon/authenticated.
-- (No-op if those grants were never applied.)
REVOKE EXECUTE ON FUNCTION public.get_financial_summary(
  TIMESTAMPTZ, TIMESTAMPTZ, UUID, UUID, UUID, TEXT
) FROM anon, authenticated;

-- Explicit: only the service-role client (used by the Admin API
-- after requireAdmin() succeeds) can call this RPC.
GRANT EXECUTE ON FUNCTION public.get_financial_summary(
  TIMESTAMPTZ, TIMESTAMPTZ, UUID, UUID, UUID, TEXT
) TO service_role;

-- Done. Verify with:
--   \df public.get_financial_summary
--   SELECT routine_name, routine_type FROM information_schema.routine_privileges
--   WHERE routine_name = 'get_financial_summary';
--   -- Should show ONLY service_role with EXECUTE.

-- =====================================================
-- v94: Security hardening — P0+P1 fixes from audit
-- =====================================================
-- Fixes 4 critical/high security issues identified in the
-- comprehensive code audit:
--
-- P0-1: REVOKE EXECUTE on activate_subscription_after_payment
--        from anon + authenticated (only service_role keeps it)
-- P1-12: FORCE ROW LEVEL SECURITY on all sensitive tables
--        (defense-in-depth — table owner can't bypass RLS)
-- =====================================================

-- ───────────────────────────────────────────────────────
-- P0-1: Revoke EXECUTE on the activation RPC from anon + authenticated
-- ───────────────────────────────────────────────────────
-- The function is SECURITY DEFINER + was granted to anon + authenticated.
-- This means any student with the anon key could call it directly from
-- their browser and activate their own subscription WITHOUT paying.
-- Only the service_role (used by the Next.js API) should retain EXECUTE.
REVOKE EXECUTE ON FUNCTION public.activate_subscription_after_payment(UUID, TEXT, NUMERIC, TEXT, TEXT, JSONB, UUID) FROM anon, authenticated;

-- Also revoke on the uncancel function (v84) — same risk
REVOKE EXECUTE ON FUNCTION public.uncancel_order_if_payment_received(UUID, TEXT) FROM anon, authenticated;

-- Also revoke on the financial summary RPC (v80) — it reads ALL financial
-- data and should be admin-only via the API (service_role)
REVOKE EXECUTE ON FUNCTION public.get_financial_summary(TEXT, TEXT, TEXT, UUID, UUID, TEXT) FROM anon, authenticated;

COMMENT ON FUNCTION public.activate_subscription_after_payment(UUID, TEXT, NUMERIC, TEXT, TEXT, JSONB, UUID) IS
  'v94: EXECUTE revoked from anon + authenticated. Only service_role (Next.js API) can call this. Prevents payment bypass via direct RPC call.';

-- ───────────────────────────────────────────────────────
-- P1-12: FORCE ROW LEVEL SECURITY on all sensitive tables
-- ───────────────────────────────────────────────────────
-- Even though ENABLE RLS is set, the table owner (postgres) can still
-- bypass RLS by default. FORCE RLS ensures even the owner is subject
-- to the policies. The service_role always bypasses RLS regardless
-- (that's intentional — the API uses it).

ALTER TABLE public.users FORCE ROW LEVEL SECURITY;
ALTER TABLE public.orders FORCE ROW LEVEL SECURITY;
ALTER TABLE public.payments FORCE ROW LEVEL SECURITY;
ALTER TABLE public.financial_ledger FORCE ROW LEVEL SECURITY;
ALTER TABLE public.subject_students FORCE ROW LEVEL SECURITY;
ALTER TABLE public.teacher_payouts FORCE ROW LEVEL SECURITY;
ALTER TABLE public.teacher_payout_ledger_entries FORCE ROW LEVEL SECURITY;
ALTER TABLE public.teacher_payout_methods FORCE ROW LEVEL SECURITY;
ALTER TABLE public.teacher_payout_audit_log FORCE ROW LEVEL SECURITY;
ALTER TABLE public.payment_gateways FORCE ROW LEVEL SECURITY;
ALTER TABLE public.scorm_tracking FORCE ROW LEVEL SECURITY;
ALTER TABLE public.banned_users FORCE ROW LEVEL SECURITY;
ALTER TABLE public.push_subscriptions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.notifications FORCE ROW LEVEL SECURITY;
ALTER TABLE public.fee_catalog FORCE ROW LEVEL SECURITY;
ALTER TABLE public.order_fees FORCE ROW LEVEL SECURITY;

-- Done.
-- Verify:
--   SELECT proname, proacl FROM pg_proc WHERE proname = 'activate_subscription_after_payment';
--   -- proacl should show service_role=Z / Z meaning service_role has EXECUTE
--   -- but NOT anon or authenticated

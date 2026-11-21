-- =====================================================
-- Audit #10: verify + lock down EXECUTE grants on payment RPCs
-- =====================================================
-- Background: Postgres grants EXECUTE on new functions to PUBLIC by
-- default. Migration v94 already revoked EXECUTE from anon + authenticated
-- on activate_subscription_after_payment, uncancel_order_if_payment_received
-- and get_financial_summary — but NOT from PUBLIC, and a PUBLIC grant
-- still lets every role execute. This script closes that hole.
--
-- activate_subscription_after_payment IS versioned (latest body: migration
-- v112). increment_platform_announcement_views exists only in the live DB.
--
-- SAFE for the payment flow: the webhook and the verify-after-redirect
-- routes call these RPCs through the service role (supabaseServer).
-- Supabase's default privileges grant service_role EXECUTE explicitly, so
-- revoking from PUBLIC/anon/authenticated does NOT affect it.
-- =====================================================

-- ── CHECK: who can execute each function? ──
-- In the output, look at the `grants` (proacl) column:
--   =X/...             → PUBLIC can execute  (BAD for these)
--   anon=X/...         → anon role can execute (BAD)
--   authenticated=X/.. → authenticated can execute (BAD unless intended)
--   NULL               → default grants; defaults give PUBLIC EXECUTE (BAD)
select
  p.proname        as function_name,
  pg_get_function_arguments(p.oid) as arguments,
  p.proacl         as grants,
  p.prosecdef      as is_security_definer
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'activate_subscription_after_payment',
    'uncancel_order_if_payment_received',
    'get_financial_summary',
    'increment_platform_announcement_views',
    'check_rate_limit'
  )
order by p.proname;

-- ── LOCKDOWN (run only after reviewing the CHECK output) ──
-- The live DB carried TWO overloads of activate_subscription_after_payment
-- (an old one and the v112 one), so per-signature REVOKEs can miss one.
-- This DO block revokes public/anon/authenticated from EVERY overload of
-- each listed function, whatever its argument list. Verified against the
-- live DB on 2026-11-21: after running it, the re-run CHECK showed only
-- postgres and service_role grants on all five functions.
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'activate_subscription_after_payment',
        'uncancel_order_if_payment_received',
        'get_financial_summary',
        'increment_platform_announcement_views',
        'check_rate_limit'
      )
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.sig);
  end loop;
end $$;

-- ── Re-run the CHECK afterwards: none of the five should show PUBLIC,
-- anon or authenticated execute privileges.

-- ── TODO (process): export the live body of
-- increment_platform_announcement_views into a versioned migration:
--   select pg_get_functiondef('public.increment_platform_announcement_views(uuid)'::regprocedure);
-- paste the output into supabase/migrations/ as a create or replace file.

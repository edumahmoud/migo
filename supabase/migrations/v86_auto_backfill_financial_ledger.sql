-- =====================================================
-- v86: Auto-Backfill — financial_ledger orphans (P0 follow-up)
-- =====================================================
-- PROBLEM: After applying v85 (RPC fix), users still had to
-- manually hit `POST /api/admin/backfill-financial-ledger` to
-- recover historical orphaned paid orders (orders marked 'paid'
-- with NO financial_ledger row, due to the v78 RPC's RETURN-before-
-- ledger bug). The user reasonably asked: "Do I have to do this
-- every time?"
--
-- ANSWER: NO. v85 fixes the future (new orphans won't be created).
-- This v86 migration retroactively fixes the past — it inserts
-- the missing financial_ledger rows (and any missing payment rows)
-- for ALL existing paid orders. After applying v86, the manual
-- backfill endpoint is OPTIONAL (only needed for debugging /
-- re-running on suspicious data).
--
-- This migration is IDEMPOTENT — safe to run multiple times.
-- Both INSERTs use ON CONFLICT DO NOTHING.
--
-- The migration runs in 2 passes:
--   Pass 1: Create missing `payments` rows for paid orders that
--           have no payment record. (provider_payment_id =
--           'backfill_<order_id>' so it's traceable.)
--   Pass 2: Create missing `financial_ledger` rows for paid
--           orders with a payment record but no ledger row.
--           Uses snapshotted values: teacher_id (from subjects),
--           commission_rate (active rate at migration time),
--           gross_amount/platform_share/teacher_share computed
--           server-side.
-- =====================================================

-- ───────────────────────────────────────────────────────
-- Pass 1: Create missing `payments` rows for paid orders
-- ───────────────────────────────────────────────────────
-- For every order with status='paid' that has NO payment row,
-- insert a placeholder payment with provider_payment_id =
-- 'backfill_<order_id>' so the next pass can link a ledger row
-- to it via the payment_id FK.
INSERT INTO public.payments (
  order_id, provider_payment_id, amount, currency, status,
  raw_payload, confirmed_by
)
SELECT
  o.id,
  'backfill_' || o.id::text,
  o.amount,
  o.currency,
  'paid',
  jsonb_build_object(
    'backfill', true,
    'reason', 'Auto-backfill from v86 migration — paid order with no payment record',
    'order_paid_at', o.paid_at,
    'order_created_at', o.created_at
  ),
  NULL
FROM public.orders o
WHERE o.status = 'paid'
  AND NOT EXISTS (
    SELECT 1 FROM public.payments p WHERE p.order_id = o.id
  )
ON CONFLICT DO NOTHING;

-- ───────────────────────────────────────────────────────
-- Pass 2: Create missing `financial_ledger` rows
-- ───────────────────────────────────────────────────────
-- For every paid order WITH a payment record but WITHOUT a
-- ledger row, insert the missing ledger row using snapshotted
-- values. The teacher_id is the subject's teacher at migration
-- time (best available snapshot). The commission_rate is the
-- currently-active rate.
INSERT INTO public.financial_ledger (
  payment_id, order_id, student_id, subject_id, teacher_id,
  gateway_id, provider_payment_id, currency,
  gross_amount, platform_share, teacher_share, gateway_fee, net_amount,
  commission_rate, status
)
SELECT
  p.id,
  o.id,
  o.student_id,
  o.subject_id,
  COALESCE(s.teacher_id, '00000000-0000-0000-0000-000000000000'::uuid),
  o.gateway_id,
  p.provider_payment_id,
  o.currency,
  o.amount,
  ROUND(
    o.amount * COALESCE(
      (SELECT rate_percentage FROM public.commission_rates
       WHERE is_active = true ORDER BY effective_from DESC LIMIT 1),
      0
    ) / 100.0,
    2
  ),
  o.amount - ROUND(
    o.amount * COALESCE(
      (SELECT rate_percentage FROM public.commission_rates
       WHERE is_active = true ORDER BY effective_from DESC LIMIT 1),
      0
    ) / 100.0,
    2
  ),
  0,
  o.amount - ROUND(
    o.amount * COALESCE(
      (SELECT rate_percentage FROM public.commission_rates
       WHERE is_active = true ORDER BY effective_from DESC LIMIT 1),
      0
    ) / 100.0,
    2
  ),
  COALESCE(
    (SELECT rate_percentage FROM public.commission_rates
     WHERE is_active = true ORDER BY effective_from DESC LIMIT 1),
    0
  ),
  'paid'
FROM public.orders o
JOIN public.payments p ON p.order_id = o.id
LEFT JOIN public.subjects s ON s.id = o.subject_id
WHERE o.status = 'paid'
  AND NOT EXISTS (
    SELECT 1 FROM public.financial_ledger fl WHERE fl.payment_id = p.id
  )
ON CONFLICT (payment_id) DO NOTHING;

-- ───────────────────────────────────────────────────────
-- Diagnostics: how many rows were backfilled?
-- ───────────────────────────────────────────────────────
-- (Run manually after the migration to verify.)
-- SELECT COUNT(*) FROM public.payments WHERE provider_payment_id LIKE 'backfill_%';
-- SELECT COUNT(*) FROM public.financial_ledger;

-- v86: auto-backfill orphaned paid orders. Idempotent. After running,
-- the manual /api/admin/backfill-financial-ledger endpoint is optional.

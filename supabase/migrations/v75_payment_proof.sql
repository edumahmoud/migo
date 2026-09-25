-- =============================================================
-- v75_payment_proof.sql
-- AttenDo LMS — Add proof-of-payment fields to orders table.
--
-- When a student pays via manual methods (Fawry, Vodafone Cash,
-- InstaPay, bank transfer, etc.), they need to submit proof so the
-- supervisor can verify before activating the subscription.
--
-- New fields on orders (all nullable):
--   * sender_name        — the name on the sender's account
--   * transaction_ref    — transaction ID / reference number
--   * proof_notes        — free-text notes from the student
--   * proof_submitted_at — when the proof was submitted
--   * proof_url          — URL to uploaded proof image (Supabase Storage)
--
-- The supervisor's pending-orders view shows these fields so they
-- can match the payment to the order before approving.
-- =============================================================

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS sender_name TEXT;
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS transaction_ref TEXT;
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS proof_notes TEXT;
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS proof_submitted_at TIMESTAMPTZ;
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS proof_url TEXT;

-- Index for fast lookup of orders with proof submitted (supervisor view)
CREATE INDEX IF NOT EXISTS idx_orders_proof_submitted
  ON public.orders(proof_submitted_at)
  WHERE proof_submitted_at IS NOT NULL;

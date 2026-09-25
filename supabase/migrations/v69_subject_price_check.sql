-- =============================================================
-- v69_subject_price_check.sql
-- AttenDo LMS — Add CHECK constraint on subjects.price (>= 0)
--
-- v68 added the price column with DEFAULT 0 but no lower-bound
-- CHECK. This migration adds the constraint so negative prices
-- are rejected at the DB level (defense-in-depth on top of the
-- application-level validation in the course create/edit UI).
--
-- Idempotent.
-- =============================================================

ALTER TABLE public.subjects
  DROP CONSTRAINT IF EXISTS subjects_price_nonnegative;

ALTER TABLE public.subjects
  ADD CONSTRAINT subjects_price_nonnegative
  CHECK (price >= 0);

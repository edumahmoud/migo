-- =============================================================
-- v80_financial_admin_indexes.sql
-- AttenDo LMS — Phase 12: Financial Admin Dashboard
--
-- Adds the missing created_at index on financial_ledger that the
-- new admin dashboard's date-range filters depend on.
--
-- Phase 12 scope: READ-ONLY optimizations only.
--   - No data changes.
--   - No schema changes (no new columns, no constraints).
--   - No financial calculation changes.
--
-- Index choice rationale:
--   1. idx_financial_ledger_created  — REQUIRED. The admin
--      dashboard filters by from_date/to_date on every request,
--      and the existing schema has no index on created_at.
--      Without this, date-range queries do a full table scan.
--
--   2. Composite indexes (teacher_id, created_at) etc. are NOT
--      added in this migration because the existing single-column
--      indexes (teacher_id, subject_id, gateway_id, status) are
--      sufficient for the dashboard's filter cardinality
--      (few distinct teacher/subject/gateway values per request).
--      They can be added later if EXPLAIN ANALYZE on a large
--      production ledger proves they are needed.
-- =============================================================

-- Single-column descending index on created_at.
-- DESC so the most common admin query (ORDER BY created_at DESC LIMIT 25)
-- can use an index-only scan.
CREATE INDEX IF NOT EXISTS idx_financial_ledger_created
  ON public.financial_ledger(created_at DESC);

-- Done. Verify with:
--   SELECT indexname, indexdef FROM pg_indexes
--   WHERE tablename = 'financial_ledger' ORDER BY indexname;

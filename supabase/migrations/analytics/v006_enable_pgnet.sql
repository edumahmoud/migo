-- =====================================================
-- Migration 006: Enable pg_net Extension
-- Required for DB triggers to make HTTP POST requests
-- to /api/analytics/refresh for cache invalidation.
--
-- IMPORTANT: If this extension is not available on your
-- Supabase plan, triggers in Migration 007 will fail.
-- TTL fallback still works -- cache expires automatically.
-- Skip this migration if pg_net is not available.
-- =====================================================

-- Enable pg_net extension (Supabase provides this)
CREATE EXTENSION IF NOT EXISTS pg_net SCHEMA extensions;

-- Grant access to pg_net for the postgres role
GRANT USAGE ON SCHEMA extensions TO postgres;

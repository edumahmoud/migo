-- =====================================================
-- Migration: Fix lecture_notes file references
-- The old [FILE:url:name] format breaks because URLs contain ':'
-- Migrate to [FILE|||url|||name] format
-- =====================================================

-- Update all lecture_notes that use the old [FILE:...] format
-- This regex replacement changes the first ':' after [FILE to '|||'
-- and the last ':' before ] to '|||'
UPDATE public.lecture_notes
SET content = regexp_replace(
  regexp_replace(
    content,
    '^\[FILE:', '[FILE|||'
  ),
  ':(.+?)\]$', '|||\1]'
)
WHERE content LIKE '[FILE:%]'
  AND content NOT LIKE '[FILE|||%]';

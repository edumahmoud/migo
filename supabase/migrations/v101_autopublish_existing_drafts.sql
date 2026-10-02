-- =====================================================
-- v101: Auto-publish existing draft units + lessons so students see them
-- =====================================================
-- ROOT CAUSE of "units + lessons don't show for students":
--   - POST /api/lesson-units creates with is_published=false (draft)
--   - POST /api/lessons creates with status='draft'
--   - GET /api/lesson-units filters students to is_published=true
--   - GET /api/lessons filters students to status='published'
--   → teachers create units/lessons but students see nothing!
--
-- Fix #1 (code, committed separately): defaults changed to auto-publish
-- Fix #2 (this migration): backfill existing draft units + lessons to
-- published state so students see content immediately.
-- =====================================================

-- Backfill: publish all draft units
UPDATE public.lesson_units
SET is_published = true, updated_at = now()
WHERE is_published = false;

-- Backfill: publish all draft lessons + set published_at
UPDATE public.lessons
SET status = 'published',
    published_at = COALESCE(published_at, now()),
    published_json = COALESCE(published_json, content_json),
    updated_at = now()
WHERE status = 'draft';

-- Done. Verify with:
--   SELECT COUNT(*) FROM lesson_units WHERE is_published = false;  -- should be 0
--   SELECT COUNT(*) FROM lessons WHERE status = 'draft';           -- should be 0

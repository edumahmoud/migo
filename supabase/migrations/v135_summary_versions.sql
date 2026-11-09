-- ============================================================
-- v135_summary_versions.sql
-- AttenDo LMS — Summary versions (أرشفة نسخ الملخصات)
--
-- يحفظ نسخة من المحتوى قبل كل إعادة تلخيص أو تنقيح،
-- مما يتيح للمستخدم العودة للنسخة الأصلية أو السابقة.
--
-- النموذج:
--   - summaries.summary_content = المحتوى الحالي المعروض.
--   - summary_versions = نسخ مؤرشفة قبل كل تعديل.
--   - version_label: 'original' (النسخة الأولى) | 'previous' (نسخة سابقة).
--   - source_op: 'initial' | 'regenerate' | 'refine' | 'restore'.
--
-- متوافق مع الجداول الموجودة، لا يحذف أو يعدّل شيئاً موجوداً.
-- ============================================================

-- 1. جدول نسخ الملخصات
CREATE TABLE IF NOT EXISTS public.summary_versions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  summary_id      UUID NOT NULL REFERENCES public.summaries(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL,
  content         TEXT NOT NULL,            -- محتوى الملخص وقت الأرشفة
  version_label   TEXT NOT NULL,            -- 'original' | 'previous'
  source_op       TEXT NOT NULL,            -- 'initial' | 'regenerate' | 'refine' | 'restore'
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. فهرسة سريعة للاستعلام عن نسخ ملخص معين
CREATE INDEX IF NOT EXISTS idx_summary_versions_summary_id
  ON public.summary_versions(summary_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_summary_versions_user
  ON public.summary_versions(user_id, created_at DESC);

-- 3. قيد على قيم version_label
DO $$
BEGIN
  ALTER TABLE public.summary_versions
    DROP CONSTRAINT IF EXISTS chk_summary_versions_label;
  ALTER TABLE public.summary_versions
    ADD CONSTRAINT chk_summary_versions_label CHECK (
      version_label IN ('original', 'previous')
    );
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

-- 4. قيد على قيم source_op
DO $$
BEGIN
  ALTER TABLE public.summary_versions
    DROP CONSTRAINT IF EXISTS chk_summary_versions_source;
  ALTER TABLE public.summary_versions
    ADD CONSTRAINT chk_summary_versions_source CHECK (
      source_op IN ('initial', 'regenerate', 'refine', 'restore')
    );
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

-- 5. RLS: المستخدم يرى نسخ ملخصاته فقط
ALTER TABLE public.summary_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "summary_versions_select_own" ON public.summary_versions;
CREATE POLICY "summary_versions_select_own"
  ON public.summary_versions FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "summary_versions_insert_own" ON public.summary_versions;
CREATE POLICY "summary_versions_insert_own"
  ON public.summary_versions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "summary_versions_delete_own" ON public.summary_versions;
CREATE POLICY "summary_versions_delete_own"
  ON public.summary_versions FOR DELETE
  USING (auth.uid() = user_id);

-- 6. تعليق توثيقي
COMMENT ON TABLE public.summary_versions IS
  'يحفظ نسخاً من محتوى الملخص قبل كل إعادة تلخيص أو تنقيح لإتاحة العودة للنسخ السابقة';
COMMENT ON COLUMN public.summary_versions.version_label IS
  'original = النسخة الأصلية الأولى، previous = نسخة سابقة قبل آخر تعديل';
COMMENT ON COLUMN public.summary_versions.source_op IS
  'العملية التي أنشأت النسخة: initial (أول حفظ)، regenerate (إعادة تلخيص)، refine (تنقيح)، restore (استعادة)';

-- 7. تحقق
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'summary_versions'
ORDER BY ordinal_position;

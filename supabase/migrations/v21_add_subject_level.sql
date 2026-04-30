-- =====================================================
-- v21: Add level (الفرقة/المستوى) to subjects
-- =====================================================

-- Add level column to subjects table
-- Level represents the academic year/group (e.g. "الفرقة الأولى", "الفرقة الثانية")
-- Sub-level represents the term/semester (e.g. "مستوى أول", "مستوى ثاني")
ALTER TABLE subjects ADD COLUMN IF NOT EXISTS level TEXT;
ALTER TABLE subjects ADD COLUMN IF NOT EXISTS sub_level TEXT;

-- Add comment for documentation
COMMENT ON COLUMN subjects.level IS 'الفرقة الأكاديمية (مثال: الفرقة الأولى، الفرقة الثانية)';
COMMENT ON COLUMN subjects.sub_level IS 'المستوى داخل الفرقة (مثال: مستوى أول، مستوى ثاني)';

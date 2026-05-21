-- =====================================================
-- v41: Add unique report_number to reports table
-- =====================================================

-- Add report_number column (nullable first for backfill)
ALTER TABLE reports
  ADD COLUMN IF NOT EXISTS report_number TEXT;

-- Backfill existing reports with sequential numbers
-- Uses a CTE with ROW_NUMBER to assign numbers based on created_at order
DO $$
DECLARE
  rec RECORD;
  counter INT := 1;
  prefix TEXT := 'RPT-';
  padded_num TEXT;
BEGIN
  -- Only backfill if there are reports without a number
  IF EXISTS (SELECT 1 FROM reports WHERE report_number IS NULL) THEN
    FOR rec IN
      SELECT id FROM reports WHERE report_number IS NULL ORDER BY created_at ASC
    LOOP
      padded_num := LPAD(counter::TEXT, 6, '0');
      UPDATE reports SET report_number = prefix || padded_num WHERE id = rec.id;
      counter := counter + 1;
    END LOOP;
  END IF;
END $$;

-- Now make report_number NOT NULL and UNIQUE
ALTER TABLE reports
  ALTER COLUMN report_number SET NOT NULL;

-- Create unique index on report_number
CREATE UNIQUE INDEX IF NOT EXISTS idx_reports_report_number ON reports(report_number);

-- Create a function to auto-generate the next report number
CREATE OR REPLACE FUNCTION generate_report_number()
RETURNS TEXT AS $$
DECLARE
  next_num INT;
  result TEXT;
BEGIN
  -- Get the max numeric portion of existing report numbers
  SELECT COALESCE(MAX(CAST(SUBSTRING(report_number FROM 5) AS INT)), 0) + 1
  INTO next_num
  FROM reports;

  result := 'RPT-' || LPAD(next_num::TEXT, 6, '0');
  RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create a trigger to auto-assign report_number on insert
CREATE OR REPLACE FUNCTION set_report_number()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.report_number IS NULL THEN
    NEW.report_number := generate_report_number();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop trigger if exists, then create
DROP TRIGGER IF EXISTS trg_set_report_number ON reports;
CREATE TRIGGER trg_set_report_number
  BEFORE INSERT ON reports
  FOR EACH ROW
  EXECUTE FUNCTION set_report_number();

-- Add index for faster search by report_number prefix
CREATE INDEX IF NOT EXISTS idx_reports_report_number_prefix ON reports(report_number text_pattern_ops);

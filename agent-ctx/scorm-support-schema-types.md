# SCORM Support — Schema & Types

## Task ID: SCORM-SUPPORT
## Agent: SCORM Schema & Types Developer

## Summary

Created the complete database schema and TypeScript types for SCORM support in the Attendo/Migo LMS platform, including:

### Files Created/Modified

1. **`/home/z/my-project/supabase/migrations/v60_scorm_support.sql`** — New migration with 3 tables:
   - `scorm_packages` — Stores uploaded SCORM package metadata
   - `scorm_resources` — Stores individual SCORM resources/SCO items parsed from manifest
   - `scorm_tracking` — Stores student progress data with UNIQUE(student_id, resource_id)
   - RLS policies using `get_teacher_subject_ids()`, `get_student_subject_ids()`, `is_admin()` helper functions
   - Triggers for auto-update `updated_at`
   - Realtime publication entries

2. **`/home/z/my-project/src/lib/scorm-types.ts`** — TypeScript types matching the database schema:
   - `ScormPackage`, `ScormResource`, `ScormTracking` core interfaces
   - Type enums: `ScormVersion`, `ScormPackageStatus`, `ScormResourceType`, `ScormCompletionStatus`, `ScormSuccessStatus`
   - API-ready types: `ScormLaunchData`, `ScormCmiData`, `ScormTrackingUpsertRequest`, `ScormPackageUploadRequest`, `ScormTrackingSummary`, `ScormStudentProgress`

3. **`/home/z/my-project/supabase/schema.sql`** — Updated with appended SCORM tables at the end (lines 345-567)

### Key Design Decisions

- Used `gen_random_uuid()` for UUID defaults (not `uuid_generate_v4()`) per instructions and newer migration patterns
- Used `now()` for timestamp defaults
- CHECK constraints for all enumerated types (version, status, type, completion_status, success_status)
- UNIQUE constraint on (student_id, resource_id) in scorm_tracking to prevent duplicates
- RLS policies follow the existing project pattern with teacher/student subject-based access
- DECIMAL(5,2) for score fields to support SCORM 0-100 scoring with precision
- Realtime enabled for all 3 tables with REPLICA IDENTITY FULL

### Verification

- `bun run lint` passes clean with no issues

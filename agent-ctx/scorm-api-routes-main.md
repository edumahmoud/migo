# SCORM API Routes — Work Record

## Task ID: SCORM-API-ROUTES
## Agent: SCORM API Routes Developer

## Summary

Created 4 SCORM API routes for the Attendo/Migo LMS platform, covering the full SCORM content lifecycle: upload → list → launch → track.

## Files Created

1. **`/home/z/my-project/src/app/api/scorm/upload/route.ts`** — SCORM Package Upload API (POST)
   - Accepts multipart FormData with `file` (.zip) and `subjectId`
   - Teacher/admin auth via `requireTeacher`
   - Validates .zip format and <50MB size
   - JSZip extraction with nested manifest detection
   - Regex/string-based imsmanifest.xml parsing (no XML parser dependency)
   - SCORM version detection (1.2 vs 2004) from namespace patterns
   - Organization items and resource parsing
   - Supabase Storage upload to `scorm-packages` bucket
   - DB inserts to `scorm_packages` and `scorm_resources` tables
   - Cleanup on failure

2. **`/home/z/my-project/src/app/api/scorm/track/route.ts`** — SCORM Tracking API (POST + GET)
   - POST: Upserts tracking data, verifies studentId === authUser.id
   - GET: Teachers/admins see any student; students see only their own
   - Enriches results with student names and resource titles

3. **`/home/z/my-project/src/app/api/scorm/launch/route.ts`** — SCORM Launch API (GET)
   - Verifies enrollment for students
   - Creates/updates initial tracking record (launch_count, last_accessed)
   - Builds CMI data model for SCORM 1.2 or 2004

4. **`/home/z/my-project/src/app/api/scorm/list/route.ts`** — SCORM List API (GET)
   - Lists packages for a subject with nested resource tree
   - Enriches with uploader names

## Verification

- jszip v3.10.1 already installed — no new packages needed
- `bun run lint` passes clean with no issues

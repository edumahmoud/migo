# Worklog: Fix Summary Disappearing Bug

## Bug Description
Summaries created from files would appear briefly then disappear, showing "تم التفريغ او التلخيص ولكن فشل الحفظ" (transcription/summarization completed but save failed).

## Root Cause
1. User uploads file → text extracted → AI summarizes → DB save fails (Vercel 60s timeout, `db_save_timeout`, etc.)
2. `savedSummaryId` is null → client-side retry via POST /api/summaries also fails (single attempt)
3. Summary gets `temp-{timestamp}` ID and is added optimistically to local state
4. After 30 seconds, `recentlyAddedSummaryIdsRef` protection expires
5. Next `fetchSummaries()` returns server data without the temp ID → summary disappears

## Changes Applied

### File 1: `/home/z/my-project/src/components/student/student-dashboard.tsx`

**Change A** (lines 1871-1908): Replaced single client-side retry with robust multi-retry mechanism
- Added exponential backoff (2s, 4s, 8s, 16s, 32s delays)
- Up to 5 retry attempts via `/api/summaries` POST
- Uses fresh `waitForSession()` token instead of potentially-expired one
- Removed `abortController.signal` from retry fetch (not needed, potentially expired)

**Change B** (lines 1925-1927): Enhanced optimistic update protection
- Temp IDs now get 24-hour protection window (86400000ms marker) instead of 30 seconds
- Added localStorage recovery: unsaved summaries are saved to `unsaved_summaries_{userId}` key
- Stores all summary data needed for re-save attempt

**Change C** (lines 446-463): Enhanced `safeSetSummaries` protection logic
- Added `TEMP_ID_PROTECTION_MS = 86400000` for temp IDs
- Different protection logic for temp IDs vs real IDs
- Temp IDs check if a "real version" exists in fetched data (by title + content match)
- Prevents duplicate display when real version appears

**Change D** (after line 1037): Added recovery useEffect
- Checks localStorage for unsaved summaries on mount
- Retries saving each unsaved summary via `/api/summaries` POST
- Replaces temp IDs with real IDs in local state on success
- Cleans up localStorage when all saves succeed
- Refreshes from server after successful recovery
- Delayed 5 seconds to avoid conflicting with initial load

### File 2: `/home/z/my-project/src/components/teacher/teacher-summaries-section.tsx`

**Change A** (lines 936-967): Same multi-retry pattern as student dashboard
- 5 retry attempts with exponential backoff
- Fresh `waitForSession()` token per attempt
- No `abortController.signal` on retry fetch

**Change B** (lines 987-988): Same enhanced optimistic update protection
- 24-hour marker for temp IDs
- localStorage recovery for unsaved summaries

**Change C** (lines 210-226): Same enhanced `fetchSummaries` protection logic
- Temp ID protection with 86400000ms window
- Real version detection to prevent duplicates

**Change D** (after line 366): Same recovery useEffect as student dashboard
- Checks and recovers unsaved summaries from localStorage
- Replaces temp IDs with real IDs
- Refreshes data after recovery

## Verification
- TypeScript compilation passed with no errors (`npx tsc --noEmit`)
- All changes are minimal and targeted — only the described modifications were made
- No other logic was modified

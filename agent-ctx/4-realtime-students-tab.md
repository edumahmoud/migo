# Task 4: Add Supabase Realtime subscriptions to students-tab.tsx

## Summary
Added Supabase Realtime subscriptions to `/home/z/my-project/src/components/course/tabs/students-tab.tsx` for live data updates.

## Changes Made

### 1. Modified `fetchPendingRequests` to accept `showLoading` parameter
- Changed from `async () =>` to `async (showLoading = true) =>`
- Added `if (showLoading)` guard before `setLoadingPending(true)`

### 2. Modified `fetchStudents` to accept `showLoading` parameter
- Changed from `async () =>` to `async (showLoading = true) =>`
- Added `if (showLoading)` guard before `setLoading(true)`

### 3. Added Realtime subscription useEffect
- Added after the initial fetch useEffect (line 278-310)
- Channel name: `students-tab-${subjectId}`
- Subscriptions:
  - `subject_students` INSERT/UPDATE/DELETE with `subject_id=eq.${subjectId}` filter → calls `fetchStudents(false)` + `fetchPendingRequests(false)`
  - `scores` INSERT/UPDATE/DELETE with `subject_id=eq.${subjectId}` filter → calls `fetchStudents(false)`
- Cleanup: `supabase.removeChannel(channel)` on unmount
- Dependencies: `[subjectId, fetchStudents, fetchPendingRequests]`

## Rationale
- Added UPDATE event for `subject_students` (beyond just INSERT/DELETE) because enrollment status changes (pending→approved) are UPDATE operations that affect both the enrolled students list and the pending requests list
- Using `fetchData(false)` pattern avoids UI spinner flash during background refetches
- `supabase` was already imported — no import changes needed

## Lint
- Passes with 0 errors

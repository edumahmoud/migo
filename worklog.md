# AttenDo Worklog

---
Task ID: 1
Agent: Main
Task: Examine and fix the notification service - root cause analysis and deep linking

Work Log:
- Explored entire notification system architecture (DB schema, API routes, frontend components, service worker, push notifications)
- Identified ROOT CAUSE: `team_message` notification type not in DB CHECK constraint, causing all team_message notification inserts to fail silently
- Found 6 additional deep link issues across the codebase
- Fixed all issues surgically

Stage Summary:
- Root cause: `team_message` type missing from `notifications_type_check` DB constraint
- Created migration v53 to add `team_message` type
- Added `team_message` to TypeScript `NotificationType` type
- Fixed `/api/notify` route: poll link `poll:ID:polls` → `subject:ID:polls`, team_message link `teams` → `subject:ID:teams`
- Fixed teams-tab.tsx: now passes `subjectId` for deep linking, fallback also uses `subject:ID:teams` format
- Created centralized `navigateNotification` utility in `src/lib/notification-navigation.ts`
- Refactored `notification-bell.tsx` and `notifications-section.tsx` to use shared utility (eliminated ~200 lines of duplicate code)
- Fixed sw.js: added `report`, `poll`, `team_message` push notification action buttons, bumped cache version to v7
- Fixed `join-subject/route.ts`: `enrollment:ID:students` → `subject:ID:students` (2 occurrences)
- Fixed `subject-teachers/route.ts`: `subject:ID` → `subject:ID:students` (missing tab)
- Created migration v54 to fix report notification trigger functions: `report:ID` → `/reports/ID` format
- All TypeScript errors resolved, lint passes with 0 errors (14 pre-existing warnings)

---
Task ID: 2
Agent: Main
Task: Fix file rename persistence in My Files section

Work Log:
- Investigated entire file rename flow: frontend component → API route → database
- Found the rename API route at `/api/files/rename/route.ts` uses `supabaseServer` (service role, bypasses RLS)
- Identified that the API lacked post-update verification — no re-read to confirm DB change persisted
- Identified that rename didn't sync to `subject_files` records linked via `user_file_id`
- Rewrote `/api/files/rename/route.ts` with: (1) post-update verification re-read, (2) subject_files name sync, (3) comprehensive logging, (4) null-data check after update
- Enhanced frontend `handleRenameFile` in `personal-files-section.tsx` with: (1) background DB verification after 1.5s, (2) auto-revert if DB name doesn't match, (3) better error messaging

Stage Summary:
- Root cause: API returned success without verifying the DB update actually persisted; no subject_files sync
- Fixed: `/api/files/rename/route.ts` — added post-update verification + subject_files sync + null check
- Fixed: `personal-files-section.tsx` — added background verification + auto-revert on mismatch
- Lint passes with 0 errors

---
Task ID: 3
Agent: Main
Task: Enforce role-based messaging visibility rules in chat system

Work Log:
- Analyzed current chat system: search, conversation creation, and messaging flow
- Identified 3 major gaps in role-based visibility:
  1. Students could search globally by email (find any user on platform)
  2. Teachers could search all users globally (including admins and students not in their courses)
  3. No authorization on conversation creation (anyone could start a DM with anyone)
- Fixed `search-users-global` API endpoint with role-based filtering:
  - Students: returns empty (they must use course-scoped `search-users` only)
  - Teachers: only returns other teachers + students enrolled in their courses
  - Admin/Supervisor: returns all teachers + students (excludes other admins)
- Added authorization to `create-individual` API endpoint:
  - Students: verified against enrolled courses (teacher or classmate check)
  - Teachers: verified target is another teacher or student in their courses
  - Returns 403 with Arabic error message if unauthorized
- Added authorization to `search-users` API endpoint:
  - Students: must be enrolled in the subjectId they're searching
  - Teachers: must own the subjectId they're searching
  - Prevents arbitrary subjectId injection
- Updated frontend `chat-section.tsx` handleSearchUsers:
  - Students: search ONLY within enrolled courses (no global search)
  - Teachers: use `search-users-global` (backend filters appropriately)
  - Admin: use `search-users-global` (backend filters to teachers+students only)

Stage Summary:
- Enforced rules: Student→course teacher+classmates, Teacher→other teachers+own students, Admin→all teachers+students
- Server-side authorization on both search AND conversation creation
- Lint passes with 0 errors

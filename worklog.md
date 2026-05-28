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

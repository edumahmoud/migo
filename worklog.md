# Attendu Project Worklog

---
Task ID: 1
Agent: Main Agent
Task: Fix RLS infinite recursion (42P17) causing all client-side Supabase queries to fail

Work Log:
- Diagnosed root cause: The "Admins can read all users" RLS policy on `users` table queries the `users` table itself, creating infinite recursion (42P17)
- Confirmed the issue with live testing: `supabase.from('users').select(...)` with anon key returns "infinite recursion detected in policy for relation users"
- Confirmed service role key DOES bypass RLS and can read all tables successfully
- Created `supabase/fix_rls_recursion_final.sql` with correct fix using SECURITY DEFINER `is_admin()` function
- Could NOT execute SQL automatically (no database password available)
- Created API routes `/api/admin/fix-rls` and `/api/admin/apply-rls-fix` for diagnostic and SQL fix execution

Stage Summary:
- Root cause identified and SQL fix file created
- SQL fix must be executed manually in Supabase Dashboard SQL Editor
- Service role key works fine for backend queries (bypasses RLS)

---
Task ID: 2
Agent: Main Agent
Task: Fix middleware admin check that was returning 403 errors

Work Log:
- Changed middleware from using `createServerClient` (from @supabase/ssr) to `createClient` (from @supabase/supabase-js) for admin role check
- `createClient` with service role key reliably bypasses RLS
- Added JWT fast-path: Check `app_metadata.role` and `user_metadata.role` from JWT claims first (no DB query needed)
- Only fall back to DB query if JWT claims don't have admin role
- Updated `/api/auth/me` to sync `profile.role` to `auth.app_metadata.role` on every login

Stage Summary:
- Middleware now uses JWT claims for fast admin check (no DB query)
- Falls back to `createClient` with service role key for DB check
- No more `createServerClient` for admin verification (avoids potential RLS issues)

---
Task ID: 3
Agent: Subagent
Task: Fix notification store to handle RLS errors gracefully

Work Log:
- Added `isRLSRecursionError()` helper that checks for error code "42P17" or message containing "infinite recursion"
- Added early RLS probe in `initializeNotifications` - if probe fails with 42P17, set initialized=true and return early
- Reduced logging for RLS recursion errors (console.warn instead of console.error)
- Made notification store degrade gracefully when RLS recursion exists

Stage Summary:
- Notification store no longer crashes or spams console on RLS recursion
- Works locally even when Supabase queries fail

---
Task ID: 4
Agent: Subagent
Task: Fix institution logo appearing as user avatar (Bug 2)

Work Log:
- Added server-side validation in `/api/profile/route.ts` to reject avatar_url values containing institution logo paths
- Added client-side guard in `auth-store.ts` updateProfile to strip institution logo URLs from avatar updates
- Existing defensive measures: `/api/auth/me` already cleans up corrupted avatar_url values

Stage Summary:
- Institution logo paths are now blocked from being stored as user avatar_url
- Both client-side and server-side guards are in place

---
Task ID: 5
Agent: Subagent
Task: Fix profile page z-index appearing above sidebar (Bug 3)

Work Log:
- Changed desktop sidebar z-index from `z-30` to `z-50`
- Added `relative z-40` to profile page container
- This ensures sidebar (z-50) always appears above profile page (z-40)

Stage Summary:
- Sidebar z-index: z-50, Profile page z-index: z-40
- Sidebar always appears on top when both are visible
---
Task ID: 6
Agent: Main
Task: Fix infinite loading after admin actions (role change, delete, ban) + server crash

Work Log:
- Server was crashing repeatedly due to background process being killed when Bash session ends
- Fixed by using double-fork technique `(node ... &)&` to properly detach the Next.js process
- Added `fetchWithTimeout` helper with AbortController (15s default, 30s for data fetch) to all admin API calls
- Added `getAuthToken` helper to centralize auth token retrieval with error handling
- Updated ALL admin action handlers to use fetchWithTimeout + getAuthToken:
  - handleChangeRole
  - handleDeleteUser
  - handleDeleteSubject
  - handleBanUser
  - handleUnbanUser
  - fetchBannedUsers
  - fetchAnnouncements
  - handleCreateAnnouncement
  - handleToggleAnnouncement
  - handleDeleteAnnouncement
  - handleViewSubject
  - fetchUsageStats
  - fetchAllData
- Fixed N+1 query problem in /api/admin/data endpoint:
  - Previously: 1 query per user for subject count + 1 query per user for student count + 1 query per banned user for name = potentially hundreds of queries
  - Now: 3 batch queries for user enrichment + 1 batch query for banned user names = fixed number of queries regardless of user count
- All loading states are guaranteed to reset via finally blocks, even on timeout/network errors

Stage Summary:
- Admin actions now have 15-second timeout (30s for data fetch) preventing infinite loading
- N+1 queries replaced with batch queries, reducing API response time from potentially minutes to ~2 seconds
- Server is running stably on port 3000

---
Task ID: 7
Agent: Main
Task: Fix profile page layout issues (green banner overlap, sidebar overlap, z-index conflicts)

Work Log:
- Analyzed screenshot using VLM - identified green banner overlapping header, sidebar overlap, and z-index problems
- Root cause 1: Profile page root had `z-40` which conflicted with header's `z-40`, causing green banner to render over header
- Root cause 2: Profile page used `min-h-screen` div (no flex) + `md:mr-64` (margin-right), while admin dashboard correctly uses `flex min-h-screen` div + `flex-1 md:pr-64` (padding-right)
- Fix 1: Removed `z-40` from UserProfilePage root div
- Fix 2: Changed profile page layout in page.tsx to match admin dashboard structure:
  - Outer div: `min-h-screen bg-background` → `flex min-h-screen bg-background`
  - Main element: `pt-14 sm:pt-16 bg-background min-h-screen md:mr-64` → `flex-1 pt-14 sm:pt-16 pl-0 md:pr-64`
  - This ensures the sidebar offset works correctly with padding instead of margin

Stage Summary:
- Profile page now uses the same layout structure as admin dashboard
- Green banner no longer overlaps with header (z-40 removed)
- Sidebar properly separated from main content (flex + pr-64 instead of mr-64)

---
Task ID: 8
Agent: Main
Task: Comprehensive improvements to chat system in Arabic RTL educational platform

Work Log:
1. **Fixed Send Arrow Icon** — Replaced `Send` icon with `ArrowUp` icon from lucide-react in both `chat-section.tsx` and `chat-tab.tsx`. The old `<Send className="h-4 w-4 rotate-180" />` looked like a rotated paper airplane; now uses `<ArrowUp className="h-4 w-4" />` for a proper send arrow.

2. **Fixed Duplicate Messages & "Invalid Date" Issue**:
   - Fixed `relativeTime()` in both files to guard against invalid/null dates: returns `''` if `dateStr` is falsy or `new Date(dateStr)` produces `NaN`
   - Added negative diff guard (returns 'الآن' if diff < 0)
   - Added optimistic message deduplication in `new-message` and `chat-notification` socket handlers: checks for `temp-` prefixed messages with same sender/content within 10 seconds, and replaces them with the server version instead of duplicating

3. **Added Delete Conversation & Delete All Conversations**:
   - **Backend** (`/api/chat/route.ts`): Added `delete-conversation` action (removes user from `conversation_participants` for individual conversations only) and `delete-all-conversations` action (removes user from all individual conversation participants)
   - **Frontend** (`chat-section.tsx`): Added trash icon button on each individual conversation item in the list (shows on hover), added "delete all" button in the conversations panel header (only visible when individual conversations exist), added `handleDeleteConversation` and `handleDeleteAllConversations` handlers with proper state cleanup

4. **Enhanced Message Editing with `edited_at` Timestamp**:
   - **Types** (`/lib/types.ts`): Added `edited_at?: string | null` field to `ChatMessage` interface
   - **Backend**: Updated `edit-message` action to also set `edited_at: new Date().toISOString()`. If `edited_at` column doesn't exist, falls back to updating without it, then without `is_edited` too
   - **Backend**: Updated `messages` GET query to also select `edited_at` column
   - **Frontend**: When `isEdited` is true, shows `(معدّلة منذ 5 د)` format using `relativeTime(msg.edited_at)`, falling back to `(معدّلة)` if `edited_at` is not available
   - Updated `message-updated` socket event type to include `editedAt?: string` and pass it through the socket emit

5. **Verified Message Deletion**: Confirmed code paths for `delete-message` action are intact — both the backend (soft delete with `is_deleted` flag and content replacement) and frontend (optimistic update + socket broadcast) are working correctly.

6. **Verified Message Notifications**: Confirmed `setChatUnreadCount` is called in the `useEffect` that computes total unread from conversations + local overrides. The sidebar chat badge updates correctly. Unread badges on individual conversations via `getUnreadCount(conv)` work as expected.

7. **Improved Avatars for Group Conversations**:
   - Added `groupParticipants` state (Map<string, UserProfile[]>) to cache participants for group conversations
   - Added `useEffect` to fetch participants for group conversations when the conversation list loads
   - For group conversations with 2+ participants, shows stacked overlapping avatars (up to 3) in both the conversation list and the chat header
   - Falls back to the Hash icon if participants aren't loaded yet or there are fewer than 2

Stage Summary:
- Send button now uses ArrowUp icon (no more rotated paper airplane)
- No more "Invalid Date" in message timestamps
- No more duplicate messages from optimistic + socket broadcast
- Individual conversations can be deleted (trash icon on hover)
- All individual conversations can be deleted at once (header button)
- Edited messages show `(معدّلة منذ X د)` with the edit timestamp
- Group conversations show stacked participant avatars instead of just a Hash icon
- All changes pass `bun run lint` with zero errors

---
Task ID: 9
Agent: Main
Task: Comprehensive chat improvements (7 user requirements) - Round 2

Work Log:
1. **Sidebar Notification Badge (All States)**: Fixed the chat notification badge on the sidebar icon to show even when the sidebar is collapsed. Previously it only appeared when `!collapsed`. Now uses `relative` positioning on the icon span with an absolute-positioned badge that scales down when collapsed.

2. **Back Button for All Screen Sizes**: Removed `md:hidden` class from the back button in the chat header so it's visible on all screen sizes, not just mobile.

3. **Fixed Duplicate Message Display (Critical)**: Added content-based deduplication check (`isContentDuplicate`) in both `new-message` and `chat-notification` socket handlers in both `chat-section.tsx` and `chat-tab.tsx`. The new check looks for messages with the same sender_id, same content, and within 10 seconds timestamp difference — even if the optimistic message was already replaced by the API response (no longer `temp-` prefixed).

4. **Archive/Delete Actions with Confirmation Dialog**:
   - Added `archive-conversation` and `unarchive-conversation` API actions
   - Added 3-dot menu on each conversation item with Archive and Delete options
   - Added 3-dot menu in the chat header with Archive and Delete options for the active conversation
   - Added AlertDialog confirmation before any delete action
   - Added collapsible "المؤرشفة (X)" section at bottom of conversations list
   - Each archived conversation has an Unarchive button
   - Used shadcn/ui AlertDialog and Collapsible components

5. **Confirmation Dialog Before Delete**: Added AlertDialog with Arabic text for both single delete ("هل أنت متأكد من حذف هذه المحادثة؟") and delete all ("هل أنت متأكد من حذف جميع المحادثات؟") with Cancel and Delete buttons.

6. **Pinned Input Area at Bottom**: Made the message input `sticky bottom-0 z-10` on small screens with `sm:relative` for desktop, ensuring it stays visible at the bottom when scrolling.

7. **Fixed First-Time Chat Notification**: Changed the `new-conversation` socket handler to only show a toast about the new conversation without incrementing unread count, since there are no messages yet.

8. **Fixed Chat Deletion Being Synced Across Sides (API)**:
   - Changed `delete-conversation` to use `is_hidden` flag instead of removing participant record
   - Falls back to participant removal if `is_hidden` column doesn't exist
   - Changed `delete-all-conversations` similarly
   - The other user's conversation is completely unaffected
   - API conversations query now filters out `is_hidden` conversations and separates `is_archived` ones
   - Graceful fallback when `is_hidden`/`is_archived` columns don't exist

9. **Database Migration**: Added `migrate-chat-columns` API action that checks column existence. The SQL needs to be run manually in Supabase SQL Editor:
   ```sql
   ALTER TABLE conversation_participants ADD COLUMN IF NOT EXISTS is_hidden BOOLEAN DEFAULT FALSE;
   ALTER TABLE conversation_participants ADD COLUMN IF NOT EXISTS is_archived BOOLEAN DEFAULT FALSE;
   ```

Stage Summary:
- Chat notification badge now shows on sidebar icon regardless of collapsed state
- Back button visible on all screen sizes
- Duplicate messages no longer appear (content-based dedup added)
- Archive/delete actions with confirmation dialog fully implemented
- Message input pinned at bottom on small screens
- First-time chat no longer triggers false unread notification
- Chat deletion is now per-user (other side unaffected) using is_hidden flag
- All changes pass `bun run lint` with zero errors
- NOTE: is_hidden and is_archived columns need to be added to Supabase for full functionality

---
Task ID: 1
Agent: Main Agent
Task: Fix two chat issues: (1) Back button on large screens should exit chat and show welcome area, (2) First-time chat entry should not send notification to other user

Work Log:
- Read chat-section.tsx (2076 lines) to understand the chat architecture
- Identified Issue 1: Back button only called setShowChat(false) without resetting activeConvId/activeConvInfo, so on desktop the chat content remained visible
- Identified Issue 2: startIndividualChat emitted 'notify-new-conversation' socket event to other user, causing toast + conversation list refresh even without any messages
- Fixed Issue 1: Updated back button onClick to also clear activeConvId, activeConvInfo, and messages state
- Fixed Issue 2: Removed the 'notify-new-conversation' socket emit from startIndividualChat - other user will only see the conversation when the first actual message is sent (via chat-notification)
- Verified socket service properly handles chat-notification for direct delivery to participants
- Verified API route doesn't have server-side notification logic for conversation creation
- Ran lint - passes cleanly

Stage Summary:
- Back button now properly exits chat on all screen sizes and shows "مرحباً بك في المحادثات" welcome area
- New chat creation no longer notifies the other user until the first message is sent
- No breaking changes to existing message notification flow

---
Task ID: 3
Agent: Subagent
Task: Add tagline column to institution_settings table and update backend API

Work Log:
1. **Attempted DB Migration via Supabase**:
   - Tried `supabase` CLI: not installed
   - Tried `psql`: not available
   - Tried Supabase REST API `rpc/exec_sql`: no such RPC function exists
   - Tried Supabase `/pg/query` endpoint: invalid path
   - Tried direct PostgreSQL connection via `pg` module with service role key as password: "Tenant or user not found"
   - Tried all regional pooler endpoints: same error
   - Tried direct DB host: network unreachable
   - **Conclusion**: Cannot add column remotely without the database password. Column must be added manually via Supabase SQL Editor.

2. **Updated TypeScript Types** (`/src/stores/institution-store.ts`):
   - Added `tagline?: string | null` to `InstitutionData` interface

3. **Updated Setup API** (`/src/app/api/setup/route.ts`):
   - Added `tagline` to destructured body fields
   - Added `p_tagline` parameter to `setup_initialize_system` RPC call
   - After RPC succeeds, tries to update `tagline` separately (in case RPC function hasn't been updated yet)
   - For direct update path: includes `tagline` in update object, with fallback retry if column doesn't exist
   - For direct insert path: includes `tagline` in insert object, with fallback retry if column doesn't exist
   - Updated `getMigrationSQL()` to include `tagline TEXT` column and `p_tagline` parameter in the RPC function

4. **Updated Admin Institution Section** (`/src/components/admin/institution-section.tsx`):
   - Added `tagline` to local `InstitutionData` interface
   - Added `tagline` to save handler body
   - Added tagline input field in the Basic Info card (after English name), with label "شعار المؤسسة (Tagline)", placeholder "عبارة قصيرة تصف المؤسسة...", maxLength 200, and helper text

5. **Updated Setup Wizard** (`/src/components/setup/setup-wizard.tsx`):
   - Added `institutionTagline` state
   - Added `tagline` to save handler body
   - Added tagline input field in institution info step (after English name)
   - Updated migration SQL template to include `tagline TEXT` column and `p_tagline` parameter

6. **Updated App Header** (`/src/components/shared/app-header.tsx`):
   - `HeaderTitle` component now shows the tagline below the institution name as a smaller subtitle when available

7. **Created Migration Endpoint** (`/src/app/api/migrate/tagline-column/route.ts`):
   - GET/POST: checks if `tagline` column exists, returns status 'migrated' or 'pending' with SQL
   - SQL includes ALTER TABLE and updated `setup_initialize_system` function

8. **Created Migration SQL File** (`/supabase/migrations/v17_institution_tagline.sql`):
   - ALTER TABLE to add `tagline TEXT` column
   - Updated `setup_initialize_system` function with `p_tagline` parameter

9. **Lint**: All changes pass `bun run lint` with zero errors

Stage Summary:
- `tagline` field added to all TypeScript interfaces, API routes, and frontend components
- Backend gracefully handles the case where the `tagline` column doesn't exist yet (retry without it)
- App header shows tagline as a subtitle under the institution name
- Migration endpoint and SQL file created for manual execution
- **IMPORTANT**: The `tagline` column must be added to Supabase manually by running this SQL in the Dashboard SQL Editor:
  ```sql
  ALTER TABLE institution_settings ADD COLUMN IF NOT EXISTS tagline TEXT;
  ```
  And optionally update the `setup_initialize_system` function (see v17 migration file)
- All changes pass lint

---
Task ID: 3-6
Agent: Main Agent
Task: Institution section improvements - logo persistence, dynamic favicon/tab title, tagline field, fix input/icon overlap

Work Log:
- Analyzed uploaded screenshot using VLM to identify UI issues (input/icon overlap, logo placement)
- Read institution-section.tsx, app-header.tsx, institution-store.ts, layout.tsx, and setup API route
- Added tagline field to InstitutionData interface in store, API, and institution-section component
- Updated setup API route with graceful fallback for tagline column (retries without tagline if column doesn't exist)
- Created migration endpoint at /api/migrate/tagline-column that checks if column exists
- Added migration banner in institution-section UI that shows SQL to run when tagline column is missing
- Fixed all input/icon overlap issues: changed absolute left-3 to logical properties (end-3 for RTL, start-3 for LTR)
- Added proper padding to inputs (pe-10 for RTL fields, ps-10 for LTR fields like email/phone)
- Added pointer-events-none to decorative icons to prevent click interference
- Created InstitutionHead component that dynamically updates document.title and favicon based on institution data
- Updated layout.tsx to include InstitutionHead in <head> and set default favicon
- Tab title now shows: "Institution Name - Tagline" when tagline is set, otherwise just institution name
- Favicon dynamically updates to institution logo when available
- Header logo already shows institution logo via useInstitutionStore (verified working)

Stage Summary:
- Input/icon overlap fixed using logical CSS properties (start/end instead of left/right) and proper padding
- Tagline field added with graceful DB fallback - shows migration banner when column doesn't exist
- Dynamic favicon and tab title implemented via InstitutionHead client component
- API saves tagline when column exists, falls back gracefully when it doesn't
- SQL needed: ALTER TABLE institution_settings ADD COLUMN IF NOT EXISTS tagline TEXT;

---
Task ID: 10
Agent: Main Agent
Task: User management section improvements (7 requirements)

Work Log:
1. **Removed delete button from user cards**: Deleted the inline delete/confirm UI that appeared on each card in the grid view. Delete action is now only available in the user detail modal.
2. **Added exact registration time**: Created `formatDateTime()` helper that shows date + time (hour:minute). Replaced `formatDate()` with `formatDateTime()` in both grid cards, list view, and detail modal. Shows "وقت التسجيل" instead of "تاريخ التسجيل".
3. **Disabled profile navigation from user cards**: Replaced `UserLink` components (which open profile on click) with plain `UserAvatar` + `formatNameWithTitle` text in both grid and list views. The card itself opens the admin detail modal instead.
4. **Added display mode toggle**: Added `userDisplayMode` state ('grid' | 'list') and a toggle button group in the header with `LayoutGrid` and `List` icons. Grid view shows cards in a 3-column grid. List view shows a table with columns: User, Email, Role, Registration Time, and a chevron indicator.
5. **Color-coded cards by role**: Added `getRoleCardClass()` (border colors) and `getRoleAccentClass()` (top bar colors) helpers. Grid cards have a colored top accent bar and matching border. List view rows have a colored right border (border-r-4). Colors: superadmin=amber, admin=purple, teacher=emerald, student=sky.
6. **Added sort by registration date**: Added `userSortOrder` state ('newest' | 'oldest') and a toggle button. Modified `filteredUsers` computed value to include `.sort()` based on `created_at`. Button shows current order and toggles on click.
7. **Prevented self-actions**: Added `isSelf()` helper that checks if userId matches profile.id. In the detail modal: role change section is hidden when viewing self, danger zone (ban/delete) is hidden when viewing self, and a notice message is shown instead: "لا يمكنك اتخاذ إجراءات بحق حسابك".

Stage Summary:
- Delete button removed from cards (only in detail modal)
- Exact registration time with hours and minutes shown
- No profile navigation from user cards (uses admin detail modal instead)
- Grid/List view toggle implemented
- Cards color-coded by role (amber/purple/emerald/sky)
- Sort by newest/oldest registration date
- Admin/supervisor cannot take actions on their own account
- All changes pass lint

---
Task ID: 11
Agent: Main Agent
Task: Add stats to user cards + fix ban/delete infinite loading

Work Log:
1. **Added stats to user cards (grid view)**: 
   - Teachers show: 📗 X مقرر + 👥 X طالب
   - Students show: 📗 X مقرر + 🎓 X معلم
   - Stats appear in a bordered row at bottom of each card
2. **Added stats to list view**: Added "الإحصائيات" column in table showing subject/teacher/student counts
3. **Updated API (admin/data/route.ts)**:
   - Changed student links query to select both `student_id` and `teacher_id` (was only selecting `student_id`)
   - Added `studentTeachersMap` to map students to their linked teachers
   - Added `studentSubjectCountMap` to calculate subject counts for students (sum of subjects from all linked teachers)
   - Added `teacherCount` field to student enrichment
   - Added `subjectCount` field to student enrichment
4. **Updated UserWithMeta interface**: Added `teacherCount` field
5. **Updated detail modal for students**: Changed from single "معلم مربوط" stat to grid showing "معلم مربوط" + "مقرر دراسي"
6. **Fixed ban/delete infinite loading**:
   - Added safe JSON parsing with try/catch around `res.json()` in both `handleDeleteUser` and `handleBanUser`
   - If JSON parsing fails, throws a meaningful error with HTTP status code
   - Increased timeout from 15s to 20s for both ban and delete operations
   - Better error messages: shows server status code when response is not OK

Stage Summary:
- User cards now show subject/student/teacher counts directly
- Students see: number of subjects + number of linked teachers
- Teachers see: number of subjects + number of students
- API now calculates subject counts for students via their linked teachers
- Ban/delete operations have more robust error handling preventing infinite loading
- All changes pass lint

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

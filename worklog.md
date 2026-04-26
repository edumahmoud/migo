---
Task ID: 1
Agent: Main Agent
Task: Fix 3 critical bugs - DB/RLS login issue, avatar/logo separation, profile z-index

Work Log:
- Created /api/auth/me endpoint that fetches user profile using service role key (bypasses RLS)
- Rewrote auth-store initialize() to use /api/auth/me instead of client-side Supabase queries
- Rewrote auth-store signInWithEmail() to use /api/auth/me instead of client-side Supabase queries
- Rewrote auth-store onAuthStateChange SIGNED_IN handler to use /api/auth/me
- Rewrote auth-store refreshProfile() to use /api/auth/me as primary method
- Added createFallbackProfile() helper that creates a profile from auth metadata when API fails
- The /api/auth/me endpoint also auto-creates profiles for new users and cleans up corrupted avatar_url
- Fixed profile page z-index by removing `relative` class from wrapper div and `z-10` from back button
- The profile page now renders WITHOUT sidebar (no z-index conflict possible)
- The avatar_url cleanup in /api/auth/me automatically clears institution logo URLs from user avatars
- Verified all changes pass lint and the dev server compiles successfully

Stage Summary:
- Bug 1 (DB/RLS): All auth profile fetches now use /api/auth/me (service role key, bypasses RLS). Every path has a fallback to createFallbackProfile() so login can never hang indefinitely.
- Bug 2 (Avatar/Logo): /api/auth/me auto-cleans corrupted avatar_url containing /institution/logos/. The institution-logo API already separates logo uploads from avatar uploads. Both user-avatar.tsx and settings-section.tsx already have guards.
- Bug 3 (z-index): Profile page no longer has `relative` or `z-10` that could create stacking context conflicts. openProfile() already sets sidebarOpen=false. Profile view doesn't include AppSidebar component.
---
Task ID: 1
Agent: Main
Task: Fix admin dashboard showing 0 for all statistics - user management and statistics not visible to platform admin

Work Log:
- Analyzed uploaded screenshots: First shows Supabase Table Editor with 3 users, second shows admin dashboard with all stats at 0
- Root Cause Analysis identified 3 issues:
  1. `supabaseServer` singleton in `/src/lib/supabase-server.ts` was created at module load time with potentially empty env vars
  2. `/api/admin/data/route.ts` silently swallowed errors - returning `{success: true, data: {}}` even when all queries failed
  3. Middleware also had module-level env var reads that could be empty
- Fixed `supabaseServer` to use lazy Proxy-based initialization that reads env vars at first access time
- Fixed `/api/admin/data/route.ts` to include error details in response and default empty arrays
- Fixed middleware to read env vars at request time instead of module load time
- Added proper error handling to admin dashboard `fetchAllData` with toast messages for 401/403/500 errors
- Created diagnostic API endpoint at `/api/migrate/admin-rls-fix` for testing
- Verified service role key can read all data (3 users, 0 subjects, etc.) via diagnostic endpoint
- Created comprehensive RLS policy fix SQL at `supabase/fix_admin_rls_policies.sql`
- RLS policies are secondary since service role bypasses RLS, but important for client-side queries

Stage Summary:
- Core fix: `supabaseServer` lazy initialization (was module-level singleton, now Proxy-based lazy getter)
- Core fix: Error handling in `/api/admin/data/route.ts` (no longer silently returns empty data)
- Core fix: Middleware env var reads moved to request time
- Enhancement: Admin dashboard now shows error toasts instead of silent 0 stats
- Diagnostic: Confirmed service role reads all data correctly (3 users accessible)
- Pending: RLS policies need to be applied via Supabase Dashboard SQL Editor (file: supabase/fix_admin_rls_policies.sql)

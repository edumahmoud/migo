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

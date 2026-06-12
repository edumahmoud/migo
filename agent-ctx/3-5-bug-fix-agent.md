# Task 3-5: Fix Critical Bugs in Setup Wizard and Institution Settings

## Summary
Fixed three critical bugs preventing proper institution setup and admin account creation.

## Bugs Fixed

### Bug 1: Institution settings don't save during first-time setup
- **File**: `src/components/setup/setup-wizard.tsx`
- **Root Cause**: `handleSaveInstitution` sent POST to `/api/setup` without auth token, but by Step 2 the admin account already exists, so the API requires superadmin auth
- **Fix**: Added `supabase.auth.getSession()` and conditional `Authorization: Bearer` header

### Bug 2: Institution settings don't save from inside dashboard (timezone)
- **File**: `src/app/api/setup/route.ts`
- **Root Cause**: The `institution_settings` table had no `timezone` column; the API route didn't accept or persist timezone
- **Fix**: Added `timezone` to:
  - POST handler destructured fields
  - RPC call parameters (`p_timezone`)
  - Direct update and insert objects
  - Migration SQL table DDL (`timezone TEXT`)
  - `setup_initialize_system()` RPC function signature and body
  - Inline migration SQL in `setup-wizard.tsx`

### Bug 3: First account superadmin promotion unreliable
- **File**: `src/components/setup/setup-wizard.tsx`
- **Root Cause**: Fixed 1.5s timeout was fragile; promotion result was not checked; silent failure
- **Fix**: 
  - Replaced timeout with retry loop (5 attempts, 1s intervals)
  - Verified profile existence before checking role
  - Checked `check-first-user` API response (`success` + `promoted`)
  - Show error and abort on failure instead of silently continuing

## Files Modified
1. `src/components/setup/setup-wizard.tsx` — Bug 1 (auth token), Bug 3 (retry loop)
2. `src/app/api/setup/route.ts` — Bug 2 (timezone support in all paths)

## Verification
- `bun run lint` passes cleanly

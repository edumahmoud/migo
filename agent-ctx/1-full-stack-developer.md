# Task 1: Fix Setup Wizard and Superadmin Creation

## Summary
Fixed two bugs and verified feature change in the bilingual LMS platform:
1. **Bug 1**: JSON parse error ("Unexpected token '<'") — made all fetch calls robust
2. **Bug 2**: First user created as 'student' instead of 'superadmin' — made app_metadata the PRIMARY mechanism
3. **Feature Change**: Remove institution setup step from wizard — already done (only db-migration, admin-account, complete steps remain)

## Files Modified
1. `/home/z/my-project/src/app/api/auth/check-first-user/route.ts` — Complete rewrite
2. `/home/z/my-project/src/app/api/auth/me/route.ts` — Added superadmin override + removed broken RPC calls
3. `/home/z/my-project/src/lib/auth-helpers.ts` — requireSuperAdmin/requireAdmin accept app_metadata fallback
4. `/home/z/my-project/src/components/setup/setup-wizard.tsx` — Robust fetch calls with content-type checks
5. `/home/z/my-project/src/stores/auth-store.ts` — overrideSuperadminFromAppMetadata applied in 3 locations

## Key Architecture Decision
`supabaseServer.auth.admin.updateUserById(userId, { app_metadata: { role: 'superadmin' } })` is the PRIMARY mechanism for granting superadmin. This ALWAYS works because it goes through the Supabase Auth admin API, NOT PostgREST, bypassing DB-level CHECK constraints. The DB profile role is secondary and gets overridden from app_metadata when the CHECK constraint blocks 'superadmin'.

## Lint Status
All changes pass `bun run lint` with no errors.

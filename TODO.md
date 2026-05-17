# TODO — Migo LMS Code Issues & Fixes

## 🔴 Critical (Security)

### 1. ✅ Hardcoded VAPID Private Key in Source Code
- **File**: `src/lib/web-push.ts` (lines 20-21)
- **Issue**: Fallback VAPID private key is hardcoded in source code. Anyone with repo access can send push notifications to all users.
- **Fix**: Remove hardcoded keys. Fail gracefully if env vars are not set.

### 2. ✅ Hardcoded EMIT_SECRET in Chat Service and API Route
- **File**: `mini-services/chat-service/index.ts` (line 321), `src/app/api/chat/route.ts` (line 23)
- **Issue**: `EMIT_SECRET = 'attendo-internal-2024'` as default. Anyone reading the source can forge internal API requests.
- **Fix**: Remove default value. Throw error at startup if EMIT_SECRET is not configured.

### 3. ✅ Socket.IO Chat Service Has No Authentication
- **File**: `mini-services/chat-service/index.ts` (lines 43-78)
- **Issue**: The `auth` event trusts any `userId` and `userName` from the client. No token verification. A malicious client can impersonate any user.
- **Fix**: Require JWT token verification during the `auth` event.

### 4. ✅ Chat Service CORS Set to `*`
- **File**: `mini-services/chat-service/index.ts` (line 9)
- **Issue**: `cors: { origin: "*" }` allows any website to connect to the Socket.IO server.
- **Fix**: Restrict CORS to the application's origin only via env var.

### 5. ✅ `/api/check-first-user` Race Condition — Superadmin Hijacking
- **File**: `src/app/api/auth/check-first-user/route.ts`
- **Issue**: No auth verification. Any user could call this endpoint. If count===1, they get superadmin. No check that the calling user is the user being promoted.
- **Fix**: Add authentication check. Verify the caller's userId matches the userId being promoted. Add a DB-level flag for atomic first-user check.

### 6. ✅ `/api/check-ban` — Unauthenticated Ban Status Enumeration
- **File**: `src/app/api/check-ban/route.ts`
- **Issue**: No authentication — anyone can query ban status by email or userId. Allows user enumeration.
- **Fix**: Require authentication. Only allow users to check their own ban status.

## 🟠 High Severity

### 7. ✅ `application/octet-stream` MIME Type Allowed for Upload
- **File**: `src/app/api/files/course-upload/route.ts` (line 20)
- **Issue**: Including `application/octet-stream` in ALLOWED_MIME_TYPES essentially allows any file type. A user could upload `.exe`, `.sh`, `.bat` files.
- **Fix**: Remove `application/octet-stream`. Validate by file extension as fallback for mobile browsers.

### 8. ✅ `createFallbackProfile` Trusts `user_metadata.role`
- **File**: `src/stores/auth-store.ts` (lines 169-190)
- **Issue**: The fallback profile reads `role` from `user_metadata` which is user-modifiable in Supabase. A user could set their metadata role to `superadmin`.
- **Fix**: Never trust `user_metadata.role` for the fallback profile. Always use `'student'` as the default role.

### 9. ✅ `delete-account` Route Bans Self-Deleted Users
- **File**: `src/app/api/auth/delete-account/route.ts` (lines 61-73)
- **Issue**: After a user deletes their own account, their email is added to `banned_users`. This permanently prevents re-registration.
- **Fix**: Don't ban users who delete their own accounts. Only ban users deleted by admins.

### 10. ✅ `typescript.ignoreBuildErrors: true` in next.config.ts
- **File**: `next.config.ts` (line 8)
- **Issue**: TypeScript build errors are explicitly ignored. Type errors that could cause runtime crashes are silently compiled.
- **Fix**: Remove `ignoreBuildErrors: true` and fix the underlying TS errors.

### 11. ✅ Status Store — `userStatuses` Map Not Cleared on Cleanup
- **File**: `src/stores/status-store.ts` (lines 381-391)
- **Issue**: The `cleanup()` method does NOT clear `userStatuses`. After sign-out and re-login, stale user statuses from the previous session persist.
- **Fix**: Add `userStatuses: new Map()` to the `cleanup()` set call.

### 12. ✅ Notification Store — `initializing` Flag Can Get Stuck
- **File**: `src/stores/notification-store.ts`
- **Issue**: If initialization fails after setting `initializing: true` but before setting `initializing: false`, the flag stays `true` forever, blocking all future init attempts.
- **Fix**: Use try/finally to ensure `initializing` is reset even on failure.

### 13. ✅ Duplicate `EmitRequest` Interface Definition
- **File**: `mini-services/chat-service/index.ts` (lines 312-319 and 336-343)
- **Issue**: The `EmitRequest` interface is defined twice with identical fields.
- **Fix**: Remove the duplicate definition.

### 14. ✅ Dead Code: `ensureColumns()` Function
- **File**: `src/app/api/chat/route.ts` (lines 49-64)
- **Issue**: The function is defined but never called. It can't actually add columns (noted in comment).
- **Fix**: Remove the dead function.

## 🟡 Medium Severity

### 15. ✅ Unused `supabasePublishableKey` Export
- **File**: `src/lib/supabase.ts`
- **Issue**: `supabasePublishableKey` is exported but never used anywhere.
- **Fix**: Remove the unused export.

### 16. ✅ `sanitizeString` Only Strips HTML Tags — Insufficient XSS Prevention
- **File**: `src/lib/api-security.ts` (line 107)
- **Issue**: `input.replace(/<[^>]*>/g, '')` only removes HTML tags but doesn't handle JavaScript URLs, HTML entity encoding, or CSS attacks.
- **Fix**: Add handling for `javascript:` URLs and HTML entities.

### 17. ✅ No Input Validation on `banUntil` Parameter
- **File**: `src/app/api/admin/ban-user/route.ts`
- **Issue**: The `banUntil` parameter from the request body is passed directly to the database without validation.
- **Fix**: Validate that `banUntil` is a valid ISO date string in the future.

### 18. ✅ Status Store — Typo in localStorage Key
- **File**: `src/stores/status-store.ts` (line 102)
- **Issue**: The key is `'attenddo-user-status'` (double 'd') while the app name is 'attendo'.
- **Fix**: Migrate to the correct key name `'attendo-user-status'`.

### 19. ✅ Chat Route — `search-users-global` No Role-Based Access Control
- **File**: `src/app/api/chat/route.ts` (lines 456-506)
- **Issue**: The default `mode='all'` allows any authenticated user (including students) to search ALL users by name and email.
- **Fix**: Restrict default mode based on role. Students should default to email-only search.

## 🟢 Low Severity

### 20. ✅ Remove `prisma/schema.prisma` — Unused/Incorrect
- **File**: `prisma/schema.prisma`
- **Issue**: The Prisma schema defines User/Post models with SQLite, but the app uses Supabase directly. Stale and misleading.
- **Fix**: Remove the `prisma/` directory or add a README noting it's unused.

---

*All items marked with ✅ have been fixed in the commits below.*

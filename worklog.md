# Attendo LMS — Fix Worklog

## Date: 2026-05-16

### Issue 1: Fix App Crash After Login/Logout and After Pressing "Retry"

**Files Modified:**
- `/home/z/my-project/src/components/shared/dashboard-error-boundary.tsx`
- `/home/z/my-project/src/app/error.tsx`
- `/home/z/my-project/src/app/page.tsx`

**Changes:**

1. **dashboard-error-boundary.tsx:**
   - Added `autoRetrying` state to show a spinner on first error with auto-retry after 2 seconds
   - `componentDidCatch` now triggers an auto-retry on the first error (retryCount === 0)
   - `handleGoToLogin` now calls `this.props.onFallbackToLogin?.()` first before falling back to `window.location.href = '/'`
   - `handleRetry` now also resets `autoRetrying` to false

2. **error.tsx:**
   - After the 3-second auto-retry timer, now actually calls `reset()` to remount the page (was previously just showing the error UI)
   - Added `hasActiveSession` state that checks for Supabase auth tokens
   - Added a "العودة للتطبيق" (Return to App) button that only shows when user has an active session

3. **page.tsx:**
   - Added `AppErrorBoundary` class component that wraps the entire dashboard content area, separate from `DashboardErrorBoundary` which wraps individual dashboards
   - `AppErrorBoundary` catches layout-level errors and provides retry/fallback-to-login options
   - Fixed `handleSignOut` to call `signOut()` BEFORE `setCurrentPage('auth')` to avoid rendering auth page while still cleaning up (race condition fix)
   - Added `React` import for the class component
   - Added `AlertTriangle`, `RefreshCw`, `LogOut` icons for the error boundary UI
   - Updated student nav items to include tracking

### Issue 2: Fix Lecture Creation Crash When Uploading Files

**File Modified:**
- `/home/z/my-project/src/components/course/tabs/lectures-tab.tsx`

**Changes:**
1. Added `pendingFilesRef` ref and a sync effect to keep it in sync with `newPendingFiles` state — avoids stale closure in the async upload loop
2. In `handleCreateLecture`, replaced `newPendingFiles` with `pendingFilesRef.current` (snapshot into `currentPendingFiles` local variable)
3. Changed the "all uploads failed" toast to still show a success message for the lecture creation, plus an error about file uploads — ensures the modal closes and the user knows the lecture was created
4. Added DUPLICATE_NAME error handling for both fetch and XHR upload attempts, showing a toast asking the user to rename the file

### Issue 3: Fix Duplicate Notifications and External Push Not Sending

**Files Modified:**
- `/home/z/my-project/src/lib/notifications-service.ts`
- `/home/z/my-project/src/stores/notification-store.ts`

**Changes:**

1. **notifications-service.ts:**
   - Extended dedup to work even when `link` is null: uses content-based dedup (user_id + type + title + message comparison) for notifications without a link
   - Added `console.log` statements for push delivery tracking (success and failure)
   - Removed unused `contentKey` variable

2. **notification-store.ts:**
   - Reduced polling initial interval from 5s to 8s to reduce overlap with Realtime
   - In `refetchNotifications`, improved merge logic to use DB ID as the primary dedup key
   - In Realtime INSERT handler, added `localOnlyMatch` check that specifically looks for local-only notifications (ids starting with `notif-`) with matching content within the dedup window, and replaces them with the DB version
   - Added content-based dedup as a fallback after the local-only check

### Issue 4: File Duplicate Name Check

**Files Modified:**
- `/home/z/my-project/src/app/api/files/course-upload/route.ts`
- `/home/z/my-project/src/components/course/tabs/lectures-tab.tsx`

**Changes:**

1. **course-upload/route.ts:**
   - Added `checkDuplicateFileName()` helper function that queries `subject_files` for existing files with the same `file_name` AND `subject_id`
   - Exact same name (including extension) → returns `{ success: false, error: 'يوجد ملف بنفس الاسم والامتداد. يرجى تغيير اسم الملف', code: 'DUPLICATE_NAME' }` with HTTP 409
   - Same base name but different extension → allowed (no error)
   - Applied duplicate check to BOTH Mode 1 (JSON body) and Mode 2 (FormData body)

2. **lectures-tab.tsx:**
   - Added DUPLICATE_NAME error handling in both fetch and XHR upload paths
   - Shows a toast: `الملف "${displayName}" موجود بالفعل. يرجى تغيير اسم الملف`

### Issue 2 (Revisit): Fix Lecture Creation Crash When Uploading Files — Comprehensive Hardening

**File Modified:**
- `/home/z/my-project/src/components/course/tabs/lectures-tab.tsx`

**Task ID:** 2

**Changes (6 fixes applied):**

1. **Mounted ref to prevent state updates after unmount:**
   - Added `mountedRef = useRef(true)` with a cleanup effect that sets it to `false` on unmount
   - All `setNewPendingFiles` and `setCreating` calls now check `mountedRef.current` before updating state
   - This prevents React "Can't perform a React state update on an unmounted component" warnings

2. **Robust try-catch around entire upload loop:**
   - Added an outer `try-catch` block around the `for` loop that iterates through pending files
   - Any unexpected error that escapes the inner per-file try-catch is now caught by this outer handler
   - Shows a toast: `'حدث خطأ غير متوقع أثناء رفع الملفات. يرجى المحاولة مرة أخرى.'`

3. **Null safety for file data (Blob creation):**
   - Changed `uploadBlob` type from `Blob` to `Blob | null` with explicit null tracking
   - Added try-catch around `new Blob([pf.fileData], ...)` — previously could throw if ArrayBuffer was detached
   - If `pf.fileData` fails, falls through to `pf.file.arrayBuffer()` with validation of `byteLength > 0`
   - If `arrayBuffer()` also fails, attempts direct `pf.file` usage with `pf.file.size > 0` check
   - If all three approaches fail, skips the file with `continue` and shows a specific Arabic error toast
   - Added `blobError` tracking variable to provide specific error messages for each failure mode

4. **Ensure `creating` is always reset:**
   - The `finally` block now explicitly checks `mountedRef.current` before calling `setCreating(false)`
   - The outer `catch` block now logs the error with context: `'[LectureUpload] Unexpected error in handleCreateLecture:'`
   - Even on early returns (e.g., lecture insert failure at line 658), the `finally` block still executes and resets `creating`
   - Added `if (mountedRef.current)` guard on all state resets at the end of the function

5. **Total timeout protection (3 minutes):**
   - Added `TOTAL_UPLOAD_TIMEOUT_MS = 3 * 60 * 1000` (3 minutes)
   - Before each file upload iteration, checks `isUploadTimedOut()` function
   - If timeout exceeded, marks all remaining files as error with message `'انتهت مهلة الرفع الإجمالية'`
   - Shows a toast: `'انتهت مهلة الرفع الإجمالية (3 دقائق). تم إلغاء رفع الملفات المتبقية.'`
   - Breaks out of the upload loop cleanly

6. **Better Arabic error messages with error classification:**
   - Added `classifyError()` helper function that maps different error types to specific Arabic messages:
     - `AbortError` → `'انتهت مهلة الطلب — يرجى التحقق من اتصال الإنترنت'`
     - `TypeError` (network) → `'خطأ في الاتصال بالشبكة — يرجى التحقق من اتصال الإنترنت'`
     - `TypeError` (other) → `'خطأ في نوع البيانات — قد يكون الملف تالفاً'`
     - Auth errors (401/403/JWT) → `'خطأ في المصادقة — يرجى إعادة تسجيل الدخول'`
     - Storage errors → `'خطأ في خدمة التخزين — يرجى المحاولة لاحقاً'`
     - Network/fetch errors → `'خطأ في الاتصال بالشبكة — يرجى التحقق من اتصال الإنترنت'`
     - Timeout errors → `'انتهت مهلة الرفع — قد يكون الاتصال بطيئاً'`
     - Payload too large (413) → `'حجم الملف كبير جداً — الحد الأقصى 4 ميغابايت'`
   - HTTP response error classification in `tryServerUpload`: maps 401/403, 413, 5xx to Arabic messages
   - Token unavailable error now shows: `'فشل التحقق من الهوية. يرجى إعادة تسجيل الدخول والمحاولة مرة أخرى.'`
   - Per-file error toast now includes the filename and classified error: `'فشل رفع الملف "${fileName}": ${classifiedError}'`
   - XHR error/timeout messages in `tryDirectStorageUpload` changed from English to Arabic

**Additional improvements:**
   - Storage cleanup after failed record creation now wrapped in try-catch to prevent secondary errors
   - XHR upload progress callbacks now check `mountedRef.current` before updating state
   - Component unmount check during upload loop breaks out early to prevent wasted work

### Issue 5: Add Student Tracking Path

**Files Modified:**
- `/home/z/my-project/src/lib/types.ts`
- `/home/z/my-project/src/components/shared/app-sidebar.tsx`
- `/home/z/my-project/src/components/shared/mobile-bottom-nav.tsx`
- `/home/z/my-project/src/components/student/student-dashboard.tsx`
- `/home/z/my-project/src/app/page.tsx`

**New File Created:**
- `/home/z/my-project/src/components/student/student-tracking-section.tsx`

**Changes:**

1. **types.ts:**
   - Added `'tracking'` to the `StudentSection` union type

2. **app-sidebar.tsx:**
   - Added `Activity` icon import from lucide-react
   - Added `{ id: 'tracking', label: 'تتبع الطالب', icon: <Activity /> }` to student navigation items

3. **mobile-bottom-nav.tsx:**
   - Added `Activity` icon import from lucide-react
   - Replaced chat in the bottom nav with tracking: `{ id: 'tracking', label: 'تتبع', icon: <Activity /> }`

4. **student-dashboard.tsx:**
   - Added import for `StudentTrackingSection`
   - Added `case 'tracking'` in the switch statement that renders the tracking component with all required props

5. **page.tsx:**
   - Updated student nav items (for profile page sidebar) to include tracking
   - Added `Activity` icon import

6. **student-tracking-section.tsx (NEW):**
   - Full tracking section component with:
     - **Attendance Overview**: Card with circular progress indicator showing attendance rate, total sessions, attended, absent counts
     - **Attendance by Subject**: Table/list showing each subject with attendance statistics and progress bars
     - **Performance Summary**: Cards showing average quiz score, completed assignments, quiz count, and overall progress
     - **Recent Attendance**: Timeline of recent check-ins with date, time, subject name, and status badge
     - **Activity Timeline**: Recent activities (attendance, quiz completions, assignment submissions) sorted by date with type badges
   - Uses shadcn/ui components (Card, Badge, Progress)
   - Tailwind CSS with sky/teal color scheme
   - RTL direction throughout
   - All Arabic labels
   - Responsive design (mobile-first)
   - Framer Motion animations consistent with the rest of the app
   - Fetches subject names dynamically for attendance display

### Issue 6: Fix App Crash After Login/Logout and Retry Button (Comprehensive Fix)

**Task ID:** 1

**Files Modified:**
- `/home/z/my-project/src/components/shared/dashboard-error-boundary.tsx`
- `/home/z/my-project/src/app/page.tsx`

**Root Causes Fixed:**

1. **DashboardErrorBoundary locks users out after 3 retries** — retryCount was incremented in componentDidCatch but never reset after successful recovery, causing permanent lockout
2. **Sign-out race condition** — signOut() was called BEFORE setCurrentPage('auth'), causing the dashboard to briefly render without a user
3. **Error boundary retry doesn't clean up Zustand store state** — stale Zustand data could cause the same error to recur after retry
4. **AppErrorBoundary has no auto-recovery** — transient layout-level errors permanently crashed the app

**Changes:**

1. **dashboard-error-boundary.tsx (v3):**

   a) **Reset retryCount on successful render (componentDidUpdate):**
   - Added `componentDidUpdate` that detects when `hasError` transitions from `true` to `false` (recovery)
   - Starts a 5-second timer; if still error-free after 5 seconds, resets `retryCount` to 0
   - Timer is cancelled if another error occurs during the 5-second window
   - Timer is cleaned up in `componentWillUnmount`
   - This prevents users from being permanently locked out due to accumulated transient errors

   b) **Retry button is ALWAYS available (no lockout):**
   - Removed the `tooManyRetries` condition that hid the retry button after MAX_RETRIES
   - After MAX_RETRIES, the description message changes to suggest resetting the app, but retry is still clickable
   - Retry count indicator now always shows when retryCount > 1

   c) **Added "إعادة تعيين التطبيق" (Reset App) button:**
   - New `handleResetApp` method that clears ALL app state and reloads the page
   - Clears localStorage keys: `attendo-app-store`, `_wsr`, `_sw_reload_pending`, `_attendo_busy`
   - Resets Zustand stores: `useAppStore.reset()`, `useNotificationStore.cleanup()`, `useStatusStore.cleanup()`
   - Uses `require()` with eslint-disable for dynamic imports in class component context
   - Performs full page reload via `window.location.href = '/'`
   - Button styled with red border (border-red-200, text-red-600) to indicate destructive action
   - Uses `RotateCcw` icon from lucide-react

   d) **Reset retryCount in handleRetry:**
   - Manual retry now resets `retryCount` to 0, giving users a fresh start
   - Previously, retryCount only incremented, leading to inevitable lockout

   e) **Cancel recovery timer on new error:**
   - `componentDidCatch` now cancels any pending recovery timer when a new error occurs
   - Prevents stale timer from resetting retryCount after a subsequent error

2. **page.tsx:**

   a) **Fixed sign-out race condition:**
   - Changed `handleSignOut` to call `setCurrentPage('auth')` BEFORE `signOut()`
   - This ensures the UI switches to the auth page before the user state becomes null
   - Previous order (signOut first) caused a brief moment where dashboard tried to render without a user
   - Wrapped `signOut()` in try-catch to prevent any errors from propagating
   - Same fix applied to the inline `onSignOut` handler in the profile page section

   b) **Added auto-recovery to AppErrorBoundary:**
   - Added `autoRetrying` and `retryKey` state properties
   - `componentDidCatch` now triggers a 3-second auto-retry timer
   - Shows a branded spinner during auto-recovery (matching DashboardErrorBoundary style)
   - Timer is cleaned up in `componentWillUnmount`
   - Children are remounted via `retryKey` on retry (same pattern as DashboardErrorBoundary)

   c) **Better error recovery in AppErrorBoundary:**
   - `handleRetry` now resets Zustand stores to clear stale state
   - Uses `require()` with eslint-disable for dynamic imports: `useAppStore.reset()`, `useNotificationStore.cleanup()`, `useStatusStore.cleanup()`
   - Also clears localStorage flags (`_wsr`, `_sw_reload_pending`, `_attendo_busy`)
   - Forces remount via `retryKey` increment (previously just cleared error state without remounting)

### Issue 3 (Revisit): Fix Duplicate Notifications and Enable External Push Notifications — Comprehensive Fix

**Task ID:** 3

**Files Modified:**
- `/home/z/my-project/src/stores/notification-store.ts`
- `/home/z/my-project/src/lib/web-push.ts`
- `/home/z/my-project/src/components/shared/sw-registration.tsx`
- `/home/z/my-project/src/components/shared/notification-permission.tsx`
- `/home/z/my-project/.env`

**Root Causes Fixed:**

1. **Duplicate notifications from Realtime + polling race condition** — When a new notification was inserted, both Supabase Realtime and the polling timer could deliver it. The dedup logic checked inside `set()` callbacks (O(n) array scan), but two concurrent `set()` calls could both read stale state and both add the same notification.
2. **Supabase Realtime duplicate events** — During reconnection, Realtime could deliver the same INSERT event twice. The ID-based dedup inside `set()` had a timing gap.
3. **Content dedup was O(n)** — Every new notification triggered an O(n) scan of the entire notifications array for content-based matching, which was slow and still had race conditions.
4. **VAPID keys not configured** — The `.env` file had no VAPID keys. The server-side `web-push.ts` required env vars with no fallback, while the client-side had a hardcoded fallback public key. The key mismatch meant push subscriptions created by the client couldn't be validated by the server.
5. **Missing Authorization header in notification-permission.tsx** — When users enabled push notifications through the settings section, the subscription request to `/api/push/subscribe` was sent without the Authorization header, resulting in a 401 rejection and the subscription never being stored.

**Changes:**

1. **notification-store.ts (major rewrite of dedup logic):**

   a) **Added global `seenNotificationIds` Set (module-level):**
   - O(1) lookup for notification IDs, checked before any `set()` call
   - Prevents race conditions where two concurrent `set()` callbacks both add the same notification
   - Populated during initialization with all DB notification IDs
   - Updated on INSERT (add), DELETE (remove), and cleanup (reset)
   - Checked FIRST in the Realtime INSERT handler, before the `set()` callback

   b) **Added `contentHashTimestamps` Map (module-level):**
   - Maps `title::message::type` hash → timestamp for O(1) content dedup
   - Replaces O(n) array scanning for content-based duplicate detection
   - Entries older than `DEDUP_WINDOW_MS` are automatically pruned
   - Populated during initialization and on every new notification

   c) **Extended dedup window from 30s to 60s:**
   - Changed `DEDUP_WINDOW_MS` from 30000 to 60000
   - Covers more race conditions between Realtime and polling

   d) **Fixed Realtime INSERT handler:**
   - Now checks `seenNotificationIds` FIRST (before `set()` callback)
   - Marks ID as seen immediately to prevent concurrent handlers from adding it
   - Uses content hash for O(1) content dedup
   - When a content duplicate is found, checks if it's a local-only notification that should be replaced with the DB version
   - Falls back to link-based dedup as a final check

   e) **Fixed `refetchNotifications` merge logic:**
   - Marks all DB notification IDs in `seenNotificationIds` before merging
   - Marks all content hashes in `contentHashTimestamps` before merging
   - Added defensive dedup within DB batch results (shouldn't happen but prevents corruption)
   - Prunes expired content hashes periodically

   f) **Fixed `addNotification`:**
   - Checks `contentHashTimestamps` FIRST (O(1)) before falling back to link check
   - Marks ID and content hash in global structures before calling `set()`
   - Still has defensive check inside `set()` callback for race conditions

   g) **Fixed `cleanup()`:**
   - Calls `resetDedupStructures()` to clear `seenNotificationIds` and `contentHashTimestamps`
   - Prevents stale dedup data from contaminating the next user's session

   h) **Fixed `clearNotification()` and `clearAll()`:**
   - `clearNotification` removes the ID from `seenNotificationIds`
   - `clearAll` calls `resetDedupStructures()` to clear all dedup state

2. **web-push.ts (VAPID key fallback):**

   a) **Added hardcoded fallback VAPID key pair:**
   - `FALLBACK_VAPID_PUBLIC_KEY` and `FALLBACK_VAPID_PRIVATE_KEY`
   - Used when `NEXT_PUBLIC_VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` env vars are not set
   - Matches the client-side fallback keys in `sw-registration.tsx` and `notification-permission.tsx`
   - Ensures client and server always use the same key pair

   b) **Updated `ensureVapidInitialized()`:**
   - Now uses `process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || FALLBACK_VAPID_PUBLIC_KEY`
   - And `process.env.VAPID_PRIVATE_KEY || FALLBACK_VAPID_PRIVATE_KEY`
   - Push notifications work even without explicit env configuration

3. **sw-registration.tsx:**
   - Updated hardcoded fallback VAPID public key from old key to new key matching `web-push.ts` fallback pair
   - Added comment explaining the key must match `web-push.ts`

4. **notification-permission.tsx:**

   a) **Updated hardcoded fallback VAPID public key** to match `web-push.ts` fallback pair

   b) **Added Authorization header to `/api/push/subscribe` request:**
   - Uses `waitForSession` from `@/lib/client-auth` to get a valid auth token
   - Includes `Authorization: Bearer <token>` header in the subscription sync request
   - Previously missing, causing 401 rejections and subscriptions never being stored
   - This was a critical fix — without it, push subscriptions created through the settings section were silently lost

   c) **Added Authorization header to `/api/push/unsubscribe` request:**
   - Same pattern as subscribe — uses `waitForSession` for auth token
   - Ensures unsubscribe requests are authenticated

5. **.env:**
   - Added `NEXT_PUBLIC_VAPID_PUBLIC_KEY` with generated key
   - Added `VAPID_PRIVATE_KEY` with generated key
   - Keys were generated using `npx web-push generate-vapid-keys`

### Issue 4 (Revisit): Improve File Name Duplicate Validation — Require Rename if Same Name+Extension, Allow if Different Extension

**Task ID:** 4

**Files Modified:**
- `/home/z/my-project/src/components/course/tabs/lectures-tab.tsx`
- `/home/z/my-project/src/components/course/tabs/lecture-modal.tsx`
- `/home/z/my-project/src/components/shared/personal-files-section.tsx`

**Changes:**

1. **lectures-tab.tsx (Create Lecture Modal):**

   a) **Extended `PendingFile` interface with error tracking:**
   - Added `error?: string` — stores the specific error message for failed uploads
   - Added `errorCode?: 'duplicate_name' | 'auth' | 'network' | 'size' | 'other'` — categorized error code for UI rendering

   b) **Updated `uploadFileWithProgress` return type:**
   - Added `code?: string` to the return type so XHR responses can carry the `DUPLICATE_NAME` code from the server

   c) **Added state for retry and pre-validation:**
   - `createdLectureId` — stores the lecture ID after creation, enabling retry for failed file uploads
   - `existingSubjectFileNames` — stores existing subject file names for client-side pre-validation

   d) **Added `fetchExistingSubjectFileNames` function:**
   - Queries `subject_files` table for existing file names in the current subject
   - Called when the create modal opens

   e) **Improved DUPLICATE_NAME error handling in all upload paths:**
   - Fetch path: Shows specific Arabic message "يوجد ملف بنفس الاسم والامتداد ({displayName}). يرجى تغيير اسم الملف والمحاولة مرة أخرى", stores error code, and returns `false` (doesn't fall through to XHR retry)
   - XHR path: Same specific message and error code storage
   - Direct storage (JSON mode): Same handling, also cleans up the uploaded storage file
   - Previous behavior showed a generic toast "الملف موجود بالفعل. يرجى تغيير اسم الملف"

   f) **Keep modal open when file uploads fail:**
   - After the upload loop, checks if any files have `status === 'error'`
   - If failed files exist, keeps the modal open so the user can rename and retry
   - If all files succeeded, closes the modal and resets state as before
   - Changed toast messages to mention "يمكنك تغيير الاسم وإعادة المحاولة" instead of just "يمكنك رفعها لاحقاً"

   g) **Added `retryFileUpload` function:**
   - Takes the index of a failed file and re-uploads just that file
   - Uses the stored `createdLectureId` to create the `lecture_note` entry after successful upload
   - Includes client-side pre-validation before retrying (checks against `existingSubjectFileNames`)
   - Handles DUPLICATE_NAME from both server upload and direct storage paths
   - On success, refreshes the existing file names list and checks if all files are done (auto-closes modal after 1.5s delay)

   h) **Added client-side pre-validation when selecting files:**
   - When files are selected, checks each file name against `existingSubjectFileNames` and against other pending files
   - Duplicate files are immediately marked with `status: 'error'`, `errorCode: 'duplicate_name'`, and the specific Arabic error message
   - Shows a toast warning about the number of duplicate files

   i) **Updated pending files UI:**
   - Error files with `errorCode === 'duplicate_name'` get amber styling instead of red (actionable error, not fatal)
   - Added error message display with `AlertTriangle` icon for all failed files
   - Added "إعادة المحاولة" (Retry) button with `RefreshCw` icon for failed files (only when `createdLectureId` exists)
   - Remove (X) button now available for both `pending` and `error` status files
   - Rename field clears error status when the user types a new name (`onChange` resets `error`, `errorCode`, and `status` to `'pending'`)
   - Added `RefreshCw` and `AlertTriangle` icon imports

   j) **Updated modal close/cancel handlers:**
   - Both the X button and cancel button now also reset `createdLectureId` and `existingSubjectFileNames`

2. **lecture-modal.tsx (Lecture Detail Modal):**

   a) **Extended `PendingFile` interface:**
   - Added `errorCode?: 'duplicate_name' | 'auth' | 'network' | 'size' | 'other'`

   b) **Added icon imports:**
   - `RefreshCw`, `AlertTriangle`

   c) **Added `existingSubjectFileNames` state:**
   - Fetched when the modal opens (queries `subject_files` table)
   - Used for client-side pre-validation

   d) **Updated `handleFileSelect` with client-side pre-validation:**
   - Checks against `existingSubjectFileNames` and other pending files
   - Duplicate files are marked with `status: 'error'`, `errorCode: 'duplicate_name'`
   - Shows toast warning

   e) **Updated `updatePendingFileName` to clear errors on rename:**
   - Changes to custom name now reset `error`, `errorCode`, and set `status: 'pending'`

   f) **Improved DUPLICATE_NAME handling in upload paths:**
   - Server upload (FormData): Shows specific Arabic message, stores error code, uses `continue` to skip fallback
   - Direct storage (JSON mode): Shows specific Arabic message, stores error code, cleans up storage file

   g) **Updated pending files UI:**
   - Same amber styling for duplicate_name errors
   - Error message display with `AlertTriangle` icon
   - Remove button for error-status files
   - Inline retry button with full re-upload logic (single file, same as `handleUploadFiles` but for one file)
   - Retry includes client-side pre-validation, server upload, direct storage fallback, and DUPLICATE_NAME handling
   - On success, refreshes notes and existing file names

3. **personal-files-section.tsx:**

   a) **Added client-side pre-validation in `handleFileSelect`:**
   - Checks selected file names against existing personal files (`files` state) and other pending uploads
   - Shows warning toast with the duplicate file names: "يوجد ملف(ات) بنفس الاسم والامتداد ({names}). يرجى تغيير الاسم قبل الرفع، أو سيتم استبدال الملف الموجود."
   - Note: Personal files don't have server-side DUPLICATE_NAME checking (they use a different upload path), so this is client-side only

### Issue 7: Add Teacher Student Tracking/Progress Path with Classification by Performance

**Task ID:** 5

**Files Modified:**
- `/home/z/my-project/src/lib/types.ts`
- `/home/z/my-project/src/components/shared/app-sidebar.tsx`
- `/home/z/my-project/src/components/teacher/teacher-dashboard.tsx`
- `/home/z/my-project/src/app/page.tsx`

**New File Created:**
- `/home/z/my-project/src/components/teacher/teacher-student-tracking-section.tsx`

**Changes:**

1. **types.ts:**
   - Added `'tracking'` to the `TeacherSection` union type

2. **app-sidebar.tsx:**
   - Added `{ id: 'tracking', label: 'تتبع الطلاب', icon: <Activity /> }` to teacher navigation items (between students and files)

3. **teacher-dashboard.tsx:**
   - Added import for `TeacherStudentTrackingSection`
   - Added `{activeSection === 'tracking' && <TeacherStudentTrackingSection ... />}` to the render section with all required props passed from teacher dashboard state

4. **page.tsx:**
   - Added tracking nav item to teacherNavItems array for profile page sidebar

5. **teacher-student-tracking-section.tsx (NEW):**
   - Full teacher-facing student tracking section component with:
     - **Overview Cards**: Total students, average performance, attendance rate, top performers count — each with icon and color-coded card
     - **Classification System**: 4 performance levels with interactive filter buttons:
       - ممتاز (Excellent): 85%+ overall — emerald/green color scheme
       - جيد (Good): 70-84% overall — sky/blue color scheme
       - متوسط (Average): 50-69% overall — amber color scheme
       - ضعيف (Weak): below 50% overall — rose/red color scheme
     - **Filter by Classification**: Clickable level buttons that toggle filtering; active level highlighted with color; clear filter option
     - **Student List**: Each student shows:
       - Avatar (via UserAvatar), name (via UserLink for profile navigation)
       - Overall performance percentage with mini progress bar
       - Performance level badge (color-coded)
       - Expandable details on click
     - **Performance Breakdown (expanded)**: Three metric cards per student:
       - Quiz average score (with BarChart3 icon)
       - Attendance rate (with CheckCircle2 icon, session count)
       - Assignment completion rate (with ClipboardList icon, count)
     - **Weighted Performance Calculation**: Shows the breakdown of weighted components (quiz 40%, attendance 30%, assignments 30%)
     - **Recent Activity Timeline**: Shows last 10 activities (quiz completions, attendance, assignment submissions) with type badges and timeline dots
     - **Search**: Filter students by name or email
     - **Sort Options**: By name (Arabic locale), by performance (high→low), by attendance, by quiz scores
   - Uses shadcn/ui components (Card, Badge, Progress)
   - Uses UserAvatar and UserLink from shared components
   - Tailwind CSS with sky/teal gradient color scheme matching the app
   - RTL direction throughout, all Arabic labels
   - Responsive design (mobile-first with grid cols adapting)
   - Framer Motion animations (containerVariants, itemVariants, AnimatePresence for expand/collapse, layout animations)
   - Computed performance data via useMemo for efficiency
   - Props interface matches existing teacher dashboard state variables

---
Task ID: 2-b
Agent: Chat Hardcoded Strings Fix Agent
Task: Replace hardcoded Arabic strings in chat-section.tsx with t() translations

Work Log:
- Replaced 60+ hardcoded Arabic strings with t() calls in chat-section.tsx
- Modified `relativeTime()` function to accept `t` and `locale` parameters (was hardcoded Arabic + 'ar-SA' locale)
- Modified `TypingIndicator` component to accept `t` prop and use translation keys
- Updated all 4 `relativeTime()` call sites to pass `t` and `locale` args
- Updated `TypingIndicator` usage to pass `t` prop
- Destructured `locale` from `useI18n()` hook in ChatSection component
- Added 48 new translation keys to ar.ts and en.ts chat section
- Fixed dark mode issues on TypingIndicator: added `dark:bg-sky-950/30 dark:border-sky-800` and `dark:text-sky-300`
- Verified no `right-`/`left-` CSS positioning issues remain (file already uses `start-`/`end-`)
- Zero remaining Arabic hardcoded strings in chat-section.tsx

Stage Summary:
- Chat section now fully supports i18n
- All Arabic strings replaced with translation keys
- Dark mode support added for typing indicator
- RTL/LTR positioning already correct

---

Task ID: 5-b
Agent: RTL/LTR CSS Fix Agent
Task: Fix RTL/LTR CSS issues in CRITICAL and HIGH priority files — swap physical CSS properties for logical CSS properties

**Summary**: Replaced all physical-direction CSS properties (left/right, pl/pr, text-left, etc.) with logical properties (start/end, ps/pe, text-start, etc.) across 14 component files to ensure correct layout in both Arabic (RTL) and English (LTR) modes.

**Files Modified:**

### PRIORITY 1 — CRITICAL (broken layout in RTL)

1. **`/home/z/migo/src/components/shared/app-header.tsx`**
   - `fixed top-0 right-0 left-0` → `fixed top-0 end-0 start-0` (header positioning)
   - `${isRTL ? '-left-0.5' : '-right-0.5'}` → `-end-0.5` (2 instances: desktop + mobile status dots)
   - `${isRTL ? 'items-end' : 'items-start'}` → `items-start` (name/role column alignment — Tailwind logical properties handle RTL automatically)

2. **`/home/z/migo/src/components/shared/video-upload-indicator.tsx`**
   - `fixed bottom-20 left-4 right-4 sm:left-auto sm:right-4` → `fixed bottom-20 start-4 end-4 sm:start-auto sm:end-4`

3. **`/home/z/migo/src/components/shared/install-prompt.tsx`**
   - `fixed bottom-20 left-4 right-4 sm:left-auto sm:right-6` → `fixed bottom-20 start-4 end-4 sm:start-auto sm:end-6`
   - `pr-2` → `pe-2`
   - `absolute top-3 left-3` → `absolute top-3 start-3` (close button)

4. **`/home/z/migo/src/components/shared/summary-view.tsx`**
   - `absolute inset-y-0 right-0` → `absolute inset-y-0 start-0` (progress bar fill — start is correct for progress bars)
   - `fixed bottom-20 left-4 sm:left-6` → `fixed bottom-20 start-4 sm:start-6` (scroll-to-top button)

### PRIORITY 2 — Input icon positioning + text alignment

5. **`/home/z/migo/src/components/shared/settings-section.tsx`**
   - `text-left pr-10` → `text-start pe-10` (3 password fields, lines 1367/1393/1419)
   - `absolute right-3` → `absolute end-3` (3 toggle-eye buttons, lines 1374/1400/1426)
   - `absolute top-3 left-3` → `absolute top-3 start-3` (avatar preview close button)
   - `absolute bottom-3 left-3` → `absolute bottom-3 start-3` (avatar preview download button)
   - `absolute bottom-3 right-3` → `absolute bottom-3 end-3` (avatar preview change button)

6. **`/home/z/migo/src/components/shared/settings-modal.tsx`**
   - `text-left pr-10` → `text-start pe-10` (3 password fields, lines 398/424/450)
   - `absolute right-3` → `absolute end-3` (3 toggle-eye buttons, lines 405/431/457)

7. **`/home/z/migo/src/components/shared/personal-files-section.tsx`**
   - `absolute right-3` → `absolute end-3` (Search + Mail icons, lines 2974/3027/3470/3560)
   - `pr-10 pl-3` → `pe-10 ps-3` (input padding, lines 2980/3033/3476/3566)
   - `absolute left-3` → `absolute start-3` (Loader2 spinners, lines 2985/3481)

8. **`/home/z/migo/src/components/teacher/teacher-student-tracking-section.tsx`**
   - `absolute right-3` → `absolute end-3` (search icon)
   - `pr-9 pl-3` → `pe-9 ps-3` (search input padding)
   - `pl-3 pr-8` → `ps-3 pe-8` (sort dropdown padding)
   - `absolute right-2` → `absolute end-2` (sort arrow icon)
   - `pr-2` → `pe-2` (2 formula text divs)
   - `text-left` → `text-start` (5 instances: range distribution, quiz/attendance/assignment scores, overall performance)
   - `absolute right-[15px]` → `absolute end-[15px]` (timeline line)
   - `absolute -top-0.5 -left-0.5` → `absolute -top-0.5 -start-0.5` (pulsing dot)

9. **`/home/z/migo/src/components/teacher/question-bank-section.tsx`**
   - `absolute right-3` → `absolute end-3` (Search + Filter icons)
   - `pr-10 pl-3` → `pe-10 ps-3` (search input + filter select padding)

10. **`/home/z/migo/src/components/course/tabs/students-tab.tsx`**
    - `absolute right-3` → `absolute end-3` (2 Search icons)
    - `pr-9 pl-3` → `pe-9 ps-3` (2 search input paddings)

11. **`/home/z/migo/src/components/course/tabs/lecture-modal.tsx`**
    - `absolute right-3` → `absolute end-3` (Search icon)
    - `pr-10 pl-4` → `pe-10 ps-4` (search input padding)

12. **`/home/z/migo/src/components/course/tabs/chat-tab.tsx`**
    - `pr-4 pl-12` → `pe-4 ps-12` (chat input padding)
    - `${isOwn ? '-left-1' : '-right-1'}` → `${isOwn ? '-start-1' : '-end-1'}` (message action buttons)
    - `${isOwn ? 'left-0' : 'right-0'}` → `${isOwn ? 'start-0' : 'end-0'}` (message action dropdown)

13. **`/home/z/migo/src/components/setup/setup-wizard.tsx`**
    - `pr-10 pl-10` → `pe-10 ps-10` (2 password inputs)
    - `absolute right-3` → `absolute end-3` (2 password toggle-eye buttons)
    - `absolute left-3` → `absolute start-3` (12 input icons: User, Mail, Lock×2, Building2, FileText×2, MapPin, Phone, Mail, Globe, Calendar)
    - `absolute top-2 left-2` → `absolute top-2 start-2` (copy SQL button)
    - `absolute -top-40 -right-40` → `absolute -top-40 -end-40` (background decoration)

14. **`/home/z/migo/src/components/student/student-tracking-section.tsx`**
    - `text-left` → `text-start` (attendance rate percentage)
    - `absolute right-[15px]` → `absolute end-[15px]` (timeline line)

**NOT changed (intentional):**
- `left-1/2 -translate-x-1/2` patterns: These are CSS centering tricks (position at 50% then translate back 50%). Direction-independent; works correctly in both RTL and LTR. Found in personal-files-section.tsx, teacher-student-tracking-section.tsx, students-tab.tsx.
- `absolute -bottom-40 -left-40` and `absolute top-1/3 left-1/3` in setup-wizard.tsx: Purely decorative background blurred circles. Physical positioning is intentional.

**Verification:**
All 14 target files scanned for remaining physical direction properties (`right-`, `left-`, `pr-`, `pl-`, `text-left`). Only acceptable centering patterns and decorative backgrounds remain.

---
Task ID: 5-a
Agent: Dark Mode Critical Pages Fix Agent
Task: Fix dark mode issues in CRITICAL page-level files

Files Modified:
1. `/home/z/migo/src/app/auth/reset-password/page.tsx`
2. `/home/z/migo/src/app/error.tsx`
3. `/home/z/migo/src/app/offline/page.tsx`
4. `/home/z/migo/src/app/global-error.tsx`
5. `/home/z/migo/src/app/page.tsx` (AppErrorBoundary error fallback section)
6. `/home/z/migo/src/components/shared/supabase-config-error.tsx`
7. `/home/z/migo/src/components/shared/dashboard-error-boundary.tsx`
8. `/home/z/migo/src/app/globals.css`

Changes Applied (consistent pattern across all 7 TSX files):

**Background gradients:**
- `bg-gradient-to-br from-sky-50 via-white to-teal-50` → added `dark:from-slate-950 dark:via-card dark:to-teal-950`
- `bg-gradient-to-b from-slate-50 via-white to-sky-50/30` → added `dark:from-slate-950 dark:via-card dark:to-sky-950/30`

**Background decoration blobs:**
- `bg-sky-100/40` → added `dark:bg-sky-900/20`
- `bg-teal-100/40` → added `dark:bg-teal-900/20`

**Card containers:**
- `bg-white/90` → added `dark:bg-card/90`
- `bg-white` (standalone) → added `dark:bg-card`

**Borders:**
- `border-sky-100/50` → added `dark:border-border`
- `border-gray-200` → added `dark:border-border`
- `border-red-200` → added `dark:border-red-800`
- `border-amber-200` (in supabase-config-error) → kept as-is (amber styling)

**Text colors:**
- `text-gray-900` → added `dark:text-foreground`
- `text-gray-700` → added `dark:text-foreground`
- `text-gray-500` → added `dark:text-muted-foreground`
- `text-gray-400` → added `dark:text-muted-foreground`
- `text-sky-800` → added `dark:text-sky-300`
- `text-red-600` → added `dark:text-red-400`

**Input fields:**
- `bg-gray-50/50` → added `dark:bg-input/50`
- `border-gray-200` (input) → added `dark:border-border`
- `bg-gray-200` (strength bar empty) → added `dark:bg-gray-700`

**Interactive states:**
- `hover:text-gray-600` → added `dark:hover:text-foreground`
- `hover:bg-gray-50` → added `dark:hover:bg-muted/50`
- `active:bg-gray-100` → added `dark:active:bg-muted`
- `hover:bg-red-50` → added `dark:hover:bg-red-950/50`
- `active:bg-red-100` → added `dark:active:bg-red-950`

**globals.css (scrollbar dark mode):**
- Added `.dark .custom-scrollbar::-webkit-scrollbar-thumb { background: #475569; }`
- Added `.dark .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #64748b; }`

No functionality changes — only dark: variant Tailwind classes added.

---

Task ID: 6-a
Agent: Dark Mode Quiz + Files Fix Agent
Task: Fix dark mode issues in quiz-view.tsx and personal-files-section.tsx

**Files Modified:**
1. `/home/z/migo/src/components/shared/quiz-view.tsx` (~199 dark: variants added)
2. `/home/z/migo/src/components/shared/personal-files-section.tsx` (~120 dark: variants added)

**Both files had ZERO `dark:` variants before this fix.**

### quiz-view.tsx Changes:

**Border patterns:**
- `border-sky-300` → `border-sky-300 dark:border-sky-800` (7 instances)
- `border-sky-200` → `border-sky-200 dark:border-sky-800` (9 instances)
- `border-teal-300` → `border-teal-300 dark:border-teal-800` (1 instance)
- `border-teal-200` → `border-teal-200 dark:border-teal-800` (1 instance)
- `border-amber-300` → `border-amber-300 dark:border-amber-800` (1 instance)
- `border-rose-300` → `border-rose-300 dark:border-rose-800` (1 instance)
- `border-rose-200` → `border-rose-200 dark:border-rose-800` (1 instance)
- `border-rose-100` → `border-rose-100 dark:border-rose-900` (1 instance)
- `border-emerald-200` → `border-emerald-200 dark:border-emerald-800` (1 instance)
- `border-sky-400` → `border-sky-400 dark:border-sky-600` (PAIR_COLORS)
- `border-teal-400` → `border-teal-400 dark:border-teal-600` (PAIR_COLORS)
- `border-amber-400` → `border-amber-400 dark:border-amber-600` (PAIR_COLORS)
- `border-rose-400` → `border-rose-400 dark:border-rose-600` (PAIR_COLORS)
- `border-cyan-400` → `border-cyan-400 dark:border-cyan-600` (PAIR_COLORS)
- `hover:border-sky-400` → `hover:border-sky-400 dark:hover:border-sky-600` (3 btnClass instances)
- `hover:border-teal-400` → `hover:border-teal-400 dark:hover:border-teal-600` (1 btnClass instance)

**Background patterns:**
- `bg-sky-100` → `bg-sky-100 dark:bg-sky-900/50` (11 instances, including PAIR_COLORS and scoreBg)
- `bg-sky-50` → `bg-sky-50 dark:bg-sky-950/30` (12 instances, including btnClass, pulse animations, badges)
- `bg-sky-50/50` → `hover:bg-sky-50/50 dark:hover:bg-sky-950/30` (3 btnClass instances)
- `bg-teal-100` → `bg-teal-100 dark:bg-teal-900/50` (2 instances + PAIR_COLORS)
- `bg-teal-50` → `bg-teal-50 dark:bg-teal-950/30` (2 btnClass instances)
- `hover:bg-teal-50/50` → `hover:bg-teal-50/50 dark:hover:bg-teal-950/30` (1 instance)
- `bg-amber-100` → `bg-amber-100 dark:bg-amber-900/50` (3 instances + PAIR_COLORS + scoreBg)
- `hover:bg-amber-50` → `hover:bg-amber-50 dark:hover:bg-amber-950/30` (1 instance)
- `bg-rose-100` → `bg-rose-100 dark:bg-rose-900/50` (5 instances + PAIR_COLORS + scoreBg)
- `bg-rose-50` → `bg-rose-50 dark:bg-rose-950/30` (5 instances)
- `bg-rose-50/50` → `bg-rose-50/50 dark:bg-rose-950/20` (1 instance)
- `bg-rose-200` → `bg-rose-200 dark:bg-rose-800` (1 instance)
- `bg-sky-200` → `bg-sky-200 dark:bg-sky-800` (1 instance)
- `bg-emerald-50` → `bg-emerald-50 dark:bg-emerald-950/30` (1 instance)
- `bg-white` → `bg-white dark:bg-card` (8 instances: cards, btnClass, matching items)
- `bg-sky-700` → `bg-sky-700 dark:bg-sky-600` (3 button instances)

**Text color patterns:**
- `text-sky-800` → `text-sky-800 dark:text-sky-200` (26 instances: buttons, labels, scores, matching items)
- `text-sky-700` → `text-sky-700 dark:text-sky-300` (5 instances: icons, labels)
- `text-sky-600` → kept as-is (badge colors, fine in dark)
- `text-teal-700` → `text-teal-700 dark:text-teal-300` (6 instances + PAIR_COLORS)
- `text-amber-700` → `text-amber-700 dark:text-amber-300` (3 instances + PAIR_COLORS)
- `text-amber-600` → `text-amber-600 dark:text-amber-400` (2 instances: icons)
- `text-rose-700` → `text-rose-700 dark:text-rose-300` (9 instances)
- `text-rose-600` → `text-rose-600 dark:text-rose-400` (7 instances: icons, error text)
- `text-rose-800` → `text-rose-800 dark:text-rose-200` (1 instance: explanation text)
- `text-emerald-700` → `text-emerald-700 dark:text-emerald-300` (1 instance)

**Ring patterns:**
- `ring-sky-300` → `ring-sky-300 dark:ring-sky-700` (3 instances + PAIR_COLORS)
- `ring-teal-300` → `ring-teal-300 dark:ring-teal-700` (1 instance + PAIR_COLORS)
- `ring-amber-300` → `ring-amber-300 dark:ring-amber-700` (PAIR_COLORS)
- `ring-rose-300` → `ring-rose-300 dark:ring-rose-700` (PAIR_COLORS)
- `ring-cyan-300` → `ring-cyan-300 dark:ring-cyan-700` (PAIR_COLORS)
- `ring-sky-200` → `ring-sky-200 dark:ring-sky-800` (scoreRing)
- `ring-amber-200` → `ring-amber-200 dark:ring-amber-800` (scoreRing)
- `ring-rose-200` → `ring-rose-200 dark:ring-rose-800` (scoreRing)

**Hover/interactive patterns:**
- `hover:bg-sky-50` → `hover:bg-sky-50 dark:hover:bg-sky-950/30` (5 button instances)
- `hover:bg-rose-200` → `hover:bg-rose-200 dark:hover:bg-rose-900/50` (2 remove-button instances)
- `hover:bg-sky-800` → `hover:bg-sky-800 dark:hover:bg-sky-500` (3 primary button instances)

**PAIR_COLORS constant (line 1878-1885):**
- Added dark variants to all 6 color entries: bg, border, text, ring properties all received appropriate `dark:` variants

**Progress bar:**
- `bg-sky-100 [&>div]:bg-sky-700` → `bg-sky-100 dark:bg-sky-900/50 [&>div]:bg-sky-700 dark:[&>div]:bg-sky-500`

**Focus ring:**
- `focus:border-sky-600 focus:ring-sky-600/20` → `focus:border-sky-600 dark:focus:border-sky-500 focus:ring-sky-600/20`

### personal-files-section.tsx Changes:

**Border patterns:**
- `border-sky-300` → `border-sky-300 dark:border-sky-800` (3 instances: dashed borders)
- `border-sky-200` → `border-sky-200 dark:border-sky-800` (1 instance)
- `border-gray-300` → `border-gray-300 dark:border-border` (2 instances: select dropdowns)
- `border-amber-300` → `border-amber-300 dark:border-amber-800` (2 instances: upload items)
- `border-rose-200` → `border-rose-200 dark:border-rose-800` (1 instance)
- `hover:border-sky-400` → `hover:border-sky-400 dark:hover:border-sky-600` (1 instance)

**Background patterns:**
- `bg-sky-50` → `bg-sky-50 dark:bg-sky-950/30` (8 instances: buttons, badges, selected items)
- `bg-sky-50/30` → `bg-sky-50/30 dark:bg-sky-950/20` (3 instances: dashed border areas)
- `bg-sky-50/50` → `hover:bg-sky-50/50 dark:hover:bg-sky-950/30` (1 instance)
- `bg-sky-50/70` → `active:bg-sky-50/70 dark:active:bg-sky-950/40` (1 instance)
- `bg-sky-100` → `bg-sky-100 dark:bg-sky-900/50` (4 instances: icon circles, filter badges)
- `hover:bg-sky-100` → `hover:bg-sky-100 dark:hover:bg-sky-900/50` (1 instance)
- `bg-amber-50` → `bg-amber-50 dark:bg-amber-950/30` (2 instances: private filter, review state)
- `bg-amber-50/40` → `bg-amber-50/40 dark:bg-amber-950/30` (1 instance: duplicate upload)
- `bg-amber-50/50` → `bg-amber-50/50 dark:bg-amber-950/30` (1 instance: error input)
- `bg-rose-50/30` → `bg-rose-50/30 dark:bg-rose-950/20` (1 instance: failed upload)
- `hover:bg-rose-50` → `hover:bg-rose-50 dark:hover:bg-rose-950/30` (3 instances: remove buttons)
- `focus:bg-rose-50` → `focus:bg-rose-50 dark:focus:bg-rose-950/30` (2 instances)
- `bg-white/20` → `bg-white/20 dark:bg-muted/20` (1 instance)

**Text color patterns:**
- `text-sky-800` → `text-sky-800 dark:text-sky-200` (8 instances)
- `text-sky-700` → `text-sky-700 dark:text-sky-300` (18 instances: icons, labels, focus rings)
- `text-sky-600` → `text-sky-600 dark:text-sky-400` (4 instances: icons)
- `hover:text-sky-700` → `hover:text-sky-700 dark:hover:text-sky-300` (3 instances)
- `text-amber-700` → `text-amber-700 dark:text-amber-300` (2 instances: filter badges)
- `text-amber-600` → `text-amber-600 dark:text-amber-400` (3 instances: duplicate name errors)
- `text-amber-500` → `text-amber-500 dark:text-amber-400` (3 instances: warning icons)
- `text-rose-600` → `text-rose-600 dark:text-rose-400` (2 instances: delete button, filter)
- `text-rose-500` → `text-rose-500 dark:text-rose-400` (3 instances: remove icons)
- `hover:text-rose-500` → `hover:text-rose-500 dark:hover:text-rose-400` (2 instances)

**Focus patterns:**
- `focus:ring-sky-600` → `focus:ring-sky-600 dark:focus:ring-sky-500` (2 instances)
- `focus:ring-amber-500 focus:border-amber-500` → `focus:ring-amber-500 dark:focus:ring-amber-400 focus:border-amber-500 dark:focus:border-amber-400` (1 instance)

**Verification:**
- TypeScript compilation: 0 errors in modified files
- ESLint: 0 new errors in modified files (5 pre-existing warnings in quiz-view.tsx)
- No functionality changes — only `dark:` variant Tailwind classes added

---

Task ID: 6-b
Agent: Dark Mode Assignments+Attendance+Chat+Tracking Fix Agent
Task: Fix dark mode issues in multiple component files — add missing `dark:` variants for scattered light-only Tailwind classes

**Summary**: Added missing `dark:` variant Tailwind classes across 6 component files to ensure proper appearance in dark mode. All changes are CSS-only — no logic or functionality changes.

**Files Modified:**

### 1. `/home/z/migo/src/components/shared/assignments-section.tsx` (~25 fixes)

- `text-sky-700` → `text-sky-700 dark:text-sky-300` (icons, labels, conditional classes)
- `text-amber-600` → `text-amber-600 dark:text-amber-400` (conditional countdown color)
- `text-rose-600` → `text-rose-600 dark:text-rose-400` (conditional countdown color)
- `bg-sky-100` → `bg-sky-100 dark:bg-sky-900/50` (icon backgrounds)
- `bg-sky-50` → `bg-sky-50 dark:bg-sky-950/30` (tab active state, file selection, drag-drop)
- `bg-sky-50/50` → `bg-sky-50/50 dark:bg-sky-950/30` (drag-drop area)
- `bg-sky-50/30` → `bg-sky-50/30 dark:bg-sky-950/30` (empty states)
- `text-sky-800` → `text-sky-800 dark:text-sky-200` (tab text, selected files)
- `hover:bg-sky-50` → `hover:bg-sky-50 dark:hover:bg-sky-950/30` (edit button)
- `hover:bg-rose-50` → `hover:bg-rose-50 dark:hover:bg-rose-950/30` (delete/remove buttons)
- `hover:text-sky-800` → `hover:text-sky-800 dark:hover:text-sky-200` (links)
- `hover:border-sky-300` → `hover:border-sky-300 dark:hover:border-sky-800` (drag-drop border)
- `border-sky-300` → `border-sky-300 dark:border-sky-800` (checkbox, empty states)

### 2. `/home/z/migo/src/components/shared/attendance-section.tsx` (~20 fixes)

- `text-sky-700` → `text-sky-700 dark:text-sky-300` (icons, labels)
- `text-sky-800` → `text-sky-800 dark:text-sky-200` (session titles, counts)
- `text-sky-700/80` → `text-sky-700/80 dark:text-sky-300/80` (check-in time)
- `bg-sky-100` → `bg-sky-100 dark:bg-sky-900/50` (icon circles, badge backgrounds)
- `bg-sky-100 text-sky-800` → `bg-sky-100 dark:bg-sky-900/50 text-sky-800 dark:text-sky-200` (count badges)
- `bg-sky-50/50` → `bg-sky-50/50 dark:bg-sky-950/30` (active session panels)
- `bg-sky-50/30` → `bg-sky-50/30 dark:bg-sky-950/30` (empty states)
- `hover:bg-sky-50` → `hover:bg-sky-50 dark:hover:bg-sky-950/30` (action buttons)
- `hover:text-sky-700` → `hover:text-sky-700 dark:hover:text-sky-300` (action buttons)
- `hover:text-sky-800` → `hover:text-sky-800 dark:hover:text-sky-200` (export link)
- `border-sky-300` → `border-sky-300 dark:border-sky-800` (session panels, empty states)
- `border-sky-200` → `border-sky-200 dark:border-sky-800` (check-in success card)

### 3. `/home/z/migo/src/components/shared/chat-section.tsx` (~15 fixes)

- `text-sky-700` → `text-sky-700 dark:text-sky-300` (icons, links, status text)
- `text-sky-800` → `text-sky-800 dark:text-sky-200` (group avatars, conversation titles)
- `hover:text-sky-800` → `hover:text-sky-800 dark:hover:text-sky-200` (retry link)
- `bg-sky-50` → `bg-sky-50 dark:bg-sky-950/30` (empty states, active conversation)
- `bg-sky-100` → `bg-sky-100 dark:bg-sky-900/50` (avatar backgrounds)
- `bg-sky-100 text-sky-800` → `bg-sky-100 dark:bg-sky-900/50 text-sky-800 dark:text-sky-200` (avatar circles)
- `hover:bg-sky-50` → `hover:bg-sky-50 dark:hover:bg-sky-950/30` (unarchive button)
- `hover:text-sky-700` → `hover:text-sky-700 dark:hover:text-sky-300` (unarchive button)
- `bg-gray-300` → `bg-gray-300 dark:bg-gray-600` (offline status dot)

### 4. `/home/z/migo/src/components/teacher/teacher-student-tracking-section.tsx` (~25 fixes)

- `text-gray-900` → `text-gray-900 dark:text-foreground` (headings, labels)
- `text-gray-700` → `text-gray-700 dark:text-foreground` (bold values)
- `text-gray-600` → `text-gray-600 dark:text-muted-foreground` (labels)
- `text-gray-500` → `text-gray-500 dark:text-muted-foreground` (tab labels, sub-labels)
- `text-gray-400` → `text-gray-400 dark:text-muted-foreground` (inactive counts, efficiency labels)
- `text-sky-700` → `text-sky-700 dark:text-sky-300` (BarChart icon, quiz labels)
- `hover:text-sky-700` → `hover:text-sky-700 dark:hover:text-sky-300` (view all link)
- `stroke="#f1f5f9"` → `stroke="var(--muted)"` (SVG background circle)
- `stroke="#e2e8f0"` → `stroke="var(--border)"` (SVG class average indicator)
- Fixed duplicate `dark:` variants introduced during bulk replace (e.g., `dark:text-foreground dark:text-gray-100` → `dark:text-gray-100`)

### 5. `/home/z/migo/src/components/student/student-tracking-section.tsx` (~15 fixes)

- `text-gray-900` → `text-gray-900 dark:text-foreground` (headings, labels)
- `text-sky-800` → `text-sky-800 dark:text-sky-200` (circular progress, stat values)
- `text-sky-700` → `text-sky-700 dark:text-sky-300` (icon, progress percentages)
- `bg-sky-50/50` → `bg-sky-50/50 dark:bg-sky-950/30` (stat card backgrounds)
- `bg-sky-50` → `bg-sky-50 dark:bg-sky-950/30` (timeline icon bg, quiz badge)
- `ring-sky-100` → `ring-sky-100 dark:ring-sky-800` (timeline icon ring)
- `border-sky-100` → `border-sky-100 dark:border-sky-800` (quiz badge border)

### 6. `/home/z/migo/src/components/teacher/teacher-dashboard.tsx` (~15 fixes)

- `text-sky-700` → `text-sky-700 dark:text-sky-300` (icons, links)
- `hover:text-sky-800` → `hover:text-sky-800 dark:hover:text-sky-200` (links)
- `hover:bg-sky-50` → `hover:bg-sky-50 dark:hover:bg-sky-950/30` (view answers button)
- `hover:bg-white/60` → `hover:bg-white/60 dark:hover:bg-muted/60` (close panel button)
- Fixed duplicate `dark:text-sky-300 dark:text-sky-300` in `pctColorClass` → `dark:text-sky-300`

**Verification**: After all changes, used `rg --pcre2` to verify zero remaining light-only patterns (text-sky-700, text-sky-800, bg-sky-100, bg-sky-50, text-gray-900, etc.) without corresponding `dark:` variants across all 6 files. All instances now have proper dark mode counterparts.

---

Task ID: 6-c
Agent: Dark Mode + RTL Miscellaneous Fix Agent
Task: Fix dark mode and RTL issues in miscellaneous component files

**Summary**: Added dark mode variants to 9 component files and replaced `text-right` with `text-end` in 22 files, plus fixed ~30 RTL positioning issues (left/right → start/end, mr/ml → me/ms, file:mr → file:me).

## Part A: Dark Mode Fixes

### 1. `shared/subjects-section.tsx` (6 violations fixed)
- `text-sky-700` → `text-sky-700 dark:text-sky-300` (Loader2 icon, BookOpen icon, Check icon)
- `border-dashed border-sky-200 bg-sky-50/50` → added `dark:border-sky-800 dark:from-sky-950/30`
- `bg-sky-100` → `bg-sky-100 dark:bg-sky-900/50`
- `bg-sky-50 border-sky-200 text-sky-800` → added `dark:bg-sky-950/30 dark:border-sky-800 dark:text-sky-200`
- `bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100` → added `dark:bg-muted/50 dark:border-border dark:text-muted-foreground dark:hover:bg-muted`

### 2. `shared/notification-bell.tsx` (4+ violations fixed)
- `text-sky-700` (Info icon) → `text-sky-700 dark:text-sky-300`
- `text-sky-700 hover:bg-sky-50` → added `dark:text-sky-300 dark:hover:bg-sky-950/30`
- `text-rose-600 hover:bg-rose-50` → added `dark:text-rose-400 dark:hover:bg-rose-950/30`
- `bg-sky-50/30` → `bg-sky-50/30 dark:bg-sky-950/20`
- `bg-sky-100` → `bg-sky-100 dark:bg-sky-900/50`

### 3. `shared/announcements-banner.tsx` (6 violations fixed)
- Info type: `bg-gray-50 border-gray-200` → added `dark:bg-muted/50 dark:border-border`
- Info icon: `text-gray-600` → added `dark:text-gray-400`
- Info title: `text-gray-700` → added `dark:text-gray-300`
- Sky type: `bg-sky-50 border-sky-200` → added `dark:bg-sky-950/30 dark:border-sky-800`
- Sky title: `text-sky-700` → added `dark:text-sky-300`
- `hover:bg-white/50` → added `dark:hover:bg-white/10`

### 4. `shared/user-avatar.tsx` (1 violation fixed)
- `bg-gradient-to-br from-sky-100 to-teal-100 text-sky-800` → added `dark:from-sky-900/50 dark:to-teal-900/50 dark:text-sky-200`

### 5. `shared/settings-modal.tsx` (2 instances fixed)
- `bg-sky-100 text-sky-800 border-sky-200` → added `dark:bg-sky-900/50 dark:text-sky-200 dark:border-sky-800` (role badge + avatar fallback)

### 6. `course/tabs/student-profile-modal.tsx` (~12 violations fixed)
- `text-sky-700` → added `dark:text-sky-300` (4 instances: User, Loader2, Award×2, CheckCircle2)
- `bg-sky-50/50` → added `dark:bg-sky-950/30`
- `text-sky-800` → added `dark:text-sky-200` (percentage, score, submission score)
- `bg-sky-100 text-sky-800` → added `dark:bg-sky-900/50 dark:text-sky-200` (2 badge instances)

### 7. `course/tabs/teams-tab.tsx` (~6 violations fixed)
- `text-sky-700` → added `dark:text-sky-300` (7 instances: Loader2, Users, FileSpreadsheet, CheckSquare×2, BarChart3)
- `text-sky-700 hover:text-sky-800` → added `dark:text-sky-300 dark:hover:text-sky-200`

### 8. `admin/admin-dashboard.tsx` (key violations fixed)
- `bg-sky-50/30` already had `dark:bg-sky-950/30` (2 instances)
- Inline styles with `#f0f9ff` and `#0369a1` — added TODO comments (2 instances)
- `stroke="#e5e7eb"` (CartesianGrid) → `stroke="var(--border)"` (2 instances)
- `fill: '#6b7280'` (tick text) → `fill: 'var(--muted-foreground)'` (4 instances)
- `border: '1px solid #e5e7eb'` (Tooltip) → `border: '1px solid var(--border)'` (2 instances)

### 9. `student/student-dashboard.tsx` (1 violation fixed)
- `hover:bg-white/60` → added `dark:hover:bg-muted/60`

## Part B: RTL/LTR Fixes

### `text-right` → `text-end` (22 files, ~58 instances)
All instances of `text-right` replaced with `text-end` in:
1. `shared/chat-section.tsx` (~13 instances)
2. `teacher/teacher-dashboard.tsx` (~8 instances)
3. `student/student-dashboard.tsx` (~4 instances)
4. `admin/admin-dashboard.tsx` (~5 instances)
5. `course/tabs/exams-tab.tsx` (~6 instances)
6. `shared/assignments-section.tsx` (~2 instances)
7. `shared/settings-section.tsx` (~5 instances)
8. `shared/settings-modal.tsx` (~7 instances)
9. `shared/quiz-settings-modal.tsx` (~3 instances)
10. `course/tabs/chat-tab.tsx` (~3 instances)
11. `course/tabs/assignments-tab.tsx` (~2 instances)
12. `course/tabs/lecture-modal.tsx` (~2 instances)
13. `course/tabs/teams-tab.tsx` (~1 instance)
14. `teacher/teacher-summaries-section.tsx` (~1 instance)
15. `teacher/question-bank-section.tsx` (~1 instance)
16. `shared/quiz-view.tsx` (~1 instance)
17. `shared/personal-files-section.tsx` (~2 instances)
18. `shared/user-profile-page.tsx` (~1 instance)
19. `shared/video-upload-indicator.tsx` (~1 instance)
20. `shared/supabase-config-error.tsx` (~2 instances)
21. `shared/section-error-boundary.tsx` (~1 instance)
22. `teacher/teacher-student-tracking-section.tsx` (~1 instance)

### Additional RTL Positioning Fixes

- `course/tabs/videos-tab.tsx`: `file:mr-3` → `file:me-3` (2 instances); `bottom-2 left-2` → `bottom-2 start-2`
- `shared/subjects-section.tsx`: `file:mr-3` → `file:me-3`
- `reports/reports-section.tsx`: `ml-1.5` → `ms-1.5` (3 instances); `absolute top-0.5 left-0.5` → `absolute top-0.5 start-0.5`
- `reports/report-button.tsx`: `absolute top-0.5 left-0.5` → `absolute top-0.5 start-0.5`
- `student/student-dashboard.tsx`: `absolute top-3 left-3` → `absolute top-3 start-3` (4 instances); `left-12` → `start-12`
- `teacher/teacher-summaries-section.tsx`: `absolute top-3 left-3` → `absolute top-3 start-3`
- `shared/all-videos-section.tsx`: `bottom-2 left-2` → `bottom-2 start-2`; `top-2 right-2` → `top-2 end-2`
- `course/tabs/assignments-tab.tsx`: `top-0 right-0 left-0` → `top-0 end-0 start-0`; `top-3 left-3` → `top-3 start-3`
- `shared/assignments-section.tsx`: same pattern (2 instances)
- `course/tabs/lectures-tab.tsx`: `top-4 left-4` → `top-4 start-4`; `-top-2 -right-2` → `-top-2 -end-2`; `bg-white` → `bg-white dark:bg-card`
- `course/tabs/exams-tab.tsx`: `sm:absolute sm:top-3 sm:left-3` → `sm:absolute sm:top-3 sm:start-3`
- `shared/notification-bell.tsx`: `absolute -top-0.5 -right-0.5` → `absolute -top-0.5 -end-0.5`
- `shared/notification-permission.tsx`: same pattern
- `shared/quiz-view.tsx`: `absolute -top-1.5 -right-1.5` → `-end-1.5`; `absolute -top-1.5 -left-1.5` → `-start-1.5`
- `shared/user-profile-page.tsx`: `top-4 right-4` → `end-4`; `bottom-0 right-0` → `bottom-0 end-0`; `-bottom-16 right-6` → `-bottom-16 end-6` (+ `sm:right-10` → `sm:end-10`); `bottom-2 left-2` → `bottom-2 start-2`; `top-2 left-2` → `top-2 start-2`
- `shared/dashboard-error-boundary.tsx`: `-right-40` → `-end-40`; `-left-40` → `-start-40`
- `shared/supabase-config-error.tsx`: same pattern

**Verification**: Zero `text-right` instances remain in the 22 target files.
---
Task ID: 1
Agent: main
Task: Three surgical UI fixes + VLM fallback for image-heavy PDFs

Work Log:
- Replaced MoreVertical delete button with DropdownMenu in teacher-summaries-section.tsx
  - Moved ⋮ from `start-3` to `end-3` (RTL/LTR responsive)
  - Added "Rename" and "Delete" options in dropdown
  - Added rename dialog with Input + save/cancel buttons
  - Added handleRenameSummary function using PATCH /api/summaries
- Same changes applied to student-dashboard.tsx
  - Moved ⋮ to end-3 with dropdown containing Rename, Create Quiz, Delete
  - Added rename dialog
- Added PATCH handler in /api/summaries/route.ts for renaming summaries
- Centered text under "no summaries" empty state (added text-center to <p> elements)
- Added VLM fallback for image-heavy/scanned PDFs:
  - Created /api/files/extract-pdf-vlm/route.ts using z-ai-web-dev-sdk
  - VLM reads PDF via file_url type and extracts text from images
  - Triggers when pdfjs-dist returns < 50 chars for PDF files
  - Applied in teacher-summaries-section.tsx (file + existing file flows)
  - Applied in student-dashboard.tsx (file + existing file flows)
  - Applied in question-bank-section.tsx
- Added translation keys: renameSummary, renameSummaryTitle, newTitle, renameSuccess, renameFailed

Stage Summary:
- Commit: 6dd050c pushed to main
- All three user requests fulfilled
- Dropdown menu now properly positioned with RTL/LTR support
- VLM fallback enables text extraction from scanned/image-only PDFs

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

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

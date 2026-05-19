# FIX 2: Duplicate Notifications and External Notifications Not Sending

## Problem 1: External/Push Notifications Not Sending
The `/api/notify` route requires authentication (`requireTeacher` or `authenticateRequest`), but most client-side `fetch('/api/notify')` calls did NOT include an Authorization header. This caused 401/403 responses, silently dropping notifications.

## Problem 2: Duplicate Notifications
When `initializeNotifications` is called after cleanup (e.g., navigation/re-render), `cleanup()` cleared the global dedup structures (`seenNotificationIds`, `contentHashTimestamps`). Between cleanup and re-subscribe, Realtime events could be delivered and not be caught by dedup, resulting in duplicate entries.

## Changes Made

### Auth Headers Added to All `/api/notify` Calls
Added `getCachedAuthHeaders()` import and included auth headers in fetch calls:

1. **`/src/components/course/tabs/lectures-tab.tsx`** (2 calls):
   - `lecture_created` notification
   - `attendance_started` notification

2. **`/src/components/course/tabs/assignments-tab.tsx`** (2 calls):
   - `assignment_created` notification
   - `assignment_graded` notification

3. **`/src/components/course/tabs/notes-tab.tsx`** (1 call):
   - `public_note_created` notification

4. **`/src/components/shared/assignments-section.tsx`** (3 calls):
   - `assignment_created` notification
   - `assignment_graded` notification
   - `assignment_submitted` notification

5. **`/src/components/shared/attendance-section.tsx`** (1 call):
   - `attendance_started` notification

### Duplicate Notification Fix in `/src/stores/notification-store.ts`

1. **`cleanup()` now accepts `fullReset` parameter** (default `true`):
   - `cleanup(true)` (full reset): Clears everything including dedup structures, notifications, unreadCount — used on sign-out
   - `cleanup(false)` (partial reset): Only clears subscription/timer, keeps notifications and dedup structures — used during reinitialize

2. **`initializeNotifications` uses `cleanup(false)`**: Preserves dedup structures during re-subscription, preventing race conditions where Realtime events are re-delivered and not caught by dedup.

3. **`createNotification` improved**:
   - Pre-marks content hash before DB insert (so Realtime echo is deduped)
   - Uses `.select('id').single()` to get the DB-generated ID
   - Marks the DB ID in `seenNotificationIds` after successful insert

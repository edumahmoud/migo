# Task 1: Fix App Crash After Login/Logout and Retry Button

## Summary
Fixed 4 root causes for app crashes after login/logout and when pressing the retry button in error boundaries.

## Files Modified
1. `/home/z/my-project/src/components/shared/dashboard-error-boundary.tsx`
2. `/home/z/my-project/src/app/page.tsx`

## Changes Made

### DashboardErrorBoundary (v3)
- **Reset retryCount on successful render**: Added `componentDidUpdate` that detects recovery (hasError: true → false) and starts a 5-second timer. If still error-free, resets retryCount to 0. Timer cancelled on new errors and on unmount.
- **No more lockout**: Removed `tooManyRetries` condition that hid the retry button. Retry is always available.
- **Reset App button**: Added "إعادة تعيين التطبيق" button that clears ALL localStorage + Zustand stores and reloads the page.
- **Reset retryCount in handleRetry**: Manual retry resets retryCount to 0 for a fresh start.
- **Cancel recovery timer on new error**: componentDidCatch cancels any pending recovery timer.

### Page.tsx
- **Fixed sign-out race condition**: `setCurrentPage('auth')` now called BEFORE `signOut()`. signOut() wrapped in try-catch. Same fix applied to profile page onSignOut handler.
- **AppErrorBoundary auto-recovery**: Added 3-second auto-retry timer with branded spinner UI. Added `retryKey` for forced remount.
- **AppErrorBoundary Zustand reset**: handleRetry now resets Zustand stores (app-store, notification-store, status-store) and clears localStorage flags.

## Build Status
- ✅ Next.js build compiles successfully
- ✅ No new lint errors introduced (only pre-existing ones remain)

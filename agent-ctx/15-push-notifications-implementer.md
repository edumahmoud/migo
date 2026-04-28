# Task 15 - Push Notifications Implementer

## Task: Enable push notifications OUTSIDE the app (Web Push API)

## Summary
Bridged client-side notifications to external browser push notifications by creating a general-purpose push sending API and modifying the client-side notification helper to call it.

## Changes Made

### 1. New File: `src/app/api/push/send/route.ts`
- General-purpose server-side push notification endpoint
- Accepts `{ userId, title, message, url?, type? }`
- Fetches user's push subscriptions from Supabase
- Sends web push to all subscriptions using `sendPushNotification`
- Cleans up expired subscriptions (410/404)
- Returns `{ success, sent, expired }`

### 2. Modified: `src/lib/notifications.ts`
- Added `sendPushViaServer()` helper function
- `sendNotification()`: after successful DB insert, calls `sendPushViaServer()` (non-blocking)
- `sendBulkNotification()`: after successful DB insert, calls `sendPushViaServer()` for each user (non-blocking)
- Push failures don't block in-app notification delivery

### 3. Modified: `src/components/shared/sw-registration.tsx`
- Replaced `createClient()` from `@supabase/supabase-js` with `supabase` from `@/lib/supabase`
- Added `fetch('/api/push/setup', { method: 'POST' })` before subscribing
- Ensures correct Supabase session/cookies and table existence

### 4. Modified: `src/components/shared/notification-permission.tsx`
- Added `fetch('/api/push/setup', { method: 'POST' })` before push subscription flow
- Ensures `push_subscriptions` table exists

## Lint Status
No new errors introduced. Only pre-existing `react-hooks/set-state-in-effect` warnings.

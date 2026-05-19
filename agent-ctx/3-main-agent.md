# Task 3 — Fix Duplicate Notifications and Enable External Push Notifications

**Agent:** Main Agent
**Date:** 2026-03-05
**Status:** Completed

## Summary

Fixed two major issues with the notification system:
1. **Duplicate notifications** — Race conditions between Supabase Realtime and polling, plus Realtime duplicate events, caused the same notification to appear twice
2. **External push notifications not working** — VAPID keys were not configured, and the notification-permission.tsx component was missing Authorization headers

## Files Modified

1. **`src/stores/notification-store.ts`** — Major rewrite of dedup logic
   - Added module-level `seenNotificationIds` Set for O(1) ID dedup
   - Added module-level `contentHashTimestamps` Map for O(1) content dedup
   - Extended `DEDUP_WINDOW_MS` from 30s to 60s
   - Fixed Realtime INSERT handler to check global dedup before `set()`
   - Fixed `refetchNotifications` to populate global dedup structures
   - Fixed `addNotification` to use O(1) content hash check
   - Fixed `cleanup()`, `clearNotification()`, `clearAll()` to manage dedup state

2. **`src/lib/web-push.ts`** — Added VAPID key fallbacks
   - Added `FALLBACK_VAPID_PUBLIC_KEY` and `FALLBACK_VAPID_PRIVATE_KEY` constants
   - Updated `ensureVapidInitialized()` to use env vars with fallbacks

3. **`src/components/shared/sw-registration.tsx`** — Updated fallback VAPID key
   - Changed hardcoded fallback to match the new key pair in web-push.ts

4. **`src/components/shared/notification-permission.tsx`** — Critical auth fix
   - Updated fallback VAPID key to match web-push.ts
   - Added Authorization header to `/api/push/subscribe` (was missing, causing 401)
   - Added Authorization header to `/api/push/unsubscribe`

5. **`.env`** — Added VAPID keys
   - `NEXT_PUBLIC_VAPID_PUBLIC_KEY` (generated via web-push)
   - `VAPID_PRIVATE_KEY` (generated via web-push)

## Key Design Decisions

- Used module-level Sets/Maps instead of Zustand state for dedup because:
  - O(1) lookup vs O(n) array scanning
  - No race conditions between concurrent `set()` callbacks
  - Atomic check-and-mark prevents the same ID from being added by two concurrent handlers

- Generated new VAPID keys instead of trying to match the old hardcoded public key because:
  - The old key's private counterpart was unknown
  - New keys ensure client and server use the same pair
  - Both env vars AND fallbacks now use the same key pair

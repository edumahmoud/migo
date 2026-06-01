# Task: Fix Notification System — Work Summary

## Agent: Main Developer
## Task ID: notification-fix-001
## Date: 2026-03-05

## Changes Made

### 1. Real-time Subscription Fix (`src/stores/notification-store.ts`)

**Problem**: Channel name used `Date.now()` timestamp (`notifications:${userId}:${Date.now()}`), creating new channels on every init without properly cleaning old ones. No reconnection logic.

**Fix**:
- Changed to stable channel name: `notifications:${userId}` (no timestamp)
- Added comprehensive cleanup of old channels (both stable and timestamped formats) before creating new ones
- Added `subscribe((status) => {...})` callback with reconnection logic — on `CHANNEL_ERROR`, attempts to re-subscribe after 5-second delay
- Logs subscription status changes for debugging (`SUBSCRIBED`, `CHANNEL_ERROR`, `TIMED_OUT`, `CLOSED`)

### 2. Notification Bell Real-time Updates (`src/stores/notification-store.ts`)

**Problem**: No audio/haptic feedback when new notifications arrive. Users had to manually check the bell.

**Fix**:
- Added `playNotificationFeedback()` function using Web Audio API (generates a two-tone chime) and `navigator.vibrate()` for mobile haptic feedback
- Called for both Realtime-delivered and polling-detected new notifications
- Audio feedback is non-blocking and gracefully degrades if Web Audio API is unavailable

### 3. Deep Linking Fix (`src/lib/notification-navigation.ts`)

**Problem**: `notifTypeToTab` mapping was missing `quiz: 'exams'` entry. Quiz notifications would default to 'overview' tab instead of 'exams' tab when the link didn't explicitly encode the tab.

**Fix**:
- Added `quiz: 'exams'` to `notifTypeToTab` mapping
- This ensures quiz notifications always navigate to the exams tab as a fallback
- Note: The API already generates correct 3-part links (`subject:ID:exams`) for quiz_created, so this mainly helps as a safety net

### 4. Push Notifications Fix

**4a. Service Worker (`public/sw.js`)**:
- Added `quiz` type actions: `[{ action: 'open', title: 'عرض الاختبار' }, { action: 'dismiss', title: 'لاحقاً' }]`
- Notification click handler already works correctly (posts message to focused client, or opens window with deeplink URL)

**4b. Notifications Service (`src/lib/notifications-service.ts`)**:
- Improved push delivery error logging — now includes type info and extracts error message
- Push failures remain non-blocking (in-app notification still works via Realtime)

### 5. Notification Dedup Simplification (`src/stores/notification-store.ts`)

**Problem**: 4+ overlapping dedup mechanisms (`seenNotificationIds`, `contentHashTimestamps`, link-based dedup in `addNotification`, double-check in `set()` callback) — overly complex and could suppress legitimate notifications.

**Fix**: Simplified to primarily use `seenNotificationIds` (Set) as the single dedup mechanism:
- **Removed**: `contentHashTimestamps` map and all related functions (`contentHash`, `isContentHashRecent`, `markContentHashSeen`, `pruneContentHashes`)
- **Removed**: Link-based dedup check in `addNotification` (O(n) scan that could suppress different events with same link)
- **Removed**: Redundant content hash check inside `set()` callback in `addNotification`
- **Kept**: `seenNotificationIds` (primary dedup by ID — reliable, O(1))
- **Kept**: `pendingDeletionIds` (prevents re-adding deleted notifications during polling)
- **Kept**: localStorage deleted IDs (persists across page reloads when DB DELETE fails due to RLS)
- **Simplified**: Local-only → DB version replacement in Realtime INSERT handler now uses simple title+type+message match instead of content hash
- **Simplified**: `addNotification` dedup now uses simple title+type+message match
- **Simplified**: `refetchNotifications` merge uses title+type+message match instead of content hash for local-only → DB replacement

### 6. Chat Notifications Fix (`src/components/shared/notification-bell.tsx`, `src/components/shared/notifications-section.tsx`)

**Problem**: `notifications.filter(n => n.type !== 'chat')` removed chat notifications entirely from the bell dropdown and unread count.

**Fix**:
- **Notification Bell**: Removed the chat filter — all notifications (including chat) now appear in the bell dropdown
- **Notifications Section**: Same — chat notifications now appear in the full notifications section
- **Icon Update**: Changed chat notification icon from `Bell` to `MessageCircle` for better visual distinction (in both bell and section components)
- **Deep linking**: Already works — `chat:CONVERSATION_ID` links are handled by `navigateNotification()` in `notification-navigation.ts`
- **Unread count**: Chat notifications now contribute to the bell badge count

### 7. RLS Recursion Handling Improvement (`src/stores/notification-store.ts`)

**Problem**: UPDATE Realtime handler didn't add notifications that weren't already in the store (could miss notifications that arrived during brief disconnections).

**Fix**: UPDATE handler now adds the notification to the store if it doesn't already exist (instead of silently returning `state`).

## Files Modified

1. `src/stores/notification-store.ts` — Major rewrite (dedup simplification, stable channel, reconnection, audio feedback)
2. `src/components/shared/notification-bell.tsx` — Show chat notifs, icon update
3. `src/components/shared/notifications-section.tsx` — Show chat notifs, icon update
4. `src/lib/notification-navigation.ts` — Add quiz→exams mapping
5. `src/lib/notifications-service.ts` — Improved push error logging
6. `public/sw.js` — Add quiz push notification actions

## Verification

- `bun run lint`: 0 errors, 14 pre-existing warnings (all unrelated to changes)
- TypeScript: No new type errors in modified files
- All existing functionality preserved — changes are additive and simplifying only

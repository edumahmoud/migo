# Task 4: Fix Notification System

## Agent: Main
## Status: Completed

## Summary
Fixed 3 notification system issues: bell visibility, sound enhancement, and exam/task time notifications.

## Changes Made

### 1. notification-bell.tsx — Bell Visibility Fix
- Changed from single `useNotificationStore()` destructuring to individual selectors for each field
- Added 30s periodic forced refresh useEffect independent of store polling

### 2. notification-store.ts — Sound Enhancement
- Exported `playNotificationFeedback()` (was module-private)
- Three-tone ascending chime: 880Hz → 1320Hz → 1760Hz
- Increased gain: 0.35/0.30/0.25 (was 0.15/0.12)
- Added HTML5 Audio WAV blob fallback (800Hz, 250ms, volume 0.8) for mobile reliability
- Enhanced vibration: [150, 80, 150]

### 3. student-dashboard.tsx — Exam/Task Time Notifications
- Added `playNotificationFeedback` and `useNotificationStore` imports
- New useEffect with 30s interval checking quiz/assignment start times
- 4-step notification: sound + toast + browser Notification API + store notification entry
- Duplicate prevention via Set of notified IDs
- Browser notification permission request on first run

### 4. Translation Keys Added
- en.json: quizStartingNow, quizStartingNowDesc, assignmentDueNow, assignmentDueNowDesc
- ar.json: Same 4 keys in Arabic

## Verification
- TypeScript type check: passes
- ESLint: 0 errors
- JSON validation: both en.json and ar.json valid

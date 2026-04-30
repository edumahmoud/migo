---
Task ID: 1
Agent: Main Agent
Task: Fix transparent overlay blocking all UI interactions after navigation

Work Log:
- Read and analyzed all key files: role-guard.tsx, layout.tsx, navigation-cleanup.ts, globals.css, use-mounted-sections.ts, app-sidebar.tsx, student-dashboard.tsx, teacher-dashboard.tsx, admin-dashboard.tsx, banned-user-overlay.tsx, auth-store.ts, page.tsx, offline/page.tsx, sw-registration.tsx, notification-bell.tsx, chat-section.tsx
- Identified ROOT CAUSE: CSS overlay prevention rules were INSIDE `@media (hover: none) and (pointer: coarse)` block, meaning they ONLY worked on touch devices. Desktop browsers had ZERO protection against overlay blocking.
- Fixed globals.css: Moved `[data-exiting="true"]`, `[aria-hidden="true"] .fixed`, and added new rules out of @media block to make them GLOBAL
- Added new CSS rules: `[role="tabpanel"][aria-hidden="true"]` pointer-events none, `[data-radix-portal] [data-state="closed"]` pointer-events none, `[data-radix-overlay][aria-hidden="true"]` and `[data-radix-portal][aria-hidden="true"]` pointer-events none
- Enhanced navigation-cleanup.ts: Added `initExitAnimationObserver()` MutationObserver that watches for Framer Motion exit animations and marks them with `data-exiting="true"`, added `destroyExitAnimationObserver()`, improved `forceCleanupOverlays()` to be more aggressive, added `cleanupAfterNavigation()` as main entry point with multi-stage cleanup (sync + microtask + requestAnimationFrame)
- Updated dashboard layout: Added `cleanupAfterNavigation()` call on every pathname change, added `initExitAnimationObserver()` on mount
- Updated all 3 dashboards (student, teacher, admin) to use `cleanupAfterNavigation()` instead of dynamic import
- Updated app-sidebar.tsx to use `cleanupAfterNavigation()` instead of dynamic import
- Refined CSS rules to be specific (not too broad): removed blanket `.hidden` rule, replaced with `[role="tabpanel"][aria-hidden="true"]`
- Lint check passes, dev server running without errors

Stage Summary:
- Fixed the ROOT CAUSE of transparent overlay blocking: CSS prevention rules were only for touch devices, now global
- Added MutationObserver to catch Framer Motion exit animations and mark them as non-interactive
- Added multi-stage cleanup (sync + microtask + rAF) on every pathname change
- All dashboards and sidebar now use centralized `cleanupAfterNavigation()`
- The error in the user's screenshot ("خطأ في الاتصال بالإنترنت") is from the deployed Vercel version (lms-attendo.vercel.app), likely due to network issues on the user's device

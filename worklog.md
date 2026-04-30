---
Task ID: 1
Agent: main
Task: Fix navigation blocking bug - hover works but clicks don't after first navigation

Work Log:
- Analyzed the entire navigation flow: sidebar → router.push() → pathname change → section toggle
- Identified root cause: Radix UI Dialog `inert` attribute on React root (#__next) blocks clicks but allows CSS :hover
- In keep-alive pattern, dialog portals stay at body level with data-state="open" even after section is hidden
- The `isAnyVisibleDialogOpen()` check was preventing cleanup because it saw the orphaned portal as "visible"
- MutationObserver only watched body itself, not body children (missed inert on #__next)
- Sub-components using Dialog/AlertDialog didn't listen for navigation:cleanup event

Changes Made:
1. **`src/lib/navigation-cleanup.ts`** - Complete rewrite:
   - Made `cleanupInertAttributes()` UNCONDITIONAL (removed `isAnyVisibleDialogOpen()` guard)
   - Added deep scanning for inert on ALL interactive containers (header, aside, nav, main)
   - Added `#__next` and React root specific checks
   - Added `subtreeObserver` that watches ALL body descendants for inert changes (not just body)
   - Added `forceCloseOrphanedDialogs()` that dispatches Escape key to close stale dialogs
   - Added periodic safety check every 2 seconds as belt-and-suspenders
   - Replaced `isAnyVisibleDialogOpen()` with smarter `isAnyGenuinelyVisibleDialogOpen()` that checks overlay opacity and dialog visibility

2. **`src/app/globals.css`** - Enhanced CSS rules:
   - Added stale portal prevention rules for closed sheet/dialog overlays
   - Added `[data-radix-portal]:not(:has([data-state="open"]))` rule to make empty portals non-interactive
   - Added `body[style*="pointer-events: none"]` override for header/aside/nav to ensure they stay clickable even when body has pointer-events: none

3. **`src/components/shared/app-sidebar.tsx`** - Enhanced handleNav:
   - Now calls `cleanupAfterNavigation()` IMMEDIATELY (not just in rAF)
   - Also still calls it in rAF as safety net

4. **Sub-components** - Added `navigation:cleanup` event listeners:
   - `chat-section.tsx` - closes confirmDialog, showNewDM, editingMessageId, messageMenuId, convMenuId, headerMenuOpen
   - `personal-files-section.tsx` - closes all modal states (upload, delete, rename, share, assign, preview, etc.)
   - `student-profile-modal.tsx` - calls onClose()
   - `teams-tab.tsx` - closes create/edit/auto-assign/add-member dialogs
   - `students-tab.tsx` - closes all confirm dialogs and modals

Stage Summary:
- Root cause: `inert` attribute on React root (#__next) added by Radix UI Dialog, not properly cleaned up when dialog's section becomes hidden in keep-alive pattern
- `inert` blocks click events but allows CSS :hover, explaining the "hover works but click doesn't" symptom
- Fix: aggressive unconditional cleanup + MutationObserver watching all descendants + periodic safety check + sub-component dialog close listeners

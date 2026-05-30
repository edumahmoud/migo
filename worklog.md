---
Task ID: 1
Agent: Main Agent
Task: Implement 6 UI/UX improvements for LMS platform

Work Log:
- Made sidebar full screen height (top-0, h-screen) instead of starting below header
- Added app branding (logo + title) inside the sidebar header area
- Made header push inward (md:start-64/md:start-[68px]) to not overlap with sidebar
- Hidden header logo/title on desktop (md:hidden) since sidebar now shows them
- Removed "Collapse sidebar" button from bottom of sidebar on all screens
- Cleaned up unused imports (ChevronRight, ChevronLeft, useCallback)
- RTL support already handled via dir={direction} and logical CSS properties (start-0, ms-auto, etc.)
- Added clickable description expansion on course page (truncated by default, click to expand)
- Added AnimatePresence wrapping and exit animations to all card lists (exams, notes, todos, assignments)
- Added exit={{ opacity: 0, scale: 0.95, y: 10 }} animation to quiz, note, todo, assignment cards
- Made todo and assignment deletions optimistic (instant UI removal with rollback on error)
- Added 15-second quiz tick timer for automatic scheduled→active quiz tab transitions
- Fixed MCQ option letter ordering: Arabic now uses أ,ب,ج,د (correct alphabetical) instead of أ,إ,آ,ئ
- English uses A,B,C,D (String.fromCharCode(65+idx))
- Updated option label placeholders in exams-tab and question-bank-section

Stage Summary:
- Sidebar now full-height with branding, header pushed inward on desktop
- All card lists have exit animations for instant hide on delete/move
- Quiz tabs auto-update every 15 seconds for scheduled→active transitions
- Question options now use correct alphabetical ordering per language
- Course description is clickable to expand/collapse

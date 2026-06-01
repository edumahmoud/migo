# Tasks 3, 4, 5 — Main Agent Work Record

## Task 3: Sticky Notes Feature
- Added `sticky` to `LectureNote.visibility` type in `src/lib/types.ts`
- Created `src/components/course/tabs/draggable-sticky-note.tsx` — draggable floating card with localStorage position persistence, mouse/touch support, minimize/close
- Modified `src/components/course/tabs/notes-tab.tsx` — added 'sticky' visibility option with Pin icon, amber styling, rendering as floating cards
- Translation keys: stickyNote, showAsSticky, stickyNoteDesc

## Task 4: Auto-add Quizzes/Assignments + Fix Toggle
- Modified `src/components/shared/todo-section.tsx`:
  - Added `AutoTodoItem` interface and `fetchAutoTodos` for quiz/assignment auto-population
  - Created `allDisplayTodos` computed merge
  - Fixed toggle: optimistic update BEFORE API call, `togglingInProgress` ref to skip realtime re-fetch
- Modified `src/components/shared/calendar-section.tsx`: same toggle fix
- Translation keys: todos.autoQuiz, todos.autoAssignment

## Task 5: Calendar Color-Coding
- Modified `src/components/shared/calendar-section.tsx`:
  - Changed overdue badge to "missed" text
  - Added color legend in header banner
- Translation keys: calendar.missed, inProgress, legend, legendMissed, legendCompleted, legendUpcoming

## Lint: 0 errors

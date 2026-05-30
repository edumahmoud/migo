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
---
Task ID: 1
Agent: main
Task: Fix todo-section.tsx flickering bug (tasks reappear after delete, disappear after create) and auto-todo persistence

Work Log:
- Identified root cause: Realtime subscription called `fetchTodos()` on every DB change event, which replaced the entire `todos` state with a fresh DB query. This created a race condition where the DB query could return stale data (before the INSERT/DELETE committed), overwriting the optimistic local state.
- Removed `togglingInProgress` and `addingInProgress` refs (no longer needed)
- Replaced realtime subscription from `fetchTodos()`-based to direct state mutations using event payloads:
  - INSERT event → add to state (with smart dedup for optimistic temp entries)
  - UPDATE event → update matching item in state
  - DELETE event → remove matching item from state
- This eliminates the race condition entirely because we never do a full re-fetch from the realtime handler
- Added `subjectsRef` to avoid stale closure in realtime handler
- Fixed auto-todo persistence: added localStorage-based hidden auto-todo tracking (`hidden-auto-todos-{userId}`), so dismissed auto-tasks don't reappear after page refresh
- Updated `fetchAutoTodos` to filter out hidden auto-todos from localStorage
- Updated `handleDelete` for auto-todos to call `persistHiddenAutoTodo()` before removing from state
- Updated `handleDelete` for manual todos: on error, call `fetchTodos()` to restore (instead of stale closure rollback)
- Simplified `handleAdd` and `handleToggle` by removing flag-based guards

Stage Summary:
- **Root cause**: `fetchTodos()` in realtime handler caused race conditions
- **Fix**: Direct state mutation from event payloads instead of full re-fetch
- **Auto-todo fix**: localStorage persistence for hidden/dismissed auto-tasks
- Lint: clean, no errors
- Dev server: running normally
---
Task ID: 2
Agent: main
Task: Comprehensive Student Performance Analytics System Redesign

Work Log:
- Created shared performance calculation engine (src/lib/performance-calculator.ts)
- Added attendance_status column to DB (v58 migration: present/late/partial/absent)
- Updated TypeScript AttendanceRecord type with attendance_status field
- Rewrote teacher-student-tracking-section.tsx with new KPIs, risk system, growth index, discipline score, ranking, enhanced timeline
- Rewrote student-tracking-section.tsx with KPI dashboard, course analytics, timeline filtering
- Rewrote student-profile-modal.tsx with new metrics engine
- Updated teacher-dashboard.tsx to fetch submitted_at, due_date, attendance_status
- Updated student-dashboard.tsx attendance queries (already done by subagent)
- Added 100+ i18n translation keys in both Arabic and English
- Lint: clean, no errors
- Pushed as commit 832584b

Stage Summary:
- **New calculation engine**: All formulas centralized in performance-calculator.ts
- **Weighted exam performance**: total earned / total possible (not average of percentages)
- **Points-based attendance**: present=100, late=75, partial=50, absent=0
- **Split assignment metrics**: compliance (commitment) + quality (academic)
- **New overall weights**: Exam=35%, Attendance=20%, Compliance=15%, Quality=30%
- **Efficiency redesign**: "Insufficient Data" when effort < 40%
- **Discipline score**: behavioral commitment (0-100)
- **Growth index**: recent vs earliest with trend arrows
- **Early risk detection**: 4 levels with specific reasons
- **Student ranking**: percentile-based (Top 5%/10%/25%/50%)
- **Enhanced timeline**: filter buttons, new event types (grading, risk, achievement)
- **CSV export**: 16 columns with all new metrics
---
Task ID: 3
Agent: Main Agent
Task: Final Audit & Completion Pass — Analytics System Hardening

Work Log:
- Performed comprehensive gap analysis of all analytics code
- Found legacy 40/30/30 formula in teacher-dashboard.tsx (line 611-647) and student-dashboard.tsx (line 2950-2986)
- Found duplicated business logic in teacher-student-tracking-section.tsx and student-tracking-section.tsx (inline subject-level growth/risk calculations)
- Found hardcoded constants throughout performance-calculator.ts (weights, thresholds, classification ranges)
- Created centralized analytics-config.ts with ALL configurable constants
- Created strongly typed analytics models in analytics-types.ts
- Refactored performance-calculator.ts to use centralized config instead of hardcoded values
- Added computeSubjectPerformance() to eliminate duplicated subject-level logic
- Added computeCohortAnalytics() for reusable cohort distribution calculations
- Added improvementPercentage to calculateGrowthIndex return value
- Added score field to calculateRiskLevel return value
- Replaced legacy 40/30/30 in teacher-dashboard.tsx with computeAllMetrics from shared engine
- Replaced legacy 40/30/30 in student-dashboard.tsx with computeAllMetrics from shared engine
- Fixed student-profile-modal.tsx TypeScript error (score: number | undefined → score ?? null)
- Fixed SubjectPerformanceInput interface (added missing student_id field)
- Updated Excel export in handleExportSummaries with 14 new analytics columns
- Added calculatePercentile import to teacher-dashboard for Excel ranking
- Created 81 unit tests in analytics-engine.test.ts covering all calculation functions
- Created comprehensive analytics documentation in docs/ANALYTICS_ENGINE.md
- Added HistoricalSnapshot and HistoricalTrend interfaces for future-ready architecture
- Excluded test directory from TypeScript compilation in tsconfig.json
- All TypeScript checks pass, ESLint passes, dev server returns 200, 81/81 tests pass

Stage Summary:
- **FIXED**: Legacy 40/30/30 calculations removed from both dashboards
- **FIXED**: All hardcoded constants moved to analytics-config.ts
- **FIXED**: Duplicated subject-level logic extracted to computeSubjectPerformance()
- **FIXED**: Excel export now includes all 14 new analytics metrics
- **FIXED**: TypeScript errors resolved (score type, missing student_id)
- **CREATED**: analytics-config.ts (centralized configuration)
- **CREATED**: analytics-types.ts (strongly typed models)
- **CREATED**: computeSubjectPerformance() (reusable subject analytics)
- **CREATED**: computeCohortAnalytics() (cohort distribution engine)
- **CREATED**: 81 unit tests (analytics-engine.test.ts)
- **CREATED**: Analytics documentation (docs/ANALYTICS_ENGINE.md)
- **VALIDATED**: Historical analytics architecture is future-ready
- **VALIDATED**: CSV export already includes all metrics (from previous implementation)
- **VALIDATED**: TypeScript, ESLint, dev server all pass cleanly

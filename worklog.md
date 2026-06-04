---
Task ID: 1
Agent: Dashboard Improver
Task: Fix detailed analysis button, improve Performance Overview UX/UI, enhance chart, add Top Students section

Work Log:
- Fixed "تحليل تفصيلي" button: Changed `setActiveSection('tracking')` to `handleSectionChange('tracking')` for proper store sync
- Removed `performanceViewMode` state and cards/charts toggle - now always shows compact stat bar + charts
- Replaced 4 large KPI cards with compact horizontal stat bar (chips with icon + value + label)
- Enhanced multi-metric area chart: Added efficiency (teal #14b8a6, dashed) and discipline (violet #8b5cf6, dashed) as reference lines
- Updated monthlyTrendData to include efficiency and discipline averages
- Added Top Students by Points section to dashboard (top 5 with rank badges, expandable details)
- Added translation key `topStudentsByPoints` to ar.ts/en.ts and ar.json/en.json

Stage Summary:
- Button fix ensures store sync when navigating to tracking section
- Performance Overview now has compact stat bar + 4-metric chart + pie chart
- Top 5 students shown on dashboard with expandable details (attendance, efficiency, discipline, risk)

---
Task ID: 2
Agent: Tracking Section Improver
Task: Make top students clickable, redesign course rankings, enhance student list title

Work Log:
- Made "أفضل الطلاب" and "أقل الطلاب أداءً" cards clickable with expandable detail panels
- Detail panels show: avatar, email, 4-metric breakdown (exams, attendance, compliance, quality), efficiency, discipline, growth, risk reasons
- Redesigned per-course rankings as leaderboard with medals (🥇🥈🥉), sort dropdown, show all/less toggle
- Updated perCourseRankings useMemo to return ALL students per course (not just top/bottom 3)
- Enhanced "قائمة الطلاب" title to show: filtered count / total, sort method, active filters
- Added translation keys: trackingStudentListFull, trackingSortedBy, trackingFilteredBy, trackingOfTotal, trackingShowAll, trackingTop3, trackingRankingBy
- Removed duplicate CourseRankingCard definition (kept only the redesigned leaderboard version)

Stage Summary:
- Top/bottom students now expandable with rich detail panels
- Course rankings redesigned as leaderboard with sort, medals, show all toggle
- Student list title shows context (count, sort, filters)
- All lint checks pass, server compiles and runs successfully

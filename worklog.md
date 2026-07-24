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

---
Task ID: 3
Agent: UI Redesign Agent
Task: Redesign per-course rankings overview to be compact, handle many courses without excessive vertical scrolling

Work Log:
- Replaced the overview tab grid (grid-cols-1/2/3 with tall mini-cards) with a compact horizontal strip layout
- On mobile: horizontal scrollable flex container with 200px-wide compact cards
- On desktop (lg+): switches to grid layout (2 cols on lg, 3 cols on xl) for space efficiency
- Each card is now ~50px tall (2 rows: course name + avg, meta line with student count / at-risk / top student)
- Added color-coded average performance (green ≥75%, amber ≥50%, rose <50%)
- Reduced icon size from h-7 w-7 to h-6 w-6, padding from p-3 to px-3 py-2
- Meta line uses dot separators, compact abbreviations ("stu" instead of "students")
- Added hover border highlight on cards for better interactivity
- Wrapped CourseRankingCard in max-h-[400px] overflow-y-auto container when a specific course is selected
- Lint passes cleanly

Stage Summary:
- Overview tab now uses compact horizontal strip (mobile) / grid (desktop) instead of tall vertical cards
- Each course card is ~50px tall, showing name, avg%, student count, at-risk badge, top student
- Specific course tab capped at 400px height with scroll to prevent excessive vertical space
- Same violet theme, Arabic/English bilingual support preserved

---
Task ID: 4
Agent: Height Fix Agent
Task: Fix Activity Log height to match Performance Overview height in teacher dashboard

Work Log:
- Changed Performance Overview `motion.div` from `className="lg:col-span-2"` to `className="lg:col-span-2 flex"` so it becomes a flex container that stretches to fill its grid cell
- Changed Performance Overview inner card div from `h-full` to `flex-1` for reliable height matching within the flex parent
- Changed Activity Log `motion.div` from no class to `className="flex"` so it also stretches as a flex container
- Changed Activity Log inner card div from `h-full flex flex-col` to `flex-1 flex flex-col` for consistent flex-based stretching
- Enhanced Activity Log empty state from `py-12 text-center` to `flex-1 flex flex-col items-center justify-center py-12` so it fills available space when no activities exist
- Verified no redundant/duplicate sections exist in the dashboard render function (renderDashboard is clean: header + stats row + performance/activity grid)
- All lint checks pass

Stage Summary:
- Both grid items now use `flex` on motion.div + `flex-1` on inner card for reliable height matching
- Activity Log card stretches to match Performance Overview height regardless of content amount
- Empty state in Activity Log also fills available vertical space
- No duplicate sections found in dashboard render function

---
Task ID: 5
Agent: Trend Analysis Agent
Task: Add student performance trend analysis feature showing changes over time periods

Work Log:
- Added `TrendDirection` type and `StudentTrendData` interface for trend data modeling
- Added `trendPeriod` state variable (`monthly` | `quarterly` | `semester`) with default `monthly`
- Implemented `trendAnalysisData` useMemo that groups scores by period (month/quarter/semester), computes average per period, compares latest two periods, and determines trend direction (improved if change > +2%, declined if change < -2%, otherwise stable)
- Implemented `trendSummary` useMemo counting improved/declined/stable students
- Added `BarChart` and `Bar` imports from recharts for mini sparkline charts
- Added `Minus` icon import from lucide-react for stable trend indicator
- Built Trend Analysis UI section between per-course rankings and student list:
  - Period selector (Monthly/Quarterly/Semester) with pill-style toggle buttons
  - Summary stats bar showing counts of improved, declined, and stable students with colored badges
  - Column headers (Student, Previous, Current, Change, Trend)
  - Scrollable student list (max-h-[400px]) with:
    - Student avatar + name
    - Previous and current period scores
    - Change indicator with colored arrow icon (↑ green, ↓ red, → gray)
    - Mini bar chart showing score trend across periods (last 6)
  - Empty state with message when not enough data
- Added 14 translation keys (trendAnalysis, trendMonthly, trendQuarterly, trendSemester, trendImproved, trendDeclined, trendStable, trendPrevious, trendCurrent, trendChange, trendNoData, trendStudentsImproved, trendStudentsDeclined, trendStudentsStable) to ar.ts, en.ts, ar.json, en.json
- Trend list sorted: declined first (need attention), then improved, then stable; within each group sorted by magnitude of change
- All lint checks pass, server compiles successfully

Stage Summary:
- Trend Analysis section shows period-over-period student performance comparison
- Users can switch between monthly, quarterly, and semester views
- Visual indicators (colored arrows + mini bar charts) make trends immediately visible
- Summary bar provides quick overview of how many students improved/declined/stayed stable
- Consistent violet theme matching the rest of the tracking section
- Full Arabic/English bilingual support
---
Task ID: 3
Agent: Main Agent
Task: Complete redesign of Teacher Tracking & Analytics Section with 5-tab architecture

Work Log:
- Added new recharts imports: RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis, LineChart, Line, Legend
- Added new lucide-react imports: LayoutDashboard, GraduationCap, AlertOctagon, BarChartHorizontal, ChevronLeft
- Added new state: activeTrackingTab (overview/courses/students/attendance/risk), courseDrillDown
- Added new computed data: courseComparisonData, attendanceDistributionData, attendanceTrendData, riskDistributionData, suddenDropStudents, improvementStreakStudents, volatileStudents, engagementData, performanceDistributionData
- Restructured render into 5 tabs:
  - Tab 1 (Overview): KPI cards, performance trend AreaChart, level distribution PieChart, performance distribution BarChart, Top 5/Bottom 5 students, at-risk alert banner
  - Tab 2 (Courses): Course comparison horizontal BarChart, course difficulty index, clickable course cards grid with drill-down to CourseRankingCard
  - Tab 3 (Students): Existing classification/filter/search/student list sections
  - Tab 4 (Attendance): Attendance trend stacked BarChart, attendance distribution PieChart, engagement scores list
  - Tab 5 (Risk): Risk distribution PieChart, trend summary, at-risk students list, sudden drop/improvement streak/volatile detection cards, trend analysis with sparklines
- Removed old per-course rankings and trend analysis from students tab (now in their dedicated tabs)
- Fixed TypeScript type: StudentTrendData.studentAvatar changed to string | null | undefined

Stage Summary:
- Teacher tracking section now has professional 5-tab analytics dashboard
- 80% chart-based data visualization as requested
- Role-aware data separation maintained
- All existing calculation logic preserved exactly
- Scalable with pagination and scroll containers
- Dark/light mode compatible with bilingual support

---
Task ID: 6
Agent: Main Agent
Task: Redesign Admin Tracking Section with system-wide analytics + Add translation keys for all new sections

Work Log:
- Complete rewrite of `/src/components/admin/admin-performance-tracking-section.tsx` from 611 lines to 900+ lines
- Changed from simple 3-tab (students/teachers/courses) layout to 5-tab analytics architecture:
  - Tab 1 (Overview Dashboard): 6 KPI cards, performance trend AreaChart, level distribution PieChart, performance distribution BarChart, Top 5/Bottom 5 students, System Health metrics (avg attendance, discipline, efficiency, excellence rate)
  - Tab 2 (Courses Analytics): Horizontal course comparison BarChart (performance + attendance), difficulty index, clickable course cards grid with drill-down to student rankings per course
  - Tab 3 (Students Analytics): Sub-tab for students/teachers lists, search, progress bars, risk badges, attendance/compliance details
  - Tab 4 (Attendance & Engagement): Attendance distribution PieChart, attendance trend stacked BarChart, engagement scores list (top 20 students ranked by engagement)
  - Tab 5 (Risk & Insights): Risk distribution PieChart, trend summary cards (improved/stable/declined), at-risk students quick list, sudden drop detection (≥10% decline), improvement streak detection (3+ consecutive periods up), most improved students insight
- Added `computeCohortAnalytics` import for system-wide aggregated statistics
- Added new chart types: AreaChart, PieChart, BarChart with stacked, horizontal, and color-coded variants
- Added drill-down navigation pattern: course list → click course → see ranked students
- Used `renderCustomizedLabel` for pie chart percentage labels
- Added 58 new translation keys to all 4 files (ar.ts, en.ts, ar.json, en.json) under `admin.adminTracking*` namespace
- Preserved all existing business logic and calculation functions (no changes to performance-calculator.ts)
- Lint passes cleanly, dev server runs without errors

Stage Summary:
- Admin tracking section redesigned as world-class data intelligence dashboard with 5 tabs
- 80% charts (area, pie, bar, stacked) / 20% indicators and progress bars
- System-wide analytics using computeCohortAnalytics for O(n) scalability
- Intelligent insights: sudden drop, improvement streak, most improved, engagement scores
- Drill-down course analytics with student rankings
- Full Arabic/English bilingual support with 58 new translation keys

---
Task ID: 3-5
Agent: Bug Fix Agent
Task: Fix three critical bugs: institution settings not saving during setup, timezone not persisting, first account superadmin promotion unreliable

Work Log:
- Bug 1: Added auth token to handleSaveInstitution in setup-wizard.tsx
  - The wizard's Step 2 (institution save) was missing the Authorization header
  - By this point the admin account was already created in Step 1, so users table was non-empty
  - The /api/setup route requires superadmin auth when users exist, causing 401/403
  - Added `supabase.auth.getSession()` + conditional `Authorization: Bearer` header, matching institution-section.tsx pattern
- Bug 2: Added timezone column support throughout the setup API pipeline
  - Added `timezone` to POST handler destructured fields in route.ts
  - Added `timezone` to RPC call parameters (`p_timezone`)
  - Added `timezone` to direct update object and direct insert object
  - Updated getMigrationSQL() table DDL to include `timezone TEXT` column
  - Updated setup_initialize_system() RPC function to accept `p_timezone` parameter
  - Updated RPC function body: UPDATE and INSERT statements include timezone column
  - Also updated the inline migration SQL in setup-wizard.tsx renderMigrationStep() to match
- Bug 3: Replaced fragile 1.5s timeout with robust retry loop for superadmin promotion
  - Replaced single `setTimeout(1500)` with retry loop (5 attempts, 1s intervals)
  - Each retry checks if user profile exists in `users` table before proceeding
  - If profile not found after all retries, shows error and aborts (instead of silently continuing)
  - After calling check-first-user API, now verifies the response: checks `success` and `promoted` fields
  - If promotion fails, logs error and shows toast error instead of silently continuing
  - Catches network errors from check-first-user and shows error instead of ignoring

Stage Summary:
- Institution settings now save correctly during first-time setup (auth token included)
- Timezone is now persisted when saving institution data from the dashboard
- First account superadmin promotion is reliable with retry logic and error handling
- All lint checks pass

---
Task ID: 6
Agent: Notification Store Refactor Agent
Task: R1 - Extract notification store merge logic into pure functions (Reliability P2)

Work Log:
- Added `mergeNotifications()` pure function before store creation (lines 293-327) that:
  - Builds a Set of DB notification IDs for O(1) lookup
  - Filters local-only notifications (id starts with 'notif-') that don't have a DB ID match
  - Suppresses local-only notifications that match a DB notification by content (title+type+message)
  - Deduplicates DB notifications within the batch (defensive)
  - Merges unique DB + surviving local, sorts by createdAt descending, caps at 100
- Added `computeUnreadCount()` pure function (lines 329-334) that counts unread notifications
- Replaced inline merge logic in `refetchNotifications` set() callback (was ~30 lines) with 3-line call to pure functions
- All lint checks pass cleanly

Stage Summary:
- Merge logic extracted into two pure, independently testable functions
- `refetchNotifications` set() callback simplified from ~30 lines to 3 lines
- Single source of truth for merge logic reduces surface area for unreadCount mismatches
- No behavioral changes — logic is identical, just restructured for testability

---
Task ID: 1
Agent: full-stack-developer
Task: Fix setup wizard and superadmin creation

Work Log:
- Rewrote /api/auth/check-first-user/route.ts: Made app_metadata the PRIMARY mechanism for superadmin role, removed broken supabaseServer.rpc('exec_sql') calls, added robust error handling, override profile role from app_metadata when DB CHECK constraint blocks 'superadmin'
- Updated /api/auth/me/route.ts: Added applySuperadminOverride() function that checks if app_metadata.role='superadmin' but DB profile has different role, tries to UPDATE DB profile to 'superadmin', falls back to overriding returned role from app_metadata, removed broken supabaseServer.rpc('exec_sql') call
- Updated /lib/auth-helpers.ts: requireSuperAdmin() and requireAdmin() now also check app_metadata.role as fallback when DB role is not 'superadmin', handles CHECK constraint issue gracefully
- Updated /components/setup/setup-wizard.tsx: Made all fetch calls robust (check response.ok, content-type includes 'json', wrap .json() in try/catch) for /api/auth/me, /api/auth/check-first-user, and /api/setup endpoints
- Updated /stores/auth-store.ts: Added overrideSuperadminFromAppMetadata() helper function, applied it in 3 places where /api/auth/me profile is fetched (initialize, onAuthStateChange, signInWithEmail) to ensure superadmin role from app_metadata takes precedence when DB CHECK constraint blocks 'superadmin'

Stage Summary:
- Bug 1 (JSON parse error): All fetch calls in setup-wizard now check content-type and wrap .json() in try/catch, preventing "Unexpected token '<'" errors
- Bug 2 (first user as student): app_metadata is now the PRIMARY mechanism for superadmin — supabaseServer.auth.admin.updateUserById() ALWAYS works; DB role is secondary and gets overridden from app_metadata when CHECK constraint blocks 'superadmin'
- Feature change (remove institution step): Setup wizard already only has db-migration, admin-account, and complete steps; institution info already only editable from admin settings

---
Task ID: 1
Agent: Main Agent
Task: Radical surgical fix for first user being created as student instead of superadmin

Work Log:
- Diagnosed root cause: DB CHECK constraint `users_role_check` missing 'superadmin' + trigger `handle_new_user()` swallowing ALL exceptions with `EXCEPTION WHEN OTHERS`
- When trigger tried INSERT with role='superadmin', CHECK constraint blocked it, EXCEPTION caught it silently, and NO profile row was created
- The `check-first-user` API relied on `system_initialized` table which had stale data from previous failed attempts
- Contradictory toast messages came from partial success in the flow

- FIXED: `supabase/schema.sql` - Rewrote `handle_new_user()` trigger to:
  - Handle `check_violation` specifically (fall back to 'admin' for first user)
  - Handle `unique_violation` specifically (duplicate key race condition)
  - NEVER swallow all exceptions silently - always create a profile row
  
- FIXED: `supabase/migrations/add_superadmin_role.sql` - Same trigger improvements

- FIXED: `src/app/api/auth/check-first-user/route.ts` - Complete rewrite:
  - Removed reliance on `system_initialized` table (can have stale data)
  - Now checks if ANY superadmin exists in DB as primary indicator
  - Also checks `app_metadata.role` as fallback
  - Simplified and more robust flow

- FIXED: `src/components/setup/setup-wizard.tsx`:
  - Rewrote `handleCreateAdmin` flow: wait for trigger → call check-first-user → verify superadmin → fallback to auth/me → force override from app_metadata
  - Removed contradictory toast messages (now only ONE toast)
  - Updated migration SQL with improved trigger and first-user promotion step

- FIXED: `src/app/api/auth/me/route.ts`:
  - Updated first-user detection to check superadmin count + total users
  - Respects app_metadata.role='superadmin' as source of truth
  - Never downgrades app_metadata from 'superadmin'

Stage Summary:
- All 5 files modified with radical fix
- Lint passes clean (no errors)
- Dev server running on port 3000, API routes returning proper JSON
- Browser verification shows app renders correctly (Supabase env vars not in sandbox, expected)
- The fix ensures: trigger ALWAYS creates profile row, check-first-user ignores stale system_initialized, app_metadata is source of truth for superadmin

---
Task ID: 1
Agent: Fix Agent
Task: Fix JOIN queries and missing translations

Work Log:
- Fixed subjects-section.tsx: Replaced `subject_students.select('id, subject_id, status, subjects(*)')` with two separate queries (enrollment data + subjects by ID), combined manually using Map lookup
- Fixed subjects-section.tsx teacher branch: Replaced `subject_teachers.select('subject_id, role, subjects(*)')` with two separate queries, combined manually
- Fixed todo-section.tsx: Replaced `user_todos.select('*, subjects(name)')` with two separate queries (todos + subjects by ID), combined using subjectNameLookup
- Fixed calendar-section.tsx: Replaced `user_todos.select('*, subjects(name)')` with two separate queries (todos + subjects by ID), combined using todoSubjectNameMap
- Added missing translations to ar.json and en.json:
  - student section: trackingCurrentStatus, trackingLevelWeak, trackingLevelFair, trackingLevelGood, trackingLevelExcellent
  - settings.status section: online, busy, away, invisible, offline
- Lint passes cleanly with no errors

Stage Summary:
- All 4 PostgREST JOIN queries (PGRST200) replaced with two-query pattern across 3 files
- Both student and teacher branches in subjects-section.tsx fixed
- 10 translation keys added (5 in student section, 5 in settings.status section) to both ar.json and en.json
- No behavioral changes — same state updates, cache updates, and rendering logic preserved

---
Task ID: 2
Agent: Main Agent
Task: Fix all console errors and app reload on files section

Work Log:
- Fixed subject_students↔subjects JOIN (PGRST200): replaced with two separate queries in subjects-section.tsx
- Fixed user_todos↔subjects JOIN: replaced with two separate queries in todo-section.tsx and calendar-section.tsx
- Added missing translations: student.trackingCurrentStatus, trackingLevelWeak/Fair/Good/Excellent in ar.json and en.json
- Added missing translations: settings.status.online/busy/away/invisible/offline in ar.json and en.json
- Added SectionErrorBoundary around ALL sections in student-dashboard.tsx (prevents root error.tsx auto-reload)
- Added SectionErrorBoundary around ALL sections in teacher-dashboard.tsx
- Root cause of app reload: SectionErrorBoundary was missing → errors propagated to root error.tsx which auto-calls reset() after 3s

Stage Summary:
- All JOIN queries replaced with safe two-query approach (avoids PGRST200)
- All missing translations added
- SectionErrorBoundary wraps every section in both dashboards → no more app reloads from section errors
- Lint passes clean, dev server running

---
Task ID: SCORM-SUPPORT
Agent: SCORM Schema & Types Developer
Task: Create database schema and TypeScript types for SCORM support (v60 migration, types, schema.sql update)

Work Log:
- Created migration file `/home/z/my-project/supabase/migrations/v60_scorm_support.sql` with 3 tables:
  - `scorm_packages`: stores uploaded SCORM package metadata (id, title, description, version, manifest_xml, uploaded_by, subject_id, status, entry_point, total_objects, package_size, storage_path, created_at, updated_at)
  - `scorm_resources`: stores individual SCORM resources/SCO items parsed from manifest (id, package_id, identifier, title, type, href, scorm_type, parent_identifier, order_index, launch_url)
  - `scorm_tracking`: stores student progress data (id, student_id, package_id, resource_id, completion_status, success_status, score_raw/min/max/scaled, total_time, session_time, suspend_data, launch_count, last_accessed, created_at, updated_at) with UNIQUE(student_id, resource_id)
- Added RLS policies for each table using existing helper functions `get_teacher_subject_ids()`, `get_student_subject_ids()`, `is_admin()`:
  - Teachers/admins can CRUD packages and resources for their subjects
  - Students can read packages and resources for enrolled subjects
  - Students can insert/update their own tracking data
  - Teachers/admins can read all tracking data for their subjects
- Added triggers for auto-update `updated_at` on scorm_packages and scorm_tracking
- Added Realtime publication entries for all 3 tables
- Used `gen_random_uuid()` for UUID defaults and `now()` for timestamp defaults (per instructions)
- Created TypeScript types at `/home/z/my-project/src/lib/scorm-types.ts` matching the database schema, including:
  - ScormPackage, ScormResource, ScormTracking interfaces
  - Type enums: ScormVersion, ScormPackageStatus, ScormResourceType, ScormCompletionStatus, ScormSuccessStatus
  - Supporting types: ScormLaunchData, ScormCmiData, ScormTrackingUpsertRequest, ScormPackageUploadRequest, ScormTrackingSummary, ScormStudentProgress
- Updated `/home/z/my-project/supabase/schema.sql` to append SCORM tables at the end (lines 345-567)
- Ran `bun run lint` — passes clean with no issues

Stage Summary:
- SCORM database schema complete with 3 tables, proper indexes, CHECK constraints, RLS policies, triggers, and Realtime support
- TypeScript types fully match the database schema with comprehensive API-ready types
- Both migration file and schema.sql updated consistently
- Lint passes clean

---
Task ID: SCORM-API-ROUTES
Agent: SCORM API Routes Developer
Task: Create SCORM upload, tracking, launch, and list API routes

Work Log:
- Created `/home/z/my-project/src/app/api/scorm/upload/route.ts` — SCORM Package Upload API:
  - Accepts multipart FormData with `file` (.zip) and `subjectId` (UUID)
  - Requires teacher/admin authentication via `requireTeacher`
  - Validates file is .zip and size < 50MB
  - Extracts ZIP in memory using JSZip (already installed as v3.10.1)
  - Finds and parses `imsmanifest.xml` from ZIP (handles nested folder manifests)
  - Determines SCORM version (1.2 or 2004) from manifest namespace patterns
  - Extracts entry point, organization items, and resources via regex/string parsing
  - Uploads extracted content files to Supabase Storage bucket `scorm-packages` at `{subjectId}/{packageId}/`
  - Saves package metadata to `scorm_packages` table
  - Saves individual resources/SCOs to `scorm_resources` table
  - Returns package ID, parsed structure, and upload status
  - Includes proper content-type mapping for all common web file types
  - Handles cleanup on failure (removes uploaded storage files if DB insert fails)

- Created `/home/z/my-project/src/app/api/scorm/track/route.ts` — SCORM Tracking API:
  - POST handler: Upserts tracking data for a student
    - Accepts: `{ studentId, packageId, resourceId, completionStatus, successStatus, scoreRaw, scoreMin, scoreMax, scoreScaled, sessionTime, suspendData }`
    - Uses `authenticateRequest` for auth (any authenticated user)
    - Verifies `studentId === authUser.id` (students can only update their own tracking)
    - Validates completion_status and success_status values against CHECK constraints
    - Upserts to `scorm_tracking` table with onConflict: `student_id,resource_id`
  - GET handler: Fetches tracking data
    - Teachers/admins: can get tracking for any student (packageId required, studentId optional)
    - Students: can only get their own tracking (packageId + resourceId required)
    - Enriches data with student names, emails, avatars, and resource titles

- Created `/home/z/my-project/src/app/api/scorm/launch/route.ts` — SCORM Launch API:
  - GET handler: Returns launch data for a SCORM resource
    - Accepts query params: `packageId` and `resourceId`
    - Requires authentication via `authenticateRequest`
    - Verifies student enrollment in the subject (checks `subject_students` table)
    - Creates initial tracking record if none exists (completion_status: 'not_attempted')
    - Updates `last_accessed` and increments `launch_count` on each launch
    - Builds CMI data model for SCORM 1.2 (cmi.core.*) or SCORM 2004 (cmi.*) fields
    - Returns: `{ launchUrl, packageVersion, packageTitle, resourceTitle, resourceType, trackingData, cmiData }`

- Created `/home/z/my-project/src/app/api/scorm/list/route.ts` — SCORM List API:
  - GET handler: Returns all SCORM packages for a subject
    - Accepts query param: `subjectId`
    - Requires authentication via `authenticateRequest`
    - Fetches packages with all metadata fields
    - Fetches associated resources organized by `order_index`
    - Fetches uploader names from users table
    - Organizes resources into tree structure based on `parent_identifier`
    - Returns enriched packages with nested resource hierarchy and uploader names

- Verified jszip was already installed (v3.10.1 in package.json) — no installation needed
- Ran `bun run lint` — passes clean with no issues

Stage Summary:
- 4 SCORM API routes created covering the full lifecycle: upload → list → launch → track
- All routes follow existing project patterns (auth-helpers, supabaseServer, error handling)
- Regex/string-based XML parsing avoids adding new dependencies
- Proper auth enforcement: teacher/admin for upload, any user for tracking/launch/list
- Enrollment verification for student access
- CMI data model supports both SCORM 1.2 and 2004 standards
- Resource tree organization for hierarchical SCORM content
- Lint passes clean

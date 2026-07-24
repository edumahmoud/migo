---
Task ID: 1-7
Agent: main-agent
Task: Add complete SCORM standard support to the platform (import + export + player + tracking)

Work Log:
- Created SCORM Export API route at `/api/scorm/export/route.ts`
  - Supports 3 content types: quiz, lesson, subject (full course)
  - Generates SCORM 1.2 and 2004 compatible ZIP packages
  - Includes imsmanifest.xml generation, HTML content pages, SCORM API wrapper JS, XSD files
  - Quiz export: generates interactive quiz HTML with SCORM API calls for scoring
  - Lesson export: generates lesson content HTML with completion tracking
  - Subject export: bundles all published lessons + quizzes into one package
- Created SCORM Package Management API at `/api/scorm/packages/route.ts`
  - GET: single package details with tracking summary
  - DELETE: delete package with storage cleanup + tracking data cleanup
  - PATCH: update package metadata (title, description, status)
- Created SCORM Player component at `/src/components/course/tabs/scorm-player.tsx`
  - Full iframe-based SCORM content renderer
  - SCORM 1.2 API adapter (window.API) with LMSInitialize, LMSGetValue, LMSSetValue, LMSCommit, LMSFinish
  - SCORM 2004 API adapter (window.API_1484_11) with Initialize, GetValue, SetValue, Commit, Terminate
  - Injects API into iframe contentWindow and parent window (fallback for cross-origin)
  - Tracking callback relays SCO data to /api/scorm/track endpoint
  - Session time tracking on close
  - Fullscreen toggle support
  - Header bar with package title, version, close/fullscreen buttons
- Created SCORM Tab component at `/src/components/course/tabs/scorm-tab.tsx`
  - Teacher view: Upload SCORM packages, Export as SCORM, Delete packages, Preview content
  - Student view: List packages, Launch content, View progress tracking
  - Export modal with content type selection (quiz/lesson/subject) and version selection (1.2/2004)
  - Package cards with expand/collapse, resource list, status badges, launch buttons
  - Delete confirmation flow
  - Tracking data integration for student progress display
- Updated CourseTab type in types.ts to include 'scorm'
- Updated course-page.tsx:
  - Added lazy import for ScormTab
  - Added Package icon import
  - Added 'scorm' tab to TABS array with labelKey 'course.tabScorm'
  - Added ScormTab rendering in renderTabContent
- Added complete SCORM translations to ar.json (48 keys) and en.json (48 keys)
  - Includes: upload, export, player, tracking, status labels, modal labels

Stage Summary:
- SCORM Import: ✅ Already existed (upload route)
- SCORM Export: ✅ NEW - Full quiz/lesson/subject export as SCORM 1.2/2004 ZIP
- SCORM Player: ✅ NEW - iframe + API adapter for both SCORM 1.2 and 2004
- SCORM Tab: ✅ NEW - Full teacher/student management UI
- SCORM Management API: ✅ NEW - GET/PATCH/DELETE package operations
- SCORM Tracking: ✅ Already existed (track route), now connected to player
- Translations: ✅ 48 keys in both Arabic and English
- Lint: ✅ Clean, no errors

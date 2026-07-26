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

---
Task ID: 2
Agent: main-agent
Task: Add SCORM question bank export with bank selection + platform-level SCORM import

Work Log:
- Updated SCORM Export API route `/api/scorm/export/route.ts`
  - Added `contentType: 'questionBank'` support
  - Added `bankIds` and `questionIds` parameters for selective export
  - Created `exportQuestionBankAsScorm()` function that:
    - Fetches question banks from Supabase (filtered by bankIds/questionIds)
    - Groups questions by bank
    - Generates interactive quiz HTML for each bank with SCORM API integration
    - Supports MCQ, boolean, completion, and matching question types
    - Calculates scores and reports to SCORM 1.2/2004 API
    - Includes question navigation, progress bar, and results review
  - Updated `generateManifest()` to support `hrefOverride` for quiz resources
  - Fixed XSD string syntax (single quotes instead of mixed backtick+single quotes)

- Created Platform-Level SCORM Import API route `/api/scorm/platform-import/route.ts`
  - Accepts FormData with: file (ZIP), name (subject name), description, version
  - Parses ZIP with JSZip, reads imsmanifest.xml
  - Regex-based manifest parsing for items and resources
  - Creates new subject (course) on the platform
  - Creates draft lessons from manifest items
  - Uploads ZIP to Supabase Storage (scorm-packages bucket)
  - Creates scorm_packages and scorm_resources records
  - Error handling with cleanup (subject deletion, storage removal on failures)
  - maxDuration = 120 for large file processing

- Updated scorm-tab.tsx component
  - Export modal now shows 3 content type options: Lessons, Full Course, Question Banks
  - Question bank export shows bank selection with checkboxes
  - Select All / Deselect All buttons for bank selection
  - Question count displayed per bank
  - Added "Import Course from SCORM" button (amber/orange color)
  - Added platform import modal with:
    - Course name input (required)
    - Course description textarea
    - File upload with .zip validation
    - Import & Create Course button
  - Cleaned up unused imports (FileCheck, MoreHorizontal, Settings, Edit, SectionErrorBoundary, CourseTab)

- Updated i18n messages
  - ar.json: 15+ new keys (selectBanks, selectAll, deselectAll, loadingBanks, noBanks, questions, banks, selectedCount, selectBankError, platformImportTitle, platformImportDesc, platformImportName, platformImportDescription, platformImportButton, platformImporting, platformImportSuccess, platformImportError)
  - en.json: Same 15+ keys in English
  - Changed "exportQuiz" from "الاختبارات"/"Quizzes" to "بنوك الأسئلة"/"Question Banks"
  - Updated "quizJsonNote" to mention SCORM export option for question banks

Stage Summary:
- SCORM Question Bank Export: ✅ NEW - Interactive quiz HTML with SCORM API tracking, bank/question selection
- Platform-Level SCORM Import: ✅ NEW - Create new course from external SCORM package
- SCORM Tab UI: ✅ Updated - 3 export options + bank selection + platform import modal
- i18n: ✅ 15+ new keys in both Arabic and English
- Lint: ✅ Clean, no errors
- Dev server: ✅ Running on port 3000
- Git: ✅ Committed locally (push failed due to no GitHub auth token)
---
Task ID: 1
Agent: main
Task: Fix Google Forms OAuth flow — popup+polling, URL param detection, configured status handling

Work Log:
- Identified that the original implementation used `window.open` (popup) for Google OAuth, but the main window never detected when authorization completed in the popup
- Found no URL parameter detection for `google_auth_success=true` / `google_auth_error=...` on the client side
- Found `GoogleAuthStatus` type missing `configured` field returned by the auth check API
- Updated `useGoogleForms.ts`: changed to popup+polling approach (polls auth status every 3s while popup open), falls back to same-tab redirect if popup blocked, added `authJustCompleted` flag, added URL param detection
- Updated `export-google-form-modal.tsx`: added `authJustCompleted` toast notification, added `configured: false` detection to show proper config warning instead of broken authorize button
- Updated `question-bank-section.tsx`: added useEffect to detect OAuth callback URL params, auto-open modal + show toast on auth success/error
- Updated `GoogleAuthStatus` type: added optional `configured` field
- Added i18n keys: `googleFormsAuthSuccess` and `googleFormsAuthError` in both ar.json and en.json
- Lint passed, pushed to GitHub

Stage Summary:
- Google Forms OAuth flow now works via popup+polling (checks auth every 3s) and URL param detection (for same-tab fallback)
- When auth completes, modal auto-transitions from auth-check stage to config stage with success toast
- When Google OAuth env vars are not configured, shows proper warning instead of broken button
- Changes pushed to GitHub (commit 2efbd34), will deploy on Vercel

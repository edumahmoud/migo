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

---
Task ID: 3
Agent: main
Task: Fix matching question export issue, add question type filtering, bold question titles

Work Log:
- Updated `src/types/googleForms.ts`:
  - Changed matching type mapping from unsupported → supported (choiceQuestion/DROP_DOWN)
  - Added `enabledQuestionTypes` field to `ExportGoogleFormConfig` for type filtering
  - Added `ALL_QUESTION_TYPES` constant array
  - Added `ExportedQuestionDetail` interface for success view
  - Added `exportedQuestions` field to `ExportGoogleFormResult`
  - Updated matching reason: "Each matching pair is converted to a dropdown question..."
- Rewrote `src/lib/google/forms.ts`:
  - Added `buildBoldTitle()` function: prepends ★ to question titles for visual emphasis
  - Added `buildMatchingPairItems()` function: expands each matching pair into a DROP_DOWN question
    - Title: ★ [Parent Title] — [Left Side]
    - Options: All right sides from all pairs (dropdown choices)
    - Correct answer: The matching right side (for quiz grading)
  - Added `buildAllQuestionItems()` function: handles both regular and matching questions with proper index tracking
  - Updated `buildGradingUpdateRequests()`: now uses `matchingOffsetMap` to properly calculate item indices when matching questions are expanded into multiple items
  - Updated `createNewGoogleForm()` and `appendToExistingGoogleForm()`: pass `enabledQuestionTypes` to `mapQuestionsToGoogleForm()`, use `buildAllQuestionItems()`, return `exportedQuestions` and accurate `questionsExported` count
  - Updated `mapQuestionsToGoogleForm()`: accepts optional `enabledTypes` parameter for type filtering
- Rewrote `src/components/question-bank/export-google-form-modal.tsx`:
  - Added question type selection section with checkboxes for MCQ, Boolean, Completion, Matching
  - Each type shows: label, count badge, Google Forms mapping (e.g., "→ RADIO", "→ DROP_DOWN (pairs expanded)")
  - Matching type shows special note: "Each pair becomes a dropdown question"
  - Added `enabledQuestionTypes` state (default: all types enabled)
  - Added `filteredQuestionCount` calculation (shows N/M selected)
  - Export button disabled when no types selected
  - Success stage now shows exported questions list with bold titles (`font-bold`)
  - Success stage shows question type → Google Forms type mapping
  - Added `ListFilter` icon import
  - Added `Badge` component import
- Updated `src/components/teacher/question-bank-section.tsx`:
  - Added `questionTypeCounts` prop to ExportGoogleFormModal
  - Computed from `selectedBank?.questions` using reduce
- Added i18n translations:
  - ar.json: googleFormsQuestionTypeFilter, googleFormsNoTypesSelected, googleFormsQuestionCountUnit, googleFormsMatchingConverted, googleFormsExportedQuestionsList, googleFormsUnsupportedWarningNew
  - en.json: Same 6 keys in English
- Lint: ✅ Clean, no errors
- Dev server: ✅ Running on port 3000 without errors

Stage Summary:
- Matching questions are now SUPPORTED for Google Forms export (expanded into dropdown questions)
- Each matching pair → one DROP_DOWN question with ★ bold title prefix
- Users can select/deselect question types before export (MCQ, Boolean, Completion, Matching)
- Question titles are displayed in bold (font-bold) in the success view
- Google Forms titles use ★ prefix for visual emphasis in the form
- Exported questions list shown in success stage with type mapping info
- All changes verified with lint ✅ and dev server ✅

---
Task ID: v73-otp-resilience-fix
Agent: main
Task: Fix: new student accounts skip OTP verification and go directly to the activation page despite v73 migration reportedly applied.

Diagnosis:
- The v73 migration updates `handle_new_user()` to set `account_status='pending_verification'` for self-registered students with a phone.
- But verify-otp / resend-otp APIs strictly checked `account_status === 'pending_verification'`. If the trigger set `'pending'` instead (partial v73 apply: ALTER TABLE ok but CHECK widening OR function body didn't take), the APIs rejected the OTP request and page.tsx routed to the activation page.
- The v73 EXCEPTION block also retried the INSERT with the SAME value that just failed (`new_account_status`), so a partial-apply made the trigger raise an unhandled exception — auth.users INSERT failed → signup broken.

Fix (multi-layered, resilient):
1. `supabase/migrations/v73_phone_otp_verification.sql`:
   - EXCEPTION block now falls back to `'pending'` (safe in old v68 CHECK) instead of retrying `'pending_verification'`.
   - Added `DROP TRIGGER + CREATE TRIGGER on_auth_user_created` to re-bind the trigger to the updated function (avoids OID caching issues).
2. `src/app/api/auth/verify-otp/route.ts` + `resend-otp/route.ts`:
   - Resilient OTP gate: accept `'pending_verification'` OR `('pending' + phone present + phone_verified=false)`. Works in both v73 and degraded paths.
3. `src/app/page.tsx`:
   - Routing logic now treats `pending + phone + !phone_verified` as needing OTP (renders OtpVerificationPage) — same resilient gate.
4. `src/components/auth/otp-verification-page.tsx`:
   - Polling now uses `phone_verified === true` as the success signal (not `account_status === 'pending'`) — works in both paths because `phone_verified` flips false → true on success regardless of the initial status.
5. NEW `src/app/api/auth/ensure-pending-verification/route.ts`:
   - Safety-net called by `signUpWithEmail` after a successful signup.
   - Uses service role to recover the phone from auth metadata and UPDATE the profile to `pending_verification` if the trigger left it in `pending`. Also sets `phone` if missing. No-op if the trigger already did the right thing.
   - Returns helpful error if the v73 ALTER TABLE didn't apply (phone column missing) — instructs operator to run /api/setup/check-otp-migration.
6. NEW `src/app/api/setup/check-otp-migration/route.ts`:
   - Diagnostic that probes the live DB and reports whether v73 was fully applied, partially applied, or not applied. Returns a verdict + copy-pasteable fix SQL.
7. NEW `supabase/migrations/reapply/reapply_v73_phone_otp_verification.sql`:
   - One-shot idempotent SQL to re-apply v73 cleanly in the Supabase SQL editor. Includes a backfill for users stuck in the degraded state.

Stage Summary:
- Root cause: most likely v73 was only partially applied (CHECK widening or function update didn't take). The trigger set `'pending'` and the frontend couldn't route to OTP.
- Fix: layered resilience. Even if v73 isn't fully applied, signups now: (a) auto-promote to `pending_verification` via the ensure endpoint, OR (b) get routed to the OTP page based on `phone + !phone_verified` columns alone.
- Operator action required: run `supabase/migrations/reapply/reapply_v73_phone_otp_verification.sql` in the Supabase SQL editor to bring the DB fully in sync. Then verify with `GET /api/setup/check-otp-migration`.

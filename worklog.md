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

---
Task ID: paymob-500-fix
Agent: main
Task: Fix recurring HTTP 500 error from Paymob when student clicks "Pay Now" — error message: "تعذّر تجهيز عملية الدفع (خطأ 500 من بوابة الدفع). لم يتم خصم أي مبلغ. تحقق من إعدادات البوابة وحاول مرة أخرى."

Diagnosis:
- Error originated in `src/lib/payment/providers/paymob/client.ts` — Paymob's Accept API returned HTTP 500 on one of the 3 steps (auth token / create order / payment key).
- The error message that reached the user was the safe Arabic fallback (`PAYMOB_API_REJECTED` category), but the actual Paymob response body (which explains WHY Paymob rejected) was thrown into the error's `cause` field and then stripped by `logPaymentEvent` — so we were flying blind.
- Two latent bugs found while auditing:
  1. The `items[]` array sent to `/api/ecommerce/orders` used `amount` (legacy field name) instead of `amount_cents`. Paymob Accept API docs strictly require `amount_cents`. This is the most likely root cause of the 500 (Paymob rejected the malformed items array).
  2. `billing_data.phone_number` was sent as plain Egyptian local format (e.g., '01012345678') with no country-code prefix. Paymob Accept API expects E.164 format. Some Paymob merchant accounts reject with 500 when phone is not E.164.
- `testConnection` only did a format check on the API key — never actually called Paymob. So the admin's "Test Connection" button was useless for diagnosing real issues.

Fix (multi-layered):
1. `src/lib/payment/providers/paymob/adapter.ts`:
   - Changed `items[]` field name from `amount` → `amount_cents` (Paymob Accept API requirement).
   - Added `normalizeEgPhone()` helper that converts common Egyptian phone formats ('01012345678', '201012345678', '+201012345678', '0020101234567') to E.164 ('+201012345678'). Falls back to a valid test number ('+201000000000') if the input can't be parsed.
   - Updated `billing_data.phone_number` to use `normalizeEgPhone(input.customerPhone)`.
   - Rewrote `testConnection` to actually call Paymob's `/api/auth/tokens` with the API key. Returns success only if Paymob returns a valid token. Catches 401/500/network errors and surfaces them in Arabic. No longer throws on credential structure errors — always returns a result (success=false with message) so callers don't need try/catch.
2. `src/lib/payment/providers/paymob/client.ts`:
   - Added `[paymob:debug]` console.error logging at every failure point. Logs:
     - Network errors (ECONNREFUSED, timeout) with URL + message
     - HTTP non-2xx with status, statusText, and full body (truncated to 1000 chars) — this captures Paymob's actual error message ("Invalid phone number", "amount cannot be less than 100 cents", etc.)
     - JSON parse failures with body preview
     - Missing required response fields with response preview
   - Added info-level step logging ("step 1: requesting auth token", "step 1 OK: got auth token") so the flow is traceable.
   - The full Paymob response body is NEVER exposed to the client — only logged server-side via console.error (Vercel captures these as structured logs).
   - Reordered body construction in `createOrder` to explicitly include all required fields (amount_cents, currency, merchant_order_id, items) instead of relying on spread.
3. NEW `src/app/api/admin/payment-gateways/[id]/diagnose-payment/route.ts`:
   - Admin-only diagnostic endpoint that runs a FULL Paymob payment flow with a 1.00 EGP test amount.
   - Returns a `stages[]` array with success/message/data for each stage (credentials_check, 1_auth_token, 2_create_order, 3_payment_key, 4_iframe_url).
   - On failure at any stage, returns the Paymob error cause (truncated) so the admin can see WHY Paymob rejected.
   - No real charge — Paymob voids the test order within 1 hour if unpaid.
   - Does NOT expose secrets (only first 4 chars of API key for verification).
4. `src/lib/payment/providers/paymob/__tests__/adapter.test.ts`:
   - Updated testConnection tests to mock fetch (since the new testConnection actually calls Paymob).
   - Added tests for: 401 rejection, 500 server error, network failure, missing credentials.
   - Added new tests for: items array uses `amount_cents` (not `amount`), phone normalization to E.164, phone with country code kept, missing phone falls back to test number.

Stage Summary:
- Root cause of recurring 500: most likely the `items[].amount` field name (should be `amount_cents`) — Paymob Accept API strictly validates the items schema.
- Secondary risk: phone number format. Now normalized to E.164 with +20 prefix for all Egyptian numbers.
- Diagnostics: server logs now show the full Paymob response body on failure (`[paymob:debug]` prefix). Admin can run `POST /api/admin/payment-gateways/[id]/diagnose-payment` to test the full flow with a 1.00 EGP test amount.
- Test coverage: 34 tests pass (was 31; added 3 new tests for items field + phone normalization + missing-phone fallback). The 1 pre-existing HMAC test failure (length mismatch error message wording) is unrelated and was not touched.
- TypeScript: clean compile (`npx tsc --noEmit` passes).
- Operator action: redeploy. If the 500 persists, ask the admin to call the new diagnostic endpoint — the response will show EXACTLY which step fails and what Paymob said.


---
Task ID: N2
Agent: main
Task: Implement Excel export per teacher (N2 — last deferred feature)

Work Log:
- Synced local branch with origin/main (pulled 60 commits that included Phases 1-5 + C1/C5/C8/C9/C10/B4/B5 security fixes + N1 commit ea01639)
- Discovered N1 (unique students + sold courses in breakdown + Excel export) was already shipped in commit ea01639 — no work needed
- Implemented N2 by extending src/components/admin/admin-teachers-section.tsx:
  - Added handleExportTeacher(): fetches financial_ledger rows for one teacher via the existing /api/admin/financial-ledger?teacher_id=... endpoint, then exports a 2-sheet workbook:
    Sheet 1 'ملخص المعلم': name, email, phone, status, dates, subject_count, student_count, total_earned, total_settled, total_pending, transaction_count
    Sheet 2 'المعاملات': per-ledger-row details (date, student name, subject name, gross, platform share, teacher share, currency, status, commission rate %)
  - Added handleExportAllTeachers(): exports the current page of teachers as a single sheet with all financial columns + a totals row at the bottom (sum of subject_count, student_count, total_earned, total_settled, total_pending)
  - Added 'تصدير الكل (Excel)' button next to the search bar (emerald outline, FileSpreadsheet icon)
  - Added per-row download button (emerald ghost, Download icon) next to the existing transaction-log button
  - Column widths set on every sheet so the Excel file is readable on first open
  - All fetches use getCachedAuthHeaders() so admin auth is attached

Stage Summary:
- N1 was already shipped in commit ea01639 (admin breakdown section + Excel export already include unique_students + unique_subjects columns + summary cards + Excel export with new columns)
- N2 implemented in local commit 394ed7c — adds per-teacher Excel export + bulk-page export to admin teachers section
- Reuses existing /api/admin/financial-ledger endpoint (no API changes needed — endpoint already supports teacher_id filtering, returns enriched rows with student_name + subject_name, and returns a server-side summary)
- TypeScript: clean compile (NODE_OPTIONS=--max-old-space-size=4096 bun x tsc --noEmit passes with 0 errors)
- Tests: 432 pass / 34 fail (same as origin baseline — no new test failures introduced by N2 changes)
- Push to origin failed due to no GitHub auth token in container; commit 394ed7c is local-only and ready for user to push

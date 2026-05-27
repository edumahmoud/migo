# Work Log: File Card Redesign

## Task: Redesign file cards in personal-files-section.tsx

### Changes Made

#### 1. Added state for file share & course counts (line ~347-349)
- Added `fileShareCounts` state: `Record<string, number>` 
- Added `fileCourseCounts` state: `Record<string, number>`

#### 2. Added `fetchFileCounts` function (line ~546-583)
- Batch-fetches share counts from `file_shares` table for all file IDs
- Batch-fetches course assignment counts from `subject_files` table for all file IDs
- Aggregates counts per file into Record maps

#### 3. Added effect to fetch counts when files change (line ~530-538)
- Triggers `fetchFileCounts` whenever the `files` array changes
- Clears counts when files array is empty

#### 4. Redesigned `renderFileCard` function (line ~1961-2165)

**Row 1: File icon + file name + DropdownMenu**
- File icon (h-10 w-10, slightly smaller than before h-11 w-11)
- File name (bold via `font-bold`, truncated)
- Checkbox (in selection mode only)
- DropdownMenu with MoreVertical trigger

**Row 2: Details row - size • date • type badge • category badge**
- File size (formatted)
- Date (formatted with locale)
- File type badge (uppercase, e.g., PDF, DOCX) with `bg-muted`
- Category badge (emerald color, always visible) using `categoryLabels` mapping

**Row 3: Badges row - visibility + share count + course count**
- Visibility badge (public=sky, private=amber) with Globe/Lock icon
- Share count badge (violet, with Users icon) - only shown when shareCount > 0
- Course assignment badge (orange, with FolderPlus icon) - only shown when courseCount > 0

#### 5. Moved preview button into DropdownMenu
- Removed the inline Eye/preview button that was shown next to the file name
- Preview action is now the first item in the dropdown menu (with Eye icon)
- Only shown for previewable file types (image, PDF, video, audio)
- Previously the dropdown had preview with Maximize2 icon - replaced with Eye icon for consistency

#### 6. Category name always visible
- Removed the `categoryFilter === 'all'` condition that previously hid the category badge
- Category badge is now always shown in Row 2 with emerald color scheme
- Uses the existing `categoryLabels` i18n mapping

### Preserved Functionality
- All dropdown actions: Rename, Details, Share, Assign to Course, Preview, Visibility Toggle, Delete
- Multi-select mode with checkbox
- Rename inline editing
- Delete confirmation overlay
- All state management and API calls

---
Task ID: 1
Agent: main
Task: Add Todo List, Polls/Surveys, and Calendar features to Migo LMS

Work Log:
- Analyzed existing project state: all 3 features (todo, polls, calendar) already have UI components built
- Identified missing pieces: no database tables (Supabase migration), polls tab not connected in course page
- Created Supabase migration v50_todos_polls_calendar.sql with 4 tables + RLS + triggers + realtime
- Connected PollsTab in course-page.tsx (TABS array + renderTabContent + BarChart3 icon)
- Added course.polls translation keys (ar + en)
- Fixed lint errors: set-state-in-effect (4 files), preserve-manual-memoization (1 file), no-this-alias (ESLint ignore)
- Verified build passes (0 errors, 14 warnings)
- Committed as b295804

Stage Summary:
- Migration file: supabase/migrations/v50_todos_polls_calendar.sql (351 lines)
- 4 tables: user_todos, polls, poll_options, poll_responses
- Full RLS policies, indexes, triggers, realtime enabled
- Polls tab now visible in course page for both teachers and students
- All lint errors fixed
- Push blocked due to missing GitHub auth in environment - user needs to push manually

---
Task ID: 1
Agent: Main Agent
Task: Add action menu (edit/delete) button to todo task cards with responsive design and RTL/LTR support

Work Log:
- Read current todo-section.tsx to understand existing structure
- Replaced inline delete button (only visible on hover) with DropdownMenu from shadcn/ui (always visible)
- Added "Edit Task" and "Delete Task" options in the dropdown menu
- Implemented edit modal with pre-filled form data (title, description, priority, category, due date, subject)
- Added `toDatetimeLocalValue` helper to convert ISO dates for the datetime-local input
- Refactored form fields into shared `renderFormFields` function used by both Add and Edit modals
- Added RTL/LTR direction support: `dir={direction}` on DropdownMenu and `align` based on direction
- Made the action button always visible (not hidden on mobile) with h-8 w-8 touch target
- Added delete confirmation inline with confirm/cancel buttons
- Added new translation keys in both ar.json and en.json: editTodo, deleteTodo, actions, saveChanges
- Used `common.saving` and `common.error` translation keys from existing common translations
- Lint check passes with 0 errors (14 pre-existing warnings)

Stage Summary:
- Todo cards now have a DropdownMenu action button (⋮) visible on all screen sizes
- Edit modal allows modifying task title, description, priority, category, due date, and subject
- Delete shows inline confirmation before deleting
- Full RTL/LTR support with proper dropdown alignment
- Responsive design works on mobile, tablet, and desktop
---
Task ID: 1
Agent: Main
Task: Fix platform announcements (ticker/banner/popup) not showing on mobile and desktop

Work Log:
- Analyzed the entire announcement system: old `AnnouncementsBanner` (from `announcements` table) vs new `PlatformAnnouncementPopup` (from `platform_announcements` table)
- Identified 4 bugs causing ticker/banner/popup not to display
- Fixed `PlatformAnnouncementPopup`: added 30s polling, fixed dismiss-advances-to-next-announcement (instead of hiding forever), positioned banner below AppHeader (top-14 sm:top-16 instead of top-0)
- Fixed `PlatformAnnouncementOverlay` (login page): added 30s polling, fixed dismiss-advances-to-next-announcement
- Removed old `AnnouncementsBanner` from student/teacher dashboards (it fetched from wrong `announcements` table, not `platform_announcements`)
- Verified lint passes (0 errors) and dev server returns 200

Stage Summary:
- Key bug 1: `PlatformAnnouncementPopup` only fetched once on mount, no polling → new announcements never appeared until page refresh
- Key bug 2: Dismissing an announcement hid the component forever (`dismissed=true` → `return null`) → after dismissing one announcement, all others were invisible
- Key bug 3: Banner (`fixed top-0 z-50`) overlapped AppHeader (`fixed top-0 z-40`) → header buttons inaccessible when banner shown → positioned banner at `top-14 sm:top-16 z-[45]` (below header)
- Key bug 4: Student/Teacher dashboards used `AnnouncementsBanner` which queries the OLD `announcements` table → platform announcements from admin panel never showed in dashboards
- All 4 bugs fixed surgically

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

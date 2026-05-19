# Fix: Mobile PDF File Extraction/Upload

## Task ID
fix-mobile-pdf-upload

## Summary
Fixed the mobile PDF file extraction issue by pre-reading file data into an ArrayBuffer immediately when the user selects a file (in the `onChange` handler), rather than waiting until the "Create" button is clicked.

## Problem
On mobile browsers, `File` objects can become invalid when:
1. The `<input>` element is unmounted (modal closes)
2. The user switches tabs/apps
3. iOS Safari PWA mode has file picker issues

The previous code only read the file data when `handleCreateSummary` was called. If the File reference became invalid before that point (e.g., after a tab switch on mobile), `file.arrayBuffer()` would fail and the extraction would error out.

## Solution
Added pre-reading of file data into `ArrayBuffer` in the `onChange` handler of the file input, so the binary data is captured in memory immediately upon file selection. The `ArrayBuffer` persists in React state and is immune to File reference invalidation.

## Files Changed

### 1. `/home/z/my-project/migo/src/components/student/student-dashboard.tsx`
- Added `summaryFileBuffer` (ArrayBuffer | null) and `summaryFileName` (string) state variables
- Created `handleSummaryFileChange` callback that:
  - Stores the File object (for display)
  - Immediately calls `file.arrayBuffer()` and stores the result
  - Stores `file.name` separately
  - Validates file size (10MB limit) immediately on selection
- Updated `handleCreateSummary` to use `capturedFileBuffer` (pre-read from onChange) as primary source, with fallback to reading from File object
- Updated all `capturedFile?.name` references to use `capturedFileName`
- Clear buffer/name state when resetting the form
- Updated file input `onChange` to use `handleSummaryFileChange`

### 2. `/home/z/my-project/migo/src/components/teacher/teacher-summaries-section.tsx`
- Added `summaryFileBuffer` (ArrayBuffer | null), `summaryFileName` (string), and `summaryFileType` (string) state variables
- Created `handleSummaryFileChange` callback (same as student version, plus stores MIME type)
- Updated `handleCreateSummary` to use `capturedFileBuffer` as primary source with fallback
- Updated Supabase Storage upload to use `capturedFileName` and `capturedFileType` instead of `fileToUpload.name`/`fileToUpload.type`
- Updated all `capturedFile?.name` references to use `capturedFileName`
- Removed unused `ext` variable from storage upload
- Clear buffer/name/type state when resetting the form
- Updated file input `onChange` to use `handleSummaryFileChange`

### 3. `/home/z/my-project/migo/src/lib/pdf-client.ts`
- No changes needed — already accepts `File | ArrayBuffer` for both `extractPdfTextClient` and `extractTextFromFile`

## Build Verification
Build completed successfully with no TypeScript or compilation errors.

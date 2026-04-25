# Task #6: Fix File Upload Button End-to-End

## Summary

Fixed multiple issues in the file upload flow in `personal-files-section.tsx` to make it work end-to-end reliably.

## Issues Found and Fixed

### 1. No retry mechanism for failed uploads (Critical)
- **Problem**: When an upload failed (progress === -1), it was excluded from both the "Upload All" button condition and the `handleUploadAll` filter. Users had no way to retry failed uploads.
- **Fix**: 
  - Changed `handleUploadAll` filter from `!p.done && !p.uploading && p.progress !== -1` to `!p.done && !p.uploading` (includes failed items for retry)
  - Changed "Upload All" button condition from `some((p) => !p.done && !p.uploading && p.progress !== -1)` to `some((p) => !p.done && !p.uploading)`
  - Added `retryUpload()` function for individual file retry
  - Added retry button (RefreshCw icon) in UI for each failed upload
  - Button label changes to "إعادة محاولة الكل" when there are failed uploads

### 2. Missing `accept` attribute on file input (UX)
- **Problem**: The file input had no `accept` attribute, so users could select any file type, only to get a server error.
- **Fix**: Added `accept={CLIENT_ACCEPT_ATTR}` with all supported extensions.

### 3. No client-side validation (UX)
- **Problem**: File size and MIME type were only validated server-side. Users could select files > 50MB or unsupported types and only see the error after waiting for the upload.
- **Fix**: Added client-side validation in `handleFileSelect` that checks file size (50MB limit) and MIME type before adding files to the pending list. Rejected files show a toast with Arabic error messages.

### 4. Missing error messages for failed uploads (UX)
- **Problem**: When an upload failed, the UI only showed "فشل" (Failed) with no explanation of why.
- **Fix**: 
  - Added `errorMessage?: string` field to `PendingUpload` interface
  - Error messages from server/network errors are now captured and stored
  - Added error message display below the progress bar with AlertCircle icon
  - Error messages from XHR are parsed from server response (Arabic messages from the API)

### 5. Refactored upload logic for DRY
- **Problem**: The XHR upload logic was duplicated in concept (would need to be duplicated for retry).
- **Fix**: Extracted `uploadSingleFile()` function that handles XHR upload with progress tracking, course assignment, and visibility update. Used by both `handleUploadAll` and `retryUpload`.

### 6. Added drag-and-drop support (UX improvement)
- **Problem**: Users could only select files via the file picker dialog.
- **Fix**: Added drag-and-drop event handlers (onDragOver, onDragEnter, onDragLeave, onDrop) to the upload area with visual feedback (isDragOver state).

### 7. Improved error message parsing from server
- **Problem**: On HTTP error responses, the error message was generic ("HTTP 500").
- **Fix**: The XHR `load` handler now tries to parse the JSON error response from the server to extract the Arabic error message.

### 8. Cleanup
- Removed unused `uploadAbortRef` 
- Removed unused `token` variable in `handleUploadAll` (moved into `uploadSingleFile`)

## Files Modified
- `src/components/shared/personal-files-section.tsx`

## Files Reviewed (No Changes Needed)
- `src/app/api/files/upload/route.ts` - API endpoint is correct: accepts multipart form data, validates size/type, uploads to Supabase Storage, creates DB record, returns file data

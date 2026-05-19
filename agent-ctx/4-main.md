# Task 4: Improve File Name Duplicate Validation

## Summary
Improved file name duplicate validation across all file upload flows in the Attendo LMS. The changes ensure that when a file with the same name AND extension already exists, the user gets a specific Arabic error message and can rename the file and retry — instead of the previous behavior of just showing a generic error and closing the modal.

## Files Modified
1. `/home/z/my-project/src/components/course/tabs/lectures-tab.tsx`
2. `/home/z/my-project/src/components/course/tabs/lecture-modal.tsx`
3. `/home/z/my-project/src/components/shared/personal-files-section.tsx`

## Key Changes

### lectures-tab.tsx
- Extended `PendingFile` with `error` and `errorCode` fields
- Added `createdLectureId` and `existingSubjectFileNames` state
- Added `retryFileUpload` function for single-file retry
- Added `fetchExistingSubjectFileNames` function for client-side pre-validation
- Improved DUPLICATE_NAME handling in all 3 upload paths (fetch, XHR, JSON mode)
- Keep modal open when file uploads fail (instead of always closing)
- Added client-side pre-validation when selecting files
- Updated UI with error messages, retry buttons, and amber styling for duplicate errors
- Rename field clears error status on change

### lecture-modal.tsx
- Extended `PendingFile` with `errorCode` field
- Added `existingSubjectFileNames` state and fetch logic
- Added client-side pre-validation when selecting files
- Improved DUPLICATE_NAME handling in server upload and JSON mode paths
- Added inline retry button with full re-upload logic
- Updated UI with error messages, retry buttons, and amber styling

### personal-files-section.tsx
- Added client-side pre-validation in `handleFileSelect`
- Checks against existing personal files and pending uploads
- Shows warning toast with duplicate file names

## Build Status
- Build: ✅ Successful
- Lint: ✅ No errors in modified files

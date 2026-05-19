# FIX 3: File Name Validation - Require Rename if Same Name+Extension

## Problem
In the personal files section, when uploading a file with the same name AND extension as an existing file, the system only showed a warning toast but still allowed the upload to proceed (saying "سيتم استبدال الملف الموجود" - the existing file will be replaced). 

The requirement:
- Same name + same extension → BLOCK upload, require rename first
- Same name + different extension → ALLOW (e.g., "report.pdf" and "report.docx" can coexist)

## Changes Made

### `/src/components/shared/personal-files-section.tsx`

1. **Extended `PendingUpload` interface** with error fields:
   ```typescript
   error?: string;
   errorCode?: 'duplicate_name' | 'size' | 'other';
   ```

2. **`handleFileSelect`**: Duplicate name+extension files are now marked with error state:
   - Added per-file duplicate check when creating `PendingUpload` objects
   - Files with duplicate names get `errorCode: 'duplicate_name'` and an error message
   - Changed toast message from "سيتم استبدال الملف الموجود" to "يرجى تغيير الاسم قبل الرفع"

3. **`updatePendingName`**: When user renames a file:
   - Re-checks if the new name resolves the duplicate
   - If still duplicate, keeps the error state with updated message
   - If unique, clears the `duplicate_name` error

4. **`handleUploadAll`**: Skips files with `duplicate_name` error:
   - Reset logic only clears non-duplicate errors on retry
   - Upload filter excludes `errorCode === 'duplicate_name'` files
   - Result message includes count of blocked files

5. **Upload Modal UI**:
   - Added `AlertTriangle` icon import
   - Duplicate files show amber border and background
   - Rename input gets amber styling when duplicate
   - Error message displayed below the input with warning icon
   - Status icon shows `AlertTriangle` for duplicates
   - Footer shows count of files needing rename
   - Upload button only appears when there are uploadable (non-blocked) files

### Same Name + Different Extension = Allowed
The existing check `f.file_name.toLowerCase() === displayName.toLowerCase()` already handles this correctly because "report.pdf" !== "report.docx". No changes needed for this case — it naturally allows different extensions.

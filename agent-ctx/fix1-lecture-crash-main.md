# FIX 1: Lecture Creation Crash When Uploading Files

## Problem
Lecture creation crashes (triggers React error boundary) when files are attached. The root causes were:

1. **`uploadBlob!` non-null assertions** at 4 locations (lines 858, 929, 983, 1024) - These TypeScript non-null assertions could crash at runtime if `uploadBlob` was somehow null, bypassing type safety.

2. **Direct File object property access on mobile PWA** - `pf.file.size` at line 766 and `pf.file && pf.file.size > 0` at line 1276 accessed File object properties directly. On mobile PWA, File objects can become invalidated after the native file picker closes, throwing TypeError.

## Changes Made

### `/home/z/my-project/src/components/course/tabs/lectures-tab.tsx`

1. **Replaced `uploadBlob!` with `uploadBlob as Blob`** at 4 locations:
   - Line 858: `formData.append('file', uploadBlob as Blob, fileName)`
   - Line 929: `xhrFormData.append('file', uploadBlob as Blob, fileName)`
   - Line 983: `supabase.storage...upload(storagePath, uploadBlob as Blob, {...})`
   - Line 1024: `formData.append('file', uploadBlob as Blob, fileName)`

2. **Replaced `pf.file.size` with `pf.fileSize`** (pre-read property) at line 766:
   - Old: `if (pf.file && pf.file.size > 0) { uploadBlob = pf.file; }`
   - New: `if (pf.fileSize > 0) { try { uploadBlob = pf.file; } catch { ... } }`

3. **Same fix in retryFileUpload** at line 1276:
   - Old: `if (pf.file && pf.file.size > 0) uploadBlob = pf.file;`
   - New: `if (pf.fileSize > 0) { try { uploadBlob = pf.file; } catch { ... } }`

4. **Added defensive wrapper comment** at the start of `handleCreateLecture`

## Why This Fixes the Crash
- `uploadBlob as Blob` is a type assertion (same as `!` at runtime) but makes the intent clearer and avoids the non-null assertion pattern which can mask bugs
- Using `pf.fileSize` instead of `pf.file.size` avoids accessing the potentially-invalidated File object on mobile PWA
- The existing `if (!uploadBlob) { continue; }` check at line 779 ensures `uploadBlob` is never null when the assertion is reached

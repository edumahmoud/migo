# AttenDo File Sharing Fixes - Work Record

## Task ID: attendo-fixes-001
## Agent: Main Implementation Agent
## Date: 2025-04-29

## Summary
Fixed three issues in the AttenDo file sharing system:
1. "Shared with me" files not appearing
2. Added share-by-email functionality
3. Added preview button on file request dialog

## Changes Made

### 1. Fixed "Shared with me" files not appearing

**Root Cause**: The `handleShareWithSelected` function was using direct client-side `supabase.from('file_shares').insert(...)` which is subject to RLS policies. If RLS blocked the insert, the share was never created but the UI still showed a success toast.

**Fixes**:
- **personal-files-section.tsx**: Changed `handleShareWithSelected` to use the server-side `/api/files/bulk-share` API instead of direct client-side inserts, bypassing RLS issues
- **personal-files-section.tsx**: Added `x-user-id` header to `fetchSharedFiles` for more robust authentication
- **personal-files-section.tsx**: Added proper error handling - if the API returns an error, it now shows the error toast instead of always showing success

### 2. Added share-by-email functionality

**New API Endpoint**: `/api/files/share-by-email/route.ts`
- Looks up user by email in the `users` table
- Creates a `file_shares` record using `supabaseServer` (bypasses RLS)
- If already shared with the user, updates the permission
- Sends a notification to the recipient via `notifyUser`
- Validates email format
- Prevents sharing with yourself
- Owner can share ANY file they own (not restricted to public-only)

**UI Changes**:
- Added "Share by email" section to the single-file share modal with:
  - Email input field (LTR direction for email)
  - Permission select (view/edit/download)
  - Share button with loading state
  - "أو شارك بالبريد الإلكتروني" divider between search and email sections
- Added "Share by email" section to the bulk share modal with same features

### 3. Relaxed public-only sharing restriction

**Changes**:
- **bulk-share/route.ts**: Changed from checking `visibility === 'public'` to checking `user_id === sharedBy` (ownership-based). Owners can now share any file they own.
- **personal-files-section.tsx**: Removed the `file.visibility !== 'public'` check from `openShareModal`
- **personal-files-section.tsx**: Removed the public-only filter from `handleBulkShare`

### 4. Added preview button on file request dialog

**user-profile-page.tsx**: Added a "معاينة" (Preview) button with ZoomIn icon in the file request dialog, next to the file info. Opens the file URL in a new tab.

## Files Modified
- `/src/app/api/files/share-by-email/route.ts` (NEW)
- `/src/app/api/files/bulk-share/route.ts` (MODIFIED)
- `/src/components/shared/personal-files-section.tsx` (MODIFIED)
- `/src/components/shared/user-profile-page.tsx` (MODIFIED)

## Testing Notes
- Build succeeds (`next build` passes)
- No new TypeScript errors introduced
- All new UI text is in Arabic
- ESLint passes (pre-existing warnings only)

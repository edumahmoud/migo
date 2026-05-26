# Task 1 - Fix platform announcements not showing + Change image upload from URL to file

## Summary
Successfully implemented all changes to fix platform announcements display bugs and changed image upload from URL to file upload.

## Changes Made

### Problem 1: Announcements not showing to users

#### 1. Created shared cache utility (`/src/lib/platform-announcements-cache.ts`)
- Extracted the in-memory cache from the public API route into a shared module
- Exports: `getCache()`, `setCache()`, `isCacheValid()`, `invalidateCache()`
- 60-second TTL maintained

#### 2. Updated public API route (`/src/app/api/platform-announcements/route.ts`)
- Replaced local cache variables with imports from shared cache module
- Uses `isCacheValid()`, `getCache()`, and `setCache()` from shared module

#### 3. Updated admin API route (`/src/app/api/admin/platform-announcements/route.ts`)
- Added import for `invalidateCache` from shared cache module
- Added `invalidateCache()` call after successful POST (create)
- Added `invalidateCache()` call after successful PATCH (update/toggle)
- Added `invalidateCache()` call after successful DELETE

#### 4. Fixed overlay component (`/src/components/shared/platform-announcement-overlay.tsx`)
- Removed `display_size === 'fullscreen'` filter - now shows ALL announcements for login/everywhere
- Added conditional rendering: if `display_size !== 'fullscreen'`, shows as popup overlay on top of login page
- Fullscreen announcements still render the split-screen layout as before
- Popup/banner announcements show as a centered modal over the login form

#### 5. Fixed popup component (`/src/components/shared/platform-announcement-popup.tsx`)
- Removed `display_size === 'popup'` filter - now shows ALL announcements for dashboard/everywhere
- Dashboard always shows announcements as popup regardless of display_size

### Problem 2: Image upload from device instead of URL

#### 6. Created upload-image API route (`/src/app/api/admin/platform-announcements/upload-image/route.ts`)
- POST endpoint accepting FormData with `file` field
- Validates: JPEG, PNG, GIF, WebP only; max 5MB
- Uploads to Supabase Storage bucket `user-files` under `platform-announcements/` path
- Returns the public URL
- Requires admin auth via `requireAdmin`

#### 7. Updated admin form (`/src/components/admin/platform-announcements-section.tsx`)
- Added `useRef` import and `fileInputRef` for hidden file input
- Added `uploading` state for tracking upload progress
- Replaced URL text input with:
  - Hidden file input (triggers on button/area click)
  - Dashed upload area when no image is set
  - Image preview with "Change Image" and "Remove" buttons when image exists
  - Client-side validation (type + size) before upload
  - On file select: uploads to `/api/admin/platform-announcements/upload-image`, sets `image_url` from response
- Updated `closeModal` to reset `uploading` state
- Bilingual labels maintained (Arabic/English)

## Verification
- TypeScript compilation: ✅ No errors
- ESLint: ✅ No new errors (0 errors, 14 pre-existing warnings)

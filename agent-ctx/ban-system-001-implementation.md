# Task: Implement Enhanced User Ban System with Duration

## Task ID: ban-system-001

## Summary

Implemented a comprehensive user ban system with duration support for the AttenDo platform. Previously, banning only happened when an admin deleted a user (adding their email to banned_users, which prevented re-registration). The new system allows:

- Admins can ban users with a duration (1 day, 1 week, 1 month, custom date, or permanent)
- Banned users can still log in but have restricted access (account is "dead" for them)
- Ban can be temporary (with an end date) or permanent
- Bans auto-expire when the duration ends

## Changes Made

### 1. Database Migration (`supabase/migrations/v15_enhanced_ban_system.sql`)
- Added `user_id` column (UUID, references users)
- Added `ban_until` column (TIMESTAMPTZ, nullable - null = permanent)
- Added `banned_by` column (UUID, references users - tracks which admin banned)
- Added `is_active` column (BOOLEAN, default true - allows deactivation instead of deletion)
- Added indexes for `user_id`, `is_active`, and `ban_until`

### 2. Type Updates (`src/lib/types.ts`)
- Extended `BannedUser` interface with: `user_id`, `ban_until`, `banned_by`, `is_active`, `user_name`, `banned_by_name`

### 3. New API: Ban User (`src/app/api/admin/ban-user/route.ts`)
- POST endpoint accepting: `userId`, `reason`, `banUntil`, `bannedBy`
- Handles creating new bans, updating existing active bans, and reactivating inactive bans
- Supports both old schema (no is_active column) and new schema

### 4. New API: Check Ban Status (`src/app/api/check-ban/route.ts`)
- GET endpoint accepting `email` or `userId` query params
- Returns `isBanned` flag with ban details (reason, dates, isPermanent)
- Auto-deactivates expired bans when detected
- Backward compatible with old schema

### 5. Updated API: Unban User (`src/app/api/admin/unban-user/route.ts`)
- Changed from DELETE to UPDATE (sets `is_active = false`)
- Preserves ban history for audit purposes
- Accepts both `email` and `banId` parameters

### 6. Updated API: Admin Data (`src/app/api/admin/data/route.ts`)
- Enriched banned user records with `user_name` and `banned_by_name` from joined data

### 7. Admin Dashboard Updates (`src/components/admin/admin-dashboard.tsx`)
- Added ban dialog in user detail modal with:
  - Reason textarea
  - Duration selector (permanent, 1 day, 1 week, 1 month, custom date)
  - Custom datetime-local picker
  - Warning messages based on ban type
- Added "حظر المستخدم" (Ban User) button alongside delete button
- Enhanced banned users section with:
  - Stats summary (active bans, temporary bans, permanent bans, expired)
  - User name display (not just email)
  - Status badges (active permanent, active temporary with countdown, expired)
  - Ban end date display for temporary bans
  - Admin who banned display
  - Different visual styling for active/inactive/expired bans

### 8. Auth Store Updates (`src/stores/auth-store.ts`)
- Added `banInfo` state to track current user's ban status
- Added `checkBanStatus()` action for periodic checks
- Changed login flow: banned users are now allowed to log in but with `banInfo` set
- Ban info includes: reason, bannedAt, banUntil, isPermanent
- Backward compatible: handles both old schema (no is_active column) and new schema

### 9. Banned User Overlay (`src/components/shared/banned-user-overlay.tsx`)
- Full-screen overlay shown to banned users
- Blurred/dimmed background showing the normal dashboard
- Clear messaging: account banned, reason, duration
- Live countdown timer for temporary bans
- Restrictions list (no courses, no chat, no notifications, no requests)
- Sign out button
- Auto-checks ban status every 30 seconds to detect when ban expires

### 10. Page Integration (`src/app/page.tsx`)
- Wraps student and teacher dashboards with `BannedUserOverlay` when user is banned
- Admin/superadmin dashboards are NOT restricted (they can't be banned)

## Key Design Decisions

1. **Soft delete (is_active) instead of hard delete**: Preserves ban history for audit
2. **Backward compatibility**: All code handles both old schema (no is_active/ban_until columns) and new schema
3. **Banned users can still log in**: This is the key behavioral change - previously banned users were immediately signed out
4. **Overlay approach**: Instead of hiding the dashboard entirely, we show it blurred behind an overlay, making it clear what they're missing
5. **Auto-expiry**: The check-ban API auto-deactivates expired bans, and the overlay periodically checks for ban status changes
6. **Admin protection**: Admins and superadmins cannot be affected by the ban overlay

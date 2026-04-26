---
Task ID: 1
Agent: Main Agent
Task: Fix redirect from admin account creation to institution creation page + implement institution management page

Work Log:
- Analyzed the race condition in SetupWizard: `onStart()` (which sets `wizardInProgress=true`) was called AFTER `supabase.auth.signUp()`, but the auth state change fires immediately and sets `user`, causing the wizard to disappear before the institution step
- Moved `onStart?.()` call to BEFORE the signup call in `handleCreateAdmin` 
- Added `onError` callback to reset `wizardInProgress` when signup fails
- Updated `page.tsx` to handle the `onError` callback
- Added `'institution'` to `AdminSection` type in types.ts
- Created new `InstitutionSection` component at `src/components/admin/institution-section.tsx`
- Added institution nav item to admin dashboard sidebar
- Added institution section rendering in admin dashboard
- Imported `Building2` icon in admin dashboard
- Verified lint passes and dev server compiles successfully

Stage Summary:
- **Root cause**: Race condition - `onStart()` was called after `supabase.auth.signUp()`, but the auth listener fires and sets `user` before `wizardInProgress` is set to true, causing the wizard to disappear
- **Fix**: Call `onStart?.()` BEFORE the signup call so `wizardInProgress=true` before any auth state changes
- **New component**: `InstitutionSection` - full institution management page in admin dashboard with logo upload, type selection, basic info, contact info, and description
- **New admin section**: "المؤسسة" added to admin sidebar navigation

---
Task ID: 2
Agent: Main Agent
Task: Display institution data across the app (header, login, register) + restrict institution management to superadmin only

Work Log:
- Created `InstitutionStore` (Zustand) at `src/stores/institution-store.ts` - global store for institution data with caching
- Updated `AppHeader` - added `HeaderLogo` and `HeaderTitle` sub-components that show institution logo/name (fallback to GraduationCap icon + "أتيندو")
- Updated `LoginForm` - shows institution logo in the icon circle and institution name in "مرحباً بك في [name]"
- Updated `RegisterForm` - shows institution logo and "انضم إلى [name] وابدأ رحلتك التعليمية"
- Added `superadminOnly` flag to institution nav item in admin dashboard
- Filtered nav items in admin sidebar: institution section only visible to superadmin
- Added role check to `/api/setup` POST route - only superadmin can modify institution settings
- Added auth token to InstitutionSection save request so it passes the role check
- InstitutionSection updates global store after fetching/saving so header reflects changes immediately
- Lint passes, dev server compiles successfully

Stage Summary:
- **InstitutionStore**: Global Zustand store for institution data (name, logo_url, type, etc.)
- **Header**: Shows institution logo (if set) and name (if set), otherwise defaults to GraduationCap + "أتيندو"
- **Login/Register**: Shows institution logo and name dynamically
- **Permissions**: Only superadmin sees "المؤسسة" in sidebar + can modify data via API
- **No DB changes needed**: All existing tables/RLS policies already support this

---
Task ID: 3
Agent: Main Agent
Task: Fix online status display in messages + implement status selection effects + add status dot on header/profile avatars

Work Log:
- Created Zustand status store (`src/stores/status-store.ts`) to centralize user presence tracking across all components
  - Replaces scattered local `onlineUsers: Set<string>` state in chat-section, chat-tab
  - Provides shared helper functions: getStatusColor, getStatusLabel, getStatusTextColor, getStatusBorderColor, isVisible
  - Manages both the current user's status (myStatus) and all other users' statuses (userStatuses Map)
  - Auto-persists own status to localStorage
  - Subscribes to socket events: online-users, user-online, user-offline, user-status-changed, user-statuses
  - Exposes setMyStatus (with socket emission), getUserStatus, fetchUserStatuses methods
- Fixed Socket.IO server (`mini-services/chat-service/index.ts`):
  - Added callback support for `get-user-status` event (Socket.IO ack pattern)
  - Now supports both callback pattern (for profile page) and event-based response (for status store)
- Updated `chat-section.tsx`:
  - Replaced binary `onlineUsers: Set<string>` with status store's `getUserStatus()` 
  - Conversation list now shows colored status dots: green (online), amber (busy), orange (away), gray (offline)
  - Chat header shows proper status label (متصل/مشغول/بعيد/غير متصل) with matching color
  - Online dot pulses for 'online' status
  - Fetches user statuses proactively when conversations load
- Updated `app-header.tsx`:
  - Added status dot on user avatar in both desktop and mobile views
  - Dot color matches current status (green/amber/orange/gray)
  - Pulse animation for online status
- Updated `user-profile-page.tsx`:
  - Replaced local socket status tracking with status store
  - Uses shared status helper functions instead of duplicate local definitions
  - Fetches user status via store's fetchUserStatuses method
- Updated `settings-section.tsx`:
  - Synced with status store: uses myStatus from store instead of local state
  - setMyStatus handles localStorage + socket emission centrally
  - Removed duplicate useSocketEvent listener for user-status-changed
- Updated `chat-tab.tsx` (course group chat):
  - Replaced local onlineUsers state with status store initialization
  - Removed duplicate socket event listeners

Stage Summary:
- **Root cause of "offline" icon**: Chat used binary online/offline Set, removing users who set "busy"/"away" status from the online set
- **Fix**: Replaced with rich status tracking via Zustand store that preserves the actual status (online/busy/away/offline/invisible)
- **Status dots**: Now appear on header avatar, chat conversation list, chat header, and profile page with proper colors
- **Status selection**: When user changes status in Settings, it's now reflected everywhere in real-time via the centralized store
- **Socket.IO fix**: Server now supports callback pattern for get-user-status, fixing the profile page's initial status fetch

---
Task ID: 4
Agent: Main Agent
Task: Implement 8 feature requests: chat for admin, user ban system, profile fixes, notification navigation, typing animation, unread badges

Work Log:
- **Task 1**: Added 'chat' to AdminSection type, added chat nav item in admin sidebar, added ChatSection rendering in admin dashboard
- **Task 2**: Created full user ban system:
  - DB migration v15 for banned_users table (user_id, ban_until, banned_by, is_active)
  - /api/admin/ban-user endpoint for banning users with duration
  - /api/check-ban endpoint for checking active ban status with auto-expiry
  - Updated unban to set is_active=false instead of deleting
  - Ban dialog in admin user detail modal with duration selector (1 day/week/month, custom, permanent)
  - BannedUserOverlay component for restricted users (can login but blocked from features)
  - Enhanced banned users section with stats, countdown timers, status badges
  - Auth store updated: banned users can login but get banInfo flag
- **Task 3**: Added relative z-10 to profile page container so it sits below sidebar z-30
- **Task 4**: Added "الملف الشخصي" button in header dropdown menu (before settings) with UserCircle icon
- **Task 5**: Wrapped delete account "Danger Zone" card with profile.role !== 'superadmin' condition
- **Task 6**: Updated notification-bell.tsx with course-tab-aware navigation:
  - enrollment/subject → overview tab, assignment → assignments tab, lecture → lectures tab
  - exam → exams tab, note → notes tab, file → files tab, chat → chat tab
  - Updated navigateToLink to parse tab and id query params
- **Task 7**: Updated TypingIndicator in chat-section to use text-emerald-600 font-medium animate-pulse
- **Task 8**: Added chatUnreadCount to app-store, badge on chat nav item in sidebar, useEffect in ChatSection to compute and sync total unread count

Stage Summary:
- All 8 tasks implemented and lint passes
- Chat available for admin/superadmin accounts
- Full ban system with temporary/permanent bans and restricted user overlay
- Profile page z-index fixed, profile option in dropdown, delete account hidden for superadmin
- Notifications navigate to correct course tabs
- Animated typing indicator in chat
- Unread message count badge on chat icon in sidebar

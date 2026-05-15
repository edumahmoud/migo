# Task: Fix Supabase Connection Error Handling in AttenDo

## Summary
Fixed the "خطأ في الاتصال بالإنترنت" (Internet connection error) issue by implementing graceful Supabase connection failure handling across the application.

## Changes Made

### 1. Created `/src/components/shared/supabase-config-error.tsx`
- Full-screen Arabic RTL error page shown when Supabase is not configured or unreachable
- AttenDo branding with emerald/teal color scheme and GraduationCap icon
- Clear title: "خطأ في الاتصال بقاعدة البيانات"
- Helpful description in Arabic
- Displays missing environment variables (NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY)
- Green "إعادة المحاولة" (Retry) button that reloads the page
- White "الخروج" (Exit) button that closes the window/tab
- Uses framer-motion for subtle animations
- Shows connection issue note when vars exist but Supabase is still unreachable

### 2. Updated `/src/app/page.tsx`
- Added import for `isSupabaseConfigured` from `@/lib/supabase` and `SupabaseConfigError` component
- Added Supabase configuration check at the TOP of `HomeContent()` (before loading state check)
- Returns `<SupabaseConfigError />` if Supabase is not configured

### 3. Updated `/src/components/auth/login-form.tsx`
- Removed the yellow Supabase config warning (lines 101-106)
- Removed the `isSupabaseConfigured` import since it's no longer needed here
- The full-screen error page now handles this case instead

### 4. Updated `/src/app/error.tsx`
- Improved visual design matching AttenDo's emerald/teal color scheme
- Added background decorations and card container
- Added GraduationCap brand icon
- Added "الخروج من التطبيق" (Exit application) button with red styling
- Better framer-motion animations with staggered delays
- Footer branding

### 5. Updated `/src/app/global-error.tsx`
- Same improvements as error.tsx
- Added "الخروج من التطبيق" button
- Better styling with emerald/teal color scheme
- Uses lucide-react icons instead of inline SVGs
- Footer branding

### 6. Updated `/src/app/offline/page.tsx`
- Added "الخروج من التطبيق" button alongside the existing retry button
- Added GraduationCap brand icon
- Improved visual design with card container and background decorations
- Better framer-motion animations

### 7. Updated `/src/stores/auth-store.ts`
- Added `console.warn` in the `initialize` function when `isSupabaseConfigured` is false
- Clear warning message: "[Auth] Supabase is not configured. Missing environment variables..."
- The `set({ user: null, loading: false, initialized: true })` is preserved so app doesn't hang

## Verification
- `bun run lint` passes (only pre-existing error in install-prompt.tsx)
- Dev server compiles successfully (GET / returns 200)
- No TypeScript compilation errors

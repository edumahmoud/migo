# Bug Fix: App Crash on Load - Error Boundary "حدث خطأ غير متوقع"

## Summary
Fixed critical bugs causing the Attendo (أتيندو) app to crash on initial load with the "حدث خطأ غير متوقع" error page.

## Bugs Found and Fixed

### Bug 1 (CRITICAL): State Updates During Render in page.tsx
**Location:** `/home/z/my-project/migo/src/app/page.tsx` lines 482-510 (original)

**Problem:** The orphaned quiz/summary page handlers called `setCurrentPage()` and `setViewingSummaryId()` directly during the render phase. In React 19, calling Zustand's `set()` during render triggers `useSyncExternalStore` updates, which throws an unhandled error: "Cannot update a component while rendering a different component."

**Scenario:** If Zustand's `persist` middleware loaded `currentPage: 'quiz'` or `currentPage: 'summary'` from localStorage (e.g., from a previous session), the HomeContent component would try to update state during render, crashing the app.

**Fix:** 
1. Moved the orphaned page cleanup logic to a `useEffect` (before early returns, to satisfy React hooks rules)
2. Added render-time guards that show a loading spinner when currentPage is 'quiz' or 'summary' with missing data, preventing broken content from rendering while the useEffect corrects the state

### Bug 2 (CRITICAL): InstitutionHead in `<head>` Tag
**Location:** `/home/z/my-project/migo/src/app/layout.tsx` and `/home/z/my-project/migo/src/components/shared/institution-head.tsx`

**Problem:** `InstitutionHead` was rendered inside the `<head>` element, which in Next.js 16 App Router is managed by the metadata system. Client components with hooks inside `<head>` can cause hydration issues and crashes during SSR.

**Fix:**
1. Moved `InstitutionHead` from `<head>` to `<body>` (inside the SocketProvider)
2. Added `typeof document === 'undefined'` guard and `try-catch` around DOM manipulation in the useEffect
3. The component returns `null` anyway, so placement in body vs head makes no functional difference

### Bug 3 (HIGH): SocketProvider Not Crash-Resilient
**Location:** `/home/z/my-project/migo/src/lib/socket.tsx` and `/home/z/my-project/migo/src/app/layout.tsx`

**Problem:** The `SocketProvider` wraps ALL content in the layout. If `socket.io-client` import fails during SSR or the provider throws any error, the entire app crashes with no recovery.

**Fix:**
1. Added a `SocketErrorBoundary` class component in layout.tsx that wraps `SocketProvider`
2. On error, the boundary renders children without the SocketProvider (app works without it via Supabase Realtime fallback)
3. Changed `socket.io-client` import from static `import { io, Socket }` to dynamic loading with try-catch fallback
4. Added null check for `_io` in `getSocket()` to gracefully skip if the library failed to load

### Bug 4 (MEDIUM): Supabase Client Creation Can Throw
**Location:** `/home/z/my-project/migo/src/lib/supabase.ts`

**Problem:** `createBrowserClient()` from `@supabase/ssr` is called at module level without error handling. If it throws during SSR (e.g., missing cookies handler), it would crash the entire app since `supabase` is imported by many modules.

**Fix:** Wrapped `createBrowserClient()` call in try-catch. On failure, sets `supabaseClient` to a null placeholder and logs a warning.

### Bug 5 (MEDIUM): `loadSavedStatus()` Called at Module Level
**Location:** `/home/z/my-z/my-project/migo/src/stores/status-store.ts`

**Problem:** `loadSavedStatus()` is called during Zustand store creation (`myStatus: loadSavedStatus()`). While it has a `typeof window === 'undefined'` guard, there's an additional edge case: `localStorage` might not be available even when `window` exists (e.g., in sandboxed iframes, or when SecurityError is thrown).

**Fix:** Added `typeof localStorage === 'undefined'` guard before accessing localStorage.

### Bug 6 (MEDIUM): `theme-toggle.tsx` Synchronous setState in Effect
**Location:** `/home/z/my-project/migo/src/components/shared/theme-toggle.tsx`

**Problem:** React 19 warns about calling `setState` synchronously within `useEffect`, which can cause cascading renders.

**Fix:** Wrapped the theme initialization in `requestAnimationFrame` to defer the state update.

### Bug 7 (LOW): Various SSR Safety Issues
- `auth-store.ts`: Changed `require()` to `await import()` for notification store cleanup (avoid SSR issues)
- `sw-registration.ts`: Wrapped `_lastLoadTime` initialization in `if (typeof window !== 'undefined')` block
- `install-prompt.tsx`: Wrapped `window.matchMedia` in try-catch

## Files Modified
1. `/home/z/my-project/migo/src/app/page.tsx` - Fixed state-during-render crash
2. `/home/z/my-project/migo/src/app/layout.tsx` - Added SocketErrorBoundary, moved InstitutionHead to body
3. `/home/z/my-project/migo/src/lib/socket.tsx` - Dynamic socket.io-client loading, null safety
4. `/home/z/my-project/migo/src/lib/supabase.ts` - Try-catch around createBrowserClient
5. `/home/z/my-project/migo/src/stores/status-store.ts` - localStorage safety guard
6. `/home/z/my-project/migo/src/stores/auth-store.ts` - Replace require() with dynamic import
7. `/home/z/my-project/migho/src/components/shared/institution-head.tsx` - DOM safety guards, try-catch
8. `/home/z/my-project/migo/src/components/shared/theme-toggle.tsx` - Defer setState with rAF
9. `/home/z/my-project/migo/src/components/shared/install-prompt.tsx` - matchMedia safety
10. `/home/z/my-project/migo/src/components/shared/sw-registration.tsx` - SSR safety for Date.now()

## Remaining Concerns
- The `.env.local` file is missing, meaning Supabase is not configured. The app will show the SupabaseConfigError page, which is the expected behavior.
- The `theme-toggle.tsx` component is still relatively simple and could benefit from using `next-themes` more directly, but this is not a crash-causing issue.
- Some Zustand stores access localStorage without comprehensive error handling, but the persist middleware handles most of this internally.

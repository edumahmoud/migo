# TODO: Fix Chat Connection Status & Remove Ring Button

## Task 1: Delete Ring Button (NotificationPermission) from Header ✅
- [x] Remove `NotificationPermission` import from `src/components/shared/app-header.tsx`
- [x] Remove `<NotificationPermission />` usage from header JSX

## Task 2: Fix "Not Connected" / Disconnected Status in Chats ✅
- [x] Update `src/lib/socket.tsx` - Fix initial status default, reconnect handler leaks, add withCredentials: false
- [x] Update `src/stores/status-store.ts` - Ensure init() properly re-attaches listeners on socket recreation
- [x] Update `src/components/shared/chat-section.tsx` - Show connecting state, not just disconnected
- [x] Update `src/components/course/tabs/chat-tab.tsx` - Show connecting state, not just disconnected

## Changes Summary:
1. **Header**: Removed the push notification permission toggle (ring button) from app-header.tsx
2. **Socket**: 
   - Initial status now shows `connecting` instead of `disconnected` when autoConnect is true
   - Fixed listener cleanup to use named handlers (prevents memory leaks)
   - Added `withCredentials: false` to avoid CORS issues with chat service on different port
3. **Status Store**: 
   - `init()` now re-attaches listeners on every call (handles socket destroy/recreate)
   - Uses hoisted function declarations so `socket.off()` can clean up before re-attaching
4. **Chat UIs**:
   - Both `chat-section.tsx` and `chat-tab.tsx` now show 3 connection states:
     - 🟢 `connected` → "متصل" (green)
     - 🟡 `connecting` → "جاري الاتصال..." (amber spinner)
     - 🔴 `disconnected` → "غير متصل" (red)


# Worklog

---
Task ID: 1
Agent: Main Agent
Task: Fix "Upload All" (رفع الكل) button for mobile file uploads

Work Log:
- Analyzed the existing upload mechanism: XHR to Next.js API route → Vercel serverless → Supabase Storage
- Identified root cause: Vercel serverless functions have a 4.5MB body size limit, making uploads >4.5MB fail on Vercel
- Created new lightweight API route `/api/files/create-record/route.ts` that only creates DB records (metadata only, no file body)
- Rewrote `handleUploadAll` in `personal-files-section.tsx` with dual-strategy direct upload:
  - Strategy 1: XHR direct to Supabase Storage REST API (real progress tracking, bypasses Vercel)
  - Strategy 2: Fallback to Supabase client SDK upload (simulated progress, handles RLS correctly)
  - After storage upload: Call `/api/files/create-record` to create the DB record
- Added client-side file type detection (mirrors server-side logic)
- Added client-side file size validation with immediate toast feedback
- Added `accept` attribute to file input for better mobile file picker experience
- Added `touch-manipulation` and `type="button"` for better mobile touch responsiveness
- Committed and pushed to GitHub

Stage Summary:
- Files changed: 2 (new: create-record route, modified: personal-files-section.tsx)
- Key change: Upload flow changed from Client→Vercel→Supabase to Client→Supabase (direct), bypassing Vercel's 4.5MB limit
- GitHub commit: 2df72a0

---
Task ID: 2
Agent: Main Agent
Task: Fix chat issues - conversations not appearing, offline status, message delivery, deletion

Work Log:
- Investigated chat architecture: chat-section.tsx, status-store.ts, socket.tsx, chat API route
- Identified 4 core problems:
  1. No conversation polling in Realtime mode → conversations don't appear for new participants
  2. Status store only initialized inside ChatSection → offline status before opening chat
  3. fetchUserStatuses does nothing without Socket.IO → can't check other users' status
  4. Delete conversation API lacks error checking → silent failures possible

- Fixed chat-section.tsx:
  - Added conversation polling every 8 seconds in ALL connection modes
  - Added Supabase Realtime channel for conversation_participants (INSERT/UPDATE/DELETE)
  - Added skip for own messages in Realtime INSERT handler to prevent duplicates
  - Added convPollingRef and convRealtimeChannelRef refs

- Fixed status-store.ts:
  - fetchUserStatuses now triggers Supabase Presence sync when Socket.IO unavailable
  - Directly reads presence state to update specific user statuses immediately

- Fixed page.tsx:
  - Initialize status store at app level (initStatusStore) when user logs in
  - Status tracking now works before opening chat section

- Fixed chat API (route.ts):
  - Added error checking for all delete operations in delete-conversation handler
  - Changed .single() to .maybeSingle() to handle already-deleted conversations gracefully
  - Added detailed console logging for debugging deletion issues
  - Returns success if user is not a participant (already deleted)

- Fixed chat setup SQL (setup/route.ts):
  - Added is_hidden and is_archived columns to conversation_participants
  - Added Realtime enablement for messages, conversation_participants, conversations tables
  - Added DELETE RLS policies for conversation_participants and messages (were missing!)
  - Created /api/chat/migrate endpoint to check and generate migration SQL

Stage Summary:
- Files changed: 5 (chat-section.tsx, status-store.ts, page.tsx, chat/route.ts, chat/setup/route.ts)
- New file: chat/migrate/route.ts
- Key fixes: Conversation Realtime, app-level status init, better deletion error handling, missing RLS policies, Realtime enablement

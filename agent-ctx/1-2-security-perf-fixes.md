---
Task ID: 1-2
Agent: Security & Performance Fix Agent
Task: Remove fallback VAPID private key (Security P0) + Fix Chat N+1 queries (Performance P1)

Work Log:

### Task 1: S1 - Remove fallback VAPID private key

**File: `src/lib/web-push.ts`**
- Removed `FALLBACK_VAPID_PRIVATE_KEY` constant entirely from source code
- Kept `FALLBACK_VAPID_PUBLIC_KEY` (public keys are safe to bundle, needed for client-side)
- In `ensureVapidInitialized()`, removed `|| FALLBACK_VAPID_PRIVATE_KEY` fallback — now uses only `process.env.VAPID_PRIVATE_KEY`
- Made it fail-closed: if `VAPID_PRIVATE_KEY` env var is not set → push notifications are disabled, with clear warning message
- Updated comment at top to explain the new security model (private key must be set via env var, public key has fallback)

**File: `src/components/shared/notification-permission.tsx`**
- Updated comment to clarify public key fallback matches `web-push.ts FALLBACK_VAPID_PUBLIC_KEY`
- Added note that public keys are safe to include in client-side code
- Kept fallback public key unchanged (consistent value)

**File: `src/components/shared/sw-registration.tsx`**
- Updated comment to clarify public key fallback matches `web-push.ts FALLBACK_VAPID_PUBLIC_KEY`
- Added note that public keys are safe to include in client-side code
- Kept fallback public key unchanged (consistent value)

**File: `src/components/shared/settings-section.tsx`**
- Fixed inconsistent VAPID public key: changed from `BEmz0poQ1JXb7aq39ZTW6t1OUSRMgFxaONIgKlUDYxEgW9P_pT-_etTSj9YV-gLOgFnqSEnPqjUuhLLJLAf5qEE` to `BJVI5gJTr0mRDS4ZcO63JtuPFcKQb-sEghvtV9NBV970s9D0weFCnxcbKrpUL8IBXY1g2sdxP74bM2cdOYrRZYI` (matching other client files and web-push.ts)

### Task 2: P1 - Fix Chat N+1 queries

**File: `src/app/api/chat/route.ts`**

**Problem 1 (messages action, ~line 464):**
- Replaced N+1 query pattern: `Promise.all(messages.map(async msg => { const sender = await supabase...single() }))`
- With batch approach: collect unique sender_ids → single `.in()` query → build Map → synchronous `.map()`
- Return format preserved: `{ messages: enrichedMessages.reverse() }`

**Problem 2 (participants action, ~line 502):**
- Replaced N+1 query pattern: `Promise.all(parts.map(async p => { const user = await supabase...single() }))`
- With batch approach: collect unique user_ids → single `.in()` query → build Map → synchronous `.map()`
- Return format preserved: `{ participants }`

### Verification
- `bun run lint` passes cleanly with no errors

Stage Summary:
- VAPID private key fully removed from source code — no fallback, fail-closed security model
- All client-side files now use consistent fallback public key
- Chat API N+1 queries fixed with batch fetch + Map lookup pattern
- All changes preserve exact return formats
- Lint passes cleanly

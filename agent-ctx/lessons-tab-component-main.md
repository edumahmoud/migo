# Task: Lessons Tab Component for AttenDo LMS

## Summary
Created the Lessons tab component (`lessons-tab.tsx`) for the AttenDo LMS platform with full bilingual Arabic/English support, along with its dependency (RichTextEditor) and i18n translation keys.

## Files Created/Modified

### Created
1. **`/home/z/my-project/src/components/course/tabs/lessons-tab.tsx`** — Main lessons tab component
2. **`/home/z/my-project/src/components/editor/rich-text-editor.tsx`** — Rich text editor component (dependency)

### Modified
3. **`/home/z/my-project/src/i18n/messages/en.json`** — Added `lessons` namespace with 30+ English translation keys
4. **`/home/z/my-project/src/i18n/messages/ar.json`** — Added `lessons` namespace with 30+ Arabic translation keys

## Component Features

### Teacher View
- **List View**: Grid of lesson cards with title, status badge (Draft=amber, Published=emerald), last updated date, word count, excerpt, and dropdown actions (Edit, Duplicate, Delete)
- **Editor View**: Split layout with:
  - Left sidebar (w-72): Back button, editable title input, status indicator, autosave status (Saved/Saving.../Unsaved changes), metadata (created date, last saved, word count)
  - Right content area: Top bar with Save, Publish/Unpublish, Preview buttons; RichTextEditor component
- **Autosave**: 3-second debounced autosave when unsaved changes detected
- **Delete confirmation**: AlertDialog for destructive actions
- **Empty state**: Book icon with "Create your first lesson" message

### Student View
- Read-only list of published lessons only
- Clicking a lesson opens a read-only view with lesson content
- No editing controls visible

### Technical Details
- Uses `getAuthHeaders` from `@/lib/client-auth` for all API calls
- Uses `supabase` from `@/lib/supabase` for real-time subscriptions
- Uses `useTranslations` with `lessons` namespace
- Uses framer-motion for animations
- Uses shadcn/ui components: Badge, Button, Input, DropdownMenu, AlertDialog
- RTL support throughout via `direction` from `useTranslations`
- Real-time updates via Supabase postgres_changes subscription
- Toast notifications for save/publish/delete operations

## API Endpoints Expected
- `GET /api/lessons?subject_id={id}` — Fetch lessons
- `POST /api/lessons` — Create lesson
- `PUT /api/lessons/{id}` — Save lesson
- `POST /api/lessons/{id}/publish` — Publish/unpublish lesson
- `DELETE /api/lessons/{id}` — Delete lesson

## Lint Status
✅ ESLint passes with no errors

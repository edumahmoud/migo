# Task 6: Improve AI question generation system

## Summary
All 3 requirements implemented successfully:

### 1. Show stage name during AI question generation
- Added prominent "Stage:" label + current stage name above step indicators
- Stage names: "Extracting text from file" / "Generating questions with AI" / "Saving questions to bank"
- Also added subject/course name as secondary text under the bank name

### 2. Make progress bar sticky
- Changed from inline flow (`mb-4`) to `sticky top-0 z-30`
- Added `shadow-md backdrop-blur-sm` for visibility when sticky
- Flat edges (no rounded-xl) when sticky for better visual integration

### 3. Save progress and allow background generation
- Created Zustand store (`ai-generation-store.ts`) that persists to localStorage
- State survives navigation away from question bank and back
- Auto-clears stale tasks older than 10 minutes
- AbortController remains as useRef (can't be serialized) — restored tasks can't be cancelled but auto-clear

## Files Modified
- `src/stores/ai-generation-store.ts` (NEW)
- `src/components/teacher/question-bank-section.tsx`
- `src/i18n/messages/ar.json`
- `src/i18n/messages/en.json`

## Lint: 0 errors

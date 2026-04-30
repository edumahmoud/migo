---
Task ID: 1
Agent: Main
Task: Set up Supabase environment variables and fix navigation blocking bug

Work Log:
- Added Supabase env vars (URL, anon key, service role key) to .env file
- Deep investigation of navigation blocking bug (hover works but clicks don't)
- Root cause identified: `inert` HTML attribute left on page content after navigation
- `inert` blocks ALL user interaction events (click, focus, keyboard) but NOT CSS :hover
- Previous fix attempts (v1-v3) used MutationObserver + 500ms interval but had timing gaps
- Rewrote navigation-cleanup.ts (v4) with requestAnimationFrame loop approach
- Updated SectionTransition component to remove `role="tabpanel"` and `aria-hidden` (these triggered `pointer-events: none !important` CSS rules)
- Removed `[role="tabpanel"][aria-hidden="true"]` CSS rules from globals.css (redundant with `hidden` class)

Stage Summary:
- Supabase environment variables configured
- navigation-cleanup.ts v4: rAF loop (every 16ms for 2s after nav), MutationObserver on <html>, 1s safety interval
- SectionTransition: simplified to use only `hidden` class (no aria-hidden or role attributes)
- globals.css: removed tabpanel/aria-hidden CSS rules that could interfere with interaction
- All code passes lint check

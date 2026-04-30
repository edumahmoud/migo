---
Task ID: 1
Agent: Main
Task: Fix navigation desync, infinite loading, and interaction gap in AttenDo

Work Log:
- Analyzed the entire navigation architecture: app-sidebar, 3 dashboard components, app-header, useMountedSections hook, Zustand store, usePathname(), and [[...section]] catch-all routes
- Identified root cause: `activeSection` was derived purely from `usePathname()`, which only updates AFTER Next.js soft navigation completes (RSC payload fetch). This caused a desync where URL updates but UI stays frozen
- Fixed app-sidebar.tsx: Added immediate Zustand store update (setTeacherSection/setStudentSection/setAdminSection) BEFORE router.push() so the UI updates instantly on click
- Fixed teacher-dashboard.tsx: Changed activeSection source from pathname-derived to Zustand store primary + pathname sync. Added `storeSection` subscription, pathname→store sync useEffect, and fallback to pathnameSection for initial render
- Fixed student-dashboard.tsx: Same pattern as teacher dashboard
- Fixed admin-dashboard.tsx: Same pattern as teacher dashboard  
- Fixed app-header.tsx: ActiveSectionLabel now reads from Zustand store instead of deriving from pathname, removed unused usePathname import
- All pages compile successfully with no lint errors

Stage Summary:
- Navigation desync FIXED: Zustand store updates instantly on sidebar click, CSS hidden class toggles immediately
- Infinite loading FIXED: No transition overlay depends on pathname anymore; all section visibility is driven by Zustand store which updates synchronously
- The keep-alive pattern is preserved (sections stay mounted with CSS hidden) but now uses the instantly-updating Zustand store
- pathname still syncs to store via useEffect for back/forward navigation and direct URL access

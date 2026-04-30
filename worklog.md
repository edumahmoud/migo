---
Task ID: 1
Agent: Main Agent
Task: Implement comprehensive RBAC security authorization system for AttenDo

Work Log:
- Explored entire codebase: proxy.ts, auth-helpers.ts, auth-store.ts, dashboard layout, route pages, API routes
- Identified root cause: NO server-side route protection + client-side only auth guard
- Discovered 6 critical security vulnerabilities across the application
- Updated proxy.ts (Next.js 16 middleware equivalent) with role-based route protection
- Removed insecure x-user-id header trust from auth-helpers.ts
- Added requireRole() function for per-endpoint RBAC in auth-helpers.ts
- Fixed createFallbackProfile() to NEVER trust user_metadata.role
- Created RoleGuard component for client-side defense layer
- Updated dashboard layout with role-to-URL validation
- Updated all 3 dashboard route pages with RoleGuard
- Fixed 7 unprotected API routes (P0/P1/P2)
- All lint checks pass cleanly

Stage Summary:
- Implemented Defense in Depth: 3 layers of security (Edge/Proxy → API Routes → Client RoleGuard)
- Student → /student only, Teacher → /teacher only, Admin/Superadmin → /admin only
- Removed x-user-id header trust vulnerability
- Fixed createFallbackProfile to always default to 'student' role
- Secured all previously unprotected API routes (admin/usage-stats, admin/data, attendance/manual-register, push/setup, chat/setup, check-ban, profile/[userId])
- App compiles and runs successfully with all changes

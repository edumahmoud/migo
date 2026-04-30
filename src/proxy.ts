import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';

// =====================================================
// AttenDo — Edge-Level Route Protection (Next.js 16 Proxy)
// =====================================================
//
// Security Architecture: Defense in Depth
// ─────────────────────────────────────────
//   Layer 1 (Edge/Proxy):   THIS FILE — validates session + role at the Edge
//   Layer 2 (API Routes):   auth-helpers.ts — authenticateRequest + requireRole
//   Layer 3 (Client):       RoleGuard component — client-side redirect
//
// This proxy enforces Role-Based Access Control (RBAC) at the server level.
// A student CANNOT access /admin or /teacher routes even if they manually change the URL.
//
// Role-to-Route Mapping (STRICT — Principle of Least Privilege):
//   student    → /student/*  only
//   teacher    → /teacher/*  only
//   admin      → /admin/*    only
//   superadmin → /admin/*    only
//
// Token Strategy:
//   - Supabase stores session in HTTP-only cookies (sb-<ref>-auth-token)
//   - Proxy reads cookies, verifies session with Supabase Auth
//   - Role is stored in app_metadata.role (synced by /api/auth/me from DB)
//   - app_metadata is server-set (user cannot modify it)
//   - Proxy does NOT query the DB for role checks on page routes (too slow for Edge)
//     — it trusts app_metadata for page routes
//   - API routes query the DB directly as the authoritative source
//
// Session Refresh:
//   - Supabase auth tokens expire; this proxy refreshes them via setAll()
//   - Fresh cookies are set on every matching request

// ─── Role-to-Route Access Control ───

type DashboardRole = 'student' | 'teacher' | 'admin' | 'superadmin';

const ROLE_ROUTE_MAP: Record<DashboardRole, string> = {
  student: '/student',
  teacher: '/teacher',
  admin: '/admin',
  superadmin: '/admin',
};

/**
 * Given a user role, determine which dashboard route prefix they are allowed to access.
 * Returns the allowed route prefix (e.g., '/admin') or null if role is invalid.
 */
function getAllowedRoute(role: string): string | null {
  return ROLE_ROUTE_MAP[role as DashboardRole] ?? null;
}

/**
 * Given a pathname, extract the dashboard route prefix.
 * Examples: /admin/users → /admin, /teacher/subjects → /teacher, /student → /student
 */
function getRoutePrefix(pathname: string): string | null {
  if (pathname.startsWith('/admin')) return '/admin';
  if (pathname.startsWith('/teacher')) return '/teacher';
  if (pathname.startsWith('/student')) return '/student';
  return null;
}

// Routes that require authentication for API access
const protectedApiRoutes = ['/api/gemini', '/api/admin', '/api/files'];

// Dashboard routes that require role validation
const dashboardRoutes = ['/student', '/teacher', '/admin'];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Skip static files, Next.js internals, auth callback, and socket.io
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/static') ||
    pathname.startsWith('/auth/callback') ||
    pathname.startsWith('/socket.io') ||
    pathname.includes('.') // static files
  ) {
    return NextResponse.next();
  }

  // Read env vars at request time (not module load time) for reliability
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    console.error('Proxy: Missing Supabase env vars');
    return NextResponse.next();
  }

  // ── ALWAYS create a Supabase server client to refresh auth cookies ──
  let response = NextResponse.next({ request });

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value);
        });
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  // Refresh the session – this will call setAll() if cookies need updating
  const { data: { user }, error } = await supabase.auth.getUser();

  // ── Determine if this is a dashboard route or API route ──
  const routePrefix = getRoutePrefix(pathname);
  const isDashboardRoute = dashboardRoutes.some(route => pathname.startsWith(route));
  const isProtectedApi = protectedApiRoutes.some(route => pathname.startsWith(route));
  const isAuthRoute = pathname === '/' || pathname.startsWith('/auth');

  // ═══════════════════════════════════════════════════════════
  // CASE 1: No valid session
  // ═══════════════════════════════════════════════════════════
  if (error || !user) {
    // Redirect to login for dashboard routes
    if (isDashboardRoute) {
      const loginUrl = new URL('/', request.url);
      return NextResponse.redirect(loginUrl);
    }

    // Return 401 for protected API routes (no Bearer token fallback here)
    if (isProtectedApi) {
      // Try Bearer token fallback for API routes
      const authHeader = request.headers.get('authorization');
      if (authHeader?.startsWith('Bearer ')) {
        const token = authHeader.substring(7);
        const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
        if (supabaseServiceKey) {
          try {
            const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
              auth: { autoRefreshToken: false, persistSession: false },
            });
            const { data: { user: headerUser }, error: headerError } = await supabaseAdmin.auth.getUser(token);

            if (headerError || !headerUser) {
              return NextResponse.json(
                { success: false, error: 'جلسة غير صالحة. يرجى تسجيل الدخول مرة أخرى' },
                { status: 401 }
              );
            }

            // For admin routes, verify the user is an admin
            if (pathname.startsWith('/api/admin')) {
              const jwtRole = headerUser.app_metadata?.role;
              if (jwtRole === 'admin' || jwtRole === 'superadmin') {
                // Role confirmed from JWT
              } else {
                const { data: profile } = await supabaseAdmin
                  .from('users')
                  .select('role')
                  .eq('id', headerUser.id)
                  .single();

                const userRole = profile?.role;
                if (!userRole || (userRole !== 'admin' && userRole !== 'superadmin')) {
                  return NextResponse.json(
                    { success: false, error: 'غير مصرح بالوصول' },
                    { status: 403 }
                  );
                }
              }
            }

            // Add user info to request headers for downstream use
            // NOTE: x-user-id is set by this PROXY only (not by clients)
            // API routes should still verify via authenticateRequest() as primary auth
            const requestHeaders = new Headers(request.headers);
            requestHeaders.set('x-user-id', headerUser.id);

            return NextResponse.next({
              request: { headers: requestHeaders },
            });
          } catch {
            return NextResponse.json(
              { success: false, error: 'خطأ في التحقق من الهوية' },
              { status: 401 }
            );
          }
        }
      }

      return NextResponse.json(
        { success: false, error: 'يرجى تسجيل الدخول أولاً' },
        { status: 401 }
      );
    }

    // Non-protected routes — let them through with refreshed cookies
    return response;
  }

  // ═══════════════════════════════════════════════════════════
  // CASE 2: User is authenticated
  // ═══════════════════════════════════════════════════════════

  // ─── If on auth route (login page) and already authenticated, redirect to dashboard ───
  if (isAuthRoute) {
    const role = (user.app_metadata?.role as string) || 'student';
    const allowedRoute = getAllowedRoute(role) || '/student';
    const redirectUrl = new URL(allowedRoute, request.url);
    return NextResponse.redirect(redirectUrl);
  }

  // ─── Role-Based Route Authorization for Dashboard Pages ───
  if (isDashboardRoute && routePrefix) {
    // Get role from app_metadata (synced from DB by /api/auth/me)
    // app_metadata is server-set — users CANNOT modify it
    const userRole = (user.app_metadata?.role as string) || 'student';
    const allowedRoute = getAllowedRoute(userRole);

    if (!allowedRoute) {
      // Invalid role — redirect to login
      const loginUrl = new URL('/', request.url);
      return NextResponse.redirect(loginUrl);
    }

    // 🚨 SECURITY: Check if user is trying to access a route they're not authorized for
    if (routePrefix !== allowedRoute) {
      // A student tried to access /admin, or a teacher tried to access /student, etc.
      // Redirect them to THEIR authorized dashboard.
      const redirectUrl = new URL(allowedRoute, request.url);
      return NextResponse.redirect(redirectUrl);
    }
  }

  // ─── Protected API route checks ───
  if (isProtectedApi) {
    // For admin routes, verify the user is an admin
    if (pathname.startsWith('/api/admin')) {
      const jwtRole = user.app_metadata?.role;
      if (jwtRole === 'admin' || jwtRole === 'superadmin') {
        // Role confirmed from JWT - no DB query needed
      } else {
        // Fallback: Query the database using service role key (bypasses RLS)
        const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
        if (!supabaseServiceKey) {
          return NextResponse.json(
            { success: false, error: 'خطأ في إعدادات الخادم' },
            { status: 500 }
          );
        }

        const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
          auth: { autoRefreshToken: false, persistSession: false },
        });
        const { data: profile } = await supabaseAdmin
          .from('users')
          .select('role')
          .eq('id', user.id)
          .single();

        const userRole = profile?.role;
        if (!userRole || (userRole !== 'admin' && userRole !== 'superadmin')) {
          return NextResponse.json(
            { success: false, error: 'غير مصرح بالوصول' },
            { status: 403 }
          );
        }
      }
    }

    // Add user info to request headers for downstream use
    // NOTE: x-user-id is set by this PROXY only (not by clients)
    // API routes should still verify via authenticateRequest() as primary auth
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set('x-user-id', user.id);

    return NextResponse.next({
      request: { headers: requestHeaders },
    });
  }

  // All other routes — pass through with refreshed cookies
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};

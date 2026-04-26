import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';

// Routes that require authentication
const protectedApiRoutes = ['/api/gemini', '/api/admin', '/api/files'];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Skip static files, Next.js internals, and auth callback
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/static') ||
    pathname.startsWith('/auth/callback') ||
    pathname.includes('.') // static files
  ) {
    return NextResponse.next();
  }

  // Read env vars at request time (not module load time) for reliability
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  
  if (!supabaseUrl || !supabaseAnonKey) {
    console.error('Middleware: Missing Supabase env vars');
    return NextResponse.next();
  }

  // ── ALWAYS create a Supabase server client to refresh auth cookies ──
  // This ensures the access token is refreshed on every page load / navigation,
  // preventing stale tokens that cause RLS policy failures on client-side queries.
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
  await supabase.auth.getUser();

  // ── Protected API route checks ──
  const isProtectedApi = protectedApiRoutes.some(route => pathname.startsWith(route));

  if (!isProtectedApi) {
    // Not a protected API route – just return the response with refreshed cookies
    return response;
  }

  // Verify the user using the session from cookies
  try {
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    if (error || !user) {
      // Also try to get token from Authorization header as fallback
      const authHeader = request.headers.get('authorization');
      if (authHeader?.startsWith('Bearer ')) {
        const token = authHeader.substring(7);
        const { data: { user: headerUser }, error: headerError } = await supabase.auth.getUser(token);

        if (headerError || !headerUser) {
          return NextResponse.json(
            { success: false, error: 'جلسة غير صالحة. يرجى تسجيل الدخول مرة أخرى' },
            { status: 401 }
          );
        }

        // For admin routes, verify the user is an admin
        if (pathname.startsWith('/api/admin')) {
          // Check 1: Fast path - check role from JWT claims (app_metadata synced by /api/auth/me)
          const jwtRole = headerUser.app_metadata?.role || headerUser.user_metadata?.role;
          if (jwtRole === 'admin' || jwtRole === 'superadmin') {
            // Role confirmed from JWT - no DB query needed
          } else {
            // Check 2: Query the database using service role key (bypasses RLS)
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
        const requestHeaders = new Headers(request.headers);
        requestHeaders.set('x-user-id', headerUser.id);

        return NextResponse.next({
          request: { headers: requestHeaders },
        });
      }

      return NextResponse.json(
        { success: false, error: 'يرجى تسجيل الدخول أولاً' },
        { status: 401 }
      );
    }

    // For admin routes, verify the user is an admin
    if (pathname.startsWith('/api/admin')) {
      // Check 1: Fast path - check role from JWT claims (app_metadata synced by /api/auth/me)
      const jwtRole = user.app_metadata?.role || user.user_metadata?.role;
      if (jwtRole === 'admin' || jwtRole === 'superadmin') {
        // Role confirmed from JWT - no DB query needed
      } else {
        // Check 2: Query the database using service role key (bypasses RLS)
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
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set('x-user-id', user.id);

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

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};

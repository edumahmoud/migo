import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);

  const code = searchParams.get('code');
  // If there's an error from the OAuth provider
  const error = searchParams.get('error');
  const errorDescription = searchParams.get('error_description');

  if (error) {
    console.error('OAuth error:', error, errorDescription);
    return NextResponse.redirect(`${origin}?auth_error=${encodeURIComponent(errorDescription || error)}`);
  }

  if (!code) {
    // No code - redirect to home
    return NextResponse.redirect(origin);
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

  if (!supabaseUrl || !supabaseAnonKey) {
    console.error('Missing Supabase configuration');
    return NextResponse.redirect(`${origin}?auth_error=${encodeURIComponent('خطأ في إعدادات الخادم')}`);
  }

  // Track the redirect URL (may be updated later)
  let redirectUrl = origin;

  // Create a response object that we'll use to set cookies
  // We'll rebuild it after the Supabase client sets cookies
  let response = NextResponse.redirect(redirectUrl);

  // Create the Supabase server client with proper cookie handling
  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        // Set cookies on the request for subsequent reads within this request
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value);
        });
        // Rebuild the response with the current redirect URL and all cookies
        response = NextResponse.redirect(redirectUrl);
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  // Exchange the code for a session - this will trigger the setAll callback to set auth cookies
  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);

  if (exchangeError) {
    console.error('Code exchange error:', exchangeError.message);
    return NextResponse.redirect(`${origin}?auth_error=${encodeURIComponent('فشل في التحقق من الهوية')}`);
  }

  // Get the user from the session
  const { data: { user }, error: userError } = await supabase.auth.getUser();

  if (userError || !user) {
    console.error('Get user error:', userError?.message);
    return NextResponse.redirect(`${origin}?auth_error=${encodeURIComponent('فشل في الحصول على بيانات المستخدم')}`);
  }

  // Check if the user has a profile in the users table
  if (supabaseServiceKey) {
    // Create an admin client for profile operations (doesn't need cookie handling)
    const supabaseAdmin = createServerClient(supabaseUrl, supabaseServiceKey, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll() {
          // Admin client doesn't need to set cookies on the response
        },
      },
    });

    const { data: profile } = await supabaseAdmin
      .from('users')
      .select('id, role')
      .eq('id', user.id)
      .single();

    if (!profile) {
      // User doesn't have a profile yet - create a basic one
      const userName = user.user_metadata?.full_name || user.user_metadata?.name || user.email?.split('@')[0] || 'مستخدم';
      const avatarUrl = user.user_metadata?.avatar_url || null;

      // Check if this is the first user on the platform (should be superadmin)
      const { count: userCount } = await supabaseAdmin
        .from('users')
        .select('id', { count: 'exact', head: true });

      const isFirstUser = (userCount ?? 0) === 0;
      const defaultRole = isFirstUser ? 'superadmin' : 'student';

      const { error: insertError } = await supabaseAdmin
        .from('users')
        .insert({
          id: user.id,
          email: user.email || '',
          name: userName,
          role: defaultRole,
          avatar_url: avatarUrl,
        });

      if (insertError) {
        // If duplicate key, profile was already created (race condition)
        const err = insertError as { code?: string; message?: string };
        if (err.code !== '23505' && !(err.message || '').includes('duplicate key')) {
          console.error('Profile creation error:', insertError.message);
        }
      }

      // Redirect to home - new Google user will be routed to student-dashboard
      // Update the redirect URL and rebuild the response with auth cookies
      redirectUrl = `${origin}?new_user=true`;
      response = NextResponse.redirect(redirectUrl);
      // Copy all cookies that were set during the exchange from the request
      request.cookies.getAll().forEach((cookie) => {
        response.cookies.set(cookie.name, cookie.value);
      });
      return response;
    }
  }

  // Return the response with auth cookies properly set
  return response;
}

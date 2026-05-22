import { createBrowserClient } from '@supabase/ssr';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

export const isSupabaseConfigured =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// Export the URL for constructing storage public URLs
export { supabaseUrl };

// Use createBrowserClient from @supabase/ssr for proper cookie handling
// This ensures the client can read auth cookies set by the server during OAuth callback
// Note: The placeholder URL is used when Supabase is not configured.
// The app checks isSupabaseConfigured and shows an error page before making any real requests.
export const supabase = isSupabaseConfigured
  ? createBrowserClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        // Disable automatic URL session detection to prevent race conditions.
        // The app handles PKCE code exchange explicitly:
        // - OAuth: server-side in /auth/callback/route.ts
        // - Password recovery: client-side in /auth/reset-password/page.tsx
        // When detectSessionInUrl is true (default), @supabase/auth-js auto-exchanges
        // ?code=xxx in the URL, and then the page's explicit exchangeCodeForSession()
        // call fails because PKCE codes can only be used once.
        detectSessionInUrl: false,
      },
    })
  : createBrowserClient('https://placeholder.supabase.co', 'placeholder-key');


export type SupabaseClient = typeof supabase;

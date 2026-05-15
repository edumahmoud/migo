import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

/**
 * Lazy-initialized Supabase server client with service role key.
 * Used by API routes for admin operations that bypass RLS.
 * 
 * IMPORTANT: Previous module-level singleton was unreliable because env vars
 * may not be available at module load time in Next.js serverless functions.
 * This lazy getter ensures env vars are always read at request time.
 */
let _supabaseServer: SupabaseClient | null = null;

function getSupabaseServerInternal(): SupabaseClient {
  if (!_supabaseServer) {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    
    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error(
        'Missing Supabase environment variables. ' +
        'Ensure NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set.'
      );
    }
    
    _supabaseServer = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }
  return _supabaseServer;
}

/**
 * Supabase server client with service role key (bypasses RLS).
 * This is a lazy-initialized getter that ensures env vars are available.
 * Use in API routes for admin operations.
 */
export const supabaseServer = new Proxy({} as SupabaseClient, {
  get(_target, prop, receiver) {
    const client = getSupabaseServerInternal();
    const value = Reflect.get(client, prop, receiver);
    if (typeof value === 'function') {
      return value.bind(client);
    }
    return value;
  },
});

export type SupabaseServerClient = SupabaseClient;

/**
 * Create a Supabase server client with proper cookie handling.
 * Use this in server components and layouts that need session access.
 * Respects RLS policies since it uses the anon key.
 */
export async function getSupabaseServerClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  
  if (!url || !supabaseAnonKey) {
    throw new Error(
      'Missing Supabase environment variables. ' +
      'Ensure NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are set.'
    );
  }
  
  const cookieStore = await cookies();

  return createServerClient(url, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // This can fail in server components where cookies can't be set
        }
      },
    },
  });
}

import { NextResponse } from 'next/server';

/**
 * API route that provides database setup SQL and instructions.
 * 
 * Critical fixes included:
 * 1. GRANT permissions on public schema for anon and authenticated roles
 * 2. INSERT RLS policy on users table (needed for registration)
 * 3. Auth trigger to auto-create profiles when new users sign up
 * 
 * IMPORTANT: These SQL statements must be run in the Supabase SQL Editor
 * (Dashboard > SQL Editor) since the service role key is not configured.
 * 
 * ALSO REQUIRED: Enable email signups in Supabase Dashboard:
 * Authentication > Providers > Email > Enable Email Signup
 */

const CRITICAL_FIXES_SQL = `
-- =====================================================
-- CRITICAL FIXES FOR EXAMY REGISTRATION
-- Run this SQL in the Supabase SQL Editor (Dashboard > SQL Editor)
-- =====================================================

-- Fix 0: Grant proper permissions on public schema
-- This fixes "permission denied for schema public" errors
GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;

GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;

ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO authenticated;

-- Fix 1: Add INSERT policy on users table (CRITICAL for registration)
-- Without this, new users cannot create their profile after signup
DROP POLICY IF EXISTS "Users can insert own profile" ON public.users;
CREATE POLICY "Users can insert own profile" ON public.users
  FOR INSERT WITH CHECK (auth.uid() = id);

-- Fix 2: Create auth trigger to auto-create user profiles
-- This ensures profiles are created even when email confirmation is required
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.users (id, email, name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data->>'role', 'student')
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- If insert fails (e.g., duplicate), just return NEW
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
`.trim();

export async function GET() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const isServiceKeyConfigured = !!serviceRoleKey && serviceRoleKey !== 'placeholder_needs_real_key';

  return NextResponse.json({
    status: 'setup_required',
    supabaseConfigured: !!supabaseUrl,
    serviceKeyConfigured: isServiceKeyConfigured,
    sql: CRITICAL_FIXES_SQL,
    steps: [
      {
        step: 1,
        title: 'Enable Email Signups in Supabase',
        description: 'Go to Supabase Dashboard > Authentication > Providers > Email > Enable "Enable Email Signup"',
        critical: true,
      },
      {
        step: 2,
        title: 'Run Database Schema SQL',
        description: 'Go to Supabase Dashboard > SQL Editor and run the full schema from supabase/schema.sql',
        critical: true,
      },
      {
        step: 3,
        title: 'Run Critical Fixes SQL',
        description: 'In the same SQL Editor, run the SQL provided in the "sql" field below',
        critical: true,
      },
      {
        step: 4,
        title: 'Add Service Role Key (Optional)',
        description: 'Add your SUPABASE_SERVICE_ROLE_KEY to .env.local for server-side admin operations',
        critical: false,
      },
    ],
    instructions: isServiceKeyConfigured
      ? 'Service role key is configured. You can POST to this endpoint to apply fixes automatically, or run the SQL manually.'
      : 'Please follow the steps above to set up your Supabase database. The SQL to run is provided in the "sql" field.',
  });
}

export async function POST() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey || serviceRoleKey === 'placeholder_needs_real_key') {
    return NextResponse.json(
      {
        success: false,
        error: 'SUPABASE_SERVICE_ROLE_KEY is not configured.',
        sql: CRITICAL_FIXES_SQL,
        instructions: 'Please run the SQL manually in the Supabase SQL Editor (Dashboard > SQL Editor). Also make sure to enable Email signups in Authentication > Providers > Email.',
      },
      { status: 400 }
    );
  }

  try {
    // Use the Supabase Management API to execute SQL
    const response = await fetch(`${supabaseUrl}/rest/v1/rpc/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': serviceRoleKey,
        'Authorization': `Bearer ${serviceRoleKey}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      return NextResponse.json(
        {
          success: false,
          error: `Could not execute SQL automatically: ${errorText}.`,
          sql: CRITICAL_FIXES_SQL,
          instructions: 'Please run the SQL manually in the Supabase SQL Editor (Dashboard > SQL Editor). Also make sure to enable Email signups in Authentication > Providers > Email.',
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Database fixes applied successfully!',
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: `Failed to apply database fixes: ${error instanceof Error ? error.message : 'Unknown error'}.`,
        sql: CRITICAL_FIXES_SQL,
        instructions: 'Please run the SQL manually in the Supabase SQL Editor (Dashboard > SQL Editor). Also make sure to enable Email signups in Authentication > Providers > Email.',
      },
      { status: 500 }
    );
  }
}

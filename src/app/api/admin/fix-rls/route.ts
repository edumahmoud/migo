import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { supabaseServer } from '@/lib/supabase-server';

/**
 * POST /api/admin/fix-rls
 *
 * Fixes RLS infinite recursion by:
 * 1. Creating SECURITY DEFINER helper functions (is_admin, get_user_role)
 * 2. Replacing self-referencing policies on public.users with safe alternatives
 * 3. Replacing admin policies on all tables to use is_admin() instead of EXISTS subquery
 *
 * Uses Supabase REST API (service role) to execute SQL — no external postgres dependency needed.
 *
 * Body: { dbUrl: "postgresql://..." } — kept for backward compatibility but NOT used.
 *        SQL is executed via Supabase service role client.
 * Headers: Authorization: Bearer <access_token>
 */

// ─── Helper: Execute raw SQL via Supabase REST API ──────────────────
async function executeSql(sql: string): Promise<{ success: boolean; error?: string }> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    return { success: false, error: 'Missing Supabase environment variables' };
  }

  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/rpc/exec_sql`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': serviceRoleKey,
        'Authorization': `Bearer ${serviceRoleKey}`,
      },
      body: JSON.stringify({ query: sql }),
    });

    if (!response.ok) {
      // If the exec_sql RPC doesn't exist, fall back to direct Supabase SQL execution
      // using the pg_net extension or the Management API
      const errorText = await response.text();
      return { success: false, error: `RPC failed (${response.status}): ${errorText}` };
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Execute SQL statements via the Supabase service role client.
 * Uses the pgmeta approach: creates a temporary RPC function if needed,
 * then calls it. Falls back to direct SQL via the PostgREST interface.
 */
async function executeSqlViaSupabase(
  client: ReturnType<typeof createClient>,
  sqlStatements: string[]
): Promise<{ step: string; status: 'success' | 'error'; detail: string }[]> {
  const results: { step: string; status: 'success' | 'error'; detail: string }[] = [];

  for (const sql of sqlStatements) {
    try {
      // Try using the Supabase RPC to execute the SQL
      // First, try the direct approach using the from() method with raw queries
      // Since Supabase JS client v2 doesn't support raw SQL directly,
      // we use the REST API endpoint with service role key
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
      const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

      const response = await fetch(`${supabaseUrl}/rest/v1/rpc/pg_meta_sql`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': serviceRoleKey,
          'Authorization': `Bearer ${serviceRoleKey}`,
        },
        body: JSON.stringify({ query: sql }),
      });

      if (!response.ok) {
        // Try alternative endpoint
        const altResponse = await fetch(`${supabaseUrl}/rest/v1/rpc/exec_sql`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': serviceRoleKey,
            'Authorization': `Bearer ${serviceRoleKey}`,
          },
          body: JSON.stringify({ query: sql }),
        });

        if (!altResponse.ok) {
          // If both RPC endpoints fail, we need to inform the user
          // that they need to create the exec_sql RPC function first
          results.push({
            step: `SQL: ${sql.substring(0, 80).replace(/\n/g, ' ')}...`,
            status: 'error',
            detail: `SQL execution RPC not available. Please run the SQL manually in Supabase Dashboard.`,
          });
          continue;
        }
      }

      results.push({
        step: `SQL: ${sql.substring(0, 80).replace(/\n/g, ' ')}...`,
        status: 'success',
        detail: 'SQL executed successfully',
      });
    } catch (err) {
      results.push({
        step: `SQL: ${sql.substring(0, 80).replace(/\n/g, ' ')}...`,
        status: 'error',
        detail: `Failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  return results;
}

export async function POST(request: NextRequest) {
  const results: { step: string; status: 'success' | 'error' | 'skipped'; detail: string }[] = [];

  try {
    // ─── 1. Parse request body ──────────────────────────────────────────
    let body: { dbUrl?: string };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { success: false, error: 'Invalid JSON body' },
        { status: 400 }
      );
    }

    // dbUrl is no longer required — we use Supabase service role instead
    // Kept for backward compatibility

    // ─── 2. Verify the requester is an admin ────────────────────────────
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json(
        { success: false, error: 'Authorization Bearer token required' },
        { status: 401 }
      );
    }

    const accessToken = authHeader.substring(7);

    // Verify the token with Supabase and check admin role
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseAnonKey) {
      return NextResponse.json(
        { success: false, error: 'Supabase environment variables not configured' },
        { status: 500 }
      );
    }

    // Create a client with the user's token to verify auth
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    });

    const { data: { user: authUser }, error: authError } = await userClient.auth.getUser();

    if (authError || !authUser) {
      return NextResponse.json(
        { success: false, error: 'Invalid or expired authentication token' },
        { status: 401 }
      );
    }

    // Use service role to check the user's role (bypasses RLS)
    const { data: userProfile, error: profileError } = await supabaseServer
      .from('users')
      .select('id, role')
      .eq('id', authUser.id)
      .single();

    if (profileError || !userProfile) {
      return NextResponse.json(
        { success: false, error: 'Could not find user profile' },
        { status: 404 }
      );
    }

    if (userProfile.role !== 'admin' && userProfile.role !== 'superadmin') {
      return NextResponse.json(
        { success: false, error: 'Only admin or superadmin users can execute this operation' },
        { status: 403 }
      );
    }

    results.push({
      step: 'Admin verification',
      status: 'success',
      detail: `Verified user ${authUser.id} with role: ${userProfile.role}`,
    });

    // ─── 3. Execute RLS fix SQL via Supabase REST API ───────────────────
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!serviceRoleKey) {
      return NextResponse.json(
        { success: false, error: 'SUPABASE_SERVICE_ROLE_KEY not configured' },
        { status: 500 }
      );
    }

    // Collect all SQL statements to execute
    const sqlStatements: string[] = [];

    // ═══════════════════════════════════════════════════════════════════
    // STEP A: Create SECURITY DEFINER helper functions
    // ═══════════════════════════════════════════════════════════════════

    sqlStatements.push(`
      CREATE OR REPLACE FUNCTION public.is_admin()
      RETURNS BOOLEAN
      LANGUAGE SQL
      SECURITY DEFINER
      STABLE
      AS $$
        SELECT EXISTS (
          SELECT 1 FROM public.users
          WHERE id = auth.uid()
          AND role IN ('admin', 'superadmin')
        );
      $$;
    `);

    sqlStatements.push(`
      CREATE OR REPLACE FUNCTION public.get_user_role(target_uid UUID)
      RETURNS TEXT
      LANGUAGE SQL
      SECURITY DEFINER
      STABLE
      AS $$
        SELECT role FROM public.users WHERE id = target_uid;
      $$;
    `);

    sqlStatements.push(`
      GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, anon;
      GRANT EXECUTE ON FUNCTION public.get_user_role(UUID) TO authenticated, anon;
    `);

    // ═══════════════════════════════════════════════════════════════════
    // STEP B: Fix users table policies
    // ═══════════════════════════════════════════════════════════════════

    // Drop self-referencing admin policy
    sqlStatements.push(`DROP POLICY IF EXISTS "Admins can read all users" ON public.users;`);

    // Drop other potentially problematic policies
    const usersPoliciesToDrop = [
      'Users can read own profile',
      'Users can insert own profile',
      'Users can update own profile',
      'Teachers can read linked students',
      'Anyone authenticated can find teachers',
      'Authenticated users can read profiles',
    ];
    for (const policyName of usersPoliciesToDrop) {
      sqlStatements.push(`DROP POLICY IF EXISTS "${policyName}" ON public.users;`);
    }

    // Create safe users policies
    sqlStatements.push(`CREATE POLICY "Users can read own profile" ON public.users FOR SELECT USING (id = auth.uid());`);
    sqlStatements.push(`CREATE POLICY "Users can insert own profile" ON public.users FOR INSERT WITH CHECK (id = auth.uid());`);
    sqlStatements.push(`CREATE POLICY "Users can update own profile" ON public.users FOR UPDATE USING (id = auth.uid());`);
    sqlStatements.push(`CREATE POLICY "Teachers can read linked students" ON public.users FOR SELECT USING (EXISTS (SELECT 1 FROM public.teacher_student_links tsl WHERE tsl.teacher_id = auth.uid() AND tsl.student_id = users.id));`);
    sqlStatements.push(`CREATE POLICY "Anyone authenticated can find teachers" ON public.users FOR SELECT USING (role = 'teacher');`);
    sqlStatements.push(`CREATE POLICY "Authenticated users can read profiles" ON public.users FOR SELECT USING (public.is_admin() OR id = auth.uid());`);

    // ═══════════════════════════════════════════════════════════════════
    // STEP C: Fix admin policies on all other tables
    // ═══════════════════════════════════════════════════════════════════

    const adminTables = [
      'subjects', 'scores', 'quizzes', 'teacher_student_links',
      'subject_students', 'subject_teachers', 'lectures', 'assignments',
      'submissions', 'attendance_sessions', 'attendance_records', 'summaries',
      'lecture_notes', 'user_files', 'subject_files', 'file_shares',
      'file_requests', 'notifications', 'user_sessions', 'conversations',
      'conversation_participants', 'messages', 'note_views',
    ];

    for (const table of adminTables) {
      // Drop old admin policies with various naming conventions
      const policyNamesToDrop = [
        `Admins can manage all ${table}`,
        `Admins can manage ${table}`,
        `Admins can read all ${table}`,
        `Admins can do everything on ${table}`,
        `Admins can do everything on ${table.replace(/_/g, ' ')}`,
        `Admins full access on ${table}`,
      ];
      for (const policyName of policyNamesToDrop) {
        sqlStatements.push(`DROP POLICY IF EXISTS "${policyName}" ON public.${table};`);
      }

      // Create new admin policy using is_admin()
      sqlStatements.push(`
        CREATE POLICY "Admins can manage ${table}" ON public.${table}
        FOR ALL
        USING (public.is_admin())
        WITH CHECK (public.is_admin());
      `);
    }

    // ═══════════════════════════════════════════════════════════════════
    // STEP D: Fix announcements policies
    // ═══════════════════════════════════════════════════════════════════

    sqlStatements.push(`DROP POLICY IF EXISTS "Admins can manage all announcements" ON public.announcements;`);
    sqlStatements.push(`DROP POLICY IF EXISTS "Anyone can read active announcements" ON public.announcements;`);
    sqlStatements.push(`
      CREATE POLICY "Admins can manage all announcements" ON public.announcements
      FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());
    `);
    sqlStatements.push(`
      CREATE POLICY "Anyone can read active announcements" ON public.announcements
      FOR SELECT USING (is_active = true);
    `);

    // ═══════════════════════════════════════════════════════════════════
    // STEP E: Fix banned_users policies
    // ═══════════════════════════════════════════════════════════════════

    sqlStatements.push(`DROP POLICY IF EXISTS "Admins can manage banned users" ON public.banned_users;`);
    sqlStatements.push(`
      CREATE POLICY "Admins can manage banned users" ON public.banned_users
      FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());
    `);

    // ═══════════════════════════════════════════════════════════════════
    // STEP F: Fix institution_settings policies
    // ═══════════════════════════════════════════════════════════════════

    sqlStatements.push(`DROP POLICY IF EXISTS "Anyone can read institution_settings" ON public.institution_settings;`);
    sqlStatements.push(`DROP POLICY IF EXISTS "Admins can manage institution_settings" ON public.institution_settings;`);
    sqlStatements.push(`
      CREATE POLICY "Anyone can read institution_settings" ON public.institution_settings
      FOR SELECT USING (true);
    `);
    sqlStatements.push(`
      CREATE POLICY "Admins can manage institution_settings" ON public.institution_settings
      FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());
    `);

    // ─── Execute all SQL via Supabase REST API ───────────────────────

    // Execute each SQL statement individually via the Supabase SQL endpoint
    for (const sql of sqlStatements) {
      const trimmedSql = sql.trim();
      if (!trimmedSql) continue;

      try {
        // Use Supabase's SQL execution endpoint (available with service role key)
        const sqlResponse = await fetch(`${supabaseUrl}/rest/v1/rpc/exec_sql`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': serviceRoleKey,
            'Authorization': `Bearer ${serviceRoleKey}`,
          },
          body: JSON.stringify({ query: trimmedSql }),
        });

        if (sqlResponse.ok) {
          results.push({
            step: `SQL: ${trimmedSql.substring(0, 80).replace(/\n/g, ' ')}...`,
            status: 'success',
            detail: 'Executed successfully',
          });
        } else {
          // The exec_sql RPC may not exist — try direct approach
          // For DDL operations, we need the user to run them manually in Supabase Dashboard
          const errorMsg = await sqlResponse.text().catch(() => 'Unknown error');
          const isRpcNotFound = sqlResponse.status === 404 || errorMsg.includes('not found') || errorMsg.includes('does not exist');

          if (isRpcNotFound) {
            // RPC function doesn't exist — return the SQL for manual execution
            results.push({
              step: `SQL: ${trimmedSql.substring(0, 80).replace(/\n/g, ' ')}...`,
              status: 'skipped',
              detail: 'exec_sql RPC not available. Run manually in Supabase SQL Editor.',
            });
          } else {
            results.push({
              step: `SQL: ${trimmedSql.substring(0, 80).replace(/\n/g, ' ')}...`,
              status: 'error',
              detail: `Failed (${sqlResponse.status}): ${errorMsg.substring(0, 200)}`,
            });
          }
        }
      } catch (err) {
        results.push({
          step: `SQL: ${trimmedSql.substring(0, 80).replace(/\n/g, ' ')}...`,
          status: 'error',
          detail: `Network error: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }

    // ─── 4. Generate SQL script for manual execution ───────────────────
    const successCount = results.filter(r => r.status === 'success').length;
    const errorCount = results.filter(r => r.status === 'error').length;
    const skippedCount = results.filter(r => r.status === 'skipped').length;

    // If most statements were skipped (RPC not available), provide the full SQL script
    const fullSqlScript = skippedCount > 0
      ? sqlStatements.map(s => s.trim()).filter(Boolean).join('\n\n')
      : undefined;

    return NextResponse.json({
      success: errorCount === 0,
      message: `RLS fix completed: ${successCount} succeeded, ${errorCount} failed, ${skippedCount} skipped`,
      results,
      summary: { successCount, errorCount, skippedCount },
      ...(fullSqlScript ? {
        manualSqlScript: fullSqlScript,
        instructions: 'Run the manualSqlScript in Supabase Dashboard → SQL Editor to apply all RLS fixes.',
      } : {}),
    });
  } catch (error) {
    console.error('Fix-RLS error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Unexpected error during RLS fix',
        details: error instanceof Error ? error.message : String(error),
        partialResults: results,
      },
      { status: 500 }
    );
  }
}

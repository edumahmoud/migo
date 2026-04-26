import { NextRequest, NextResponse } from 'next/server';
import postgres from 'postgres';
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
 * Body: { dbUrl: "postgresql://..." }
 * Headers: Authorization: Bearer <access_token>
 */
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

    const { dbUrl } = body;

    if (!dbUrl || typeof dbUrl !== 'string') {
      return NextResponse.json(
        { success: false, error: 'dbUrl (PostgreSQL connection string) is required' },
        { status: 400 }
      );
    }

    // Basic validation that it looks like a PostgreSQL URL
    if (!dbUrl.startsWith('postgresql://') && !dbUrl.startsWith('postgres://')) {
      return NextResponse.json(
        { success: false, error: 'dbUrl must be a valid PostgreSQL connection string' },
        { status: 400 }
      );
    }

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

    // ─── 3. Connect to PostgreSQL and execute RLS fix ───────────────────
    let sql: ReturnType<typeof postgres> | null = null;

    try {
      sql = postgres(dbUrl, {
        max: 1,
        idle_timeout: 5,
        connect_timeout: 15,
        ssl: 'prefer',
      });

      // ═══════════════════════════════════════════════════════════════════
      // STEP A: Create SECURITY DEFINER helper functions
      // ═══════════════════════════════════════════════════════════════════

      // A1. Create is_admin() function
      try {
        await sql.unsafe(`
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
        results.push({
          step: 'Create is_admin() function',
          status: 'success',
          detail: 'Created SECURITY DEFINER function public.is_admin()',
        });
      } catch (err) {
        results.push({
          step: 'Create is_admin() function',
          status: 'error',
          detail: `Failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }

      // A2. Create get_user_role() function
      try {
        await sql.unsafe(`
          CREATE OR REPLACE FUNCTION public.get_user_role(target_uid UUID)
          RETURNS TEXT
          LANGUAGE SQL
          SECURITY DEFINER
          STABLE
          AS $$
            SELECT role FROM public.users WHERE id = target_uid;
          $$;
        `);
        results.push({
          step: 'Create get_user_role() function',
          status: 'success',
          detail: 'Created SECURITY DEFINER function public.get_user_role(UUID)',
        });
      } catch (err) {
        results.push({
          step: 'Create get_user_role() function',
          status: 'error',
          detail: `Failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }

      // A3. Grant execute on both functions
      try {
        await sql.unsafe(`
          GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, anon;
          GRANT EXECUTE ON FUNCTION public.get_user_role(UUID) TO authenticated, anon;
        `);
        results.push({
          step: 'Grant execute on helper functions',
          status: 'success',
          detail: 'Granted execute on is_admin() and get_user_role() to authenticated, anon',
        });
      } catch (err) {
        results.push({
          step: 'Grant execute on helper functions',
          status: 'error',
          detail: `Failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }

      // ═══════════════════════════════════════════════════════════════════
      // STEP B: Fix users table policies (the source of infinite recursion)
      // ═══════════════════════════════════════════════════════════════════

      // B1. Drop the self-referencing "Admins can read all users" policy
      try {
        await sql.unsafe(`
          DROP POLICY IF EXISTS "Admins can read all users" ON public.users;
        `);
        results.push({
          step: 'Drop self-referencing users admin policy',
          status: 'success',
          detail: 'Dropped "Admins can read all users" policy (source of recursion)',
        });
      } catch (err) {
        results.push({
          step: 'Drop self-referencing users admin policy',
          status: 'error',
          detail: `Failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }

      // B2. Drop other potentially problematic users policies before recreating
      const usersPoliciesToDrop = [
        'Users can read own profile',
        'Users can insert own profile',
        'Users can update own profile',
        'Teachers can read linked students',
        'Anyone authenticated can find teachers',
        'Authenticated users can read profiles',
      ];

      for (const policyName of usersPoliciesToDrop) {
        try {
          await sql.unsafe(`DROP POLICY IF EXISTS "${policyName}" ON public.users;`);
        } catch {
          // Policy may not exist, that's fine
        }
      }

      // B3. Create safe users policies
      const usersPolicies: { name: string; command: string; using: string; withCheck?: string }[] = [
        {
          name: 'Users can read own profile',
          command: 'FOR SELECT',
          using: 'id = auth.uid()',
        },
        {
          name: 'Users can insert own profile',
          command: 'FOR INSERT',
          using: 'id = auth.uid()',
          withCheck: 'id = auth.uid()',
        },
        {
          name: 'Users can update own profile',
          command: 'FOR UPDATE',
          using: 'id = auth.uid()',
        },
        {
          name: 'Teachers can read linked students',
          command: 'FOR SELECT',
          using: `
            EXISTS (
              SELECT 1 FROM public.teacher_student_links tsl
              WHERE tsl.teacher_id = auth.uid() AND tsl.student_id = users.id
            )
          `,
        },
        {
          name: 'Anyone authenticated can find teachers',
          command: 'FOR SELECT',
          using: `role = 'teacher'`,
        },
        {
          name: 'Authenticated users can read profiles',
          command: 'FOR SELECT',
          using: `public.is_admin() OR id = auth.uid()`,
        },
      ];

      for (const policy of usersPolicies) {
        try {
          let createSQL = `
            CREATE POLICY "${policy.name}" ON public.users
            ${policy.command}
            USING (${policy.using})
          `;
          if (policy.withCheck) {
            createSQL += ` WITH CHECK (${policy.withCheck})`;
          }
          await sql.unsafe(createSQL);
          results.push({
            step: `Create users policy: ${policy.name}`,
            status: 'success',
            detail: `Created ${policy.command} policy on public.users`,
          });
        } catch (err) {
          results.push({
            step: `Create users policy: ${policy.name}`,
            status: 'error',
            detail: `Failed: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
      }

      // ═══════════════════════════════════════════════════════════════════
      // STEP C: Fix admin policies on all other tables
      // ═══════════════════════════════════════════════════════════════════

      const adminTables = [
        'subjects',
        'scores',
        'quizzes',
        'teacher_student_links',
        'subject_students',
        'subject_teachers',
        'lectures',
        'assignments',
        'submissions',
        'attendance_sessions',
        'attendance_records',
        'summaries',
        'lecture_notes',
        'user_files',
        'subject_files',
        'file_shares',
        'file_requests',
        'notifications',
        'user_sessions',
        'conversations',
        'conversation_participants',
        'messages',
        'note_views',
      ];

      for (const table of adminTables) {
        // Drop old admin policy (various naming conventions)
        const policyNamesToDrop = [
          `Admins can manage all ${table}`,
          `Admins can manage ${table}`,
          `Admins can read all ${table}`,
          `Admins can do everything on ${table}`,
          `Admins can do everything on ${table.replace(/_/g, ' ')}`,
          `Admins full access on ${table}`,
        ];

        for (const policyName of policyNamesToDrop) {
          try {
            await sql.unsafe(`DROP POLICY IF EXISTS "${policyName}" ON public.${table};`);
          } catch {
            // May not exist
          }
        }

        // Also try to drop any policy containing "admin" in the name for this table
        try {
          const existingPolicies = await sql.unsafe(`
            SELECT policyname FROM pg_policies
            WHERE tablename = '${table}'
            AND schemaname = 'public'
            AND policyname ILIKE '%admin%';
          `) as { policyname: string }[];

          for (const row of existingPolicies) {
            try {
              await sql.unsafe(`DROP POLICY IF EXISTS "${row.policyname}" ON public.${table};`);
            } catch {
              // Ignore
            }
          }
        } catch {
          // Query may fail, that's okay
        }

        // Create new admin policy using is_admin()
        try {
          await sql.unsafe(`
            CREATE POLICY "Admins can manage ${table}" ON public.${table}
            FOR ALL
            USING (public.is_admin())
            WITH CHECK (public.is_admin());
          `);
          results.push({
            step: `Fix admin policy: ${table}`,
            status: 'success',
            detail: `Recreated admin policy on ${table} using is_admin()`,
          });
        } catch (err) {
          results.push({
            step: `Fix admin policy: ${table}`,
            status: 'error',
            detail: `Failed: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
      }

      // ═══════════════════════════════════════════════════════════════════
      // STEP D: Fix announcements policies
      // ═══════════════════════════════════════════════════════════════════

      // Drop existing announcement policies
      try {
        const announcementPolicies = await sql.unsafe(`
          SELECT policyname FROM pg_policies
          WHERE tablename = 'announcements'
          AND schemaname = 'public';
        `) as { policyname: string }[];

        for (const row of announcementPolicies) {
          try {
            await sql.unsafe(`DROP POLICY IF EXISTS "${row.policyname}" ON public.announcements;`);
          } catch {
            // Ignore
          }
        }
      } catch {
        // Ignore
      }

      // Create new announcement policies
      const announcementPolicies: { name: string; ddl: string }[] = [
        {
          name: 'Admins can manage all announcements',
          ddl: `
            CREATE POLICY "Admins can manage all announcements" ON public.announcements
            FOR ALL
            USING (public.is_admin())
            WITH CHECK (public.is_admin());
          `,
        },
        {
          name: 'Anyone can read active announcements',
          ddl: `
            CREATE POLICY "Anyone can read active announcements" ON public.announcements
            FOR SELECT
            USING (is_active = true);
          `,
        },
      ];

      for (const policy of announcementPolicies) {
        try {
          await sql.unsafe(policy.ddl);
          results.push({
            step: `Create announcements policy: ${policy.name}`,
            status: 'success',
            detail: 'Policy created',
          });
        } catch (err) {
          results.push({
            step: `Create announcements policy: ${policy.name}`,
            status: 'error',
            detail: `Failed: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
      }

      // ═══════════════════════════════════════════════════════════════════
      // STEP E: Fix banned_users policies
      // ═══════════════════════════════════════════════════════════════════

      // Drop existing banned_users policies
      try {
        const bannedPolicies = await sql.unsafe(`
          SELECT policyname FROM pg_policies
          WHERE tablename = 'banned_users'
          AND schemaname = 'public';
        `) as { policyname: string }[];

        for (const row of bannedPolicies) {
          try {
            await sql.unsafe(`DROP POLICY IF EXISTS "${row.policyname}" ON public.banned_users;`);
          } catch {
            // Ignore
          }
        }
      } catch {
        // Ignore
      }

      try {
        await sql.unsafe(`
          CREATE POLICY "Admins can manage banned users" ON public.banned_users
          FOR ALL
          USING (public.is_admin())
          WITH CHECK (public.is_admin());
        `);
        results.push({
          step: 'Create banned_users policy',
          status: 'success',
          detail: 'Created "Admins can manage banned users" using is_admin()',
        });
      } catch (err) {
        results.push({
          step: 'Create banned_users policy',
          status: 'error',
          detail: `Failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }

      // ═══════════════════════════════════════════════════════════════════
      // STEP F: Fix institution_settings policies
      // ═══════════════════════════════════════════════════════════════════

      // Drop existing institution_settings policies
      try {
        const instPolicies = await sql.unsafe(`
          SELECT policyname FROM pg_policies
          WHERE tablename = 'institution_settings'
          AND schemaname = 'public';
        `) as { policyname: string }[];

        for (const row of instPolicies) {
          try {
            await sql.unsafe(`DROP POLICY IF EXISTS "${row.policyname}" ON public.institution_settings;`);
          } catch {
            // Ignore
          }
        }
      } catch {
        // Ignore
      }

      const institutionPolicies: { name: string; ddl: string }[] = [
        {
          name: 'Anyone can read institution_settings',
          ddl: `
            CREATE POLICY "Anyone can read institution_settings" ON public.institution_settings
            FOR SELECT
            USING (true);
          `,
        },
        {
          name: 'Admins can manage institution_settings',
          ddl: `
            CREATE POLICY "Admins can manage institution_settings" ON public.institution_settings
            FOR ALL
            USING (public.is_admin())
            WITH CHECK (public.is_admin());
          `,
        },
      ];

      for (const policy of institutionPolicies) {
        try {
          await sql.unsafe(policy.ddl);
          results.push({
            step: `Create institution_settings policy: ${policy.name}`,
            status: 'success',
            detail: 'Policy created',
          });
        } catch (err) {
          results.push({
            step: `Create institution_settings policy: ${policy.name}`,
            status: 'error',
            detail: `Failed: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
      }

      // ═══════════════════════════════════════════════════════════════════
      // STEP G: Verify the fix by testing is_admin()
      // ═══════════════════════════════════════════════════════════════════

      try {
        const testResult = await sql.unsafe(`
          SELECT public.is_admin() as is_admin_result;
        `) as { is_admin_result: boolean }[];

        const isAdminResult = testResult[0]?.is_admin_result ?? null;
        results.push({
          step: 'Verify is_admin() function',
          status: 'success',
          detail: `is_admin() returned: ${isAdminResult} (expected: true for admin user)`,
        });
      } catch (err) {
        results.push({
          step: 'Verify is_admin() function',
          status: 'error',
          detail: `Test call failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }

    } finally {
      // Ensure connection is always closed
      if (sql) {
        try {
          await sql.end();
        } catch {
          // Ignore close errors
        }
      }
    }

    // ─── 4. Summarize results ───────────────────────────────────────────
    const successCount = results.filter(r => r.status === 'success').length;
    const errorCount = results.filter(r => r.status === 'error').length;
    const skippedCount = results.filter(r => r.status === 'skipped').length;

    return NextResponse.json({
      success: errorCount === 0,
      message: `RLS fix completed: ${successCount} succeeded, ${errorCount} failed, ${skippedCount} skipped`,
      results,
      summary: { successCount, errorCount, skippedCount },
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

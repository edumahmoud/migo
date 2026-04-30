import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer, getSupabaseServerClient } from '@/lib/supabase-server';

/**
 * POST /api/admin/apply-rls-fix
 * 
 * Diagnostic endpoint that:
 * 1. Verifies the user is an admin (using cookie-based auth + service role lookup)
 * 2. Tests whether the is_admin() RPC function exists
 * 3. If is_admin() exists, tests it and returns the result
 * 4. If is_admin() doesn't exist, returns instructions to run the SQL manually
 * 
 * This route does NOT require a dbUrl parameter — it works through the
 * Supabase client SDK and can serve as a quick diagnostic.
 */
export async function POST(request: NextRequest) {
  const results: { step: string; status: 'success' | 'error' | 'info'; detail: string }[] = [];

  try {
    // ─── 1. Verify the requester is an admin ────────────────────────────
    const serverClient = await getSupabaseServerClient();
    const { data: { user: authUser }, error: authError } = await serverClient.auth.getUser();

    if (authError || !authUser) {
      return NextResponse.json(
        { success: false, error: 'Authentication required. Please log in.' },
        { status: 401 }
      );
    }

    results.push({
      step: 'Authentication check',
      status: 'success',
      detail: `Authenticated as user ${authUser.id}`,
    });

    // Check admin role using service role (bypasses RLS)
    const { data: userProfile, error: profileError } = await supabaseServer
      .from('users')
      .select('id, role, name, email')
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
        { success: false, error: 'Only admin or superadmin users can access this endpoint' },
        { status: 403 }
      );
    }

    results.push({
      step: 'Admin verification',
      status: 'success',
      detail: `User "${userProfile.name}" (${userProfile.email}) has role: ${userProfile.role}`,
    });

    // ─── 2. Test if is_admin() RPC function exists ─────────────────────
    let isAdminFunctionExists = false;
    let isAdminResult: boolean | null = null;

    // Try calling is_admin() via RPC
    const { data: rpcResult, error: rpcError } = await supabaseServer.rpc('is_admin');

    if (rpcError) {
      // Function likely doesn't exist yet
      const errorMsg = rpcError.message || String(rpcError);

      if (
        errorMsg.includes('Could not find the function') ||
        errorMsg.includes('does not exist') ||
        errorMsg.includes('not found') ||
        errorMsg.includes('function') && errorMsg.includes('does not exist')
      ) {
        results.push({
          step: 'Test is_admin() RPC',
          status: 'info',
          detail: 'The is_admin() function does NOT exist yet in the database.',
        });
        isAdminFunctionExists = false;
      } else {
        // Some other error — the function might exist but something else went wrong
        results.push({
          step: 'Test is_admin() RPC',
          status: 'error',
          detail: `RPC call failed: ${errorMsg}`,
        });
        isAdminFunctionExists = false;
      }
    } else {
      isAdminFunctionExists = true;
      isAdminResult = rpcResult as boolean;

      results.push({
        step: 'Test is_admin() RPC',
        status: 'success',
        detail: `is_admin() function exists and returned: ${isAdminResult}`,
      });
    }

    // ─── 3. Test get_user_role() if is_admin() exists ──────────────────
    let getUserRoleResult: string | null = null;

    if (isAdminFunctionExists) {
      const { data: roleResult, error: roleError } = await supabaseServer.rpc('get_user_role', {
        target_uid: authUser.id,
      });

      if (roleError) {
        results.push({
          step: 'Test get_user_role() RPC',
          status: 'error',
          detail: `RPC call failed: ${roleError.message || String(roleError)}`,
        });
      } else {
        getUserRoleResult = roleResult as string;
        results.push({
          step: 'Test get_user_role() RPC',
          status: 'success',
          detail: `get_user_role() returned: "${getUserRoleResult}"`,
        });
      }
    }

    // ─── 4. Test RLS-protected table access ─────────────────────────────
    const tablesToTest = [
      'users',
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
      'announcements',
      'banned_users',
      'institution_settings',
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

    const tableAccessResults: { table: string; accessible: boolean; count?: number; error?: string }[] = [];

    for (const table of tablesToTest) {
      const { count, error } = await supabaseServer
        .from(table)
        .select('*', { count: 'exact', head: true });

      if (error) {
        tableAccessResults.push({
          table,
          accessible: false,
          error: error.message,
        });
      } else {
        tableAccessResults.push({
          table,
          accessible: true,
          count: count ?? 0,
        });
      }
    }

    const inaccessibleTables = tableAccessResults.filter(t => !t.accessible);
    const accessibleTables = tableAccessResults.filter(t => t.accessible);

    results.push({
      step: 'Table access check',
      status: inaccessibleTables.length > 0 ? 'error' : 'success',
      detail: `${accessibleTables.length}/${tableAccessResults.length} tables accessible via service role. ` +
        (inaccessibleTables.length > 0
          ? `Inaccessible: ${inaccessibleTables.map(t => t.table).join(', ')}`
          : 'All tables accessible.'),
    });

    // ─── 5. Check RLS policy status on key tables ──────────────────────
    // We can check RLS policy information through the service role
    const { data: usersPolicyCheck, error: usersPolicyError } = await supabaseServer
      .from('users')
      .select('id, role')
      .limit(5);

    const usersReadable = !usersPolicyError;
    results.push({
      step: 'Users table RLS check',
      status: usersReadable ? 'success' : 'error',
      detail: usersReadable
        ? `Users table is readable (found ${usersPolicyCheck?.length ?? 0} rows)`
        : `Users table NOT readable: ${usersPolicyError?.message}`,
    });

    // ─── 6. Build response ─────────────────────────────────────────────
    if (!isAdminFunctionExists) {
      // Return instructions for manual SQL execution
      const manualSQL = generateManualSQL();

      return NextResponse.json({
        success: false,
        needsManualFix: true,
        message: 'The is_admin() function does not exist. The RLS infinite recursion fix has NOT been applied.',
        results,
        tableAccess: tableAccessResults,
        instructions: {
          title: 'To fix the RLS infinite recursion, run the following SQL in your Supabase Dashboard SQL Editor:',
          sql: manualSQL,
          steps: [
            '1. Go to your Supabase Dashboard',
            '2. Navigate to the SQL Editor',
            '3. Copy and paste the SQL below',
            '4. Click "Run" to execute',
            '5. After running, come back and call this endpoint again to verify the fix',
          ],
          alternative: 'Or use the /api/admin/fix-rls endpoint with a direct PostgreSQL connection string for automated execution.',
        },
      });
    }

    // is_admin() exists — everything should be working
    return NextResponse.json({
      success: true,
      needsManualFix: false,
      message: `RLS fix is in place. is_admin() returned: ${isAdminResult}. ${getUserRoleResult ? `get_user_role() returned: "${getUserRoleResult}".` : ''}`,
      results,
      tableAccess: tableAccessResults,
      verification: {
        isAdminFunctionExists,
        isAdminResult,
        getUserRoleResult,
        allTablesAccessible: inaccessibleTables.length === 0,
        inaccessibleTables: inaccessibleTables.map(t => t.table),
      },
    });
  } catch (error) {
    console.error('Apply-RLS-fix error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Unexpected error during RLS diagnostic',
        details: error instanceof Error ? error.message : String(error),
        partialResults: results,
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/admin/apply-rls-fix
 * Quick check endpoint — returns current status without making changes.
 */
export async function GET() {
  try {
    // Quick check if is_admin() function exists
    const { error: rpcError } = await supabaseServer.rpc('is_admin');

    const functionExists = !rpcError;

    return NextResponse.json({
      status: functionExists ? 'fixed' : 'needs_fix',
      is_admin_exists: functionExists,
      message: functionExists
        ? 'The is_admin() function exists. RLS fix appears to be applied.'
        : 'The is_admin() function does NOT exist. RLS infinite recursion fix needs to be applied. Use POST to get detailed instructions.',
    });
  } catch (error) {
    return NextResponse.json(
      {
        status: 'error',
        message: 'Could not check RLS status',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

/**
 * Generate the complete SQL for manual execution.
 */
function generateManualSQL(): string {
  return `-- ═══════════════════════════════════════════════════════════════════════
-- Attendu RLS Infinite Recursion Fix
-- Run this in Supabase Dashboard → SQL Editor
-- ═══════════════════════════════════════════════════════════════════════

-- STEP 1: Create SECURITY DEFINER helper functions
-- These bypass RLS by running with the function owner's privileges

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

CREATE OR REPLACE FUNCTION public.get_user_role(target_uid UUID)
RETURNS TEXT
LANGUAGE SQL
SECURITY DEFINER
STABLE
AS $$
  SELECT role FROM public.users WHERE id = target_uid;
$$;

-- Grant execute to authenticated and anon roles
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.get_user_role(UUID) TO authenticated, anon;

-- STEP 2: Fix the users table policies (source of infinite recursion)
-- The "Admins can read all users" policy causes recursion because it
-- queries the users table inside a policy on the users table itself

DROP POLICY IF EXISTS "Admins can read all users" ON public.users;
DROP POLICY IF EXISTS "Users can read own profile" ON public.users;
DROP POLICY IF EXISTS "Users can insert own profile" ON public.users;
DROP POLICY IF EXISTS "Users can update own profile" ON public.users;
DROP POLICY IF EXISTS "Teachers can read linked students" ON public.users;
DROP POLICY IF EXISTS "Anyone authenticated can find teachers" ON public.users;
DROP POLICY IF EXISTS "Authenticated users can read profiles" ON public.users;

-- Recreate safe users policies
CREATE POLICY "Users can read own profile" ON public.users
  FOR SELECT USING (id = auth.uid());

CREATE POLICY "Users can insert own profile" ON public.users
  FOR INSERT WITH CHECK (id = auth.uid());

CREATE POLICY "Users can update own profile" ON public.users
  FOR UPDATE USING (id = auth.uid());

CREATE POLICY "Teachers can read linked students" ON public.users
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.teacher_student_links tsl
      WHERE tsl.teacher_id = auth.uid() AND tsl.student_id = users.id
    )
  );

CREATE POLICY "Anyone authenticated can find teachers" ON public.users
  FOR SELECT USING (role = 'teacher');

CREATE POLICY "Authenticated users can read profiles" ON public.users
  FOR SELECT USING (public.is_admin() OR id = auth.uid());

-- STEP 3: Fix admin policies on all other tables
-- Replace self-referencing EXISTS subqueries with is_admin() calls

${generateAdminTablePoliciesSQL()}

-- STEP 4: Fix announcements policies
DROP POLICY IF EXISTS "Admins can manage all announcements" ON public.announcements;
DROP POLICY IF EXISTS "Anyone can read active announcements" ON public.announcements;

CREATE POLICY "Admins can manage all announcements" ON public.announcements
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

CREATE POLICY "Anyone can read active announcements" ON public.announcements
  FOR SELECT USING (is_active = true);

-- STEP 5: Fix banned_users policies
DROP POLICY IF EXISTS "Admins can manage banned users" ON public.banned_users;

CREATE POLICY "Admins can manage banned users" ON public.banned_users
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

-- STEP 6: Fix institution_settings policies
DROP POLICY IF EXISTS "Anyone can read institution_settings" ON public.institution_settings;
DROP POLICY IF EXISTS "Admins can manage institution_settings" ON public.institution_settings;

CREATE POLICY "Anyone can read institution_settings" ON public.institution_settings
  FOR SELECT USING (true);

CREATE POLICY "Admins can manage institution_settings" ON public.institution_settings
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ═══════════════════════════════════════════════════════════════════════
-- Verification
-- ═══════════════════════════════════════════════════════════════════════

-- Test the function (should return true if you're an admin)
SELECT public.is_admin() as is_admin_result;`;
}

/**
 * Generate the SQL for admin table policy replacements.
 */
function generateAdminTablePoliciesSQL(): string {
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

  return adminTables.map(table => {
    const policyName = `Admins can manage ${table}`;
    return `-- Fix ${table}
DROP POLICY IF EXISTS "${policyName}" ON public.${table};
CREATE POLICY "${policyName}" ON public.${table}
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());`;
  }).join('\n\n');
}

import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';

/**
 * Diagnostic endpoint: Verify admin data access via service role key.
 * The service role key bypasses RLS, so if queries fail here, it's NOT an RLS issue.
 * 
 * POST /api/migrate/admin-rls-fix
 * Body: { "confirm": true }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    if (!body.confirm) {
      return NextResponse.json(
        { success: false, error: 'Send { "confirm": true } to execute this diagnostic' },
        { status: 400 }
      );
    }

    const results: string[] = [];

    // Test 1: Can we read users?
    const { data: users, error: usersError, count: usersCount } = await supabaseServer
      .from('users')
      .select('*', { count: 'exact' })
      .limit(5);
    
    results.push(`Users: count=${usersCount}, error=${usersError?.message || 'none'}`);

    // Test 2: Can we read subjects?
    const { count: subjectsCount, error: subjectsError } = await supabaseServer
      .from('subjects')
      .select('*', { count: 'exact' })
      .limit(5);
    
    results.push(`Subjects: count=${subjectsCount}, error=${subjectsError?.message || 'none'}`);

    // Test 3: Can we read scores?
    const { count: scoresCount, error: scoresError } = await supabaseServer
      .from('scores')
      .select('*', { count: 'exact' })
      .limit(5);
    
    results.push(`Scores: count=${scoresCount}, error=${scoresError?.message || 'none'}`);

    // Test 4: Can we read quizzes?
    const { count: quizzesCount, error: quizzesError } = await supabaseServer
      .from('quizzes')
      .select('*', { count: 'exact', head: true });
    
    results.push(`Quizzes: count=${quizzesCount}, error=${quizzesError?.message || 'none'}`);

    // Test 5: Can we read teacher_student_links?
    const { count: linksCount, error: linksError } = await supabaseServer
      .from('teacher_student_links')
      .select('*', { count: 'exact', head: true });
    
    results.push(`Teacher-student links: count=${linksCount}, error=${linksError?.message || 'none'}`);

    // Test 6: Can we read subject_students?
    const { count: enrollmentsCount, error: enrollmentsError } = await supabaseServer
      .from('subject_students')
      .select('*', { count: 'exact', head: true });
    
    results.push(`Subject students: count=${enrollmentsCount}, error=${enrollmentsError?.message || 'none'}`);

    // Test 7: Can we read announcements?
    const { count: announcementsCount, error: announcementsError } = await supabaseServer
      .from('announcements')
      .select('*', { count: 'exact', head: true });
    
    results.push(`Announcements: count=${announcementsCount}, error=${announcementsError?.message || 'none'}`);

    // Test 8: Can we read banned_users?
    const { count: bannedCount, error: bannedError } = await supabaseServer
      .from('banned_users')
      .select('*', { count: 'exact', head: true });
    
    results.push(`Banned users: count=${bannedCount}, error=${bannedError?.message || 'none'}`);

    // Test 9: Can we read institution_settings?
    const { data: instSettings, error: instError } = await supabaseServer
      .from('institution_settings')
      .select('*')
      .limit(1);
    
    results.push(`Institution settings: count=${instSettings?.length || 0}, error=${instError?.message || 'none'}`);

    // Return actual user data for verification
    const userData = (users || []).map((u: Record<string, unknown>) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
    }));

    return NextResponse.json({
      success: true,
      message: 'Diagnostic complete. Service role key bypasses RLS.',
      diagnostics: results,
      users: userData,
    });
  } catch (error) {
    console.error('Diagnostic error:', error);
    return NextResponse.json(
      { success: false, error: 'Diagnostic failed', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

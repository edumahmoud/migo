import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type') || 'all';

    const results: Record<string, unknown> = {};
    const errors: string[] = [];

    if (type === 'all' || type === 'users') {
      const { data: users, error: usersError } = await supabaseServer
        .from('users')
        .select('*')
        .order('created_at', { ascending: false });

      if (usersError) {
        console.error('[admin/data] Error fetching users:', JSON.stringify(usersError));
        errors.push(`users: ${usersError.message} (code: ${usersError.code})`);
      } else {
        // Enrich users with subject and student counts
        const enrichedUsers = await Promise.all((users || []).map(async (u: Record<string, unknown>) => {
          const meta: Record<string, unknown> = { ...u };

          if (u.role === 'teacher') {
            const { count: subjectCount } = await supabaseServer
              .from('subjects')
              .select('*', { count: 'exact', head: true })
              .eq('teacher_id', u.id as string);
            meta.subjectCount = subjectCount ?? 0;

            const { count: studentCount } = await supabaseServer
              .from('teacher_student_links')
              .select('*', { count: 'exact', head: true })
              .eq('teacher_id', u.id as string);
            meta.studentCount = studentCount ?? 0;
          }

          if (u.role === 'student') {
            const { count: studentCount } = await supabaseServer
              .from('teacher_student_links')
              .select('*', { count: 'exact', head: true })
              .eq('student_id', u.id as string);
            meta.studentCount = studentCount ?? 0;
          }

          return meta;
        }));

        results.users = enrichedUsers;
      }
    }

    if (type === 'all' || type === 'subjects') {
      const { data: subjects, error: subjectsError } = await supabaseServer
        .from('subjects')
        .select('*')
        .order('created_at', { ascending: false });

      if (subjectsError) {
        console.error('Error fetching subjects:', subjectsError);
        errors.push(`subjects: ${subjectsError.message}`);
      } else {
        results.subjects = subjects || [];
      }
    }

    if (type === 'all' || type === 'scores') {
      const { data: scores, error: scoresError } = await supabaseServer
        .from('scores')
        .select('*')
        .order('completed_at', { ascending: false });

      if (scoresError) {
        console.error('Error fetching scores:', scoresError);
        errors.push(`scores: ${scoresError.message}`);
      } else {
        results.scores = scores || [];
      }
    }

    if (type === 'all' || type === 'quizzes') {
      const { count: quizCount, error: quizError } = await supabaseServer
        .from('quizzes')
        .select('*', { count: 'exact', head: true });

      if (quizError) {
        console.error('Error fetching quiz count:', quizError);
        errors.push(`quizzes: ${quizError.message}`);
      } else {
        results.quizCount = quizCount ?? 0;
      }
    }

    if (type === 'banned') {
      const { data: banned, error: bannedError } = await supabaseServer
        .from('banned_users')
        .select('*')
        .order('banned_at', { ascending: false });

      if (bannedError) {
        console.error('Error fetching banned users:', bannedError);
        errors.push(`banned: ${bannedError.message}`);
      } else {
        // Enrich banned records with user names and admin names
        const enrichedBanned = await Promise.all((banned || []).map(async (ban: Record<string, unknown>) => {
          const enriched = { ...ban };
          
          // Fetch banned user's name
          if (ban.user_id) {
            const { data: bannedUser } = await supabaseServer
              .from('users')
              .select('name')
              .eq('id', ban.user_id as string)
              .maybeSingle();
            if (bannedUser) {
              enriched.user_name = bannedUser.name;
            }
          }

          // Fetch admin who banned's name
          if (ban.banned_by) {
            const { data: adminUser } = await supabaseServer
              .from('users')
              .select('name')
              .eq('id', ban.banned_by as string)
              .maybeSingle();
            if (adminUser) {
              enriched.banned_by_name = adminUser.name;
            }
          }

          return enriched;
        }));

        results.data = enrichedBanned;
      }
    }

    // If there were critical errors, include them in the response
    if (errors.length > 0) {
      console.error('Admin data fetch had errors:', errors);
      // Still return partial data with error info
      return NextResponse.json({ 
        success: true, 
        data: results,
        warnings: errors 
      });
    }

    return NextResponse.json({ success: true, data: results });
  } catch (error) {
    console.error('Admin data fetch error:', error);
    return NextResponse.json(
      { success: false, error: 'حدث خطأ أثناء جلب البيانات', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

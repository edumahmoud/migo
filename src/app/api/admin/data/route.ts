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
        // Batch enrichment: get subject counts per teacher, student counts per teacher/student
        const teacherIds = (users || [])
          .filter((u: Record<string, unknown>) => u.role === 'teacher')
          .map((u: Record<string, unknown>) => u.id as string);

        const studentIds = (users || [])
          .filter((u: Record<string, unknown>) => u.role === 'student')
          .map((u: Record<string, unknown>) => u.id as string);

        // Run batch queries in parallel
        const [subjectsData, teacherLinksData, studentLinksData] = await Promise.all([
          // Get all subjects for all teachers in one query
          teacherIds.length > 0
            ? supabaseServer
                .from('subjects')
                .select('teacher_id')
                .in('teacher_id', teacherIds)
            : { data: [], error: null },
          // Get all teacher-student links for teachers in one query
          teacherIds.length > 0
            ? supabaseServer
                .from('teacher_student_links')
                .select('teacher_id')
                .in('teacher_id', teacherIds)
            : { data: [], error: null },
          // Get all teacher-student links for students in one query
          studentIds.length > 0
            ? supabaseServer
                .from('teacher_student_links')
                .select('student_id, teacher_id')
                .in('student_id', studentIds)
            : { data: [], error: null },
        ]);

        // Build count maps
        const subjectCountMap: Record<string, number> = {};
        if (subjectsData.data) {
          for (const row of subjectsData.data) {
            subjectCountMap[row.teacher_id] = (subjectCountMap[row.teacher_id] || 0) + 1;
          }
        }

        const teacherStudentCountMap: Record<string, number> = {};
        if (teacherLinksData.data) {
          for (const row of teacherLinksData.data) {
            teacherStudentCountMap[row.teacher_id] = (teacherStudentCountMap[row.teacher_id] || 0) + 1;
          }
        }

        const studentLinkCountMap: Record<string, number> = {};
        const studentTeachersMap: Record<string, Set<string>> = {};
        if (studentLinksData.data) {
          for (const row of studentLinksData.data) {
            studentLinkCountMap[row.student_id] = (studentLinkCountMap[row.student_id] || 0) + 1;
            if (!studentTeachersMap[row.student_id]) {
              studentTeachersMap[row.student_id] = new Set();
            }
            studentTeachersMap[row.student_id].add(row.teacher_id);
          }
        }

        // Calculate subject count for each student (subjects from their linked teachers)
        const studentSubjectCountMap: Record<string, number> = {};
        for (const [studentId, teacherIds] of Object.entries(studentTeachersMap)) {
          let count = 0;
          for (const tid of teacherIds) {
            count += subjectCountMap[tid] || 0;
          }
          studentSubjectCountMap[studentId] = count;
        }

        // Merge counts into users
        const enrichedUsers = (users || []).map((u: Record<string, unknown>) => {
          const meta: Record<string, unknown> = { ...u };
          if (u.role === 'teacher') {
            meta.subjectCount = subjectCountMap[u.id as string] || 0;
            meta.studentCount = teacherStudentCountMap[u.id as string] || 0;
          }
          if (u.role === 'student') {
            meta.teacherCount = studentLinkCountMap[u.id as string] || 0;
            meta.subjectCount = studentSubjectCountMap[u.id as string] || 0;
            // Keep studentCount for backward compatibility (represents teacher links)
            meta.studentCount = studentLinkCountMap[u.id as string] || 0;
          }
          return meta;
        });

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
        // Batch enrichment: get all user names in one query
        const bannedUserIds = (banned || [])
          .map((ban: Record<string, unknown>) => ban.user_id as string)
          .filter(Boolean);
        const bannedByIds = (banned || [])
          .map((ban: Record<string, unknown>) => ban.banned_by as string)
          .filter(Boolean);
        const allUserIds = [...new Set([...bannedUserIds, ...bannedByIds])];

        const userNameMap: Record<string, string> = {};
        if (allUserIds.length > 0) {
          const { data: userNames } = await supabaseServer
            .from('users')
            .select('id, name')
            .in('id', allUserIds);
          if (userNames) {
            for (const u of userNames) {
              userNameMap[u.id] = u.name;
            }
          }
        }

        const enrichedBanned = (banned || []).map((ban: Record<string, unknown>) => ({
          ...ban,
          user_name: ban.user_id ? userNameMap[ban.user_id as string] || undefined : undefined,
          banned_by_name: ban.banned_by ? userNameMap[ban.banned_by as string] || undefined : undefined,
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

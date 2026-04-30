import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helpers';

export async function GET(request: NextRequest) {
  // 🔒 SECURITY: Admin-only endpoint — exposes ALL users, subjects, scores, quizzes
  const authResult = await requireAdmin(request);
  if (!authResult.success) return authErrorResponse(authResult);

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
        // Batch enrichment: get subject/student/teacher counts
        // Run batch queries in parallel
        const [subjectsData, subjectStudentsData] = await Promise.all([
          // Get all subjects with teacher_id (for teacher subject count + student enrichment)
          supabaseServer
            .from('subjects')
            .select('id, teacher_id'),
          // Get all subject-student enrollments (for accurate student/teacher counts)
          supabaseServer
            .from('subject_students')
            .select('subject_id, student_id'),
        ]);

        // ─── Build maps from subjects ───
        // subjectId → teacherId
        const subjectTeacherMap: Record<string, string> = {};
        // teacherId → count of subjects
        const teacherSubjectCountMap: Record<string, number> = {};
        if (subjectsData.data) {
          for (const row of subjectsData.data) {
            subjectTeacherMap[row.id] = row.teacher_id;
            teacherSubjectCountMap[row.teacher_id] = (teacherSubjectCountMap[row.teacher_id] || 0) + 1;
          }
        }

        // ─── Build maps from subject_students ───
        // teacherId → Set of unique studentIds
        const teacherStudentsSetMap: Record<string, Set<string>> = {};
        // studentId → Set of unique subjectIds
        const studentSubjectsSetMap: Record<string, Set<string>> = {};
        // studentId → Set of unique teacherIds
        const studentTeachersSetMap: Record<string, Set<string>> = {};

        if (subjectStudentsData.data) {
          for (const row of subjectStudentsData.data) {
            const teacherId = subjectTeacherMap[row.subject_id];
            if (teacherId) {
              if (!teacherStudentsSetMap[teacherId]) teacherStudentsSetMap[teacherId] = new Set();
              teacherStudentsSetMap[teacherId].add(row.student_id);
            }
            if (!studentSubjectsSetMap[row.student_id]) studentSubjectsSetMap[row.student_id] = new Set();
            studentSubjectsSetMap[row.student_id].add(row.subject_id);
            if (teacherId) {
              if (!studentTeachersSetMap[row.student_id]) studentTeachersSetMap[row.student_id] = new Set();
              studentTeachersSetMap[row.student_id].add(teacherId);
            }
          }
        }

        // Merge counts into users
        const enrichedUsers = (users || []).map((u: Record<string, unknown>) => {
          const meta: Record<string, unknown> = { ...u };
          const uid = u.id as string;
          if (u.role === 'teacher') {
            meta.subjectCount = teacherSubjectCountMap[uid] || 0;
            meta.studentCount = teacherStudentsSetMap[uid]?.size || 0;
          }
          if (u.role === 'student') {
            meta.subjectCount = studentSubjectsSetMap[uid]?.size || 0;
            meta.teacherCount = studentTeachersSetMap[uid]?.size || 0;
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

        results.banned = enrichedBanned;
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

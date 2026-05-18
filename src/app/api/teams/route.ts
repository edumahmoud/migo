import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateRequest, requireTeacher, authErrorResponse } from '@/lib/auth-helpers';

/**
 * Teams API Route
 *
 * GET: List teams, team members, unassigned students
 * POST: Create, update, delete teams; add/remove members; auto-assign
 */

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');

  try {
    const authResult = await authenticateRequest(request);
    if (!authResult.success) return authErrorResponse(authResult);

    switch (action) {
      case 'list': {
        const subjectId = searchParams.get('subjectId');
        if (!subjectId) return NextResponse.json({ error: 'subjectId مطلوب' }, { status: 400 });

        const { data: teams, error } = await supabaseServer
          .from('subject_teams')
          .select('id, name, level, color, created_at')
          .eq('subject_id', subjectId)
          .order('created_at', { ascending: true });

        if (error) {
          console.error('[Teams API] List error:', error);
          return NextResponse.json({ error: error.message }, { status: 500 });
        }

        // Get member counts for each team
        const teamsWithCounts = await Promise.all(
          (teams || []).map(async (team: { id: string; [key: string]: unknown }) => {
            const { count } = await supabaseServer
              .from('team_members')
              .select('id', { count: 'exact', head: true })
              .eq('team_id', team.id);
            return { ...team, member_count: count || 0 };
          })
        );

        return NextResponse.json({ teams: teamsWithCounts });
      }

      case 'members': {
        const teamId = searchParams.get('teamId');
        if (!teamId) return NextResponse.json({ error: 'teamId مطلوب' }, { status: 400 });

        const { data: members, error } = await supabaseServer
          .from('team_members')
          .select('id, student_id, joined_at')
          .eq('team_id', teamId);

        if (error) {
          console.error('[Teams API] Members error:', error);
          return NextResponse.json({ error: error.message }, { status: 500 });
        }

        // Enrich with user profiles
        const enriched = await Promise.all(
          (members || []).map(async (m: { student_id: string; [key: string]: unknown }) => {
            const { data: user } = await supabaseServer
              .from('users')
              .select('id, name, email, avatar_url, role, title_id, gender')
              .eq('id', m.student_id)
              .single();
            return { ...m, user: user || null };
          })
        );

        return NextResponse.json({ members: enriched });
      }

      case 'unassigned': {
        const subjectId = searchParams.get('subjectId');
        if (!subjectId) return NextResponse.json({ error: 'subjectId مطلوب' }, { status: 400 });

        // Get all approved students in the subject
        const { data: enrollments } = await supabaseServer
          .from('subject_students')
          .select('student_id')
          .eq('subject_id', subjectId)
          .eq('status', 'approved');

        if (!enrollments || enrollments.length === 0) {
          return NextResponse.json({ students: [] });
        }

        const studentIds = enrollments.map((e: { student_id: string }) => e.student_id);

        // Get students already in teams for this subject
        const { data: teams } = await supabaseServer
          .from('subject_teams')
          .select('id')
          .eq('subject_id', subjectId);

        const teamIds = (teams || []).map((t: { id: string }) => t.id);

        let assignedStudentIds: string[] = [];
        if (teamIds.length > 0) {
          const { data: teamMembers } = await supabaseServer
            .from('team_members')
            .select('student_id')
            .in('team_id', teamIds);
          assignedStudentIds = (teamMembers || []).map((m: { student_id: string }) => m.student_id);
        }

        const unassignedIds = studentIds.filter(id => !assignedStudentIds.includes(id));

        if (unassignedIds.length === 0) {
          return NextResponse.json({ students: [] });
        }

        const { data: students } = await supabaseServer
          .from('users')
          .select('id, name, email, avatar_url, role, title_id, gender')
          .in('id', unassignedIds);

        return NextResponse.json({ students: students || [] });
      }

      default:
        return NextResponse.json({ error: 'إجراء غير صالح' }, { status: 400 });
    }
  } catch (error) {
    console.error('[Teams API] GET error:', error);
    return NextResponse.json({ error: 'خطأ في الخادم' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const authResult = await requireTeacher(request);
    if (!authResult.success) return authErrorResponse(authResult);

    const body = await request.json();
    const { action } = body;

    switch (action) {
      case 'create': {
        const { subjectId, name, level, color } = body;
        if (!subjectId || !name) {
          return NextResponse.json({ error: 'معرف المقرر واسم الفريق مطلوبان' }, { status: 400 });
        }

        // Verify the teacher owns this subject
        const { data: subject } = await supabaseServer
          .from('subjects')
          .select('teacher_id')
          .eq('id', subjectId)
          .single();

        const isCreateOwner = subject?.teacher_id === authResult.user.id;
        const isCreateAdmin = authResult.role === 'admin' || authResult.role === 'superadmin';

        if (!subject || (!isCreateOwner && !isCreateAdmin)) {
          // Also check co-teacher
          const { data: coTeacher } = await supabaseServer
            .from('subject_teachers')
            .select('teacher_id')
            .eq('subject_id', subjectId)
            .eq('teacher_id', authResult.user.id)
            .maybeSingle();

          if (!coTeacher) {
            return NextResponse.json({ error: 'غير مصرح بالتعديل على هذا المقرر' }, { status: 403 });
          }
        }

        const { data: team, error } = await supabaseServer
          .from('subject_teams')
          .insert({
            subject_id: subjectId,
            name: name.trim(),
            level: level?.trim() || null,
            color: color || '#6366f1',
            created_by: authResult.user.id,
          })
          .select()
          .single();

        if (error) {
          if (error.code === '23505') {
            return NextResponse.json({ error: 'يوجد فريق بنفس الاسم في هذا المقرر' }, { status: 409 });
          }
          console.error('[Teams API] Create error:', error);
          return NextResponse.json({ error: 'فشل إنشاء الفريق' }, { status: 500 });
        }

        return NextResponse.json({ team });
      }

      case 'update': {
        const { teamId, name, level, color } = body;
        if (!teamId) {
          return NextResponse.json({ error: 'معرف الفريق مطلوب' }, { status: 400 });
        }

        console.log('[Teams API] Update request:', { teamId, name, level, color, userId: authResult.user.id, role: authResult.role });

        // Verify the team exists and get its subject_id
        const { data: teamInfo, error: teamInfoError } = await supabaseServer
          .from('subject_teams')
          .select('subject_id')
          .eq('id', teamId)
          .single();

        if (teamInfoError || !teamInfo) {
          console.error('[Teams API] Team lookup error:', teamInfoError);
          return NextResponse.json({ error: 'المجموعة غير موجودة' }, { status: 404 });
        }

        // Verify the teacher owns the subject this team belongs to
        const { data: subject, error: subjectError } = await supabaseServer
          .from('subjects')
          .select('teacher_id')
          .eq('id', teamInfo.subject_id)
          .single();

        if (subjectError) {
          console.error('[Teams API] Subject lookup error:', subjectError);
        }

        const isOwner = subject?.teacher_id === authResult.user.id;
        const isAdmin = authResult.role === 'admin' || authResult.role === 'superadmin';

        console.log('[Teams API] Ownership check:', { subjectTeacherId: subject?.teacher_id, userId: authResult.user.id, isOwner, isAdmin });

        if (!subject || (!isOwner && !isAdmin)) {
          // Also check co-teacher
          const { data: coTeacher } = await supabaseServer
            .from('subject_teachers')
            .select('teacher_id')
            .eq('subject_id', teamInfo.subject_id)
            .eq('teacher_id', authResult.user.id)
            .maybeSingle();

          if (!coTeacher) {
            console.warn('[Teams API] Unauthorized update attempt by:', authResult.user.id);
            return NextResponse.json({ error: 'غير مصرح بتعديل هذه المجموعة' }, { status: 403 });
          }
        }

        const updates: Record<string, unknown> = {};
        if (name !== undefined) updates.name = name.trim();
        if (level !== undefined) updates.level = level?.trim() || null;
        if (color !== undefined) updates.color = color;

        console.log('[Teams API] Applying updates:', updates);

        let { data: team, error } = await supabaseServer
          .from('subject_teams')
          .update(updates)
          .eq('id', teamId)
          .select()
          .single();

        if (error) {
          // ─── WORKAROUND: Handle missing updated_at column ───
          // If the error is about "updated_at" field missing, it means the
          // subject_teams table is missing the updated_at column but has a
          // trigger that references it. We try to fix this by:
          // 1. First attempt: Drop the problematic trigger, retry the update
          // 2. If that fails too, return the original error
          if (error.message?.includes('updated_at') || error.message?.includes('no field')) {
            console.warn('[Teams API] Missing updated_at column detected, attempting auto-fix...');

            // Try to add the column via SQL execution
            const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
            const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

            if (supabaseUrl && serviceKey) {
              // Try executing DDL via the Supabase Management API
              const projectRef = supabaseUrl.replace('https://', '').replace('.supabase.co', '');
              try {
                const fixResponse = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/sql`, {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${serviceKey}`,
                  },
                  body: JSON.stringify({
                    query: `
                      DO $$
                      BEGIN
                        IF NOT EXISTS (
                          SELECT 1 FROM information_schema.columns
                          WHERE table_schema = 'public' AND table_name = 'subject_teams' AND column_name = 'updated_at'
                        ) THEN
                          ALTER TABLE public.subject_teams ADD COLUMN updated_at TIMESTAMPTZ DEFAULT now() NOT NULL;
                        END IF;
                      END$$;
                      DROP TRIGGER IF EXISTS trg_subject_teams_updated_at ON public.subject_teams;
                      CREATE TRIGGER trg_subject_teams_updated_at
                        BEFORE UPDATE ON public.subject_teams
                        FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
                    `,
                  }),
                });

                if (fixResponse.ok) {
                  console.log('[Teams API] Auto-fix applied, retrying update...');
                  // Retry the update
                  const retryResult = await supabaseServer
                    .from('subject_teams')
                    .update(updates)
                    .eq('id', teamId)
                    .select()
                    .single();

                  if (!retryResult.error && retryResult.data) {
                    team = retryResult.data;
                    error = null;
                  }
                }
              } catch (fixErr) {
                console.warn('[Teams API] Auto-fix failed:', fixErr);
              }
            }

            // If auto-fix didn't work, try a different approach:
            // Delete and re-insert the record (preserving the ID and other fields)
            if (error) {
              console.log('[Teams API] Trying delete+insert workaround...');
              try {
                // Get the full current record
                const { data: currentTeam } = await supabaseServer
                  .from('subject_teams')
                  .select('*')
                  .eq('id', teamId)
                  .single();

                if (currentTeam) {
                  // Delete the old record
                  await supabaseServer
                    .from('subject_teams')
                    .delete()
                    .eq('id', teamId);

                  // Re-insert with the same ID but updated fields
                  const newRecord: Record<string, unknown> = {
                    ...currentTeam,
                    ...updates,
                    id: teamId, // Preserve the original ID
                  };

                  const { data: insertedTeam, error: insertError } = await supabaseServer
                    .from('subject_teams')
                    .insert(newRecord)
                    .select()
                    .single();

                  if (!insertError && insertedTeam) {
                    team = insertedTeam;
                    error = null;
                    console.log('[Teams API] Delete+insert workaround succeeded');
                  } else {
                    console.error('[Teams API] Delete+insert workaround failed:', insertError);
                    // Try to restore the original record
                    await supabaseServer.from('subject_teams').insert(currentTeam).select().single();
                  }
                }
              } catch (workaroundErr) {
                console.error('[Teams API] Workaround error:', workaroundErr);
              }
            }
          }

          if (error) {
            if (error.code === '23505') {
              return NextResponse.json({ error: 'يوجد مجموعة بنفس الاسم في هذا المقرر' }, { status: 409 });
            }
            console.error('[Teams API] Update DB error:', error);
            return NextResponse.json({ error: 'فشل تحديث المجموعة' }, { status: 500 });
          }
        }

        if (!team) {
          console.error('[Teams API] Update returned null team for id:', teamId);
          return NextResponse.json({ error: 'فشل تحديث المجموعة - لم يتم العثور على البيانات' }, { status: 500 });
        }

        console.log('[Teams API] Update successful for team:', teamId);
        return NextResponse.json({ team });
      }

      case 'delete': {
        const { teamId } = body;
        if (!teamId) {
          return NextResponse.json({ error: 'معرف الفريق مطلوب' }, { status: 400 });
        }

        // Verify the teacher owns the subject this team belongs to
        const { data: teamToDelete } = await supabaseServer
          .from('subject_teams')
          .select('subject_id')
          .eq('id', teamId)
          .single();

        if (teamToDelete) {
          const { data: subject } = await supabaseServer
            .from('subjects')
            .select('teacher_id')
            .eq('id', teamToDelete.subject_id)
            .single();

          const isDeleteOwner = subject?.teacher_id === authResult.user.id;
          const isDeleteAdmin = authResult.role === 'admin' || authResult.role === 'superadmin';

          if (!subject || (!isDeleteOwner && !isDeleteAdmin)) {
            const { data: coTeacher } = await supabaseServer
              .from('subject_teachers')
              .select('teacher_id')
              .eq('subject_id', teamToDelete.subject_id)
              .eq('teacher_id', authResult.user.id)
              .maybeSingle();

            if (!coTeacher) {
              return NextResponse.json({ error: 'غير مصرح بحذف هذه المجموعة' }, { status: 403 });
            }
          }
        }

        const { error } = await supabaseServer
          .from('subject_teams')
          .delete()
          .eq('id', teamId);

        if (error) {
          console.error('[Teams API] Delete error:', error);
          return NextResponse.json({ error: 'فشل حذف المجموعة' }, { status: 500 });
        }

        return NextResponse.json({ success: true });
      }

      case 'add-member': {
        const { teamId, studentId } = body;
        if (!teamId || !studentId) {
          return NextResponse.json({ error: 'معرف الفريق والطالب مطلوبان' }, { status: 400 });
        }

        // Check if already in a team for this subject
        const { data: teamInfo } = await supabaseServer
          .from('subject_teams')
          .select('subject_id')
          .eq('id', teamId)
          .single();

        if (teamInfo) {
          const { data: allTeams } = await supabaseServer
            .from('subject_teams')
            .select('id')
            .eq('subject_id', teamInfo.subject_id);

          if (allTeams && allTeams.length > 0) {
            const { data: existing } = await supabaseServer
              .from('team_members')
              .select('team_id')
              .eq('student_id', studentId)
              .in('team_id', allTeams.map(t => t.id));

            if (existing && existing.length > 0) {
              // Move from existing team to new team
              await supabaseServer
                .from('team_members')
                .delete()
                .eq('student_id', studentId)
                .in('team_id', allTeams.map(t => t.id));
            }
          }
        }

        const { error } = await supabaseServer
          .from('team_members')
          .insert({ team_id: teamId, student_id: studentId });

        if (error) {
          if (error.code === '23505') {
            return NextResponse.json({ error: 'الطالب موجود بالفعل في هذا الفريق' }, { status: 409 });
          }
          console.error('[Teams API] Add member error:', error);
          return NextResponse.json({ error: 'فشل إضافة العضو' }, { status: 500 });
        }

        return NextResponse.json({ success: true });
      }

      case 'remove-member': {
        const { teamId, studentId } = body;
        if (!teamId || !studentId) {
          return NextResponse.json({ error: 'معرف الفريق والطالب مطلوبان' }, { status: 400 });
        }

        const { error } = await supabaseServer
          .from('team_members')
          .delete()
          .eq('team_id', teamId)
          .eq('student_id', studentId);

        if (error) {
          console.error('[Teams API] Remove member error:', error);
          return NextResponse.json({ error: 'فشل إزالة العضو' }, { status: 500 });
        }

        return NextResponse.json({ success: true });
      }

      case 'auto-assign': {
        const { subjectId, teamCount } = body;
        if (!subjectId || !teamCount) {
          return NextResponse.json({ error: 'معرف المقرر وعدد الفرق مطلوبان' }, { status: 400 });
        }

        // Get all approved students
        const { data: enrollments } = await supabaseServer
          .from('subject_students')
          .select('student_id')
          .eq('subject_id', subjectId)
          .eq('status', 'approved');

        if (!enrollments || enrollments.length === 0) {
          return NextResponse.json({ error: 'لا يطلب مسجلون في هذا المقرر' }, { status: 400 });
        }

        const studentIds = enrollments.map((e: { student_id: string }) => e.student_id);

        // Get existing teams
        let { data: existingTeams } = await supabaseServer
          .from('subject_teams')
          .select('id')
          .eq('subject_id', subjectId);

        // Create teams if needed
        const neededTeams = Math.max(teamCount, 1);
        const existingCount = existingTeams?.length || 0;

        if (existingCount < neededTeams) {
          const newTeams = [];
          for (let i = existingCount; i < neededTeams; i++) {
            newTeams.push({
              subject_id: subjectId,
              name: `فريق ${i + 1}`,
              color: ['#0369a1', '#ec4899', '#f59e0b', '#0D9488', '#8b5cf6', '#ef4444', '#06b6d4', '#84cc16'][i % 8],
              created_by: authResult.user.id,
            });
          }
          const { data: created } = await supabaseServer
            .from('subject_teams')
            .insert(newTeams)
            .select();
          if (created) {
            existingTeams = [...(existingTeams || []), ...created];
          }
        }

        // Clear existing assignments
        if (existingTeams && existingTeams.length > 0) {
          await supabaseServer
            .from('team_members')
            .delete()
            .in('team_id', existingTeams.map(t => t.id));
        }

        // Shuffle students
        const shuffled = [...studentIds].sort(() => Math.random() - 0.5);

        // Distribute evenly
        const teamIds = (existingTeams || []).slice(0, neededTeams).map(t => t.id);
        const inserts = shuffled.map((studentId, index) => ({
          team_id: teamIds[index % teamIds.length],
          student_id: studentId,
        }));

        if (inserts.length > 0) {
          const { error: insertError } = await supabaseServer
            .from('team_members')
            .insert(inserts);

          if (insertError) {
            console.error('[Teams API] Auto-assign error:', insertError);
            return NextResponse.json({ error: 'فشل التوزيع التلقائي' }, { status: 500 });
          }
        }

        return NextResponse.json({ success: true, assignedCount: inserts.length, teamCount: teamIds.length });
      }

      case 'auto-assign-by-performance': {
        const { subjectId, teamCount } = body;
        if (!subjectId || !teamCount) {
          return NextResponse.json({ error: 'معرف المقرر وعدد الفرق مطلوبان' }, { status: 400 });
        }

        // Get all approved students
        const { data: enrollments } = await supabaseServer
          .from('subject_students')
          .select('student_id')
          .eq('subject_id', subjectId)
          .eq('status', 'approved');

        if (!enrollments || enrollments.length === 0) {
          return NextResponse.json({ error: 'لا يوجد طلاب مسجلون في هذا المقرر' }, { status: 400 });
        }

        const studentIds = enrollments.map((e: { student_id: string }) => e.student_id);

        // Get quiz IDs for this subject
        const { data: quizzes } = await supabaseServer
          .from('quizzes')
          .select('id')
          .eq('subject_id', subjectId);

        const quizIds = (quizzes || []).map((q: { id: string }) => q.id);

        // Get scores for these quizzes for the enrolled students
        type ScoreRow = { student_id: string; score: number; total: number };
        let studentScores: Record<string, { totalScore: number; totalMax: number }> = {};

        if (quizIds.length > 0) {
          const { data: scores } = await supabaseServer
            .from('scores')
            .select('student_id, score, total')
            .in('quiz_id', quizIds)
            .in('student_id', studentIds);

          if (scores) {
            for (const s of (scores as ScoreRow[])) {
              if (!studentScores[s.student_id]) {
                studentScores[s.student_id] = { totalScore: 0, totalMax: 0 };
              }
              studentScores[s.student_id].totalScore += s.score;
              studentScores[s.student_id].totalMax += s.total;
            }
          }
        }

        // Calculate average percentage for each student
        const studentPerformance = studentIds.map(id => ({
          id,
          avgPct: studentScores[id] && studentScores[id].totalMax > 0
            ? (studentScores[id].totalScore / studentScores[id].totalMax) * 100
            : -1, // -1 means no scores yet
        }));

        // Sort by performance (highest first)
        studentPerformance.sort((a, b) => b.avgPct - a.avgPct);

        // Create performance level labels
        const levelNames = ['متقدم', 'متوسط', 'مبتدئ'];
        const levelColors = ['#0369a1', '#f59e0b', '#ef4444'];
        const neededTeams = Math.max(teamCount, 1);

        // Get or create teams with performance levels
        let { data: existingTeams } = await supabaseServer
          .from('subject_teams')
          .select('id')
          .eq('subject_id', subjectId);

        const existingCount = existingTeams?.length || 0;
        const teamsToCreate = [];

        for (let i = existingCount; i < neededTeams; i++) {
          teamsToCreate.push({
            subject_id: subjectId,
            name: levelNames[i % levelNames.length] || `مستوى ${i + 1}`,
            level: levelNames[i % levelNames.length] || `مستوى ${i + 1}`,
            color: levelColors[i % levelColors.length] || '#6366f1',
            created_by: authResult.user.id,
          });
        }

        if (teamsToCreate.length > 0) {
          const { data: created } = await supabaseServer
            .from('subject_teams')
            .insert(teamsToCreate)
            .select();
          if (created) {
            existingTeams = [...(existingTeams || []), ...created];
          }
        }

        // Clear existing assignments
        if (existingTeams && existingTeams.length > 0) {
          await supabaseServer
            .from('team_members')
            .delete()
            .in('team_id', existingTeams.map(t => t.id));
        }

        // Distribute by performance: top performers to team 0, next to team 1, etc.
        // This creates homogeneous groups by performance level
        const teamIds = (existingTeams || []).slice(0, neededTeams).map(t => t.id);

        // Calculate chunk sizes for even distribution
        const totalStudents = studentPerformance.length;
        const baseSize = Math.floor(totalStudents / neededTeams);
        const remainder = totalStudents % neededTeams;

        const inserts: { team_id: string; student_id: string }[] = [];
        let idx = 0;
        for (let t = 0; t < neededTeams; t++) {
          const chunkSize = baseSize + (t < remainder ? 1 : 0);
          for (let j = 0; j < chunkSize; j++) {
            if (idx < totalStudents && teamIds[t]) {
              inserts.push({
                team_id: teamIds[t],
                student_id: studentPerformance[idx].id,
              });
              idx++;
            }
          }
        }

        if (inserts.length > 0) {
          const { error: insertError } = await supabaseServer
            .from('team_members')
            .insert(inserts);

          if (insertError) {
            console.error('[Teams API] Auto-assign by performance error:', insertError);
            return NextResponse.json({ error: 'فشل التوزيع حسب الأداء' }, { status: 500 });
          }
        }

        return NextResponse.json({
          success: true,
          assignedCount: inserts.length,
          teamCount: teamIds.length,
          studentsWithScores: Object.keys(studentScores).length,
          studentsWithoutScores: studentIds.length - Object.keys(studentScores).length,
        });
      }

      default:
        return NextResponse.json({ error: 'إجراء غير صالح' }, { status: 400 });
    }
  } catch (error) {
    console.error('[Teams API] POST error:', error);
    return NextResponse.json({ error: 'خطأ في الخادم' }, { status: 500 });
  }
}

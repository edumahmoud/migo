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

        if (!subject || (subject.teacher_id !== authResult.user.id && authResult.user.role !== 'admin' && authResult.user.role !== 'superadmin')) {
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

        const updates: Record<string, unknown> = {};
        if (name !== undefined) updates.name = name.trim();
        if (level !== undefined) updates.level = level?.trim() || null;
        if (color !== undefined) updates.color = color;

        const { data: team, error } = await supabaseServer
          .from('subject_teams')
          .update(updates)
          .eq('id', teamId)
          .select()
          .single();

        if (error) {
          console.error('[Teams API] Update error:', error);
          return NextResponse.json({ error: 'فشل تحديث الفريق' }, { status: 500 });
        }

        return NextResponse.json({ team });
      }

      case 'delete': {
        const { teamId } = body;
        if (!teamId) {
          return NextResponse.json({ error: 'معرف الفريق مطلوب' }, { status: 400 });
        }

        const { error } = await supabaseServer
          .from('subject_teams')
          .delete()
          .eq('id', teamId);

        if (error) {
          console.error('[Teams API] Delete error:', error);
          return NextResponse.json({ error: 'فشل حذف الفريق' }, { status: 500 });
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
              color: ['#6366f1', '#ec4899', '#f59e0b', '#10b981', '#8b5cf6', '#ef4444', '#06b6d4', '#84cc16'][i % 8],
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

      default:
        return NextResponse.json({ error: 'إجراء غير صالح' }, { status: 400 });
    }
  } catch (error) {
    console.error('[Teams API] POST error:', error);
    return NextResponse.json({ error: 'خطأ في الخادم' }, { status: 500 });
  }
}

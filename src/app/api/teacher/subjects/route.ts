import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateRequest, authErrorResponse, getUserRole } from '@/lib/auth-helpers';

/**
 * GET /api/teacher/subjects
 *
 * List all subjects the current teacher owns or co-teaches.
 * Used by the SCORM library UI to pick subjects for linking.
 *
 * Returns: { success, data: [{ id, name, color, is_owner }] }
 */
export async function GET(request: NextRequest) {
  const authResult = await authenticateRequest(request);
  if (!authResult.success) return authErrorResponse(authResult);

  try {
    const userId = authResult.user.id;
    const role = await getUserRole(userId);

    if (role === 'student') {
      return NextResponse.json(
        { success: false, error: 'Only teachers and admins can access this endpoint' },
        { status: 403 },
      );
    }

    const isAdmin = role === 'admin' || role === 'superadmin';

    if (isAdmin) {
      // Admins can see all subjects
      const { data: subjects, error } = await supabaseServer
        .from('subjects')
        .select('id, name, color, teacher_id')
        .order('name', { ascending: true });
      if (error) {
        console.error('[Teacher Subjects] Fetch error:', error.message);
        return NextResponse.json({ success: false, error: 'Failed to fetch subjects' }, { status: 500 });
      }
      return NextResponse.json({
        success: true,
        data: (subjects || []).map((s: any) => ({ ...s, is_owner: false })),
      });
    }

    // Teachers: subjects they own + subjects they co-teach
    const { data: owned, error: ownedErr } = await supabaseServer
      .from('subjects')
      .select('id, name, color, teacher_id')
      .eq('teacher_id', userId)
      .order('name', { ascending: true });

    if (ownedErr) {
      console.error('[Teacher Subjects] Owned fetch error:', ownedErr.message);
      return NextResponse.json({ success: false, error: 'Failed to fetch subjects' }, { status: 500 });
    }

    const { data: coTaught, error: coErr } = await supabaseServer
      .from('subject_teachers')
      .select(`
        subject_id,
        subject:subjects(id, name, color, teacher_id)
      `)
      .eq('teacher_id', userId);

    if (coErr) {
      console.error('[Teacher Subjects] Co-taught fetch error:', coErr.message);
    }

    const seenIds = new Set<string>();
    const result: any[] = [];
    for (const s of owned || []) {
      if (!seenIds.has(s.id)) {
        seenIds.add(s.id);
        result.push({ ...s, is_owner: true });
      }
    }
    for (const ct of coTaught || []) {
      const subject = (ct as any).subject;
      if (subject && !seenIds.has(subject.id)) {
        seenIds.add(subject.id);
        result.push({ ...subject, is_owner: false });
      }
    }

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    console.error('[Teacher Subjects] GET error:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

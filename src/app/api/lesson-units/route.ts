import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateRequest, authErrorResponse, getUserRole } from '@/lib/auth-helpers';

/**
 * Verify the user has teacher/admin access to the given subject.
 * (Mirrors the helper in [id]/route.ts — kept here for self-containment.)
 */
async function verifySubjectAccess(userId: string, subjectId: string, role: string | null) {
  const isAdmin = role === 'admin' || role === 'superadmin';
  if (isAdmin) return { ok: true as const };

  const { data: subject } = await supabaseServer
    .from('subjects')
    .select('teacher_id')
    .eq('id', subjectId)
    .maybeSingle();

  if (!subject) return { ok: false as const };
  if (subject.teacher_id === userId) return { ok: true as const };

  const { data: coTeacher } = await supabaseServer
    .from('subject_teachers')
    .select('id')
    .eq('subject_id', subjectId)
    .eq('teacher_id', userId)
    .maybeSingle();

  if (coTeacher) return { ok: true as const };
  return { ok: false as const };
}

/**
 * Verify the user is enrolled in the given subject (for student access).
 */
async function verifyEnrollment(userId: string, subjectId: string) {
  const { data: enrollment } = await supabaseServer
    .from('subject_students')
    .select('id')
    .eq('subject_id', subjectId)
    .eq('student_id', userId)
    .maybeSingle();
  return !!enrollment;
}

/**
 * GET /api/lesson-units?subject_id=xxx
 *
 * Returns all lesson units for a subject.
 * - Teachers/admins see all units (published + unpublished)
 * - Students see only published units in subjects they're enrolled in
 */
export async function GET(request: NextRequest) {
  const authResult = await authenticateRequest(request);
  if (!authResult.success) return authErrorResponse(authResult);

  const userId = authResult.user.id;
  const role = await getUserRole(userId);
  const subjectId = request.nextUrl.searchParams.get('subject_id');

  if (!subjectId) {
    return NextResponse.json({ error: 'subject_id is required' }, { status: 400 });
  }

  // Verify access
  const isTeacher = await verifySubjectAccess(userId, subjectId, role);
  const isStudent = role === 'student';

  if (!isTeacher) {
    if (isStudent) {
      const enrolled = await verifyEnrollment(userId, subjectId);
      if (!enrolled) {
        return NextResponse.json({ error: 'Not enrolled in this subject' }, { status: 403 });
      }
    } else {
      return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
    }
  }

  // Build query — students get published only, teachers get all
  let query = supabaseServer
    .from('lesson_units')
    .select('*')
    .eq('subject_id', subjectId)
    .order('order_index', { ascending: true });

  if (!isTeacher && isStudent) {
    query = query.eq('is_published', true);
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data });
}

/**
 * POST /api/lesson-units
 *
 * Create a new lesson unit.
 * Body: { subject_id, title, description?, pass_threshold?, order_index? }
 *
 * Teacher/admin only.
 */
export async function POST(request: NextRequest) {
  const authResult = await authenticateRequest(request);
  if (!authResult.success) return authErrorResponse(authResult);

  const userId = authResult.user.id;
  const role = await getUserRole(userId);

  let body: { subject_id?: string; title?: string; description?: string; pass_threshold?: number; order_index?: number };
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { subject_id, title, description, pass_threshold, order_index } = body;

  if (!subject_id || !title) {
    return NextResponse.json({ error: 'subject_id + title are required' }, { status: 400 });
  }

  const access = await verifySubjectAccess(userId, subject_id, role);
  if (!access.ok) {
    return NextResponse.json({ error: 'Not authorized to manage this subject' }, { status: 403 });
  }

  // Validate pass_threshold
  if (pass_threshold !== undefined && (pass_threshold < 0 || pass_threshold > 100)) {
    return NextResponse.json({ error: 'pass_threshold must be 0-100' }, { status: 400 });
  }

  const { data, error } = await supabaseServer
    .from('lesson_units')
    .insert({
      subject_id,
      title: title.trim(),
      description: description?.trim() || null,
      pass_threshold: pass_threshold ?? 60,
      order_index: order_index ?? 0,
      is_published: false,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data }, { status: 201 });
}

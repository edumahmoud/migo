import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateRequest, authErrorResponse, getUserRole } from '@/lib/auth-helpers';
import type { Lesson } from '@/lib/types';

/**
 * GET /api/lessons?subject_id=xxx
 *
 * List lessons for a subject.
 * - Students: only see published lessons in enrolled subjects
 * - Teachers/admins: see all lessons in their subjects
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await authenticateRequest(request);
    if (!authResult.success) return authErrorResponse(authResult);

    const userId = authResult.user.id;
    const { searchParams } = new URL(request.url);
    const subjectId = searchParams.get('subject_id');

    if (!subjectId) {
      return NextResponse.json(
        { error: 'subject_id query parameter is required' },
        { status: 400 },
      );
    }

    // Get user role from DB (source of truth)
    const role = await getUserRole(userId);
    const isTeacherOrAdmin = role === 'teacher' || role === 'admin' || role === 'superadmin';

    // Verify user has access to this subject
    if (isTeacherOrAdmin) {
      // Check if user is teacher of this subject (owner or co-teacher)
      const { data: subject } = await supabaseServer
        .from('subjects')
        .select('teacher_id')
        .eq('id', subjectId)
        .single();

      const isOwner = subject?.teacher_id === userId;

      // Also check co-teacher access
      let isCoTeacher = false;
      if (!isOwner) {
        const { data: coTeacherEntry } = await supabaseServer
          .from('subject_teachers')
          .select('id')
          .eq('subject_id', subjectId)
          .eq('teacher_id', userId)
          .maybeSingle();
        isCoTeacher = !!coTeacherEntry;
      }

      // Admins can access any subject
      const isAdmin = role === 'admin' || role === 'superadmin';

      if (!isOwner && !isCoTeacher && !isAdmin) {
        return NextResponse.json(
          { error: 'You do not have access to this subject' },
          { status: 403 },
        );
      }

      // Teachers/admins see all lessons
      const { data: lessons, error } = await supabaseServer
        .from('lessons')
        .select('*')
        .eq('subject_id', subjectId)
        .order('order_index', { ascending: true });

      if (error) {
        console.error('[Lessons API] Fetch error:', error.message);
        return NextResponse.json(
          { error: 'Failed to fetch lessons' },
          { status: 500 },
        );
      }

      return NextResponse.json({ lessons: lessons as Lesson[] });
    } else {
      // Student: check enrollment
      const { data: enrollment } = await supabaseServer
        .from('subject_students')
        .select('status')
        .eq('subject_id', subjectId)
        .eq('student_id', userId)
        .single();

      if (!enrollment || enrollment.status !== 'approved') {
        return NextResponse.json(
          { error: 'You do not have access to this subject' },
          { status: 403 },
        );
      }

      // Students only see published lessons
      const { data: lessons, error } = await supabaseServer
        .from('lessons')
        .select('*')
        .eq('subject_id', subjectId)
        .eq('status', 'published')
        .order('order_index', { ascending: true });

      if (error) {
        console.error('[Lessons API] Fetch error:', error.message);
        return NextResponse.json(
          { error: 'Failed to fetch lessons' },
          { status: 500 },
        );
      }

      return NextResponse.json({ lessons: lessons as Lesson[] });
    }
  } catch (error) {
    console.error('[Lessons API] GET unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}

/**
 * POST /api/lessons
 *
 * Create a new lesson.
 * Only teachers/admins can create lessons.
 * Lesson is created with status='draft' and order_index = max+1.
 *
 * Body: { subject_id: string, title: string }
 */
export async function POST(request: NextRequest) {
  try {
    const authResult = await authenticateRequest(request);
    if (!authResult.success) return authErrorResponse(authResult);

    const userId = authResult.user.id;
    const body = await request.json();
    const { subject_id, title } = body;

    if (!subject_id) {
      return NextResponse.json(
        { error: 'subject_id is required' },
        { status: 400 },
      );
    }

    if (!title || typeof title !== 'string' || title.trim().length === 0) {
      return NextResponse.json(
        { error: 'title is required and must be a non-empty string' },
        { status: 400 },
      );
    }

    // Verify user is teacher/admin
    const role = await getUserRole(userId);
    if (role !== 'teacher' && role !== 'admin' && role !== 'superadmin') {
      return NextResponse.json(
        { error: 'Only teachers and admins can create lessons' },
        { status: 403 },
      );
    }

    // Verify the subject exists and belongs to this teacher (or user is admin)
    const { data: subject, error: subjectError } = await supabaseServer
      .from('subjects')
      .select('id, teacher_id')
      .eq('id', subject_id)
      .single();

    if (subjectError || !subject) {
      return NextResponse.json(
        { error: 'Subject not found' },
        { status: 404 },
      );
    }

    const isAdmin = role === 'admin' || role === 'superadmin';

    // Check if teacher owns this subject or is co-teacher
    if (subject.teacher_id !== userId && !isAdmin) {
      // Check co-teacher access
      const { data: coTeacherEntry } = await supabaseServer
        .from('subject_teachers')
        .select('id')
        .eq('subject_id', subject_id)
        .eq('teacher_id', userId)
        .maybeSingle();

      if (!coTeacherEntry) {
        return NextResponse.json(
          { error: 'You do not have permission to create lessons in this subject' },
          { status: 403 },
        );
      }
    }

    // Get the current max order_index for this subject
    const { data: maxOrderResult } = await supabaseServer
      .from('lessons')
      .select('order_index')
      .eq('subject_id', subject_id)
      .order('order_index', { ascending: false })
      .limit(1)
      .maybeSingle();

    const nextOrderIndex = (maxOrderResult?.order_index ?? -1) + 1;

    // Create the lesson
    const { data: lesson, error: insertError } = await supabaseServer
      .from('lessons')
      .insert({
        subject_id,
        title: title.trim(),
        status: 'draft',
        order_index: nextOrderIndex,
        created_by: userId,
      })
      .select()
      .single();

    if (insertError) {
      console.error('[Lessons API] Insert error:', insertError.message);
      return NextResponse.json(
        { error: 'Failed to create lesson' },
        { status: 500 },
      );
    }

    return NextResponse.json({ lesson: lesson as Lesson }, { status: 201 });
  } catch (error) {
    console.error('[Lessons API] POST unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}

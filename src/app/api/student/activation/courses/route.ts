import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { requirePendingStudent, authErrorResponse } from '@/lib/auth-helpers';

/**
 * GET /api/student/activation/courses
 *
 * Lists courses the PENDING student can subscribe to (filtered to teachers
 * they're linked to via teacher_student_links.status='approved').
 *
 * Real price is taken from the subjects table (server-side source of truth —
 * the client can never manipulate price).
 */
export async function GET(request: NextRequest) {
  const auth = await requirePendingStudent(request);
  if (!auth.success) return authErrorResponse(auth);

  const studentId = auth.user.id;

  // 1. Get the student's approved teacher links.
  const { data: links } = await supabaseServer
    .from('teacher_student_links')
    .select('teacher_id')
    .eq('student_id', studentId)
    .eq('status', 'approved');

  const teacherIds = ((links ?? []) as Array<{ teacher_id: string }>).map((l) => l.teacher_id);

  if (teacherIds.length === 0) {
    return NextResponse.json({ success: true, courses: [] });
  }

  // 2. Get courses for those teachers that are open for subscription.
  const { data: subjects, error } = await supabaseServer
    .from('subjects')
    .select(
      'id, name, description, level, sub_level, price, currency, join_code, teacher_id, is_paused, subscription_open, created_at'
    )
    .in('teacher_id', teacherIds)
    .eq('is_paused', false)
    .eq('subscription_open', true)
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json({ success: false, error: 'فشل تحميل المقررات' }, { status: 500 });
  }

  const courses = ((subjects ?? []) as Array<{
    id: string;
    name: string;
    description: string | null;
    level: string | null;
    sub_level: string | null;
    price: number;
    currency: string;
    join_code: string | null;
    teacher_id: string;
    is_paused: boolean;
    subscription_open: boolean;
    created_at: string;
  }>).map((s) => ({
    id: s.id,
    name: s.name,
    description: s.description,
    level: s.level,
    sub_level: s.sub_level,
    price: Number(s.price),
    currency: s.currency,
    join_code: s.join_code,
    teacher_id: s.teacher_id,
    is_paused: s.is_paused,
    subscription_open: s.subscription_open,
  }));

  return NextResponse.json({ success: true, courses });
}

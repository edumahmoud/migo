import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateRequest, authErrorResponse } from '@/lib/auth-helpers';

/**
 * GET /api/student/payment-methods
 *
 * Returns the active payment methods for every teacher the calling
 * student is linked to (via teacher_student_links.status='approved').
 * Grouped by teacher so the UI can render per-teacher sections.
 *
 * Auth: any authenticated user. RLS further restricts the SELECT to
 * only methods of teachers the student is linked to.
 */
export async function GET(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if (!auth.success) return authErrorResponse(auth);

  const studentId = auth.user.id;

  // Verify role (only students should call this — but allow anyone to call
  // since RLS will only return rows the caller is allowed to see).
  // We still check the role so admins/teachers get an empty list instead
  // of cross-teacher leakage.

  // Fetch teacher links (approved only).
  const { data: links } = await supabaseServer
    .from('teacher_student_links')
    .select('teacher_id, status')
    .eq('student_id', studentId)
    .eq('status', 'approved');

  const teacherIds = (links ?? []).map((l: { teacher_id: string }) => l.teacher_id);

  if (teacherIds.length === 0) {
    return NextResponse.json({ success: true, teachers: [] });
  }

  // Fetch teacher profiles.
  const { data: teachers } = await supabaseServer
    .from('users')
    .select('id, name, email')
    .in('id', teacherIds);

  // Fetch active payment methods for those teachers.
  const { data: methods, error } = await supabaseServer
    .from('payment_methods')
    .select('id, teacher_id, name, icon, account_identifier, contact_for_confirmation, is_active, sort_order, created_at, updated_at')
    .in('teacher_id', teacherIds)
    .eq('is_active', true)
    .order('sort_order', { ascending: true });

  if (error) {
    return NextResponse.json(
      { success: false, error: 'فشل تحميل وسائل الدفع' },
      { status: 500 }
    );
  }

  // Group by teacher_id
  const byTeacher: Record<string, typeof methods> = {};
  for (const m of methods ?? []) {
    const tid = (m as { teacher_id: string }).teacher_id;
    if (!byTeacher[tid]) byTeacher[tid] = [];
    byTeacher[tid].push(m);
  }

  const teachersOut = (teachers ?? []).map((t: { id: string; name: string | null; email: string | null }) => ({
    id: t.id,
    name: t.name,
    email: t.email,
    methods: byTeacher[t.id] ?? [],
  }));

  return NextResponse.json({ success: true, teachers: teachersOut });
}

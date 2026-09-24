import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseServer } from '@/lib/supabase-server';
import { requireAgent, authErrorResponse } from '@/lib/auth-helpers';

/**
 * POST /api/agent/search-student
 * Body: { studentCode: string }
 *
 * Searches for a student by their student_code. Returns the student's
 * profile + all their subscriptions (active + expired) for the
 * supervisor's teacher's courses only.
 *
 * The supervisor can view the student's account_status, subscriptions,
 * and current billing periods.
 */
const BodySchema = z.object({ studentCode: z.string().trim().min(1).max(40) });

export async function POST(request: NextRequest) {
  const auth = await requireAgent(request);
  if (!auth.success) return authErrorResponse(auth);

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ success: false, error: 'صيغة JSON غير صالحة' }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ success: false, error: 'الكود غير صالح' }, { status: 400 });

  const { sourceTeacherId } = auth;

  // 1. Find the student by code.
  const { data: student, error: studentErr } = await supabaseServer
    .from('users')
    .select('id, email, name, username, role, student_code, account_status, created_at')
    .eq('student_code', parsed.data.studentCode.toUpperCase())
    .maybeSingle();

  if (studentErr) return NextResponse.json({ success: false, error: 'تعذّر البحث' }, { status: 500 });
  if (!student) return NextResponse.json({ success: false, error: 'لا يوجد طالب بهذا الكود' }, { status: 404 });

  const s = student as { id: string; email: string; name: string | null; username: string | null; role: string; student_code: string | null; account_status: string | null; created_at: string };

  // 2. Fetch the student's subscriptions for THIS teacher's courses only.
  const { data: subs } = await supabaseServer
    .from('subject_students')
    .select('id, subject_id, status, enrollment_method, current_period_start, current_period_end, next_billing_at, monthly_price, enrolled_at, subject:subjects!inner(id, name, level, sub_level, price, teacher_id)')
    .eq('student_id', s.id)
    .eq('subject.teacher_id', sourceTeacherId)
    .order('current_period_end', { ascending: false, nullsFirst: false });

  // 3. Fetch pending orders for this student (for this teacher's courses).
  const { data: orders } = await supabaseServer
    .from('orders')
    .select('id, subject_id, amount, currency, status, created_at, subject:subjects!inner(id, name, teacher_id)')
    .eq('student_id', s.id)
    .eq('subject.teacher_id', sourceTeacherId)
    .order('created_at', { ascending: false })
    .limit(20);

  return NextResponse.json({
    success: true,
    student: {
      id: s.id, email: s.email, name: s.name, username: s.username,
      student_code: s.student_code, account_status: s.account_status,
      created_at: s.created_at,
    },
    subscriptions: subs ?? [],
    pending_orders: (orders ?? []).filter((o: { status: string }) => o.status === 'pending'),
  });
}

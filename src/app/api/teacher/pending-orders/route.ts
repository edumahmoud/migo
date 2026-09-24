import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { requireTeacher, authErrorResponse } from '@/lib/auth-helpers';

/**
 * GET /api/teacher/pending-orders
 * Lists all PENDING manual-confirmation orders for the teacher's courses.
 */
export async function GET(request: NextRequest) {
  const auth = await requireTeacher(request);
  if (!auth.success) return authErrorResponse(auth);

  const { data, error } = await supabaseServer
    .from('orders')
    .select(
      'id, student_id, subject_id, amount, currency, status, confirmation_mode, created_at, ' +
      'subject:subjects!inner(id, name, teacher_id, level, sub_level), ' +
      'student:users!student_id(id, email, name, student_code)'
    )
    .eq('status', 'pending')
    .eq('confirmation_mode', 'manual')
    .eq('subject.teacher_id', auth.user.id)
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) {
    return NextResponse.json({ success: false, error: 'فشل تحميل الطلبات المعلقة' }, { status: 500 });
  }
  return NextResponse.json({ success: true, orders: data ?? [] });
}

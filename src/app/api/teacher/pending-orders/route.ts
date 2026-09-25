import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateRequest, getUserRole, authErrorResponse } from '@/lib/auth-helpers';

/**
 * GET /api/teacher/pending-orders
 *
 * Lists all PENDING manual-confirmation orders for the requesting
 * teacher's courses. Also accessible by registration_agent (derives
 * teacher_id from the agent's row) and admin/superadmin (see all).
 *
 * Two-step query: fetch subject IDs first, then filter orders.
 */
export async function GET(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if (!auth.success) return authErrorResponse(auth);

  const role = await getUserRole(auth.user.id);
  console.log('[pending-orders] caller role:', role, 'userId:', auth.user.id);

  if (!role || !['teacher', 'admin', 'superadmin', 'registration_agent'].includes(role)) {
    return NextResponse.json({ success: false, error: 'غير مصرح' }, { status: 403 });
  }

  // 1. Determine the teacher_id filter.
  let teacherIdFilter: string | null = null;
  if (role === 'teacher') {
    teacherIdFilter = auth.user.id;
  } else if (role === 'registration_agent') {
    const { data: agent, error: agentErr } = await supabaseServer
      .from('registration_agents')
      .select('teacher_id, is_active, source_id')
      .eq('user_id', auth.user.id)
      .maybeSingle();

    console.log('[pending-orders] agent lookup:', { agent, error: agentErr?.message });

    // Try without is_active filter if the first query returns nothing.
    if (!agent) {
      const { data: agentAny } = await supabaseServer
        .from('registration_agents')
        .select('teacher_id, is_active, source_id')
        .eq('user_id', auth.user.id)
        .maybeSingle();
      console.log('[pending-orders] agent (no is_active filter):', agentAny);
      if (agentAny) {
        teacherIdFilter = (agentAny as { teacher_id: string | null }).teacher_id ?? null;
      }
    } else {
      teacherIdFilter = (agent as { teacher_id: string | null }).teacher_id ?? null;
    }

    if (!teacherIdFilter) {
      console.error('[pending-orders] CRITICAL: agent has no teacher_id! userId:', auth.user.id);
      return NextResponse.json({ success: false, error: 'تعذر تحديد المعلم المرتبط بك — يرجى التواصل مع الإدارة' }, { status: 403 });
    }
    console.log('[pending-orders] agent teacher_id:', teacherIdFilter);
  }
  // admin/superadmin: teacherIdFilter stays null → sees all.

  // 2. Fetch the teacher's subject IDs (if filtered).
  let subjectIds: string[] | null = null;
  if (teacherIdFilter) {
    const { data: subjects, error: subErr } = await supabaseServer
      .from('subjects')
      .select('id, name')
      .eq('teacher_id', teacherIdFilter);
    console.log('[pending-orders] subjects for teacher:', { count: subjects?.length, error: subErr?.message, teacherIdFilter });

    if (subErr) {
      console.error('[pending-orders] subjects query error:', subErr);
      return NextResponse.json({ success: false, error: 'فشل تحميل مقررات المعلم' }, { status: 500 });
    }
    subjectIds = ((subjects ?? []) as Array<{ id: string }>).map((s) => s.id);
    if (subjectIds.length === 0) {
      console.log('[pending-orders] no subjects found for teacher:', teacherIdFilter);
      return NextResponse.json({ success: true, orders: [] });
    }
  }

  // 3. Query orders (includes proof fields for supervisor review).
  let query = supabaseServer
    .from('orders')
    .select(
      'id, student_id, subject_id, amount, currency, status, confirmation_mode, created_at, ' +
      'sender_name, transaction_ref, proof_notes, proof_submitted_at, proof_url, ' +
      'payment_method_id, ' +
      'subject:subjects(id, name, level, sub_level), ' +
      'student:users!student_id(id, email, name, student_code), ' +
      'payment_method:payment_methods(id, name, icon, account_identifier, contact_for_confirmation)'
    )
    .eq('status', 'pending')
    .eq('confirmation_mode', 'manual')
    .order('proof_submitted_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(200);

  if (subjectIds) {
    query = query.in('subject_id', subjectIds);
  }

  const { data, error } = await query;

  if (error) {
    console.error('[pending-orders] orders query error:', error);
    return NextResponse.json({ success: false, error: 'فشل تحميل الطلبات المعلقة: ' + error.message }, { status: 500 });
  }

  console.log('[pending-orders] found orders:', data?.length ?? 0);

  return NextResponse.json({ success: true, orders: data ?? [] });
}

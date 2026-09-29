import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateRequest, getUserRole } from '@/lib/auth-helpers';
import { parseTransactionCode } from '@/lib/payment/utils';

/**
 * GET /api/admin/transactions/search?code=TX-20260930-A1B2
 *
 * Search for a payout/transaction by its code.
 * Available to ALL authenticated users (student/teacher/agent/admin)
 * — RLS-equivalent filtering ensures users only see transactions
 * they have access to.
 *
 * The code is stored in `teacher_payouts.provider_reference` OR
 * `teacher_payouts.internal_reference`. This endpoint searches both.
 *
 * Returns: transaction details + linked ledger entries + teacher info
 */

export async function GET(request: NextRequest) {
  const authResult = await authenticateRequest(request);
  if (!authResult.success) {
    return NextResponse.json({ success: false, error: 'غير مصرح' }, { status: 401 });
  }

  const callerId = authResult.user.id;
  const role = await getUserRole(callerId);

  const code = request.nextUrl.searchParams.get('code')?.trim();
  if (!code) {
    return NextResponse.json(
      { success: false, error: 'مطلوب parameter code (مثال: TX-20260930-A1B2)' },
      { status: 400 },
    );
  }

  const normalized = parseTransactionCode(code);
  if (!normalized) {
    return NextResponse.json(
      { success: false, error: 'صيغة الكود غير صالحة — المطلوب TX-XXXX أو STL-XXXX أو PAY-XXXX' },
      { status: 400 },
    );
  }

  // Search by provider_reference OR internal_reference (ILIKE)
  const { data: payout, error: payoutErr } = await supabaseServer
    .from('teacher_payouts')
    .select(`
      id, teacher_id, payout_method_type, payout_method_display_label,
      payout_method_masked, amount, currency, status,
      internal_reference, provider_reference, failure_reason,
      initiated_by, initiated_at, executed_at, created_at
    `)
    .or(`provider_reference.ilike.%${normalized}%,internal_reference.ilike.%${normalized}%`)
    .maybeSingle();

  if (payoutErr) {
    return NextResponse.json({ success: false, error: 'تعذّر البحث' }, { status: 500 });
  }

  if (!payout) {
    return NextResponse.json(
      { success: false, error: `لا توجد معاملة بالكود ${code}` },
      { status: 404 },
    );
  }

  const p = payout as {
    id: string;
    teacher_id: string;
    payout_method_type: string;
    payout_method_display_label: string;
    payout_method_masked: string;
    amount: number;
    currency: string;
    status: string;
    internal_reference: string;
    provider_reference: string | null;
    failure_reason: string | null;
    initiated_by: string;
    initiated_at: string;
    executed_at: string | null;
    created_at: string;
  };

  // ── Authorization ──
  let authorized = false;
  if (role === 'admin' || role === 'superadmin') {
    authorized = true;
  } else if (role === 'teacher') {
    authorized = (p.teacher_id === callerId);
  } else if (role === 'registration_agent') {
    // Agents can see transactions for their teacher's payouts
    const { data: agentRow } = await supabaseServer
      .from('registration_agents')
      .select('teacher_id')
      .eq('user_id', callerId)
      .eq('is_active', true)
      .single();
    const agentTeacherId = (agentRow as { teacher_id: string | null } | null)?.teacher_id ?? null;
    authorized = !!agentTeacherId && p.teacher_id === agentTeacherId;
  }
  // Students can't see payout transactions

  if (!authorized) {
    return NextResponse.json(
      { success: false, error: 'غير مصرح — لا يمكنك عرض هذه المعاملة' },
      { status: 403 },
    );
  }

  // Fetch linked ledger entries
  const { data: linkedEntries } = await supabaseServer
    .from('teacher_payout_ledger_entries')
    .select(`
      ledger_id, amount_settled, currency, settled_at,
      ledger:financial_ledger!inner (
        id, order_id, student_id, subject_id,
        gross_amount, teacher_share, platform_share,
        commission_rate, status, created_at
      )
    `)
    .eq('payout_id', p.id);

  // Fetch teacher info
  const { data: teacherInfo } = await supabaseServer
    .from('users')
    .select('id, name, email, teacher_code')
    .eq('id', p.teacher_id)
    .maybeSingle();

  const statusLabel: Record<string, string> = {
    pending: 'معلّق',
    processing: 'قيد المعالجة',
    completed: 'مكتمل',
    failed: 'فشل',
    cancelled: 'ملغي',
  };

  const txCode = p.provider_reference || p.internal_reference || `TX-${p.id.slice(0, 8).toUpperCase()}`;

  return NextResponse.json({
    success: true,
    transaction: {
      id: p.id,
      transaction_code: txCode,
      amount: Number(p.amount),
      currency: p.currency,
      status: p.status,
      status_label: statusLabel[p.status] ?? p.status,
      method_type: p.payout_method_type,
      method_label: p.payout_method_display_label,
      method_masked: p.payout_method_masked,
      initiated_at: p.initiated_at,
      executed_at: p.executed_at,
      created_at: p.created_at,
      failure_reason: p.failure_reason,
      teacher: teacherInfo as { id: string; name: string | null; email: string; teacher_code: string | null } | null,
      linked_entries: (linkedEntries ?? []).map((e: Record<string, unknown>) => ({
        ledger_id: e.ledger_id,
        amount_settled: Number(e.amount_settled),
        currency: e.currency,
        settled_at: e.settled_at,
        order_id: (e.ledger as Record<string, unknown> | null)?.order_id,
        student_id: (e.ledger as Record<string, unknown> | null)?.student_id,
        gross_amount: Number((e.ledger as Record<string, unknown> | null)?.gross_amount ?? 0),
        teacher_share: Number((e.ledger as Record<string, unknown> | null)?.teacher_share ?? 0),
      })),
    },
  });
}

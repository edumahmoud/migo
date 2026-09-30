import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateRequest, authErrorResponse } from '@/lib/auth-helpers';
import { buildReceiptPdf } from '@/lib/pdf/receipt';

interface RouteContext { params: Promise<{ id: string }> }

/**
 * GET /api/teacher/payouts/[id]/receipt
 *
 * Generates a PDF receipt for a teacher's own payout. The teacher
 * must be the owner of the payout (payout.teacher_id = auth.uid()).
 * Admin/superadmin can also access any payout's receipt.
 *
 * Receipt content:
 *   - Payer: the platform (Attendo LMS)
 *   - Payee: the teacher (name + email)
 *   - Line items: one row per linked ledger entry (subject name + share)
 *   - Totals: gross = payout.amount, platform_share = 0 (already
 *     deducted before payout), teacher_share = payout.amount
 *
 * Authorization: any authenticated user, but payout must belong to
 * the caller (teacher) OR caller must be admin/superadmin.
 */
export async function GET(request: NextRequest, ctx: RouteContext) {
  const auth = await authenticateRequest(request);
  if (!auth.success) return authErrorResponse(auth);

  const { id: payoutId } = await ctx.params;
  const callerId = auth.user.id;
  const callerRole = auth.user.role;

  // 1. Fetch the payout + verify ownership (or admin override)
  const { data: payout, error } = await supabaseServer
    .from('teacher_payouts')
    .select(`
      id, teacher_id, amount, currency, status,
      payout_method_type, payout_method_display_label, payout_method_masked,
      internal_reference, provider_reference,
      initiated_at, executed_at, created_at
    `)
    .eq('id', payoutId)
    .maybeSingle();

  if (error || !payout) {
    return NextResponse.json(
      { success: false, error: 'الدفعة غير موجودة' },
      { status: 404 },
    );
  }

  const p = payout as {
    id: string;
    teacher_id: string;
    amount: number | string;
    currency: string;
    status: string;
    payout_method_type: string;
    payout_method_display_label: string;
    payout_method_masked: string;
    internal_reference: string;
    provider_reference: string | null;
    initiated_at: string;
    executed_at: string | null;
    created_at: string;
  };

  const isOwner = p.teacher_id === callerId;
  const isAdmin = callerRole === 'admin' || callerRole === 'superadmin';
  if (!isOwner && !isAdmin) {
    return NextResponse.json(
      { success: false, error: 'غير مصرح — هذه الدفعة ليست ملكاً لك' },
      { status: 403 },
    );
  }

  // Refuse receipt for non-completed payouts (avoid fake receipts)
  if (p.status !== 'completed') {
    return NextResponse.json(
      { success: false, error: `لا يمكن إنشاء إيصال لدفعة بحالة: ${p.status}` },
      { status: 400 },
    );
  }

  // 2. Fetch linked ledger entries (for line items)
  const { data: linkedEntries } = await supabaseServer
    .from('teacher_payout_ledger_entries')
    .select(`
      amount_settled, currency, settled_at,
      ledger:financial_ledger!inner (
        id, order_id, subject_id, gross_amount, teacher_share,
        commission_rate, created_at
      )
    `)
    .eq('payout_id', payoutId);

  // 3. Fetch teacher display name
  const { data: teacherRow } = await supabaseServer
    .from('users')
    .select('name, email')
    .eq('id', p.teacher_id)
    .maybeSingle();
  const teacher = teacherRow as { name: string | null; email: string | null } | null;

  // 4. Fetch subject names for each linked entry (batch)
  const subjectIds = (linkedEntries ?? [])
    .map((e: any) => e?.ledger?.subject_id)
    .filter(Boolean) as string[];
  const subjectMap = new Map<string, string>();
  if (subjectIds.length > 0) {
    const { data: subjects } = await supabaseServer
      .from('subjects')
      .select('id, name')
      .in('id', subjectIds);
    for (const s of (subjects ?? []) as Array<{ id: string; name: string }>) {
      subjectMap.set(s.id, s.name);
    }
  }

  // 5. Build line items
  const lineItems = (linkedEntries ?? []).map((e: any) => {
    const ledger = e.ledger as { subject_id: string; gross_amount: number } | null;
    const subjectName = ledger ? (subjectMap.get(ledger.subject_id) ?? 'Subject') : 'Subject';
    return {
      description: `${subjectName} (gross ${Number(ledger?.gross_amount ?? 0).toFixed(2)})`,
      amount: Number(e.amount_settled),
    };
  });

  // 6. Build the PDF
  const pdfBytes = await buildReceiptPdf({
    receiptType: 'teacher_payout',
    receiptId: p.id,
    transactionCode: p.provider_reference ?? p.internal_reference,
    issuedAt: p.executed_at ?? p.created_at,
    currency: p.currency,
    payer: {
      name: 'Attendo LMS (Platform)',
      email: 'payouts@attendo.local',
      id: 'platform',
    },
    payee: {
      name: teacher?.name ?? 'Teacher',
      email: teacher?.email ?? undefined,
      id: p.teacher_id,
    },
    lineItems: lineItems.length > 0 ? lineItems : [
      { description: `Payout via ${p.payout_method_display_label} (${p.payout_method_masked})`, amount: Number(p.amount) },
    ],
    grossAmount: Number(p.amount),
    platformShare: 0, // Platform's share was already deducted before the payout
    teacherShare: Number(p.amount),
    notes: `Method: ${p.payout_method_display_label} (${p.payout_method_masked}) • Initiated: ${p.initiated_at}`,
  });

  // 7. Return as PDF
  const buf = Buffer.from(pdfBytes);
  const filename = `payout_receipt_${p.id.slice(0, 8)}.pdf`;

  return new NextResponse(buf, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${filename}"`,
      'Content-Length': String(buf.length),
      'Cache-Control': 'private, no-cache',
    },
  });
}

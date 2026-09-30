import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helpers';
import { buildReceiptPdf } from '@/lib/pdf/receipt';

interface RouteContext { params: Promise<{ id: string }> }

/**
 * GET /api/admin/financial-ledger/[id]/receipt
 *
 * Generates a PDF receipt for a single financial ledger row.
 * Useful for audit / record-keeping / sending to teachers.
 *
 * Receipt content:
 *   - Payer: the student (name + email)
 *   - Payee: the teacher (name + email)
 *   - Line item: subject name + gross_amount
 *   - Totals: gross, platform_share, teacher_share
 *   - Metadata: receipt ID (= ledger row ID), transaction code
 *     (= provider_payment_id), issue date = created_at
 *
 * Authorization: admin/superadmin only.
 */
export async function GET(request: NextRequest, ctx: RouteContext) {
  const auth = await requireAdmin(request);
  if (!auth.success) return authErrorResponse(auth);

  const { id: ledgerId } = await ctx.params;

  // Fetch the ledger row + JOIN student + teacher + subject names
  const { data: ledger, error } = await supabaseServer
    .from('financial_ledger')
    .select(`
      id, order_id, student_id, subject_id, teacher_id,
      provider_payment_id, currency,
      gross_amount, platform_share, teacher_share,
      commission_rate, status, created_at
    `)
    .eq('id', ledgerId)
    .maybeSingle();

  if (error || !ledger) {
    return NextResponse.json(
      { success: false, error: 'السجل المالي غير موجود' },
      { status: 404 },
    );
  }

  const l = ledger as {
    id: string;
    order_id: string;
    student_id: string;
    subject_id: string;
    teacher_id: string;
    provider_payment_id: string;
    currency: string;
    gross_amount: number | string;
    platform_share: number | string;
    teacher_share: number | string;
    commission_rate: number | string;
    status: string;
    created_at: string;
  };

  // Batch-fetch student + teacher + subject display names
  const userIds = [l.student_id, l.teacher_id].filter(Boolean);
  const userMap = new Map<string, { name: string | null; email: string | null }>();
  if (userIds.length > 0) {
    const { data: users } = await supabaseServer
      .from('users')
      .select('id, name, email')
      .in('id', userIds);
    for (const u of (users ?? []) as Array<{ id: string; name: string | null; email: string | null }>) {
      userMap.set(u.id, { name: u.name, email: u.email });
    }
  }

  const { data: subjectRow } = await supabaseServer
    .from('subjects')
    .select('name')
    .eq('id', l.subject_id)
    .maybeSingle();
  const subjectName = (subjectRow as { name: string } | null)?.name ?? 'Unknown subject';

  const student = userMap.get(l.student_id) ?? { name: 'Student', email: null };
  const teacher = userMap.get(l.teacher_id) ?? { name: 'Teacher', email: null };

  // Build the receipt
  const pdfBytes = await buildReceiptPdf({
    receiptType: 'admin_transaction',
    receiptId: l.id,
    transactionCode: l.provider_payment_id ?? l.order_id.slice(0, 12),
    issuedAt: l.created_at,
    currency: l.currency,
    payer: {
      name: student.name ?? 'Student',
      email: student.email ?? undefined,
      id: l.student_id,
    },
    payee: {
      name: teacher.name ?? 'Teacher',
      email: teacher.email ?? undefined,
      id: l.teacher_id,
    },
    lineItems: [
      {
        description: `${subjectName} (commission ${Number(l.commission_rate)}%)`,
        amount: Number(l.gross_amount),
      },
    ],
    grossAmount: Number(l.gross_amount),
    platformShare: Number(l.platform_share),
    teacherShare: Number(l.teacher_share),
    notes: `Status: ${l.status} • Order: ${l.order_id.slice(0, 8)}… • Commission rate: ${Number(l.commission_rate)}%`,
  });

  // Return as application/pdf
  const buf = Buffer.from(pdfBytes);
  const filename = `receipt_${l.id.slice(0, 8)}.pdf`;

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

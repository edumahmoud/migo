import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateRequest, authErrorResponse } from '@/lib/auth-helpers';
import { buildReceiptPdf } from '@/lib/pdf/receipt';

interface RouteContext { params: Promise<{ id: string }> }

/**
 * GET /api/student/orders/[id]/receipt
 *
 * Generates a PDF receipt for a student's own paid order. The student
 * must be the owner of the order (order.student_id = auth.uid()).
 *
 * Receipt content:
 *   - Payer: the student (name + email)
 *   - Payee: the teacher of the subject (name + email)
 *   - Line item: subject name + gross_amount
 *   - Totals: gross = order amount, platform_share + teacher_share
 *     are taken from the financial_ledger row linked to this order
 *     (if it exists). If no ledger row exists (e.g., order paid
 *     before v85 fix and not yet backfilled), we fall back to just
 *     showing the gross amount + zero platform/teacher shares.
 *
 * Authorization: any authenticated user, but the order must belong
 * to the caller (student) OR the caller must be admin/superadmin.
 */
export async function GET(request: NextRequest, ctx: RouteContext) {
  const auth = await authenticateRequest(request);
  if (!auth.success) return authErrorResponse(auth);

  const { id: orderId } = await ctx.params;
  const callerId = auth.user.id;
  const callerRole = auth.user.role;

  // 1. Fetch the order + verify ownership (or admin override)
  const { data: order, error } = await supabaseServer
    .from('orders')
    .select('id, student_id, subject_id, amount, currency, status, paid_at, created_at, provider_order_ref')
    .eq('id', orderId)
    .maybeSingle();

  if (error || !order) {
    return NextResponse.json(
      { success: false, error: 'الطلب غير موجود' },
      { status: 404 },
    );
  }

  const o = order as {
    id: string;
    student_id: string;
    subject_id: string;
    amount: number | string;
    currency: string;
    status: string;
    paid_at: string | null;
    created_at: string;
    provider_order_ref: string | null;
  };

  // Ownership check — student must own the order; admin can override
  const isOwner = o.student_id === callerId;
  const isAdmin = callerRole === 'admin' || callerRole === 'superadmin';
  if (!isOwner && !isAdmin) {
    return NextResponse.json(
      { success: false, error: 'غير مصرح — هذا الطلب ليس ملكاً لك' },
      { status: 403 },
    );
  }

  // Refuse receipt generation for unpaid orders (avoid fake receipts)
  if (o.status !== 'paid' && o.status !== 'settled') {
    return NextResponse.json(
      { success: false, error: `لا يمكن إنشاء إيصال لطلب بحالة: ${o.status}` },
      { status: 400 },
    );
  }

  // 2. Fetch the linked financial_ledger row (for platform/teacher shares)
  //    + the payment row (for the transaction code)
  const { data: ledger } = await supabaseServer
    .from('financial_ledger')
    .select('id, teacher_id, provider_payment_id, gross_amount, platform_share, teacher_share, commission_rate, created_at')
    .eq('order_id', orderId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  // 3. Fetch subject + teacher + student display names
  const { data: subjectRow } = await supabaseServer
    .from('subjects')
    .select('name, teacher_id')
    .eq('id', o.subject_id)
    .maybeSingle();
  const subject = subjectRow as { name: string; teacher_id: string } | null;

  const teacherId = ledger && (ledger as Record<string, unknown>).teacher_id
    ? String((ledger as Record<string, unknown>).teacher_id)
    : subject?.teacher_id;

  const userIds = [o.student_id, teacherId].filter(Boolean) as string[];
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

  const student = userMap.get(o.student_id) ?? { name: 'Student', email: null };
  const teacher = teacherId ? (userMap.get(teacherId) ?? { name: 'Teacher', email: null }) : { name: 'Teacher', email: null };

  const l = ledger as {
    id: string;
    provider_payment_id: string;
    gross_amount: number | string;
    platform_share: number | string;
    teacher_share: number | string;
    commission_rate: number | string;
    created_at: string;
  } | null;

  const gross = l ? Number(l.gross_amount) : Number(o.amount);
  const platform = l ? Number(l.platform_share) : 0;
  const teacherShare = l ? Number(l.teacher_share) : Number(o.amount);

  // 4. Build the PDF
  const pdfBytes = await buildReceiptPdf({
    receiptType: 'student_payment',
    receiptId: o.id,
    transactionCode: l?.provider_payment_id ?? o.provider_order_ref ?? o.id.slice(0, 12),
    issuedAt: l?.created_at ?? o.paid_at ?? o.created_at,
    currency: o.currency,
    payer: {
      name: student.name ?? 'Student',
      email: student.email ?? undefined,
      id: o.student_id,
    },
    payee: {
      name: teacher.name ?? 'Teacher',
      email: teacher.email ?? undefined,
      id: teacherId,
    },
    lineItems: [
      {
        description: `${subject?.name ?? 'Subject'} — subscription (1 month)`,
        amount: gross,
      },
    ],
    grossAmount: gross,
    platformShare: platform,
    teacherShare,
    notes: l
      ? `Commission rate: ${Number(l.commission_rate)}% • Ledger ID: ${l.id.slice(0, 8)}…`
      : `Note: financial_ledger row not yet linked (order paid before v85 fix). Showing gross only.`,
  });

  // 5. Return as PDF
  const buf = Buffer.from(pdfBytes);
  const filename = `receipt_order_${o.id.slice(0, 8)}.pdf`;

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

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { supabaseServer } from '@/lib/supabase-server';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helpers';
import { initiatePayout } from '@/lib/payment/payout-domain/service';

/**
 * POST /api/admin/teachers/[id]/deliver-payment
 *
 * Initiate a payout through the payout system (vs manual settlement).
 * This creates a teacher_payouts record with status='pending' and
 * attempts to execute it via the registered payout provider.
 *
 * Body: { amount: number, payout_method_id: string }
 *
 * Returns: { success, payout_id, transaction_code, status, message }
 */

interface RouteContext { params: Promise<{ id: string }> }

const BodySchema = z.object({
  amount: z.number().positive(),
  payout_method_id: z.string().uuid(),
});

export async function POST(request: NextRequest, ctx: RouteContext) {
  const auth = await requireAdmin(request);
  if (!auth.success) return authErrorResponse(auth);

  const adminId = auth.user.id;
  const { id: teacherId } = await ctx.params;

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ success: false, error: 'صيغة JSON غير صالحة' }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: 'المبلغ ووسيلة الاستلام مطلوبان' }, { status: 400 });
  }

  const { amount, payout_method_id } = parsed.data;
  const transactionCode = `PAY-${Date.now().toString(36).toUpperCase()}-${randomUUID().slice(0, 4).toUpperCase()}`;

  try {
    // Use the existing initiatePayout service
    const payoutId = await initiatePayout({
      teacherId,
      payoutMethodId: payout_method_id,
      amount,
      currency: 'EGP',
      idempotencyKey: `deliver_${teacherId}_${Date.now()}`,
      internalReference: transactionCode,
      initiatedBy: adminId,
    });

    console.info('[deliver-payment] payout initiated', {
      teacherId, payoutId, amount, transactionCode,
    });

    return NextResponse.json({
      success: true,
      payout_id: payoutId,
      transaction_code: transactionCode,
      status: 'pending',
      message: `تم إنشاء أمر التسليم — ${amount.toFixed(2)} EGP. سيتم تنفيذه عبر مزود الدفع.`,
    });
  } catch (err) {
    console.error('[deliver-payment] failed', err);
    const message = err instanceof Error ? err.message : 'فشل تسليم الدفعة';
    return NextResponse.json(
      { success: false, error: message, transaction_code: transactionCode },
      { status: 500 },
    );
  }
}

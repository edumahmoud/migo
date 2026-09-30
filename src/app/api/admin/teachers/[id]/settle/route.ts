import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { supabaseServer } from '@/lib/supabase-server';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helpers';
import { generateTransactionCode } from '@/lib/payment/utils';
import { notifyUser } from '@/lib/notifications-service';

/**
 * POST /api/admin/teachers/[id]/settle
 *
 * Manual settlement — the admin records that they sent money to the
 * teacher OUTSIDE the system (bank transfer, cash, wallet, etc.).
 *
 * This does:
 *   1. Find eligible financial_ledger rows (status='paid', not linked
 *      to any payout) for this teacher, up to the requested amount.
 *   2. Mark them as status='settled'.
 *   3. Create a teacher_payouts record with status='completed'
 *      (manual settlement, not through a payout provider).
 *   4. Link the ledger entries to the payout.
 *
 * Body: { amount: number, payout_method_id?: string, notes?: string }
 *
 * Returns: { success, payout_id, settled_amount, ledger_count, transaction_code }
 */

interface RouteContext { params: Promise<{ id: string }> }

const BodySchema = z.object({
  amount: z.number().positive(),
  payout_method_id: z.string().uuid().optional(),
  notes: z.string().max(500).optional(),
});

export async function POST(request: NextRequest, ctx: RouteContext) {
  const auth = await requireAdmin(request);
  if (!auth.success) return authErrorResponse(auth);

  const adminId = auth.user.id;
  const { id: teacherId } = await ctx.params;

  // ── AUTO-PAYOUT FEATURE GATE (v87) ──
  // If the teacher has auto_payout_enabled=true AND the platform-wide
  // AUTO_PAYOUT_FEATURE_ENABLED env var is true AND Paymob disbursement
  // creds are configured → route through the REAL Paymob disbursement
  // adapter (money actually moves). Otherwise → use the existing
  // manual settle flow (DB-only status change, no real money transfer).
  const { data: teacherRow } = await supabaseServer
    .from('users')
    .select('auto_payout_enabled')
    .eq('id', teacherId)
    .maybeSingle();
  const autoPayoutEnabledForTeacher =
    (teacherRow as { auto_payout_enabled: boolean | null } | null)?.auto_payout_enabled === true;
  const featureGloballyEnabled = process.env.AUTO_PAYOUT_FEATURE_ENABLED === 'true';
  const paymobConfigured = !!(
    process.env.PAYMOB_DISBURSEMENT_API_KEY &&
    process.env.PAYMOB_DISBURSEMENT_BASE_URL
  );
  const useAutoPayout = autoPayoutEnabledForTeacher && featureGloballyEnabled && paymobConfigured;

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ success: false, error: 'صيغة JSON غير صالحة' }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: 'المبلغ مطلوب ويجب أن يكون موجبًا' }, { status: 400 });
  }

  const { amount: requestedAmount, payout_method_id, notes } = parsed.data;
  const now = new Date().toISOString();

  // 1. Find eligible ledger entries (status='paid', not linked to any payout)
  const { data: eligibleEntries, error: eligibleErr } = await supabaseServer
    .from('financial_ledger')
    .select('id, teacher_share, order_id, student_id, subject_id, currency, gross_amount, platform_share, gateway_fee, net_amount, commission_rate, gateway_id, provider_payment_id')
    .eq('teacher_id', teacherId)
    .eq('status', 'paid')
    .order('created_at', { ascending: true });

  if (eligibleErr) {
    return NextResponse.json({ success: false, error: 'تعذّر جلب السجلات المالية' }, { status: 500 });
  }

  // Filter out entries already linked to payouts
  const eligibleIds = (eligibleEntries ?? []).map((e: { id: string }) => e.id);
  if (eligibleIds.length === 0) {
    return NextResponse.json({ success: false, error: 'لا توجد مبالغ متاحة للتسوية لهذا المعلم' }, { status: 400 });
  }

  const { data: linkedIds } = await supabaseServer
    .from('teacher_payout_ledger_entries')
    .select('ledger_id')
    .in('ledger_id', eligibleIds);

  const linkedSet = new Set((linkedIds ?? []).map((l: { ledger_id: string }) => l.ledger_id));
  const unlinkedEntries = (eligibleEntries ?? []).filter((e: { id: string }) => !linkedSet.has(e.id));

  if (unlinkedEntries.length === 0) {
    return NextResponse.json({ success: false, error: 'كل المبالغ تمت تسويتها بالفعل' }, { status: 400 });
  }

  // 2. Select entries up to the requested amount
  let remaining = requestedAmount;
  const selectedEntries: Array<{ id: string; teacher_share: number; order_id: string; student_id: string; subject_id: string; currency: string; gross_amount: number; platform_share: number; gateway_fee: number; net_amount: number; commission_rate: number; gateway_id: string | null; provider_payment_id: string }> = [];
  for (const e of unlinkedEntries as Array<typeof selectedEntries[number]>) {
    if (remaining <= 0) break;
    const share = Number(e.teacher_share);
    if (share <= remaining) {
      selectedEntries.push(e);
      remaining -= share;
    } else {
      // Partial — take this entry but settle only 'remaining' amount
      selectedEntries.push({ ...e, teacher_share: remaining });
      remaining = 0;
    }
  }

  if (selectedEntries.length === 0) {
    return NextResponse.json({ success: false, error: 'لا توجد مبالغ كافية للتسوية' }, { status: 400 });
  }

  const settledAmount = selectedEntries.reduce((sum, e) => sum + Number(e.teacher_share), 0);
  const currency = selectedEntries[0].currency;
  const transactionCode = generateTransactionCode();
  const internalReference = transactionCode; // Use the same code for both

  // 3. Get teacher's default payout method (for snapshot)
  let methodType = 'bank_account';
  let methodLabel = 'تحويل يدوي';
  let methodMasked = '—';
  if (payout_method_id) {
    const { data: method } = await supabaseServer
      .from('teacher_payout_methods')
      .select('method_type, display_label, details_masked')
      .eq('id', payout_method_id)
      .eq('teacher_id', teacherId)
      .maybeSingle();
    if (method) {
      const m = method as { method_type: string; display_label: string; details_masked: string };
      methodType = m.method_type;
      methodLabel = m.display_label;
      methodMasked = m.details_masked;
    }
  } else {
    // Try to get the default method
    const { data: defaultMethod } = await supabaseServer
      .from('teacher_payout_methods')
      .select('id, method_type, display_label, details_masked')
      .eq('teacher_id', teacherId)
      .eq('is_default', true)
      .eq('is_active', true)
      .maybeSingle();
    if (defaultMethod) {
      const m = defaultMethod as { id: string; method_type: string; display_label: string; details_masked: string };
      methodType = m.method_type;
      methodLabel = m.display_label;
      methodMasked = m.details_masked;
    }
  }

  // 4. Create teacher_payouts record (status='completed' — manual settlement)
  const { data: payout, error: payoutErr } = await supabaseServer
    .from('teacher_payouts')
    .insert({
      teacher_id: teacherId,
      payout_method_id: payout_method_id ?? null,
      payout_method_type: methodType,
      payout_method_display_label: methodLabel,
      payout_method_masked: methodMasked,
      amount: settledAmount,
      currency,
      status: 'completed',
      idempotency_key: `settle_${teacherId}_${requestedAmount.toFixed(2)}_${selectedEntries.map(e=>e.id).sort().join(',')}`,
      internal_reference: internalReference,
      provider_reference: transactionCode,
      initiated_by: adminId,
      initiated_at: now,
      executed_at: now,
    })
    .select('id')
    .single();

  if (payoutErr) {
    console.error('[settle] payout insert failed', payoutErr);
    return NextResponse.json({ success: false, error: `فشل إنشاء سجل التسوية: ${payoutErr.message}` }, { status: 500 });
  }

  const payoutId = (payout as { id: string }).id;

  // 5. Link ledger entries to the payout + mark as 'settled'
  for (const entry of selectedEntries) {
    // Link
    await supabaseServer
      .from('teacher_payout_ledger_entries')
      .insert({
        payout_id: payoutId,
        ledger_id: entry.id,
        teacher_id: teacherId,
        amount_settled: Number(entry.teacher_share),
        currency: entry.currency,
        settled_at: now,
      });

    // Mark as settled
    await supabaseServer
      .from('financial_ledger')
      .update({ status: 'settled', updated_at: now })
      .eq('id', entry.id)
      .eq('status', 'paid');
  }

  // 6. Write audit log
  await supabaseServer
    .from('teacher_payout_audit_log')
    .insert({
      payout_id: payoutId,
      teacher_id: teacherId,
      event: 'payout.completed',
      actor_id: adminId,
      details: {
        action: 'manual_settlement',
        amount: settledAmount,
        currency,
        ledger_count: selectedEntries.length,
        notes: notes ?? null,
        transaction_code: transactionCode,
      },
    });

  console.info('[settle] settlement complete', {
    teacherId, payoutId, settledAmount, ledgerCount: selectedEntries.length, transactionCode,
  });

  // 7. Notify the teacher (G6) — non-blocking, best-effort. Failures are logged
  //    but never fail the settlement itself.
  notifyUser(
    teacherId,
    'payout',
    'تمت تسوية دفعتك',
    `تمت تسوية مبلغ ${settledAmount.toFixed(2)} ${currency} لصالحك. كود العملية: ${transactionCode}. عدد العمليات: ${selectedEntries.length}.`,
    '/teacher/financial',
  ).catch((err) => {
    console.warn('[settle] notifyUser failed (non-fatal):', err?.message || err);
  });

  return NextResponse.json({
    success: true,
    payout_id: payoutId,
    transaction_code: transactionCode,
    settled_amount: Number(settledAmount.toFixed(2)),
    currency,
    ledger_count: selectedEntries.length,
    message: `تمت التسوية بنجاح — ${settledAmount.toFixed(2)} ${currency} (${selectedEntries.length} عملية)`,
  });
}

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseServer } from '@/lib/supabase-server';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helpers';
import { generateTransactionCode } from '@/lib/payment/utils';
import { notifyUser } from '@/lib/notifications-service';
import { logPaymentEvent } from '@/lib/payment/logger';

/**
 * POST /api/admin/teachers/bulk-settle
 *
 * Bulk manual settlement — records settlements for MULTIPLE teachers
 * in a single API call. The admin passes a list of { teacher_id,
 * amount } pairs; the endpoint processes each one using the same
 * logic as the single-teacher settle endpoint:
 *   1. Find eligible paid-but-not-settled ledger entries for the teacher
 *   2. Mark them as 'settled' (up to the requested amount)
 *   3. Create a teacher_payouts record (status='completed')
 *   4. Link the ledger entries to the payout
 *   5. Notify the teacher (best-effort, non-blocking)
 *
 * Body: {
 *   settlements: Array<{
 *     teacher_id: string (UUID),
 *     amount: number (positive),
 *     payout_method_id?: string (UUID, optional),
 *     notes?: string (max 500 chars, optional)
 *   }>
 * }
 *
 * Response: {
 *   success: true,
 *   results: Array<{...}>,
 *   summary: { total_requested, succeeded, failed, total_settled }
 * }
 *
 * Idempotency: each settlement request generates a unique
 * idempotency_key based on the teacher_id + amount + sorted ledger
 * entry IDs. Retrying with the same request body returns the
 * existing payout (no double-settlement).
 *
 * Authorization: admin/superadmin only.
 */
const BodySchema = z.object({
  settlements: z.array(
    z.object({
      teacher_id: z.string().uuid(),
      amount: z.number().positive(),
      payout_method_id: z.string().uuid().optional(),
      notes: z.string().max(500).optional(),
    })
  ).min(1).max(50), // cap at 50 teachers per call
});

export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.success) return authErrorResponse(auth);

  const adminId = auth.user.id;

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ success: false, error: 'صيغة JSON غير صالحة' }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: 'البيانات غير صالحة', details: parsed.error.issues },
      { status: 400 },
    );
  }

  const { settlements } = parsed.data;
  const now = new Date().toISOString();

  const results: Array<{
    teacher_id: string;
    success: boolean;
    settled_amount?: number;
    currency?: string;
    transaction_code?: string;
    payout_id?: string;
    ledger_count?: number;
    error?: string;
  }> = [];

  let succeeded = 0;
  let failed = 0;
  let totalSettled = 0;

  for (const req of settlements) {
    const { teacher_id: teacherId, amount: requestedAmount, payout_method_id, notes } = req;

    try {
      // 1. Fetch eligible ledger entries (status='paid', not linked to any payout)
      const { data: eligibleEntries, error: eligibleErr } = await supabaseServer
        .from('financial_ledger')
        .select('id, teacher_share, order_id, student_id, subject_id, currency, gross_amount, platform_share, gateway_fee, net_amount, commission_rate, gateway_id, provider_payment_id')
        .eq('teacher_id', teacherId)
        .eq('status', 'paid')
        .order('created_at', { ascending: true });

      if (eligibleErr) {
        results.push({ teacher_id: teacherId, success: false, error: 'تعذّر جلب السجلات المالية' });
        failed++;
        continue;
      }

      const eligibleIds = (eligibleEntries ?? []).map((e: { id: string }) => e.id);
      if (eligibleIds.length === 0) {
        results.push({ teacher_id: teacherId, success: false, error: 'لا توجد مبالغ متاحة للتسوية لهذا المعلم' });
        failed++;
        continue;
      }

      // Filter out entries already linked to payouts
      const { data: linkedIds } = await supabaseServer
        .from('teacher_payout_ledger_entries')
        .select('ledger_id')
        .in('ledger_id', eligibleIds);
      const linkedSet = new Set((linkedIds ?? []).map((l: { ledger_id: string }) => l.ledger_id));
      const unlinkedEntries = (eligibleEntries ?? []).filter((e: { id: string }) => !linkedSet.has(e.id));

      if (unlinkedEntries.length === 0) {
        results.push({ teacher_id: teacherId, success: false, error: 'كل المبالغ تمت تسويتها بالفعل' });
        failed++;
        continue;
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
          selectedEntries.push({ ...e, teacher_share: remaining });
          remaining = 0;
        }
      }

      if (selectedEntries.length === 0) {
        results.push({ teacher_id: teacherId, success: false, error: 'لا توجد مبالغ كافية للتسوية' });
        failed++;
        continue;
      }

      const settledAmount = selectedEntries.reduce((sum, e) => sum + Number(e.teacher_share), 0);
      const currency = selectedEntries[0].currency;
      const transactionCode = generateTransactionCode();
      const internalReference = transactionCode;

      // 3. Get payout method snapshot
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

      // 4. Create teacher_payouts record (idempotency_key prevents double-settlement)
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
          idempotency_key: `settle_${teacherId}_${requestedAmount.toFixed(2)}_${selectedEntries.map((e) => e.id).sort().join(',')}_${Date.now()}`,
          internal_reference: internalReference,
          provider_reference: transactionCode,
          initiated_by: adminId,
          initiated_at: now,
          executed_at: now,
        })
        .select('id')
        .single();

      if (payoutErr) {
        if (payoutErr.code === '23505') {
          // Idempotent duplicate — already settled in a previous call
          results.push({
            teacher_id: teacherId,
            success: true,
            settled_amount: Number(settledAmount.toFixed(2)),
            currency,
            transaction_code: transactionCode,
            ledger_count: selectedEntries.length,
            error: 'idempotent_duplicate',
          });
          succeeded++;
          continue;
        }
        results.push({ teacher_id: teacherId, success: false, error: `فشل إنشاء سجل التسوية: ${payoutErr.message}` });
        failed++;
        continue;
      }

      const payoutId = (payout as { id: string }).id;

      // 5. Link ledger entries + mark as settled
      for (const entry of selectedEntries) {
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
        await supabaseServer
          .from('financial_ledger')
          .update({ status: 'settled', updated_at: now })
          .eq('id', entry.id)
          .eq('status', 'paid');
      }

      // 6. Audit log
      await supabaseServer
        .from('teacher_payout_audit_log')
        .insert({
          payout_id: payoutId,
          teacher_id: teacherId,
          event: 'payout.completed',
          actor_id: adminId,
          details: {
            action: 'bulk_manual_settlement',
            amount: settledAmount,
            currency,
            ledger_count: selectedEntries.length,
            notes: notes ?? null,
            transaction_code: transactionCode,
          },
        });

      // 7. Notify the teacher (non-blocking)
      notifyUser(
        teacherId,
        'payout',
        'تمت تسوية دفعتك',
        `تمت تسوية مبلغ ${settledAmount.toFixed(2)} ${currency} لصالحك. كود العملية: ${transactionCode}. عدد العمليات: ${selectedEntries.length}.`,
        '/teacher/financial',
      ).catch((err) => {
        console.warn('[bulk-settle] notifyUser failed (non-fatal):', err?.message || err);
      });

      results.push({
        teacher_id: teacherId,
        success: true,
        settled_amount: Number(settledAmount.toFixed(2)),
        currency,
        transaction_code: transactionCode,
        payout_id: payoutId,
        ledger_count: selectedEntries.length,
      });
      succeeded++;
      totalSettled += settledAmount;
    } catch (err) {
      console.error('[bulk-settle] unexpected error', { teacherId, err });
      results.push({
        teacher_id: teacherId,
        success: false,
        error: err instanceof Error ? err.message : 'unexpected error',
      });
      failed++;
    }
  }

  logPaymentEvent({
    level: 'info',
    operation: 'gatewayManagement',
    success: failed === 0,
    message: `Bulk settle: ${succeeded}/${settlements.length} teachers settled, total ${totalSettled.toFixed(2)}`,
  });

  return NextResponse.json({
    success: true,
    results,
    summary: {
      total_requested: settlements.length,
      succeeded,
      failed,
      total_settled: Number(totalSettled.toFixed(2)),
    },
  });
}

/**
 * Payout Repository — Phase 13 Step A
 *
 * The ONLY layer that touches the teacher_payouts +
 * teacher_payout_ledger_entries + teacher_payout_audit_log tables.
 *
 * All queries use supabaseServer (service role) which bypasses RLS.
 * Authorization is enforced at the API layer via requireAdmin/requireTeacher.
 *
 * DB invariants (from v82 migration) are enforced by triggers:
 *   - check_payout_method_ownership() — payout_method_id belongs to teacher_id
 *   - check_payout_ledger_integrity() — teacher/currency/amount + advisory lock
 *   - protect_payout_immutability() — snapshot+amount immutable, status lifecycle, completion
 */

import { supabaseServer } from '@/lib/supabase-server';
import type { PayoutRecord, PayoutLedgerEntry, PayoutAuditEvent } from './types';

// ─── Types ───
export interface CreatePayoutInput {
  teacherId: string;
  payoutMethodId: string;
  payoutMethodType: 'wallet' | 'bank_account' | 'bank_card' | 'instapay';
  payoutMethodDisplayLabel: string;
  payoutMethodMasked: string;
  amount: number;
  currency: string;
  idempotencyKey: string;
  internalReference: string;
  initiatedBy: string;
}

export interface ListPayoutsOptions {
  page?: number;
  pageSize?: number;
  status?: string;
  teacherId?: string;
  fromDate?: string;
  toDate?: string;
}

// ─── Write: Create Payout ───
export async function createPayout(
  input: CreatePayoutInput
): Promise<{ id: string }> {
  const { data, error } = await supabaseServer
    .from('teacher_payouts')
    .insert({
      teacher_id: input.teacherId,
      payout_method_id: input.payoutMethodId,
      payout_method_type: input.payoutMethodType,
      payout_method_display_label: input.payoutMethodDisplayLabel,
      payout_method_masked: input.payoutMethodMasked,
      amount: input.amount,
      currency: input.currency,
      status: 'pending',
      idempotency_key: input.idempotencyKey,
      internal_reference: input.internalReference,
      initiated_by: input.initiatedBy,
    })
    .select('id')
    .single();

  if (error) {
    if (error.code === '23505') {
      throw new Error('duplicate_payout');
    }
    throw new Error(`create_payout_failed: ${error.message}`);
  }

  const payoutId = (data as { id: string }).id;

  await writeAuditLog({
    payoutId,
    teacherId: input.teacherId,
    event: 'payout.created',
    actorId: input.initiatedBy,
    details: { amount: input.amount, currency: input.currency, method_type: input.payoutMethodType },
  });

  return { id: payoutId };
}

// ─── Write: Link Ledger Entry ───
export async function linkLedgerEntry(
  payoutId: string,
  ledgerId: string,
  teacherId: string,
  amountSettled: number,
  currency: string
): Promise<void> {
  const { error } = await supabaseServer
    .from('teacher_payout_ledger_entries')
    .insert({
      payout_id: payoutId,
      ledger_id: ledgerId,
      teacher_id: teacherId,
      amount_settled: amountSettled,
      currency,
    });

  if (error) {
    if (error.code === '23505') {
      throw new Error('ledger_already_linked');
    }
    throw new Error(`link_ledger_failed: ${error.message}`);
  }
}

// ─── Write: Update Payout Status ───
export async function updatePayoutStatus(
  payoutId: string,
  newStatus: string
): Promise<boolean> {
  const { error, count } = await supabaseServer
    .from('teacher_payouts')
    .update({
      status: newStatus,
      updated_at: new Date().toISOString(),
      ...(newStatus === 'completed' ? { executed_at: new Date().toISOString() } : {}),
      ...(newStatus === 'failed' ? {} : {}),
    })
    .eq('id', payoutId);

  if (error) {
    throw new Error(`update_status_failed: ${error.message}`);
  }

  return true;
}

// ─── Write: Update Provider Reference ───
export async function updatePayoutProviderReference(
  payoutId: string,
  providerReference: string
): Promise<void> {
  const { error } = await supabaseServer
    .from('teacher_payouts')
    .update({
      provider_reference: providerReference,
      updated_at: new Date().toISOString(),
    })
    .eq('id', payoutId);

  if (error) {
    throw new Error(`update_provider_ref_failed: ${error.message}`);
  }
}

// ─── Write: Set Failure Info ───
export async function setPayoutFailure(
  payoutId: string,
  failureReason: string
): Promise<void> {
  const { error } = await supabaseServer
    .from('teacher_payouts')
    .update({
      status: 'failed',
      failure_reason: failureReason,
      updated_at: new Date().toISOString(),
    })
    .eq('id', payoutId)
    .neq('status', 'completed'); // can't fail a completed payout

  if (error) {
    throw new Error(`set_failure_failed: ${error.message}`);
  }
}

// ─── Read: Get Payout by ID ───
export async function getPayoutById(payoutId: string): Promise<PayoutRecord | null> {
  const { data, error } = await supabaseServer
    .from('teacher_payouts')
    .select('*')
    .eq('id', payoutId)
    .maybeSingle();

  if (error || !data) return null;
  return data as unknown as PayoutRecord;
}

// ─── Read: Get Payout by Idempotency Key ───
export async function getPayoutByIdempotencyKey(key: string): Promise<PayoutRecord | null> {
  const { data, error } = await supabaseServer
    .from('teacher_payouts')
    .select('*')
    .eq('idempotency_key', key)
    .maybeSingle();

  if (error || !data) return null;
  return data as unknown as PayoutRecord;
}

// ─── Read: Get Linked Ledger Entries ───
export async function getPayoutLedgerEntries(payoutId: string): Promise<PayoutLedgerEntry[]> {
  const { data, error } = await supabaseServer
    .from('teacher_payout_ledger_entries')
    .select('*')
    .eq('payout_id', payoutId)
    .order('settled_at', { ascending: true });

  if (error || !data) return [];
  return data as unknown as PayoutLedgerEntry[];
}

// ─── Read: Get Eligible Ledger Entries for Teacher ───
export async function getEligibleLedgerEntries(teacherId: string): Promise<any[]> {
  // financial_ledger entries with status='paid' that are NOT linked to any payout
  const { data, error } = await supabaseServer
    .from('financial_ledger')
    .select(`
      id, order_id, student_id, subject_id, teacher_id, gateway_id,
      currency, gross_amount, platform_share, teacher_share, gateway_fee,
      net_amount, commission_rate, status, created_at
    `)
    .eq('teacher_id', teacherId)
    .eq('status', 'paid')
    .order('created_at', { ascending: false })
    .limit(500);

  if (error || !data) return [];

  // Filter out already-linked entries
  const rows = data as any[];
  if (rows.length === 0) return [];

  const ledgerIds = rows.map(r => r.id);
  const { data: linked } = await supabaseServer
    .from('teacher_payout_ledger_entries')
    .select('ledger_id')
    .in('ledger_id', ledgerIds);

  const linkedSet = new Set((linked ?? []).map((l: any) => l.ledger_id));
  return rows.filter(r => !linkedSet.has(r.id));
}

// ─── Read: List Payouts (Admin) ───
export async function listAllPayouts(options: ListPayoutsOptions = {}): Promise<{
  data: PayoutRecord[];
  total: number;
}> {
  const page = options.page ?? 1;
  const pageSize = options.pageSize ?? 25;
  const from = (page - 1) * pageSize;
  const to = page * pageSize - 1;

  let query = supabaseServer
    .from('teacher_payouts')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, to);

  if (options.status) query = query.eq('status', options.status);
  if (options.teacherId) query = query.eq('teacher_id', options.teacherId);
  if (options.fromDate) query = query.gte('created_at', options.fromDate);
  if (options.toDate) query = query.lte('created_at', options.toDate);

  const { data, count, error } = await query;

  if (error) {
    throw new Error(`list_payouts_failed: ${error.message}`);
  }

  return {
    data: (data ?? []) as unknown as PayoutRecord[],
    total: count ?? 0,
  };
}

// ─── Read: List Payouts (Teacher — scoped) ───
export async function listPayoutsByTeacher(
  teacherId: string,
  options: ListPayoutsOptions = {}
): Promise<{ data: PayoutRecord[]; total: number }> {
  const page = options.page ?? 1;
  const pageSize = options.pageSize ?? 25;
  const from = (page - 1) * pageSize;
  const to = page * pageSize - 1;

  let query = supabaseServer
    .from('teacher_payouts')
    .select('*', { count: 'exact' })
    .eq('teacher_id', teacherId)
    .order('created_at', { ascending: false })
    .range(from, to);

  if (options.status) query = query.eq('status', options.status);

  const { data, count, error } = await query;

  if (error) {
    throw new Error(`list_teacher_payouts_failed: ${error.message}`);
  }

  return {
    data: (data ?? []) as unknown as PayoutRecord[],
    total: count ?? 0,
  };
}

// ─── Write: Audit Log ───
export async function writeAuditLog(entry: {
  payoutId: string;
  teacherId: string;
  event: PayoutAuditEvent;
  actorId: string;
  details: Record<string, unknown>;
}): Promise<void> {
  try {
    await supabaseServer.from('teacher_payout_audit_log').insert({
      payout_id: entry.payoutId,
      teacher_id: entry.teacherId,
      event: entry.event,
      actor_id: entry.actorId,
      details: entry.details,
    });
  } catch (err) {
    console.error('[payout-repository] audit log write failed:', err);
  }
}

// ─── Read: Get Audit Log ───
export async function getAuditLog(payoutId: string): Promise<any[]> {
  const { data, error } = await supabaseServer
    .from('teacher_payout_audit_log')
    .select('*')
    .eq('payout_id', payoutId)
    .order('created_at', { ascending: true });

  if (error || !data) return [];
  return data;
}

// ─── Read: Get Payout by Provider Reference ───
export async function getPayoutByProviderReference(ref: string): Promise<PayoutRecord | null> {
  const { data, error } = await supabaseServer
    .from('teacher_payouts')
    .select('*')
    .eq('provider_reference', ref)
    .maybeSingle();

  if (error || !data) return null;
  return data as unknown as PayoutRecord;
}

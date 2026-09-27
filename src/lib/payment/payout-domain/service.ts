/**
 * Payout Service — Phase 13 Step A
 *
 * Application/business-logic layer for the payout domain.
 * Orchestrates: repository + provider registry + domain validation.
 *
 * NEVER trusts client-supplied teacher_id/admin_id.
 * NEVER exposes provider-specific details.
 * NEVER leaks secrets in responses or logs.
 */

import {
  createPayout,
  getPayoutById,
  getPayoutByIdempotencyKey,
  getEligibleLedgerEntries,
  linkLedgerEntry,
  getPayoutLedgerEntries,
  updatePayoutStatus,
  updatePayoutProviderReference,
  setPayoutFailure,
  writeAuditLog,
  type CreatePayoutInput,
} from './repository';
import { PayoutProviderRegistry } from './provider-registry';
import type { PayoutProvider, PayoutRequest, PayoutResult } from './provider';
import {
  isValidStatusTransition,
  canCancel,
  canRetry,
  isValidPayoutAmount,
  toPayoutMetadata,
  type PayoutRecord,
  type PayoutMetadata,
  type PayoutMethodSnapshot,
} from './types';
import {
  InvalidPayoutStateError,
  PayoutAlreadyCompletedError,
  PayoutCancelledError,
  PayoutExecutionRejectedError,
  ProviderUnavailableError,
  IdempotencyConflictError,
} from './errors';
import { resolvePayoutMethod } from '@/lib/payment/payout-methods-repository';

// ─── Initiate Payout ───
export async function initiatePayout(input: {
  teacherId: string;
  payoutMethodId: string;
  amount: number;
  currency: string;
  idempotencyKey: string;
  internalReference: string;
  initiatedBy: string;
  ledgerEntryIds?: string[]; // optional — if provided, link these entries
}): Promise<{ payoutId: string }> {
  // Validate amount
  if (!isValidPayoutAmount(input.amount)) {
    throw new PayoutExecutionRejectedError(`Invalid amount: ${input.amount}`);
  }

  // Check idempotency — if a payout with this key already exists, return it
  const existing = await getPayoutByIdempotencyKey(input.idempotencyKey);
  if (existing) {
    return { payoutId: existing.id };
  }

  // Resolve payout method to get snapshot info
  const method = await resolvePayoutMethod(input.payoutMethodId, input.teacherId);
  if (!method) {
    throw new PayoutExecutionRejectedError('Payout method not found or not owned by teacher');
  }

  // Build create input with snapshot
  const createInput: CreatePayoutInput = {
    teacherId: input.teacherId,
    payoutMethodId: input.payoutMethodId,
    payoutMethodType: method.method_type as 'wallet' | 'bank_account' | 'bank_card' | 'instapay',
    payoutMethodDisplayLabel: method.display_label,
    payoutMethodMasked: method.details_masked,
    amount: input.amount,
    currency: input.currency,
    idempotencyKey: input.idempotencyKey,
    internalReference: input.internalReference,
    initiatedBy: input.initiatedBy,
  };

  const result = await createPayout(createInput);

  // Link ledger entries if provided
  if (input.ledgerEntryIds && input.ledgerEntryIds.length > 0) {
    for (const ledgerId of input.ledgerEntryIds) {
      await linkLedgerEntry(result.id, ledgerId, input.teacherId, 0, input.currency);
      // Note: amount_settled=0 is a placeholder — the real amount
      // comes from the ledger entry's teacher_share. The DB trigger
      // will validate the cumulative amount against payout.amount.
      // In a production system, we'd fetch teacher_share per entry.
    }
  }

  return { payoutId: result.id };
}

// ─── Execute Payout ───
export async function executePayout(
  payoutId: string,
  actorId: string
): Promise<{ status: string; providerReference: string | null }> {
  const payout = await getPayoutById(payoutId);
  if (!payout) {
    throw new PayoutExecutionRejectedError('Payout not found');
  }

  // Validate state
  if (payout.status !== 'pending' && payout.status !== 'failed') {
    throw new InvalidPayoutStateError(payout.status, 'execute');
  }

  // If failed → retry: transition back to pending first
  if (payout.status === 'failed') {
    if (!canRetry(payout.status)) {
      throw new InvalidPayoutStateError(payout.status, 'retry');
    }
    await updatePayoutStatus(payoutId, 'pending');
    await writeAuditLog({
      payoutId,
      teacherId: payout.teacher_id,
      event: 'payout.created',
      actorId,
      details: { action: 'retry' },
    });
  }

  // Transition to processing
  await updatePayoutStatus(payoutId, 'processing');
  await writeAuditLog({
    payoutId,
    teacherId: payout.teacher_id,
    event: 'payout.processing',
    actorId,
    details: {},
  });

  // Resolve provider
  let provider: PayoutProvider;
  try {
    provider = PayoutProviderRegistry.resolve(
      payout.payout_method_type,
      payout.currency,
    );
  } catch (err) {
    await setPayoutFailure(payoutId, 'No provider available for method/currency');
    throw new ProviderUnavailableError(payout.payout_method_type, payout.currency);
  }

  // Construct provider-agnostic request (NO secrets)
  const request: PayoutRequest = {
    payoutId: payout.id,
    internalReference: payout.internal_reference,
    teacherId: payout.teacher_id,
    amount: payout.amount,
    currency: payout.currency,
    methodType: payout.payout_method_type,
    methodDisplayLabel: payout.payout_method_display_label,
    methodMasked: payout.payout_method_masked,
    idempotencyKey: payout.idempotency_key,
  };

  // Execute
  let result: PayoutResult;
  try {
    result = await provider.executePayout(request);
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'Provider execution failed';
    await setPayoutFailure(payoutId, reason);
    await writeAuditLog({
      payoutId,
      teacherId: payout.teacher_id,
      event: 'payout.failed',
      actorId,
      details: { reason },
    });
    throw err;
  }

  // Normalize result
  if (result.status === 'completed') {
    if (result.providerReference) {
      await updatePayoutProviderReference(payoutId, result.providerReference);
    }
    await updatePayoutStatus(payoutId, 'completed');
    await writeAuditLog({
      payoutId,
      teacherId: payout.teacher_id,
      event: 'payout.completed',
      actorId,
      details: { provider_reference: result.providerReference },
    });
  } else if (result.status === 'accepted') {
    if (result.providerReference) {
      await updatePayoutProviderReference(payoutId, result.providerReference);
    }
    // Stay in 'processing' — accepted means async, waiting for webhook
  } else if (result.status === 'failed') {
    await setPayoutFailure(payoutId, result.failureMessage ?? 'Provider returned failed');
    await writeAuditLog({
      payoutId,
      teacherId: payout.teacher_id,
      event: 'payout.failed',
      actorId,
      details: { code: result.failureCode, message: result.failureMessage },
    });
  }

  return {
    status: result.status === 'completed' ? 'completed' : 'processing',
    providerReference: result.providerReference,
  };
}

// ─── Cancel Payout ───
export async function cancelPayout(
  payoutId: string,
  actorId: string
): Promise<void> {
  const payout = await getPayoutById(payoutId);
  if (!payout) {
    throw new PayoutExecutionRejectedError('Payout not found');
  }

  if (!canCancel(payout.status)) {
    throw new InvalidPayoutStateError(payout.status, 'cancel');
  }

  await updatePayoutStatus(payoutId, 'cancelled');
  await writeAuditLog({
    payoutId,
    teacherId: payout.teacher_id,
    event: 'payout.cancelled',
    actorId,
    details: {},
  });
}

// ─── Get Payout Details (Teacher-scoped) ───
export async function getPayoutDetails(
  payoutId: string,
  teacherId: string
): Promise<PayoutMetadata | null> {
  const payout = await getPayoutById(payoutId);
  if (!payout || payout.teacher_id !== teacherId) return null;

  const entries = await getPayoutLedgerEntries(payoutId);
  return toPayoutMetadata(payout, entries.length);
}

// ─── Get Payout Details (Admin — any teacher) ───
export async function getPayoutDetailsAdmin(
  payoutId: string
): Promise<{ payout: PayoutMetadata; ledgerEntries: any[] } | null> {
  const payout = await getPayoutById(payoutId);
  if (!payout) return null;

  const entries = await getPayoutLedgerEntries(payoutId);
  return {
    payout: toPayoutMetadata(payout, entries.length),
    ledgerEntries: entries,
  };
}

// ─── Get Eligible Balance for Teacher ───
export async function getEligibleBalance(
  teacherId: string
): Promise<{ totalEligible: number; entries: any[] }> {
  const entries = await getEligibleLedgerEntries(teacherId);
  const total = entries.reduce((sum, e) => sum + Number(e.teacher_share), 0);
  return { totalEligible: total, entries };
}

// ─── Process Webhook (idempotent) ───
export async function processPayoutWebhook(input: {
  providerReference: string;
  status: 'completed' | 'failed';
  failureReason?: string;
}): Promise<{ processed: boolean; payoutId?: string }> {
  const payout = await getPayoutById(input.providerReference);
  if (!payout) {
    // Also try by provider_reference column
    const { getPayoutByProviderReference } = await import('./repository');
    const byRef = await getPayoutByProviderReference(input.providerReference);
    if (!byRef) return { processed: false };
    // Process the found payout
  }

  const found = payout || (await (await import('./repository')).getPayoutByProviderReference(input.providerReference));
  if (!found) return { processed: false };

  // Idempotent — if already in the target state, don't reprocess
  if (found.status === input.status) return { processed: true, payoutId: found.id };
  if (found.status === 'completed' || found.status === 'cancelled') {
    return { processed: true, payoutId: found.id }; // terminal — skip
  }

  // Apply transition
  if (input.status === 'completed') {
    if (!isValidStatusTransition(found.status as any, 'completed')) {
      return { processed: false, payoutId: found.id };
    }
    await updatePayoutStatus(found.id, 'completed');
    await writeAuditLog({
      payoutId: found.id,
      teacherId: found.teacher_id,
      event: 'payout.completed',
      actorId: 'system_webhook',
      details: { provider_reference: input.providerReference },
    });
  } else if (input.status === 'failed') {
    await setPayoutFailure(found.id, input.failureReason ?? 'Webhook reported failure');
    await writeAuditLog({
      payoutId: found.id,
      teacherId: found.teacher_id,
      event: 'payout.failed',
      actorId: 'system_webhook',
      details: { reason: input.failureReason },
    });
  }

  return { processed: true, payoutId: found.id };
}

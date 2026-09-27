/**
 * Payout Service — Phase 13 Step A
 *
 * Application/business-logic layer for the payout domain.
 * Orchestrates: repository + provider registry + domain validation.
 *
 * NEVER trusts client-supplied teacher_id/admin_id.
 * NEVER exposes provider-specific details.
 * NEVER leaks secrets in responses or logs.
 *
 * Phase 13 Hardening:
 *   - initiatePayout now enforces amount ≤ teacher's eligible balance.
 *   - initiatePayout now links ledger entries with the correct
 *     teacher_share (not the previous 0 placeholder that violated
 *     the v82 CHECK constraint `amount_settled > 0`).
 *   - processPayoutWebhook now resolves the payout directly via
 *     getPayoutByProviderReference — no redundant primary-key lookup.
 */

import {
  createPayout,
  getPayoutById,
  getPayoutByIdempotencyKey,
  getPayoutByProviderReference,
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

  // ── Fix #2: Enforce amount ≤ teacher's eligible balance ──
  //
  // Fetch all eligible (status='paid' AND unlinked) ledger entries
  // for this teacher. Filter by currency to match the payout currency
  // (the DB trigger also enforces currency consistency at link time,
  // but we filter here so the eligible balance reflects only entries
  // that can actually be linked to this payout).
  //
  // CONCURRENCY NOTE:
  //   The service-layer check is a sanity guard. The authoritative
  //   concurrency defense is at the DB layer:
  //     - UNIQUE(ledger_id) on teacher_payout_ledger_entries prevents
  //       the same ledger entry from being linked to two payouts.
  //     - check_payout_ledger_integrity() trigger takes an advisory
  //       xact_lock + FOR UPDATE on the parent payout row so that
  //       concurrent links for the same payout serialize.
  //     - protect_payout_immutability() trigger enforces
  //       SUM(linked) = amount at completion time.
  //   So even if two simultaneous payout-initiation requests both
  //   observe the same eligible balance and both pass this sanity
  //   check, the actual settlement cannot double-allocate any
  //   ledger entry — each entry is linkable to exactly one payout.
  const eligibleEntries = await getEligibleLedgerEntries(input.teacherId);
  const currencyMatchingEntries = eligibleEntries.filter(
    (e) => String(e.currency ?? 'EGP').toUpperCase() === input.currency.toUpperCase(),
  );
  const totalEligible = currencyMatchingEntries.reduce(
    (sum, e) => sum + Number(e.teacher_share),
    0,
  );
  if (totalEligible <= 0) {
    throw new PayoutExecutionRejectedError(
      'No eligible balance — teacher has no paid, unsettled ledger entries in this currency',
    );
  }
  if (input.amount > totalEligible) {
    throw new PayoutExecutionRejectedError(
      `Payout amount ${input.amount} exceeds teacher's eligible balance ${totalEligible.toFixed(2)} ${input.currency}`,
    );
  }

  // ── Fix #3: Pre-resolve ledger entries (if provided) with their
  //    actual teacher_share, instead of passing 0 at link time. ──
  //
  // The v82 CHECK constraint requires `amount_settled > 0`. The
  // previous implementation passed 0 as a placeholder, which violated
  // the constraint and made the linking path unusable.
  //
  // We resolve each requested ledger entry from the eligible list:
  //   - Confirms the entry is eligible (paid + unlinked + owned by
  //     teacher + currency matches).
  //   - Gives us the actual teacher_share to pass as amount_settled.
  //   - Reuses the existing repository function — no new query path.
  //
  // The DB trigger check_payout_ledger_integrity() still enforces:
  //   - teacher_id ownership (link vs ledger vs payout)
  //   - currency consistency
  //   - amount_settled <= ledger.teacher_share
  //   - cumulative SUM <= payout.amount
  //   - payout.status = 'pending'
  // so even if the service-side resolution races with another
  // concurrent payout, the trigger is the authoritative gate.
  let entriesToLink: { id: string; teacherShare: number }[] = [];
  if (input.ledgerEntryIds && input.ledgerEntryIds.length > 0) {
    const eligibleById = new Map(
      currencyMatchingEntries.map((e) => [String(e.id), Number(e.teacher_share)] as const),
    );
    for (const ledgerId of input.ledgerEntryIds) {
      const share = eligibleById.get(ledgerId);
      if (share === undefined) {
        throw new PayoutExecutionRejectedError(
          `Ledger entry ${ledgerId} is not eligible for this teacher (not paid, already linked, currency mismatch, or not owned)`,
        );
      }
      entriesToLink.push({ id: ledgerId, teacherShare: share });
    }
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

  // Link ledger entries if provided — using the REAL teacher_share
  // resolved above (Fix #3). The v82 CHECK constraint
  // (`amount_settled > 0`) is now satisfied because teacher_share is
  // always > 0 (validated by the financial_ledger schema).
  //
  // The DB trigger check_payout_ledger_integrity() enforces:
  //   - amount_settled <= ledger.teacher_share (we pass exactly the share)
  //   - cumulative SUM <= payout.amount (linking fails if it exceeds)
  // So if entriesToLink sums to > payout.amount, the trigger rejects
  // the offending insert and createPayout's INSERT is already
  // committed as 'pending' — the partial linkage failure surfaces
  // as an exception here. The admin can then cancel the payout.
  for (const entry of entriesToLink) {
    await linkLedgerEntry(
      result.id,
      entry.id,
      input.teacherId,
      entry.teacherShare,
      input.currency,
    );
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
//
// Fix #4: The webhook resolves the payout directly via
// getPayoutByProviderReference(providerReference). The previous
// implementation did a wasteful + semantically wrong first lookup via
// getPayoutById(input.providerReference) — which queried the `id`
// (primary-key UUID) column, not the `provider_reference` column.
// That first lookup returned null in 99% of cases (provider_reference
// is rarely a UUID), causing a guaranteed redundant second query.
//
// The webhook caller MUST verify the request signature at the route
// layer (see src/app/api/payout/webhook/route.ts). The service trusts
// the provider_reference + status only AFTER signature verification
// has succeeded at the route layer.
export async function processPayoutWebhook(input: {
  providerReference: string;
  status: 'completed' | 'failed';
  failureReason?: string;
}): Promise<{ processed: boolean; payoutId?: string }> {
  // Direct lookup by provider_reference — single query, no fallback.
  const found = await getPayoutByProviderReference(input.providerReference);
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

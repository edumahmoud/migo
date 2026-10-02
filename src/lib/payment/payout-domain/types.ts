/**
 * Payout Domain Types — Phase 13 Step 2
 *
 * Typed domain structures mirroring v82_teacher_payouts.sql.
 * NO Record<string, unknown> for typed domain structures.
 * NO PAN/CVV/provider_token anywhere.
 *
 * DB invariants enforced at 3 levels:
 *   1. DB-level (triggers/constraints/FKs — the authoritative gate)
 *   2. Domain-level (these TypeScript helpers mirror the DB rules)
 *   3. Application-level (future API layer uses these helpers)
 */

// ─── Payout Status Lifecycle ───
export type PayoutStatus =
  | 'pending'      // admin initiated, awaiting processing
  | 'processing'   // provider call in-flight (future Step 6)
  | 'completed'    // provider confirmed + ledger settled
  | 'failed'       // provider error or settlement failed
  | 'cancelled';   // admin cancelled before processing

export const PAYOUT_STATUSES: readonly PayoutStatus[] = [
  'pending', 'processing', 'completed', 'failed', 'cancelled',
] as const;

/**
 * Valid status transitions. Mirrors protect_payout_immutability() trigger.
 *
 *   pending → processing | cancelled
 *   processing → completed | failed
 *   completed → (terminal)
 *   failed → pending (retry)
 *   cancelled → (terminal)
 */
export const VALID_STATUS_TRANSITIONS: Readonly<Record<PayoutStatus, readonly PayoutStatus[]>> = {
  pending: ['processing', 'cancelled'],
  processing: ['completed', 'failed'],
  completed: [],
  failed: ['pending'],
  cancelled: [],
} as const;

export function isValidStatusTransition(from: PayoutStatus, to: PayoutStatus): boolean {
  return VALID_STATUS_TRANSITIONS[from].includes(to);
}

export function isTerminalStatus(status: PayoutStatus): boolean {
  return VALID_STATUS_TRANSITIONS[status].length === 0;
}

// ─── Payout Method Snapshot ───
/**
 * Immutable snapshot of the payout method's non-secret display info.
 *
 * DB-level: protect_payout_immutability() trigger rejects ANY UPDATE
 * to snapshot columns — not just after status leaves 'pending', but
 * from the moment of INSERT. These fields are immutable forever.
 *
 * SECURITY: Only non-secret data. For bank_card, the masked summary
 * already contains only last4 + card_brand (from Step 1 BankCardDetails).
 * NO PAN, CVV, provider_token, encrypted blobs.
 */
export interface PayoutMethodSnapshot {
  method_type: 'wallet' | 'bank_account' | 'bank_card' | 'instapay';
  display_label: string;
  masked: string;
}

// ─── Payout Record (DB row shape) ───
export interface PayoutRecord {
  id: string;
  teacher_id: string;
  payout_method_id: string | null;
  // Immutable snapshot (protected by trigger from INSERT):
  payout_method_type: PayoutMethodSnapshot['method_type'];
  payout_method_display_label: string;
  payout_method_masked: string;
  // Amount (immutable from INSERT — protected by trigger):
  amount: number;
  currency: string;
  status: PayoutStatus;
  idempotency_key: string;
  internal_reference: string;
  provider_reference: string | null;
  failure_reason: string | null;
  initiated_by: string;
  initiated_at: string;
  executed_at: string | null;
  created_at: string;
  updated_at: string;
}

// ─── Payout Metadata (safe for API response) ───
export interface PayoutMetadata {
  id: string;
  teacher_id: string;
  payout_method_type: PayoutMethodSnapshot['method_type'];
  payout_method_display_label: string;
  payout_method_masked: string;
  amount: string;
  currency: string;
  status: PayoutStatus;
  internal_reference: string;
  provider_reference: string | null;
  failure_reason: string | null;
  initiated_at: string;
  executed_at: string | null;
  created_at: string;
  updated_at: string;
  ledger_entry_count: number;
}

export function toPayoutMetadata(row: PayoutRecord, ledgerEntryCount: number = 0): PayoutMetadata {
  return {
    id: row.id,
    teacher_id: row.teacher_id,
    payout_method_type: row.payout_method_type,
    payout_method_display_label: row.payout_method_display_label,
    payout_method_masked: row.payout_method_masked,
    amount: Number(row.amount).toFixed(2),
    currency: row.currency,
    status: row.status,
    internal_reference: row.internal_reference,
    provider_reference: row.provider_reference,
    failure_reason: row.failure_reason,
    initiated_at: row.initiated_at,
    executed_at: row.executed_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    ledger_entry_count: ledgerEntryCount,
  };
}

// ─── Ledger Link Entry ───
export interface PayoutLedgerEntry {
  id: string;
  payout_id: string;
  ledger_id: string;
  teacher_id: string;
  amount_settled: number;
  currency: string;
  settled_at: string;
}

// ─── Audit Log ───
export type PayoutAuditEvent =
  | 'payout.created' | 'payout.processing' | 'payout.completed'
  | 'payout.failed' | 'payout.cancelled';

export const PAYOUT_AUDIT_EVENTS: readonly PayoutAuditEvent[] = [
  'payout.created', 'payout.processing', 'payout.completed',
  'payout.failed', 'payout.cancelled',
] as const;

/** FK ON DELETE RESTRICT — audit history cannot disappear. */
export interface PayoutAuditLogRecord {
  id: string;
  payout_id: string;
  teacher_id: string;
  event: PayoutAuditEvent;
  actor_id: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
}

// ─── Validation Helpers (domain-level — mirrors DB triggers) ───

export function isValidPayoutAmount(amount: number): boolean {
  return Number.isFinite(amount) && amount > 0;
}

export function currenciesMatch(a: string, b: string): boolean {
  return a.toUpperCase() === b.toUpperCase();
}

/** Amount is ALWAYS immutable (from INSERT). Returns false for ALL statuses. */
export function canModifyAmount(_status: PayoutStatus): boolean {
  return false;
}

export function canCancel(status: PayoutStatus): boolean {
  return status === 'pending';
}

export function canRetry(status: PayoutStatus): boolean {
  return status === 'failed';
}

/** Snapshot is ALWAYS immutable (from INSERT). Returns false for ALL statuses. */
export function canModifySnapshot(_status: PayoutStatus): boolean {
  return false;
}

// ─── FORBIDDEN FIELDS ───
export const PAYOUT_FORBIDDEN_FIELDS: readonly string[] = [
  'card_number', 'pan', 'cvv', 'cvc', 'security_code',
  'provider_token', 'details_encrypted', 'credentials_encrypted',
] as const;

export function findForbiddenFields(obj: Record<string, unknown> | null | undefined): string[] {
  if (!obj) return [];
  return PAYOUT_FORBIDDEN_FIELDS.filter((f) => f in obj);
}

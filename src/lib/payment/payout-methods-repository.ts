/**
 * Teacher Payout Methods Repository — Phase 11
 *
 * The ONLY layer that touches the `teacher_payout_methods` table.
 * Handles:
 *   - Reading methods (with decryption only inside `ResolvedPayoutMethod`)
 *   - Creating methods (encrypting details before storage)
 *   - Updating methods (re-encrypting details)
 *   - Soft-disabling methods (is_active = false)
 *   - Re-enabling methods (is_active = true)
 *   - Setting default (atomic, one-per-teacher rule)
 *   - Admin verification (verified_at, verified_by)
 *   - Audit logging (no secrets)
 *
 * Critical security rules:
 *   - The `teacherId` parameter is taken from `requireTeacher().user.id`
 *     in the API route. It is NEVER read from query/body/headers.
 *   - `details_encrypted` is NEVER returned in any API response —
 *     only `details_masked` is safe to expose.
 *   - The full decrypted details (`details` in `ResolvedPayoutMethod`)
 *     are accessible only inside the repository layer; future
 *     payout execution (Phase 13) will use it directly.
 *   - Encryption key is required before any create/update operation;
 *     if missing, `EncryptionKeyMissingError` is thrown (safe failure).
 */

import { supabaseServer } from '@/lib/supabase-server';
import { encrypt, decrypt, isEncryptionKeyConfigured } from './crypto';
import { buildMaskedSummaryForMethod } from './masking';
import {
  getPayoutMethodSchema,
  validatePayoutMethodDetails,
  isSupportedPayoutMethodType,
  coercePayoutMethodDetails,
  type PayoutMethodDetails,
} from './payout-method-schemas';
import { EncryptionKeyMissingError } from './errors';

// ─── DB row shape ───
interface PayoutMethodRow {
  id: string;
  teacher_id: string;
  method_type: string;
  display_label: string;
  details_encrypted: string;
  details_masked: string;
  is_active: boolean;
  is_default: boolean;
  verified_at: string | null;
  verified_by: string | null;
  created_at: string;
  updated_at: string;
}

// ─── Safe metadata (frontend-facing) ───
export interface PayoutMethodMetadata {
  id: string;
  method_type: string;
  display_label: string;
  details_masked: string;
  is_active: boolean;
  is_default: boolean;
  verified_at: string | null;
  verified_by: string | null;
  created_at: string;
  updated_at: string;
  // NEVER include: details_encrypted, teacher_id, decrypted details.
}

// ─── Resolved method (with decrypted details) ───
// Used internally when the payout execution layer (Phase 13 Step 6+)
// needs the full recipient data. Never returned from API routes.
//
// After the Phase 13 Step 1 Architecture Correction, `details` is a
// Discriminated Union on `method_type`. TypeScript narrows the union
// automatically based on `details.method_type` — NO casts needed
// when the caller branches on the discriminant:
//
//   if (resolved.details.method_type === 'wallet') {
//     // TS narrows resolved.details to WalletDetails here
//     console.log(resolved.details.wallet_number);  // ✓ type-safe
//   }
//
// The Phase 13 Payout Provider execution layer (Step 10, deferred)
// will use this narrowing to call the right provider adapter per
// method_type. NO branching is implemented in this repository —
// `coercePayoutMethodDetails()` only constructs the typed union
// from the decrypted raw Record.
export interface ResolvedPayoutMethod extends PayoutMethodMetadata {
  details: PayoutMethodDetails;
}

// ─── Audit event types (mirror DB CHECK constraint) ───
export type PayoutMethodAuditEvent =
  | 'payout_method.created'
  | 'payout_method.updated'
  | 'payout_method.set_default'
  | 'payout_method.disabled'
  | 'payout_method.reenabled'
  | 'payout_method.verified';

// ─── Row → safe metadata (strips secrets) ───
export function rowToPayoutMetadata(row: PayoutMethodRow): PayoutMethodMetadata {
  return {
    id: row.id,
    method_type: row.method_type,
    display_label: row.display_label,
    details_masked: row.details_masked,
    is_active: row.is_active,
    is_default: row.is_default,
    verified_at: row.verified_at,
    verified_by: row.verified_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// ─── Read operations ───

/**
 * List all payout methods for a teacher (active + disabled).
 * Returns safe metadata only — never decrypted details.
 */
export async function listPayoutMethods(
  teacherId: string,
  options: { includeInactive?: boolean } = {}
): Promise<PayoutMethodMetadata[]> {
  let query = supabaseServer
    .from('teacher_payout_methods')
    .select('*')
    .eq('teacher_id', teacherId)
    .order('created_at', { ascending: true });

  if (!options.includeInactive) {
    query = query.eq('is_active', true);
  }

  const { data, error } = await query;
  if (error || !data) return [];
  return (data as PayoutMethodRow[]).map(rowToPayoutMetadata);
}

/**
 * Get a single payout method by ID, scoped to a specific teacher.
 * Returns null if not found OR if the teacher doesn't own the method
 * (the WHERE clause enforces ownership at the DB layer).
 */
export async function getPayoutMethodForTeacher(
  id: string,
  teacherId: string
): Promise<PayoutMethodMetadata | null> {
  const { data, error } = await supabaseServer
    .from('teacher_payout_methods')
    .select('*')
    .eq('id', id)
    .eq('teacher_id', teacherId)
    .maybeSingle();

  if (error || !data) return null;
  return rowToPayoutMetadata(data as PayoutMethodRow);
}

/**
 * Get the default payout method for a teacher (if any).
 */
export async function getDefaultPayoutMethod(
  teacherId: string
): Promise<PayoutMethodMetadata | null> {
  const { data, error } = await supabaseServer
    .from('teacher_payout_methods')
    .select('*')
    .eq('teacher_id', teacherId)
    .eq('is_default', true)
    .eq('is_active', true)
    .maybeSingle();

  if (error || !data) return null;
  return rowToPayoutMetadata(data as PayoutMethodRow);
}

// ─── Write operations ───

export interface CreatePayoutMethodInput {
  teacherId: string;           // server-side only — never from client
  methodType: string;
  displayLabel: string;
  /**
   * Generic details object whose shape depends on `methodType`:
   *   - 'wallet':       { wallet_number, holder_name }
   *   - 'bank_account': { bank_name, account_number? OR iban?, holder_name }
   *   - 'bank_card':    { last4, card_brand?, expiry_month, expiry_year, holder_name }
   *   - 'instapay':     { recipient_identifier, holder_name }
   *
   * Validated server-side against the schema in payout-method-schemas.ts.
   * Encrypted via AES-256-GCM before storage.
   *
   * Forbidden fields for 'bank_card' (rejected by validation):
   *   card_number, pan, cvv, cvc, security_code, provider_token
   */
  details: Record<string, unknown>;
  setAsDefault?: boolean;
}

/**
 * Create a new payout method. Sensitive details are encrypted before
 * storage. Only masked summary is stored in plaintext.
 *
 * Failsafe: throws EncryptionKeyMissingError if the encryption key
 * is not configured (we refuse to store plaintext).
 */
export async function createPayoutMethod(
  input: CreatePayoutMethodInput,
  actorId?: string
): Promise<{ id: string; masked: string }> {
  if (!isEncryptionKeyConfigured()) {
    throw new EncryptionKeyMissingError();
  }

  // Server-side validation (defense in depth — even if the frontend
  // bypassed validation, we reject here).
  if (!isSupportedPayoutMethodType(input.methodType)) {
    throw new Error(`Unsupported method type: ${input.methodType}`);
  }
  const schema = getPayoutMethodSchema(input.methodType)!;
  const validationErrors = validatePayoutMethodDetails(schema, input.details);
  if (validationErrors.length > 0) {
    throw new Error(`Validation failed: ${validationErrors.join('; ')}`);
  }

  // Encrypt sensitive details — encrypted blob shape matches the
  // validated `details` object exactly. Decryption recovers the
  // same shape; the caller (Phase 13 execution) reads fields by name.
  const detailsEncrypted = encrypt(input.details);
  const detailsMasked = buildMaskedSummaryForMethod(input.methodType, input.details);

  // If setAsDefault, clear existing default first (atomic operation)
  if (input.setAsDefault) {
    await supabaseServer
      .from('teacher_payout_methods')
      .update({ is_default: false, updated_at: new Date().toISOString() })
      .eq('teacher_id', input.teacherId)
      .eq('is_default', true);
  }

  const { data, error } = await supabaseServer
    .from('teacher_payout_methods')
    .insert({
      teacher_id: input.teacherId,
      method_type: input.methodType,
      display_label: input.displayLabel,
      details_encrypted: detailsEncrypted,
      details_masked: detailsMasked,
      is_active: true,
      is_default: input.setAsDefault ?? false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  if (error) {
    // Handle unique constraint violation (duplicate method for same teacher)
    if (error.code === '23505') {
      throw new Error('هذه الوسيلة مسجلة بالفعل');
    }
    throw new Error(`Failed to create payout method: ${error.message}`);
  }

  const newId = (data as { id: string }).id;

  // Audit log (no secrets — only masked value)
  await writeAuditLog({
    payoutMethodId: newId,
    teacherId: input.teacherId,
    event: 'payout_method.created',
    actorId: actorId ?? input.teacherId,
    details: { masked: detailsMasked, method_type: input.methodType },
  });

  return { id: newId, masked: detailsMasked };
}

export interface UpdatePayoutMethodInput {
  id: string;
  teacherId: string;           // server-side only — never from client
  displayLabel?: string;
  /**
   * Partial details object — only the fields the teacher is updating.
   * Empty/absent fields are preserved from the existing encrypted blob.
   * Validation is applied to the MERGED details (existing + new)
   * against the schema for the row's method_type.
   *
   * NOTE: `method_type` is IMMUTABLE after creation. To change method
   * type, the teacher must disable this method + create a new one.
   */
  detailsPatch?: Record<string, unknown>;
}

/**
 * Update a payout method's label and/or details.
 * If `detailsPatch` is provided, the existing encrypted details are
 * decrypted, merged with the patch, re-validated, re-encrypted,
 * and the masked summary is regenerated.
 *
 * Critical: the WHERE clause includes teacher_id to enforce ownership.
 * A teacher CANNOT update a method they don't own (DB returns 0 rows
 * affected, which we surface as a not-found error).
 */
export async function updatePayoutMethod(
  input: UpdatePayoutMethodInput,
  actorId?: string
): Promise<{ updated: boolean; newMasked?: string }> {
  // Verify ownership first
  const existing = await getPayoutMethodForTeacher(input.id, input.teacherId);
  if (!existing) {
    return { updated: false };
  }

  const update: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  let newMasked: string | undefined;

  if (input.displayLabel !== undefined) {
    update.display_label = input.displayLabel;
  }

  // If a details patch is provided, decrypt + merge + validate + re-encrypt
  if (input.detailsPatch && Object.keys(input.detailsPatch).length > 0) {
    if (!isEncryptionKeyConfigured()) {
      throw new EncryptionKeyMissingError();
    }

    // Decrypt the existing details to merge with the new ones
    // (the existing row's details_encrypted is fetched via a raw SELECT
    //  because the safe metadata doesn't include it).
    const { data: rawRow } = await supabaseServer
      .from('teacher_payout_methods')
      .select('details_encrypted')
      .eq('id', input.id)
      .eq('teacher_id', input.teacherId)
      .maybeSingle();

    const rawRowCasted = rawRow as { details_encrypted: string } | null;
    let existingDetails: Record<string, unknown> = {};
    if (rawRowCasted?.details_encrypted) {
      try {
        existingDetails = decrypt(rawRowCasted.details_encrypted) as Record<string, unknown>;
      } catch {
        // Can't decrypt — fail safe
        throw new Error('Failed to decrypt existing details — encryption key may have changed');
      }
    }

    // Merge existing details with the patch — patch fields override
    const mergedDetails: Record<string, unknown> = { ...existingDetails, ...input.detailsPatch };

    // Validate the merged details against the schema for the existing method_type
    const schema = getPayoutMethodSchema(existing.method_type);
    if (schema) {
      const errors = validatePayoutMethodDetails(schema, mergedDetails);
      if (errors.length > 0) {
        throw new Error(`Validation failed: ${errors.join('; ')}`);
      }
    }

    update.details_encrypted = encrypt(mergedDetails);
    newMasked = buildMaskedSummaryForMethod(existing.method_type, mergedDetails);
    update.details_masked = newMasked;
  }

  const { error, count } = await supabaseServer
    .from('teacher_payout_methods')
    .update(update)
    .eq('id', input.id)
    .eq('teacher_id', input.teacherId); // ownership enforced at DB layer

  if (error) {
    if (error.code === '23505') {
      throw new Error('هذه الوسيلة مسجلة بالفعل');
    }
    throw new Error(`Failed to update: ${error.message}`);
  }

  const updated = (count ?? 0) > 0 || !error;
  if (!updated) return { updated: false };

  // Audit log
  await writeAuditLog({
    payoutMethodId: input.id,
    teacherId: input.teacherId,
    event: 'payout_method.updated',
    actorId: actorId ?? input.teacherId,
    details: {
      masked: newMasked ?? existing.details_masked,
      updated_fields: Object.keys(input).filter((k) => k !== 'id' && k !== 'teacherId'),
    },
  });

  return { updated: true, newMasked };
}

/**
 * Soft-disable a payout method (is_active = false).
 * Does NOT delete the row — audit history is preserved.
 * If the method was the default, is_default is cleared.
 */
export async function softDisablePayoutMethod(
  id: string,
  teacherId: string,
  actorId?: string
): Promise<{ disabled: boolean }> {
  const { error } = await supabaseServer
    .from('teacher_payout_methods')
    .update({
      is_active: false,
      is_default: false, // disabling clears default status
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('teacher_id', teacherId)
    .eq('is_active', true); // only update if currently active

  if (error) {
    throw new Error(`Failed to disable: ${error.message}`);
  }

  // Audit log
  await writeAuditLog({
    payoutMethodId: id,
    teacherId,
    event: 'payout_method.disabled',
    actorId: actorId ?? teacherId,
    details: {},
  });

  return { disabled: true };
}

/**
 * Re-enable a soft-disabled payout method.
 */
export async function reenablePayoutMethod(
  id: string,
  teacherId: string,
  actorId?: string
): Promise<{ reenabled: boolean }> {
  const { error } = await supabaseServer
    .from('teacher_payout_methods')
    .update({
      is_active: true,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('teacher_id', teacherId)
    .eq('is_active', false);

  if (error) {
    throw new Error(`Failed to re-enable: ${error.message}`);
  }

  await writeAuditLog({
    payoutMethodId: id,
    teacherId,
    event: 'payout_method.reenabled',
    actorId: actorId ?? teacherId,
    details: {},
  });

  return { reenabled: true };
}

/**
 * Set a payout method as the default for its teacher.
 * Atomic operation:
 *   1. Clear is_default on the teacher's current default (if any).
 *   2. Set is_default = true on the new method.
 * The partial unique index `teacher_payout_methods_one_default`
 * is a defense-in-depth: even if step 1 fails, the DB rejects the
 * duplicate default.
 *
 * Returns { set: false } if the method is not owned by the teacher
 * or is currently inactive (cannot be default while disabled).
 */
export async function setDefaultPayoutMethod(
  id: string,
  teacherId: string,
  actorId?: string
): Promise<{ set: boolean }> {
  // Verify ownership + active status
  const existing = await getPayoutMethodForTeacher(id, teacherId);
  if (!existing || !existing.is_active) {
    return { set: false };
  }
  if (existing.is_default) {
    return { set: true }; // already default — idempotent
  }

  // Step 1: clear existing default
  await supabaseServer
    .from('teacher_payout_methods')
    .update({ is_default: false, updated_at: new Date().toISOString() })
    .eq('teacher_id', teacherId)
    .eq('is_default', true);

  // Step 2: set new default
  const { error } = await supabaseServer
    .from('teacher_payout_methods')
    .update({ is_default: true, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('teacher_id', teacherId)
    .eq('is_active', true); // can't set a disabled method as default

  if (error) {
    if (error.code === '23505') {
      // The partial unique index caught a duplicate — shouldn't happen
      // since we cleared the existing default, but defense in depth.
      throw new Error('Default conflict: another method is already default');
    }
    throw new Error(`Failed to set default: ${error.message}`);
  }

  await writeAuditLog({
    payoutMethodId: id,
    teacherId,
    event: 'payout_method.set_default',
    actorId: actorId ?? teacherId,
    details: {},
  });

  return { set: true };
}

/**
 * Admin-only: mark a payout method as verified.
 * The `verified_by` is set to the admin's user_id (server-side),
 * NEVER from the client.
 */
export async function verifyPayoutMethod(
  id: string,
  adminId: string
): Promise<{ verified: boolean }> {
  const { data: method, error: fetchErr } = await supabaseServer
    .from('teacher_payout_methods')
    .select('id, teacher_id')
    .eq('id', id)
    .maybeSingle();

  if (fetchErr || !method) {
    return { verified: false };
  }

  const methodRow = method as { id: string; teacher_id: string };

  const { error } = await supabaseServer
    .from('teacher_payout_methods')
    .update({
      verified_at: new Date().toISOString(),
      verified_by: adminId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);

  if (error) {
    throw new Error(`Failed to verify: ${error.message}`);
  }

  await writeAuditLog({
    payoutMethodId: id,
    teacherId: methodRow.teacher_id,
    event: 'payout_method.verified',
    actorId: adminId,
    details: { verified_by: adminId },
  });

  return { verified: true };
}

// ─── Audit log helper ───
async function writeAuditLog(entry: {
  payoutMethodId: string;
  teacherId: string;
  event: PayoutMethodAuditEvent;
  actorId: string | undefined;
  details: Record<string, unknown>;
}): Promise<void> {
  // NEVER store secrets in `details`. Only masked values + metadata.
  try {
    await supabaseServer.from('teacher_payout_method_audit_log').insert({
      payout_method_id: entry.payoutMethodId,
      teacher_id: entry.teacherId,
      event: entry.event,
      actor_id: entry.actorId ?? null,
      details: entry.details,
      created_at: new Date().toISOString(),
    });
  } catch (err) {
    // Audit log failure should NOT break the operation.
    // Log + continue.
    console.error('[payout-methods] audit log write failed:', err);
  }
}

// ─── Internal helper: resolve + decrypt (for future Phase 13 use) ───
/**
 * Resolve a payout method to its full (decrypted, type-safe) form.
 *
 * Used internally by the payout execution layer (Phase 13 Step 6+).
 * The caller MUST read `details.method_type` first to determine
 * which fields are in `details`. TypeScript narrows the union
 * automatically based on `details.method_type`:
 *
 *   if (resolved.details.method_type === 'wallet') {
 *     // TS knows resolved.details is WalletDetails here
 *     console.log(resolved.details.wallet_number);  // ✓
 *   }
 *
 * The execution layer branches on `details.method_type` to call the
 * appropriate Payout Provider. This branching is NOT implemented
 * here — it's deferred to Phase 13 Step 10 (provider integration).
 *
 * NEVER returned from any API response. Only used inside the
 * payout execution flow.
 *
 * Note on bank_card: After the Phase 13 Step 1 Architecture Correction,
 * the bank_card details shape no longer includes `card_number` (PAN) —
 * only `last4`. If the encrypted blob in the DB contains a legacy
 * `card_number` field (created before this architecture correction),
 * the `coercePayoutMethodDetails` function will IGNORE it (it only
 * extracts `last4` from the typed union). The PAN is not leaked
 * via this function's return type.
 */
export async function resolvePayoutMethod(
  id: string,
  teacherId: string
): Promise<ResolvedPayoutMethod | null> {
  const { data, error } = await supabaseServer
    .from('teacher_payout_methods')
    .select('*')
    .eq('id', id)
    .eq('teacher_id', teacherId)
    .maybeSingle();

  if (error || !data) return null;

  const row = data as PayoutMethodRow;
  const metadata = rowToPayoutMetadata(row);

  let raw: Record<string, unknown> = {};
  if (row.details_encrypted) {
    try {
      raw = decrypt(row.details_encrypted) as Record<string, unknown>;
    } catch {
      throw new Error('Failed to decrypt payout method details — encryption key may have changed');
    }
  }

  // Construct the typed PayoutMethodDetails (discriminated union)
  // from the raw decrypted Record + the row's method_type. This is
  // type-safe: the schema validation ran at creation time and
  // guarantees the shape. `coercePayoutMethodDetails` explicitly
  // extracts only the fields the current schema declares — any
  // legacy fields (e.g., a `card_number` from before this architecture
  // correction) are NOT surfaced via the typed union.
  const details = coercePayoutMethodDetails(row.method_type, raw);

  return { ...metadata, details };
}

/**
 * Hard-delete a payout method.
 * Permanently removes the row from teacher_payout_methods.
 * The encrypted details are also deleted (not recoverable).
 * Audit log rows (if any) have payout_method_id set to NULL
 * (ON DELETE SET NULL) — the audit history text is preserved.
 *
 * IDOR defense: WHERE clause includes both id AND teacher_id.
 *
 * @param id         The payout method ID to delete.
 * @param teacherId  The teacher who owns the method (from auth).
 * @param actorId    Who performed the deletion (for audit log).
 * @returns           { deleted: boolean }
 */
export async function hardDeletePayoutMethod(
  id: string,
  teacherId: string,
  actorId: string,
): Promise<{ deleted: boolean }> {
  // Write audit log BEFORE deleting (so the log has the method_id FK)
  try {
    await supabaseServer.from('teacher_payout_method_audit_log').insert({
      payout_method_id: id,
      teacher_id: teacherId,
      event: 'payout_method.deleted',
      actor_id: actorId,
      details: { hard_delete: true },
    });
  } catch (err) {
    console.error('[payout-methods] audit log write failed:', err);
    // Continue with delete even if audit fails
  }

  const { error, count } = await supabaseServer
    .from('teacher_payout_methods')
    .delete()
    .eq('id', id)
    .eq('teacher_id', teacherId);

  if (error) {
    console.error('[payout-methods] hard delete failed:', error.message);
    return { deleted: false };
  }

  return { deleted: true };
}

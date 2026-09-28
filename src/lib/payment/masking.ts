/**
 * Masking Utilities — Phase 11 / Phase 13 Step 1 Architecture Correction
 *
 * Provides functions to mask sensitive identifiers (wallet phone
 * numbers, bank account numbers, IBANs, card numbers, InstaPay
 * recipient identifiers) for safe display in the frontend + audit
 * logs.
 *
 * Critical rule:
 *   - Masking is applied BEFORE the value leaves the server.
 *   - The frontend NEVER receives the full identifier.
 *   - Audit logs store masked values only.
 *
 * Type-aware masking:
 *   Each payout method_type has its own masking logic. The
 *   `buildMaskedSummaryForMethod(methodType, details)` dispatcher
 *   picks the right masker based on the method_type.
 *
 * Phase 13 Step 1 — Bank Card Data Minimization:
 *   After this correction, the `bank_card` method NO LONGER stores
 *   the full PAN (Primary Account Number). It stores only the
 *   `last4` field (already just 4 digits — safe to display). The
 *   `maskCardNumber()` function accepts last4 (4 digits) directly
 *   OR legacy full PAN (extracts last 4) for backward-compat.
 */

/**
 * Mask a wallet phone number — shows only the last 4 digits.
 *
 * - Returns "****" if input is empty / null / undefined.
 * - Returns "****" + last 4 if input has <= 4 chars.
 * - Returns "**** **** XXXX" for longer inputs.
 *
 * Non-numeric characters are stripped before masking.
 *
 * @param value The wallet phone number to mask
 * @returns Masked string safe for frontend / logs
 */
export function maskWalletNumber(value: string | null | undefined): string {
  if (!value) return '****';

  const digits = String(value).replace(/\D/g, '');
  if (digits.length === 0) return '****';
  if (digits.length <= 4) return `**** ${digits}`;

  const last4 = digits.slice(-4);
  return `**** **** ${last4}`;
}

/**
 * Mask a generic account number — shows only the last 4 digits.
 * Used for bank account numbers.
 */
export function maskAccountNumber(value: string | null | undefined): string {
  if (!value) return '****';

  const trimmed = String(value).replace(/\s+/g, '');
  if (trimmed.length === 0) return '****';
  if (trimmed.length <= 4) return `**** ${trimmed}`;

  const last4 = trimmed.slice(-4);
  return `**** **** ${last4}`;
}

/**
 * Mask an IBAN — shows only the last 4 alphanumeric chars.
 * Format: "•••• •••• •••• 7890"
 *
 * IBANs are 13-34 chars; we show the last 4 only.
 */
export function maskIBAN(value: string | null | undefined): string {
  if (!value) return '****';

  const trimmed = String(value).replace(/\s+/g, '');
  if (trimmed.length === 0) return '****';
  if (trimmed.length <= 4) return `•••• ${trimmed}`;

  const last4 = trimmed.slice(-4);
  return `•••• •••• •••• ${last4}`;
}

/**
 * Mask a bank card's last4 — returns a display-safe summary.
 *
 * After the Phase 13 Step 1, the `bank_card` method NO LONGER
 * stores the full PAN (Primary Account Number). It stores only the
 * `last4` field (already just 4 digits — safe to display). This
 * function takes the last4 value and returns it in a formatted
 * masked summary with bullet separators for visual consistency
 * with the other types' summaries.
 *
 * Format: "•••• •••• •••• 5678" (when input is the last4 only)
 *
 * Note: This function is kept for backward-compat and for callers
 * that may pass either a full PAN (legacy) OR a last4 string. If
 * a full PAN is passed (legacy encrypted blob), it will extract
 * the last 4 digits. If a 4-digit string is passed (the new
 * bank_card schema), it uses it directly.
 *
 * NO CVV is ever stored or masked (CVV is used at execution time only).
 * NO PAN is stored after Phase 13 Step 1 — only last4.
 */
export function maskCardNumber(value: string | null | undefined): string {
  if (!value) return '••••';

  const digits = String(value).replace(/\D/g, '');
  if (digits.length === 0) return '••••';
  if (digits.length <= 4) return `•••• •••• •••• ${digits}`;

  // Legacy path: full PAN passed → extract last 4
  const last4 = digits.slice(-4);
  return `•••• •••• •••• ${last4}`;
}

/**
 * Mask an InstaPay recipient identifier. Since the identifier can
 * be a phone number, a virtual address (name@instapay), or a card
 * identifier, we mask generically:
 *
 *   - If it contains '@' (virtual address): show only the
 *     first 2 chars of the local part + masked domain.
 *     Example: "ma••••@instapay"
 *   - Otherwise: show only the last 4 chars.
 *     Example: "•••• 5678"
 */
export function maskInstaPayIdentifier(value: string | null | undefined): string {
  if (!value) return '****';

  const trimmed = String(value).trim();
  if (trimmed.length === 0) return '****';

  // Virtual address pattern (name@domain)
  if (trimmed.includes('@')) {
    const [localPart, domain] = trimmed.split('@', 2);
    if (!localPart || !domain) return '****';
    const visibleLocal = localPart.slice(0, 2);
    const visibleDomain = domain.slice(0, 4);
    return `${visibleLocal}••••@${visibleDomain}••••`;
  }

  // Phone number or generic identifier — show last 4
  if (trimmed.length <= 4) return `•••• ${trimmed}`;
  return `•••• ${trimmed.slice(-4)}`;
}

/**
 * Mask a holder name. Shows only the first letter of each word
 * followed by dots.
 *
 * Example: "Mahmoud Ahmed" → "M. A."
 */
export function maskHolderName(value: string | null | undefined): string {
  if (!value) return '—';
  const parts = String(value).trim().split(/\s+/);
  if (parts.length === 0) return '—';
  return parts.map((p) => p.charAt(0).toUpperCase() + '.').join(' ');
}

// ─── Type-aware summary dispatcher ───
// The masked summary format varies by method_type:
//   wallet:        "**** **** 5678 • M. A."
//   bank_account:  "•••• 7890 • BANK NAME • M. A."  (uses account_number OR iban)
//   bank_card:     "•••• •••• •••• 5678 • VISA • M. A."  (uses last4, NO PAN)
//   instapay:      "ma••••@inst•••• • M. A."  (or "•••• 5678 • M. A.")
//
// All summaries include the masked holder name.

/**
 * Build a masked summary string for a payout method, based on
 * its method_type + the decrypted details. This is the single
 * entry point used by the repository to populate the
 * `details_masked` column.
 *
 * @param methodType One of: wallet, bank_account, bank_card, instapay
 * @param details    The decrypted details object
 * @returns Masked summary safe for frontend / logs / audit
 */
export function buildMaskedSummaryForMethod(
  methodType: string,
  details: Record<string, unknown> | null | undefined
): string {
  if (!details) return '****';

  const holder = maskHolderName(
    typeof details.holder_name === 'string' ? details.holder_name : null
  );

  switch (methodType) {
    case 'wallet': {
      const walletNumber =
        typeof details.wallet_number === 'string' ? details.wallet_number : null;
      return `${maskWalletNumber(walletNumber)} • ${holder}`;
    }

    case 'bank_account': {
      // Prefer IBAN if present, else fall back to account_number
      const iban = typeof details.iban === 'string' ? details.iban : null;
      const accountNumber =
        typeof details.account_number === 'string' ? details.account_number : null;
      const bankName =
        typeof details.bank_name === 'string' ? details.bank_name : null;

      const accountMask = iban ? maskIBAN(iban) : maskAccountNumber(accountNumber);
      const bankLabel = bankName ? bankName.toUpperCase() : '—';
      return `${accountMask} • ${bankLabel} • ${holder}`;
    }

    case 'bank_card': {
      // Now stores `card_number` (full PAN, encrypted). Extract last4
      // from it for the masked summary. If only last4 is present
      // (legacy), use that directly.
      const cardNumber =
        typeof details.card_number === 'string' ? details.card_number : null;
      const last4 =
        typeof details.last4 === 'string' ? details.last4 : null;
      const cardBrand =
        typeof details.card_brand === 'string' && details.card_brand.trim() !== ''
          ? details.card_brand.trim().toUpperCase()
          : null;
      // Extract last4 from card_number if available, else use explicit last4
      const effectiveLast4 = cardNumber
        ? cardNumber.replace(/\D/g, '').slice(-4)
        : last4;
      const cardPart = effectiveLast4 ? maskCardNumber(effectiveLast4) : '••••';
      const brandPart = cardBrand ? ` • ${cardBrand}` : '';
      return `${cardPart}${brandPart} • ${holder}`;
    }

    case 'instapay': {
      const identifier =
        typeof details.recipient_identifier === 'string'
          ? details.recipient_identifier
          : null;
      return `${maskInstaPayIdentifier(identifier)} • ${holder}`;
    }

    default:
      // Unknown type — return a generic mask + holder
      return `**** • ${holder}`;
  }
}

// ─── Backward-compat shim for Phase 11 callers ───
// Phase 11's `buildMaskedSummary(walletNumber, holderName)` is
// preserved for any code path that still uses the old signature.
// The repository now uses `buildMaskedSummaryForMethod` instead.
export function buildMaskedSummary(
  walletNumber: string | null | undefined,
  holderName: string | null | undefined
): string {
  return `${maskWalletNumber(walletNumber)} • ${maskHolderName(holderName)}`;
}

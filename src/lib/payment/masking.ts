/**
 * Masking Utilities — Phase 11
 *
 * Provides functions to mask sensitive numeric strings (wallet numbers,
 * bank accounts) for safe display in the frontend and audit logs.
 *
 * The masked output ALWAYS hides all but the last 4 digits.
 * Example: "01012345678" → "**** **** 5678"
 *
 * Critical rule:
 *   - Masking is applied BEFORE the value leaves the server.
 *   - The frontend NEVER receives the full wallet number.
 *   - Audit logs store masked values only.
 */

/**
 * Mask a numeric string, showing only the last 4 digits.
 *
 * - Returns "****" if input is empty / null / undefined.
 * - Returns "****" + last 4 if input has <= 4 chars.
 * - Returns "**** **** XXXX" (groups of 4 masked) + last 4 for longer inputs.
 *
 * Non-numeric characters are stripped before masking (the wallet_number
 * may be stored with formatting like spaces or dashes).
 *
 * @param value The wallet number / account number to mask
 * @returns Masked string safe for frontend / logs
 */
export function maskWalletNumber(value: string | null | undefined): string {
  if (!value) return '****';

  // Strip non-digit characters
  const digits = String(value).replace(/\D/g, '');
  if (digits.length === 0) return '****';
  if (digits.length <= 4) return `**** ${digits}`;

  const last4 = digits.slice(-4);
  // For Egyptian mobile wallets (11 digits), show 4-digit groups of stars
  return `**** **** ${last4}`;
}

/**
 * Mask a generic identifier (e.g., bank account, IBAN).
 * Same logic as maskWalletNumber but accepts longer inputs and
 * preserves the leading format. Shows last 4 only.
 *
 * @param value The account number / IBAN to mask
 * @returns Masked string safe for frontend / logs
 */
export function maskAccountNumber(value: string | null | undefined): string {
  if (!value) return '****';

  // For IBANs / long account numbers, strip spaces but keep alphanumeric
  const trimmed = String(value).replace(/\s+/g, '');
  if (trimmed.length === 0) return '****';
  if (trimmed.length <= 4) return `**** ${trimmed}`;

  const last4 = trimmed.slice(-4);
  return `**** **** ${last4}`;
}

/**
 * Mask a holder name. Shows only the first letter of each word
 * followed by dots. Used for additional display in audit logs.
 *
 * Example: "Mahmoud Ahmed" → "M. A."
 *
 * @param value Holder name to mask
 * @returns Masked name safe for audit logs
 */
export function maskHolderName(value: string | null | undefined): string {
  if (!value) return '—';
  const parts = String(value).trim().split(/\s+/);
  if (parts.length === 0) return '—';
  return parts.map((p) => p.charAt(0).toUpperCase() + '.').join(' ');
}

/**
 * Build a masked summary string combining wallet number + holder initials.
 * Used to populate `teacher_payout_methods.details_masked`.
 *
 * Example: wallet="01012345678", holder="Mahmoud Ahmed"
 *   → "**** **** 5678 • M. A."
 *
 * @param walletNumber  The full wallet number (will be masked)
 * @param holderName    The holder name (will be masked)
 * @returns Combined masked summary string
 */
export function buildMaskedSummary(
  walletNumber: string | null | undefined,
  holderName: string | null | undefined
): string {
  const maskedWallet = maskWalletNumber(walletNumber);
  const maskedHolder = maskHolderName(holderName);
  return `${maskedWallet} • ${maskedHolder}`;
}

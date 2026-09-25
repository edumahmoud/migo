/**
 * Phone number normalization utilities.
 *
 * Telegram Gateway requires E.164 international format
 * (e.g., `+201555614624`). Users typically enter local format
 * (e.g., `01555614624` in Egypt). These helpers normalize any
 * reasonable input to E.164.
 */

/**
 * Convert a phone number to E.164 format.
 *
 * Rules (applied in order):
 *   1. Strip whitespace, dashes, parentheses.
 *   2. If empty after stripping → return null.
 *   3. If starts with `+` → assume E.164 already, return as-is.
 *   4. If starts with `00` → international prefix; replace with `+`.
 *   5. If starts with `0` → local format; strip leading 0 and prepend
 *      `+<defaultCountry>` (default Egypt = +20).
 *   6. Otherwise → assume international without `+`; prepend `+`.
 *
 * @param phone The input phone number (possibly local format).
 * @param defaultCountry ISO country code prefix WITHOUT leading 0/+.
 *        Default: '20' (Egypt).
 */
export function normalizePhoneToE164(
  phone: string | null | undefined,
  defaultCountry = '20'
): string | null {
  if (!phone) return null;
  const trimmed = phone.trim();
  if (!trimmed) return null;

  // Strip spaces, dashes, parentheses, dots.
  const cleaned = trimmed.replace(/[\s\-().]/g, '');

  // Sanity check: only digits and optional leading +
  if (!/^\+?\d+$/.test(cleaned)) return null;

  if (cleaned.startsWith('+')) {
    return cleaned;
  }
  if (cleaned.startsWith('00')) {
    return '+' + cleaned.slice(2);
  }
  if (cleaned.startsWith('0')) {
    // Local format — prepend country code.
    return '+' + defaultCountry + cleaned.slice(1);
  }
  // Looks international without +.
  return '+' + cleaned;
}

/**
 * Validate a phone number is in E.164 format.
 * E.164: starts with +, followed by 6-15 digits, total length 7-16.
 */
export function isValidE164(phone: string | null | undefined): boolean {
  if (!phone) return false;
  return /^\+\d{6,15}$/.test(phone.trim());
}

/**
 * Validate the raw input (any format) is at least parseable.
 * Used in form validation BEFORE normalization.
 */
export function isParseablePhoneInput(input: string | null | undefined): boolean {
  if (!input) return false;
  const trimmed = input.trim();
  if (trimmed.length < 8 || trimmed.length > 20) return false;
  return /^[\d\s\-()+.]{8,20}$/.test(trimmed);
}

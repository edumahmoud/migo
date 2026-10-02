/**
 * Payment Gateway Core — Utility Functions
 *
 * Generic helpers used by adapters. NOT provider-specific —
 * any adapter (Paymob, Fawry, future) can use these.
 */

/**
 * Append `gateway_id` as a query parameter to a URL.
 * Used by adapters to build the notification_url so the webhook
 * can resolve the exact gateway config used at payment creation
 * (gateway snapshot — even if the default gateway changes later).
 *
 * If the URL already has query params, uses `&`. Otherwise uses `?`.
 *
 * @param url       The base notification URL
 * @param gatewayId  The resolved gateway's DB ID
 * @returns         The URL with `gateway_id` appended
 */
export function appendGatewayIdToUrl(url: string, gatewayId: string): string {
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}gateway_id=${gatewayId}`;
}

/**
 * Generate a short, human-readable payment code from an order UUID.
 *
 * The code is derived from the first 8 characters of the UUID (uppercase)
 * prefixed with "SUB-". This is unique enough for practical use (1 in
 * 4 billion combinations) and easy to share verbally or via chat.
 *
 * Example: order UUID "73998ea0-36a1-4e76-bdc8-6eb8ac2ebcf2" → "SUB-73998EA0"
 *
 * The full UUID is still the primary key in the database — this code is
 * for display + search only.
 *
 * @param orderId  The order UUID
 * @returns        The short payment code (e.g., "SUB-73998EA0")
 */
export function generatePaymentCode(orderId: string): string {
  if (!orderId || orderId.length < 8) {
    return 'SUB-UNKNOWN';
  }
  // Take the first 8 chars (before the first hyphen) and uppercase
  const shortId = orderId.replace(/-/g, '').slice(0, 8).toUpperCase();
  return `SUB-${shortId}`;
}

/**
 * Extract the order UUID from a payment code.
 *
 * Given a code like "SUB-73998EA0", this returns the regex pattern
 * to match order UUIDs that start with "73998ea0" (case-insensitive).
 *
 * Used by the search endpoint to find orders by their short code.
 *
 * @param code  The payment code (e.g., "SUB-73998EA0")
 * @returns     The 8-char prefix to match against order UUIDs (lowercase),
 *              or null if the code format is invalid
 */
export function parsePaymentCode(code: string): string | null {
  if (!code) return null;
  // Strip any leading "SUB-" or "sub-" prefix + whitespace
  const cleaned = code.trim().toUpperCase().replace(/^(SUB-?)/, '');
  // Must be 8 hex chars (matching the UUID format)
  if (!/^[0-9A-F]{8}$/.test(cleaned)) return null;
  return cleaned.toLowerCase();
}

/**
 * Generate a unique transaction code for a payout/settlement.
 *
 * Format: TX-YYYYMMDD-XXXX (e.g., "TX-20260930-A1B2")
 * - TX prefix (always)
 * - Date in YYYYMMDD format (compact, sortable)
 * - 4-char random alphanumeric suffix (uppercase)
 *
 * This is used by the settle + deliver-payment endpoints as the
 * `provider_reference` on the `teacher_payouts` record. It's
 * searchable via GET /api/transactions/search?code=TX-xxx
 *
 * @returns  A transaction code like "TX-20260930-A1B2"
 */
export function generateTransactionCode(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `TX-${yyyy}${mm}${dd}-${suffix}`;
}

/**
 * Parse a transaction code to get the date prefix for DB search.
 *
 * Given "TX-20260930-A1B2", returns "TX-20260930-" which can be
 * used in an ILIKE query: `ilike('provider_reference', 'TX-20260930-%')`
 *
 * If the code doesn't match the TX- format, returns the raw code
 * (for backward-compat with older STL-/PAY- format codes).
 *
 * @param code  The transaction code (e.g., "TX-20260930-A1B2" or "STL-xxx")
 * @returns     A search pattern for ILIKE, or null if empty
 */
export function parseTransactionCode(code: string): string | null {
  if (!code) return null;
  const trimmed = code.trim();
  // Normalize: uppercase, remove spaces
  const normalized = trimmed.toUpperCase().replace(/\s+/g, '');
  // Accept any of: TX-*, STL-*, PAY-*, PO-*
  if (/^(TX-|STL-|PAY-|PO-)/.test(normalized)) {
    return normalized;
  }
  return null;
}


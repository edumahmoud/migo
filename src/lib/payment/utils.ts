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


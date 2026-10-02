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

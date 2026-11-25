/**
 * Fawry Code (Reference Code) — Payment Provider Types
 *
 * Fawry has two integration patterns:
 *   - Fawry Pay (Redirect) — like Paymob
 *   - Fawry Code (Reference Code) — student gets a numeric code, pays at any
 *     Fawry machine/app (Aman, Masary, Fawry app, etc.), Fawry sends a webhook
 *
 * We implement Fawry Code (paymentMethod = 'PAYATFAWRY'). The student
 * doesn't leave the platform — they receive a 9-digit reference code in
 * the platform UI, then go pay at a Fawry machine within 24 hours.
 *
 * API endpoints (per Fawry's official docs):
 *   Charge  : POST https://www.atfawry.com/ECommerceWeb/Fawry/payments/charge
 *   Status  : GET  https://www.atfawry.com/ECommerceWeb/Fawry/payments/status/v2?...
 *   Webhook : POST to the URL we configured in Fawry Dashboard
 *
 * Signatures are plain SHA-256 with the secure key appended (see hmac.ts).
 *
 * IMPORTANT: Fawry's signature format expects the amount as the raw
 * decimal value (e.g., "100.00"), NOT as cents.
 */

// ─── Credentials (encrypted at rest in payment_gateways.credentials_encrypted) ───
export interface FawryCredentials {
  /** Merchant Code (public-ish — identifies the merchant in Fawry's system). */
  merchantCode: string;
  /** Security Key (SECRET — used for HMAC signatures). */
  securityKey: string;
}

// ─── Configuration (stored in payment_gateways.configuration_encrypted) ───
export interface FawryConfiguration {
  /** Webhook URL configured in Fawry Dashboard. (informational only) */
  webhookUrl?: string;
  /** 'true' to use Fawry's staging environment (test merchant code + key). */
  sandbox?: string | boolean;
  /** Redirect URL after payment (UX only — Fawry Code has no redirect). */
  redirectUrl?: string;
  /** Optional display URL (the merchant's brand page). */
  displayUrl?: string;
  /** Injected by the resolver — the gateway's DB ID. */
  gatewayId?: string;
}

// ─── Charge Request (POST /ECommerceWeb/Fawry/payments/charge) ───
export interface FawryChargeRequest {
  merchantCode: string;
  merchantRefNum: string;        // = our order UUID
  customerProfileId: string;
  customerMobile: string;
  customerEmail: string;
  amount: number;
  currencyCode: string;
  paymentMethod: 'PAYATFAWRY';
  description: string;
  paymentExpiry?: number;        // epoch ms
  chargeItems: Array<{
    itemId: string;
    description: string;
    price: number;
    quantity: number;
  }>;
  signature: string;             // SHA-256 hex (not HMAC)
}

// ─── Charge Response ───
export interface FawryChargeResponse {
  type?: string;
  referenceNumber?: string;      // THE REFERENCE CODE the student takes to the machine
  merchantRefNumber?: string;
  expirationTime?: number;
  statusCode: number;            // 200 = success
  statusDescription?: string;
}

// ─── Status Response (GET /payments/status/v2) ───
export interface FawryStatusResponse {
  statusCode: number;
  statusDescription?: string;
  merchantRefNumber?: string;
  fawryRefNumber?: string;
  paymentMethod?: string;
  paymentAmount?: number;
  orderAmount?: number;
  paymentStatus?: string;        // NEW | UNPAID | PAID | CANCELED | EXPIRED | REFUNDED | FAILED ...
}

// ─── Server Notification V2 (POST to our webhook) ───
export interface FawryCallbackPayload {
  requestId?: string;
  fawryRefNumber: string;
  merchantRefNumber: string;     // = our order UUID
  paymentAmount: number | string;
  orderAmount: number | string;
  fawryFees?: number | string;
  orderStatus: string;           // NEW | PAID | CANCELED | EXPIRED | REFUNDED | PARTIAL_REFUNDED | FAILED
  paymentMethod: string;
  paymentRefrenceNumber?: string; // sic
  orderExpiryDate?: number | string;
  messageSignature: string;      // SHA-256 hex
}

// ─── API base URLs ───
export const FAWRY_PROD_BASE = 'https://www.atfawry.com';
export const FAWRY_SANDBOX_BASE = 'https://atfawry.fawrystaging.com';
export const FAWRY_API_PATH = '/ECommerceWeb/Fawry/payments';
export function fawryBase(sandbox: boolean): string {
  return (sandbox ? FAWRY_SANDBOX_BASE : FAWRY_PROD_BASE) + FAWRY_API_PATH;
}

export const FAWRY_SUCCESS_CODE = 200;

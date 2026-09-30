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
 *   Charge  : POST https://www.atfawry.com/ECommerceWeb/Fawry/payments/api/v2/charge
 *   Status  : GET  https://www.atfawry.com/ECommerceWeb/Fawry/payments/api/v2/status?...
 *   Webhook : POST to the URL we configured in Fawry Dashboard
 *
 * The webhook is signed with HMAC-SHA256 using the merchant's securityKey.
 * Signature format (charge): merchantCode + merchantRefNum + customerProfileId
 *                            + paymentMethod + amount + securityKey
 * Signature format (webhook): merchantCode + merchantRefNum + paymentMethod
 *                              + paymentAmount (as string) + orderStatus + securityKey
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
  /** Redirect URL after payment (UX only — Fawry Code has no redirect). */
  redirectUrl?: string;
  /** Optional display URL (the merchant's brand page). */
  displayUrl?: string;
  /** Injected by the resolver — the gateway's DB ID. */
  gatewayId?: string;
}

// ─── Charge Request (POST /v2/charge) ───
export interface FawryChargeRequest {
  merchantCode: string;
  merchantRefNum: string;        // = our order UUID
  customerProfileId: string;     // = our student_id (or hashed version)
  customerMobile: string;
  customerEmail: string;
  amount: number;
  currencyCode: string;           // always 'EGP' for Fawry
  paymentMethod: 'PAYATFAWRY';   // Fawry Code mode
  description: string;
  chargeItems: Array<{
    itemId: string;
    description: string;
    price: number;
    quantity: number;
  }>;
  signature: string;            // HMAC-SHA256 hex
}

// ─── Charge Response ───
export interface FawryChargeResponse {
  statusCode: number;            // 200 = success, others = error
  statusDescription?: string;
  merchantRefNum?: string;
  fawryRefNumber?: string;       // ← THE REFERENCE CODE the student takes to the machine
  paymentMethod?: string;
  paymentStatus?: 'UNPAID' | 'PAID' | 'EXPIRED' | 'CANCELLED' | 'UNKNOWN';
  // Error fields
  errorCode?: string;
  errorMessage?: string;
}

// ─── Status Response (GET /v2/status) ───
export interface FawryStatusResponse {
  statusCode: number;
  statusDescription?: string;
  merchantRefNum?: string;
  fawryRefNumber?: string;
  paymentMethod?: string;
  paymentAmount?: number;
  paymentStatus?: 'UNPAID' | 'PAID' | 'EXPIRED' | 'CANCELLED' | 'UNKNOWN';
}

// ─── Webhook Callback ───
export interface FawryCallbackPayload {
  merchantCode: string;
  merchantRefNumber: string;     // = our order UUID
  fawryRefNumber: string;
  paymentMethod: string;
  paymentAmount: number;         // OR string — Fawry sometimes sends it as string
  orderExpiryDate?: string;
  paymentStatus: 'PAID' | 'EXPIRED' | 'CANCELLED' | 'UNKNOWN';
  signature: string;            // HMAC-SHA256 hex
}

// ─── API base URL ───
export const FAWRY_API_BASE = 'https://www.atfawry.com/ECommerceWeb/Fawry/payments/api/v2';

// ─── Fawry status codes ───
export const FAWRY_SUCCESS_CODE = 200;
export const FAWRY_ORDER_NOT_FOUND = 997; // used by testConnection

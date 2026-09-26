/**
 * Paymob Adapter — Credential + Configuration Types
 *
 * These types define the structure of the decrypted credentials
 * and configuration stored in the payment_gateways table.
 *
 * The adapter casts GatewayCredentials → PaymobCredentials
 * and GatewayConfiguration → PaymobConfiguration.
 *
 * These types are INTERNAL to the Paymob provider — never exported
 * to the application layer.
 */

// ─── Credentials (encrypted at rest in payment_gateways.credentials_encrypted) ───
export interface PaymobCredentials {
  /** Paymob Secret Key — used for API auth: `Authorization: Token <secretKey>` */
  secretKey: string;
  /** Paymob HMAC Secret — used for webhook callback signature verification */
  hmacSecret: string;
  /** Optional: integration IDs for specific payment methods (card, wallet, etc.) */
  integrationIds?: number[];
  /** Optional: public key (not used in backend flows) */
  publicKey?: string;
}

// ─── Configuration (encrypted at rest in payment_gateways.configuration_encrypted) ───
export interface PaymobConfiguration {
  /** The webhook URL Paymob will call after payment: must be publicly accessible */
  notificationUrl: string;
  /** URL to redirect the student to after checkout (for UX only — NOT payment truth) */
  redirectionUrl: string;
  /** Payment methods to enable (e.g., ['card', 'wallet']) — or use integrationIds in credentials */
  paymentMethods?: string[];
}

// ─── Paymob API response types (internal) ───
export interface PaymobIntentionResponse {
  id: string;                  // intention ID
  intention_order_id: string;  // Paymob's internal order ID
  client_secret: string;
  amount: number;              // in cents
  currency: string;
  special_reference?: string;
  payment_methods?: string[];
  items?: Array<{ name: string; amount: number; quantity: number }>;
  status?: string;
}

export interface PaymobCallbackPayload {
  type?: string;               // 'transaction' | 'intention' | ...
  obj?: Record<string, unknown>;  // the transaction/intention object
  hmac?: string;               // HMAC signature
}

// ─── Paymob callback obj fields used for HMAC computation ───
// These are the standard Paymob transaction callback fields.
// The HMAC is computed over these fields (sorted alphabetically,
// concatenated) using HMAC-SHA512.
export const PAYMOB_HMAC_FIELDS = [
  'amount_cents',
  'created_at',
  'currency',
  'error_occured',
  'has_parent_transaction',
  'id',
  'integration_id',
  'is_3D_secure_authentication',
  'is_refunded',
  'is_standalone_payment',
  'order',
  'owner',
  'pending',
  'source_data_pan',
  'source_data_sub_type',
  'source_data_type',
  'success',
] as const;

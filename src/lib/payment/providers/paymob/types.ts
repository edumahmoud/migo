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
  /**
   * Paymob API Key — used for Accept API auth:
   * POST /api/auth/tokens with {"api_key": "<secretKey>"}
   * Found in: Paymob Dashboard → Settings → API Keys
   */
  secretKey: string;
  /** Paymob HMAC Secret — used for webhook callback signature verification */
  hmacSecret: string;
  /**
   * Integration IDs — REQUIRED for the Accept API.
   * Found in: Paymob Dashboard → Payment Channels → Integrations
   * Used for: POST /api/acceptance/payment_keys (integration_id).
   *
   * NOTE: This is NOT the iframe ID. The iframe ID is a separate
   * value (see `iframeId` below). Using the integration ID in the
   * iframe URL causes "IFrame matching query does not exist" errors.
   */
  integrationIds?: number[];
  /**
   * Iframe ID — the ID of the hosted checkout iframe.
   * Found in: Paymob Dashboard → Payment Channels → Iframes (or
   *   Settings → Hosted Checkout).
   * Used for: iframe redirect URL (/api/acceptance/iframes/{iframeId}).
   *
   * If NOT set, the adapter falls back to integrationIds[0]. This
   * fallback works for some Paymob accounts where the integration
   * ID and iframe ID happen to be the same, but most accounts have
   * DIFFERENT IDs. Set this explicitly to avoid "IFrame matching
   * query does not exist" errors.
   */
  iframeId?: number;
  /**
   * Wallet Integration ID — REQUIRED if the student can pay via
   * mobile wallet (Vodafone Cash, Etisalat Cash, Orange Cash, etc.).
   *
   * In Paymob, EACH payment method has its OWN integration ID.
   * The card integration ID (integrationIds[0]) only enables cards.
   * To enable wallets, get a separate integration ID for wallets
   * from Paymob Dashboard → Payment Integrations → "Mobile Wallets"
   * integration.
   *
   * If NOT set, the student will only see the card payment option.
   */
  walletIntegrationId?: number;
  /**
   * Wallet Iframe ID — the iframe ID for the wallet checkout page.
   *
   * Each integration in Paymob has its own iframe ID. The card
   * iframeId above is for the card form. Wallets need a separate
   * iframe ID.
   *
   * If NOT set but walletIntegrationId IS set, the adapter falls
   * back to iframeId (works for some Paymob accounts where the
   * iframe ID is shared across integrations).
   */
  walletIframeId?: number;
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
  /**
   * The resolved gateway's DB ID — injected by PaymentService at runtime
   * (NOT stored in the database). Used to append `gateway_id` to the
   * notification_url so the webhook can resolve the correct gateway
   * (gateway snapshot — even if the default changes later).
   */
  gatewayId?: string;
}

// ─── Paymob callback payload (same for both Intention + Accept APIs) ───
export interface PaymobCallbackPayload {
  type?: string;               // 'transaction' | 'intention' | ...
  obj?: Record<string, unknown>;  // the transaction/intention object
  hmac?: string;               // HMAC signature
}

// ─── Paymob callback obj fields used for HMAC computation ───
// These are the standard Paymob transaction callback fields.
// The HMAC is computed over these fields (sorted alphabetically,
// concatenated) using HMAC-SHA512.
// SAME for both Intention API and Accept API — the callback format
// is identical.
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

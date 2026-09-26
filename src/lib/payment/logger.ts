/**
 * Payment Gateway Core — Safe Logger
 *
 * Logs payment operations WITHOUT ever exposing:
 *   - API keys / secret keys
 *   - HMAC secrets
 *   - Encrypted credentials
 *   - Full authorization headers
 *   - Credit card numbers
 *   - Customer PII beyond what's necessary for debugging
 *
 * What IS logged:
 *   - gateway provider
 *   - operation (createPayment, verifyPayment, etc.)
 *   - orderId (internal UUID)
 *   - paymentReference (gateway-side ID — not secret)
 *   - providerOrderReference (gateway-side order ID — not secret)
 *   - success/failure
 *   - error code (from PaymentErrorCode enum)
 *   - timestamp
 *
 * The logger uses console.info/console.warn/console.error under the
 * hood. In production, Vercel captures these as structured logs.
 */

export type PaymentLogLevel = 'info' | 'warn' | 'error';
export type PaymentOperation =
  | 'createPayment'
  | 'verifyPayment'
  | 'handleWebhook'
  | 'testConnection'
  | 'refundPayment'
  | 'resolveGateway'
  | 'gatewayManagement';

export interface PaymentLogEntry {
  timestamp: string;
  level: PaymentLogLevel;
  operation: PaymentOperation;
  provider?: string;
  orderId?: string;
  paymentReference?: string;
  providerOrderReference?: string;
  success: boolean;
  errorCode?: string;
  message?: string;
  // Duration in milliseconds (for performance monitoring)
  durationMs?: number;
}

/**
 * Log a payment event. This function is the ONLY approved way to
 * log payment-related data. It ensures no secrets leak.
 */
export function logPaymentEvent(entry: Omit<PaymentLogEntry, 'timestamp'>): void {
  const fullEntry: PaymentLogEntry = {
    ...entry,
    timestamp: new Date().toISOString(),
  };

  const prefix = `[payment:${entry.operation}]`;
  const parts: string[] = [];
  if (entry.provider) parts.push(`provider=${entry.provider}`);
  if (entry.orderId) parts.push(`orderId=${entry.orderId}`);
  if (entry.paymentReference) parts.push(`ref=${entry.paymentReference}`);
  if (entry.providerOrderReference) parts.push(`providerRef=${entry.providerOrderReference}`);
  parts.push(`success=${entry.success}`);
  if (entry.errorCode) parts.push(`error=${entry.errorCode}`);
  if (entry.durationMs !== undefined) parts.push(`duration=${entry.durationMs}ms`);
  if (entry.message) parts.push(`msg=${entry.message}`);

  const logLine = `${prefix} ${parts.join(' ')}`;

  switch (entry.level) {
    case 'info':
      console.info(logLine);
      break;
    case 'warn':
      console.warn(logLine);
      break;
    case 'error':
      console.error(logLine);
      break;
  }

  // Also emit the structured entry as a second console.info call
  // so log aggregators can parse it as JSON.
  // NOTE: fullEntry contains only the fields listed in PaymentLogEntry
  // — no secrets are present in this object.
  if (entry.level === 'error' || entry.level === 'warn') {
    console.info(JSON.stringify(fullEntry));
  }
}

/**
 * Student Payment Error Categorization
 *
 * Maps the unified PaymentError codes (from src/lib/payment/errors.ts)
 * to user-facing Arabic messages + an HTTP status code. The mapping is
 * SERVER-SIDE so the client receives only the safe, categorized message
 * — never the raw provider error or any secret.
 *
 * Used by:
 *   - /api/student/orders/[id]/pay (single-order Paymob initiation)
 *   - /api/student/checkout/sessions/[id]/pay (multi-subject Paymob initiation)
 *
 * The actual underlying error is logged server-side via logPaymentEvent
 * (which already strips secrets). The client only sees the category +
 * the safe Arabic message.
 */

import {
  PaymentError,
  PaymentErrorCode,
  isPaymentError,
} from '@/lib/payment/errors';

export type PaymentErrorCategory =
  | 'GATEWAY_NOT_CONFIGURED'        // No default gateway in DB
  | 'GATEWAY_DISABLED'              // Gateway exists but is_enabled=false
  | 'GATEWAY_NOT_IMPLEMENTED'      // Adapter not registered
  | 'CREDENTIALS_MISSING'          // Gateway row exists but no credentials
  | 'ENCRYPTION_KEY_MISSING'       // PAYMENT_CREDENTIALS_ENCRYPTION_KEY env var unset
  | 'GATEWAY_CONFIG_INVALID'       // Decryption failed (key changed, data corrupt)
  | 'PAYMOB_API_REJECTED'           // Paymob API returned non-2xx
  | 'PAYMOB_NETWORK_FAILURE'        // Could not reach Paymob API
  | 'PAYMOB_RESPONSE_INVALID'       // Paymob response missing required fields
  | 'STALE_ORDER'                   // Order.gateway_id points to deleted gateway
  | 'UNKNOWN'                       // Anything else

export interface CategorizedPaymentError {
  category: PaymentErrorCategory;
  /** Safe user-facing Arabic message (no secrets, no stack trace). */
  userMessageAr: string;
  /** HTTP status code to return to the client. */
  httpStatus: number;
  /** The original error code (for server-side logging only). */
  underlyingCode?: string;
}

/**
 * Map a thrown error (typically from PaymentService.createPayment)
 * to a categorized, safe user-facing response.
 *
 * Special case: if `orderGatewayId` is set AND the error is
 * `GatewayNotFoundError`, we treat it as `STALE_ORDER` — the
 * order was created with a gateway that no longer exists.
 */
export function categorizePaymentError(
  err: unknown,
  orderGatewayId?: string | null,
): CategorizedPaymentError {
  if (!isPaymentError(err)) {
    return {
      category: 'UNKNOWN',
      userMessageAr: 'تعذّر إتمام العملية. حاول مرة أخرى لاحقًا.',
      httpStatus: 500,
    };
  }

  const e = err as PaymentError;
  const code = e.code;

  switch (code) {
    case PaymentErrorCode.GatewayNotFound:
      // If order.gateway_id was set, the gateway was deleted → stale order
      if (orderGatewayId) {
        return {
          category: 'STALE_ORDER',
          userMessageAr:
            'هذا الطلب لم يعد صالحًا للدفع (بوابة الدفع الأصلية لم تعد متاحة). ' +
            'سنجهز لك طلبًا جديدًا. تواصل مع الدعم إذا استمرت المشكلة.',
          httpStatus: 409, // Conflict — order needs to be re-created
          underlyingCode: code,
        };
      }
      // No gateway_id set + no default gateway in DB → admin hasn't configured
      return {
        category: 'GATEWAY_NOT_CONFIGURED',
        userMessageAr:
          'بوابة الدفع غير مُهيّأة بعد. يرجى التواصل مع المسؤول لتفعيل بوابة الدفع.',
        httpStatus: 503, // Service Unavailable — admin action required
        underlyingCode: code,
      };

    case PaymentErrorCode.GatewayDisabled:
      return {
        category: 'GATEWAY_DISABLED',
        userMessageAr:
          'بوابة الدفع غير متاحة حاليًا. حاول مرة أخرى بعد قليل أو تواصل مع المسؤول.',
        httpStatus: 503,
        underlyingCode: code,
      };

    case PaymentErrorCode.GatewayNotImplemented:
      return {
        category: 'GATEWAY_NOT_IMPLEMENTED',
        userMessageAr:
          'بوابة الدفع المطلوبة غير مُنفّذة. تواصل مع المسؤول.',
        httpStatus: 503,
        underlyingCode: code,
      };

    case PaymentErrorCode.CredentialsMissing:
      return {
        category: 'CREDENTIALS_MISSING',
        userMessageAr:
          'بيانات اعتماد بوابة الدفع غير مُهيّأة. تواصل مع المسؤول.',
        httpStatus: 503,
        underlyingCode: code,
      };

    case PaymentErrorCode.EncryptionKeyMissing:
      return {
        category: 'ENCRYPTION_KEY_MISSING',
        userMessageAr:
          'إعداد تشفير بيانات الدفع غير مُهيّأ على الخادم. تواصل مع المسؤول.',
        httpStatus: 503,
        underlyingCode: code,
      };

    case PaymentErrorCode.GatewayConfigurationInvalid:
      // Decryption failed — encryption key changed or data corrupt
      return {
        category: 'GATEWAY_CONFIG_INVALID',
        userMessageAr:
          'تعذّر قراءة إعدادات بوابة الدفع. تواصل مع المسؤول لإعادة التهيئة.',
        httpStatus: 503,
        underlyingCode: code,
      };

    case PaymentErrorCode.PaymentCreationFailed:
      // Paymob API rejected the request OR network failure to Paymob.
      // The cause field may contain more info (stripped before reaching
      // the client). We surface a generic "Paymob rejected" message.
      // We can't distinguish API rejection vs network failure here
      // without inspecting the cause — but the cause may contain
      // provider data, so we don't trust it for branching.
      // Inspect the message to categorize the specific Paymob failure.
      // The message is safe (no provider data) — it's set by our own
      // client.ts, not by the raw Paymob response.
      if (e.message.includes('Failed to connect to Paymob API')) {
        return {
          category: 'PAYMOB_NETWORK_FAILURE',
          userMessageAr:
            'تعذّر الاتصال ببوابة الدفع. تحقق من اتصال الإنترنت وحاول مرة أخرى.',
          httpStatus: 502, // Bad Gateway — upstream network failure
          underlyingCode: code,
        };
      }
      if (e.message.includes('not valid JSON') || e.message.includes('returned a redirect')) {
        // Paymob returned a non-JSON response or a redirect — this is
        // typically caused by a wrong API key, account not having
        // Intention API access, or a Paymob-side issue. NOT a network
        // connectivity problem.
        return {
          category: 'PAYMOB_RESPONSE_INVALID',
          userMessageAr:
            'تعذّر تجهيز عملية الدفع. لم يتم خصم أي مبلغ. تحقق من إعدادات بوابة الدفع وحاول مرة أخرى.',
          httpStatus: 502,
          underlyingCode: code,
        };
      }
      if (e.message.includes('missing required fields')) {
        return {
          category: 'PAYMOB_RESPONSE_INVALID',
          userMessageAr:
            'تعذّر تجهيز عملية الدفع. لم يتم خصم أي مبلغ. حاول مرة أخرى لاحقًا.',
          httpStatus: 502,
          underlyingCode: code,
        };
      }
      return {
        category: 'PAYMOB_API_REJECTED',
        userMessageAr:
          'تعذّر تجهيز عملية الدفع. لم يتم خصم أي مبلغ. حاول مرة أخرى.',
        httpStatus: 502,
        underlyingCode: code,
      };

    case PaymentErrorCode.UnsupportedCapability:
    case PaymentErrorCode.PaymentVerificationFailed:
    case PaymentErrorCode.WebhookVerificationFailed:
    default:
      return {
        category: 'UNKNOWN',
        userMessageAr: 'تعذّر إتمام العملية. حاول مرة أخرى لاحقًا.',
        httpStatus: 500,
        underlyingCode: code,
      };
  }
}

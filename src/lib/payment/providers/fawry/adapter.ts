/**
 * Fawry Code (Reference Code) Adapter — implements PaymentGateway
 *
 * Fawry Code flow:
 *   1. Student initiates payment → adapter calls Fawry /v2/charge with
 *      paymentMethod='PAYATFAWRY'
 *   2. Fawry returns a fawryRefNumber (9-digit code) — displayed in the UI
 *   3. Student goes to a Fawry machine/app and pays cash within 24h
 *   4. Fawry sends a webhook to our /api/payment/webhook?provider=fawry
 *      with HMAC signature
 *   5. Webhook handler verifies the signature + maps paymentStatus → 'paid'
 *   6. The existing activate_subscription_after_payment RPC activates
 *      the order
 *
 * Authentication: HMAC-SHA256 with the merchant's securityKey.
 *
 * IMPORTANT: Fawry's amount is in MAJOR units (e.g., 100.00 EGP), NOT
 * cents. This is different from Paymob. The adapter converts from
 * our internal cents-equivalent to the decimal string Fawry expects.
 */

import type {
  PaymentGateway,
  GatewayCapabilities,
  CreatePaymentInput,
  CreatePaymentResult,
  VerifyPaymentInput,
  VerifyPaymentResult,
  WebhookInput,
  WebhookResult,
  GatewayConnectionTestResult,
  RefundInput,
  RefundResult,
  GatewayCredentials,
  GatewayConfiguration,
} from '../../types';
import type { FawryCredentials, FawryConfiguration, FawryCallbackPayload } from './types';
import { computeChargeSignature, computeStatusSignature, verifyWebhookSignature } from './hmac';
import { createCharge, getChargeStatus } from './client';
import { logPaymentEvent } from '../../logger';
const CAPABILITIES: GatewayCapabilities = {
  supportsRefund: false,
  supportsVerify: true,
  supportsWebhook: true,
  supportsTestConnection: true,
  supportsRedirectCheckout: false, // Fawry Code doesn't redirect the student
  supportsEmbeddedCheckout: false,
};

/**
 * Format a number as a decimal string with 2 decimal places.
 * Fawry expects "100.00" not "100" and not "10000" (not cents).
 */
function formatAmount(amount: number): string {
  return amount.toFixed(2);
}

/**
 * Map a Fawry paymentStatus string to our normalized PaymentStatus.
 */
function mapFawryStatus(status: string | undefined): 'pending' | 'paid' | 'failed' | 'cancelled' {
  switch (status?.toUpperCase()) {
    case 'PAID':
      return 'paid';
    case 'EXPIRED':
    case 'CANCELLED':
      return 'cancelled';
    case 'UNPAID':
    case 'UNKNOWN':
    default:
      return 'pending';
  }
}

export class FawryAdapter implements PaymentGateway {
  readonly provider = 'fawry';
  readonly capabilities = CAPABILITIES;

  /**
   * Create a Fawry reference-code payment.
   *
   * The student stays on our platform — they don't get redirected.
   * The result includes `paymentReference` (the fawryRefNumber) and
   * `metadata.referenceCode` for the UI to display.
   */
  async createPayment(
    input: CreatePaymentInput,
    credentials: GatewayCredentials,
    configuration: GatewayConfiguration,
  ): Promise<CreatePaymentResult> {
    const creds = credentials as unknown as FawryCredentials;
    if (!creds?.merchantCode || !creds?.securityKey) {
      logPaymentEvent({
        level: 'error',
        operation: 'createPayment',
        provider: 'fawry',
        orderId: input.orderId,
        success: false,
        errorCode: 'MISSING_CREDENTIALS',
        message: 'Fawry adapter called with missing merchantCode or securityKey',
      });
      return {
        success: false,
        provider: 'fawry',
        metadata: { errorCode: 'MISSING_CREDENTIALS', message: 'بيانات اعتماد فوري غير مكتملة — تحقق من إعدادات البوابة' },
      };
    }

    // Validate the phone number — Fawry requires a valid Egyptian mobile
    if (!input.customerPhone || input.customerPhone.length < 10) {
      logPaymentEvent({
        level: 'error',
        operation: 'createPayment',
        provider: 'fawry',
        orderId: input.orderId,
        success: false,
        errorCode: 'MISSING_CUSTOMER_PHONE',
        message: 'Fawry requires a customer mobile number (customerMobile)',
      });
      return {
        success: false,
        provider: 'fawry',
        metadata: { errorCode: 'MISSING_CUSTOMER_PHONE', message: 'فوري يحتاج رقم هاتف الطالب — اتأكد إنه مكتمل في الملف الشخصي' },
      };
    }

    const amountStr = formatAmount(input.amount);
    const merchantRefNum = input.orderId; // our order UUID doubles as Fawry's merchantRefNum
    const customerProfileId = input.orderId; // reuse — we don't have a separate Fawry customer ID

    const signature = computeChargeSignature(
      {
        merchantCode: creds.merchantCode,
        merchantRefNum,
        customerProfileId,
        paymentMethod: 'PAYATFAWRY',
        amount: amountStr,
      },
      creds.securityKey,
    );

    const chargeReq = {
      merchantCode: creds.merchantCode,
      merchantRefNum,
      customerProfileId,
      customerMobile: input.customerPhone,
      customerEmail: input.customerEmail || 'student@attendo.local',
      amount: input.amount,
      currencyCode: input.currency || 'EGP',
      paymentMethod: 'PAYATFAWRY' as const,
      description: input.description || 'Attendo subscription',
      chargeItems: [
        {
          itemId: input.orderId.slice(0, 8),
          description: input.description || 'Course subscription',
          price: input.amount,
          quantity: 1,
        },
      ],
      signature,
    };

    const startTime = Date.now();
    const response = await createCharge(chargeReq);

    if (response.statusCode !== 200 || !response.fawryRefNumber) {
      logPaymentEvent({
        level: 'error',
        operation: 'createPayment',
        provider: 'fawry',
        orderId: input.orderId,
        success: false,
        errorCode: response.errorCode || `FAWRY_${response.statusCode}`,
        message: `Fawry charge failed: ${response.statusDescription ?? response.errorMessage ?? 'unknown'}`,
        durationMs: Date.now() - startTime,
      });
      return {
        success: false,
        provider: 'fawry',
        metadata: { errorCode: response.errorCode || `FAWRY_${response.statusCode}`, message: `فشل في إنشاء كود فوري: ${response.statusDescription ?? response.errorMessage ?? 'خطأ غير معروف'}` },
      };
    }

    logPaymentEvent({
      level: 'info',
      operation: 'createPayment',
      provider: 'fawry',
      orderId: input.orderId,
      success: true,
      paymentReference: response.fawryRefNumber,
      message: `Fawry reference code generated: ${response.fawryRefNumber}`,
      durationMs: Date.now() - startTime,
    });

    return {
      success: true,
      provider: 'fawry',
      paymentReference: response.fawryRefNumber,
      providerOrderReference: merchantRefNum,
      // Fawry Code has NO checkout URL — the student stays on our platform.
      // The UI displays the reference code prominently.
      checkoutUrl: undefined,
      metadata: {
        referenceCode: response.fawryRefNumber,
        paymentMethod: 'PAYATFAWRY',
        paymentStatus: response.paymentStatus ?? 'UNPAID',
        // Instructions for the UI to display:
        instructions: 'خذ كود الدفع ده لاقرب ماكينة فوري أو تطبيق فوري وادفع المبلغ خلال 24 ساعة',
      },
    };
  }

  /**
   * Verify a Fawry charge status by merchantRefNum.
   *
   * Used by the UI polling loop (after the student has the code but
   * before the webhook arrives — could be minutes to hours).
   */
  async verifyPayment(
    input: VerifyPaymentInput,
    credentials: GatewayCredentials,
    _configuration: GatewayConfiguration,
  ): Promise<VerifyPaymentResult> {
    const creds = credentials as unknown as FawryCredentials;
    if (!creds?.merchantCode || !creds?.securityKey) {
      return {
        success: false,
        status: 'pending',
        amount: 0,
        currency: 'EGP',
        metadata: { errorCode: 'MISSING_CREDENTIALS', message: 'بيانات اعتماد فوري غير مكتملة' },
      };
    }

    // For Fawry, paymentReference is our order UUID (merchantRefNum)
    const merchantRefNum = input.paymentReference;
    const signature = computeStatusSignature(
      creds.merchantCode,
      merchantRefNum,
      creds.securityKey,
    );

    const startTime = Date.now();
    const response = await getChargeStatus(
      creds.merchantCode,
      merchantRefNum,
      signature,
    );

    if (response.statusCode !== 200) {
      logPaymentEvent({
        level: 'warn',
        operation: 'verifyPayment',
        provider: 'fawry',
        paymentReference: merchantRefNum,
        success: false,
        message: `Fawry status lookup failed: ${response.statusDescription ?? 'unknown'}`,
        durationMs: Date.now() - startTime,
      });
      return {
        success: false,
        status: 'pending',
        amount: 0,
        currency: 'EGP',
        metadata: { message: response.statusDescription ?? 'فشل في الاستعلام عن الحالة' },
      };
    }

    const mapped = mapFawryStatus(response.paymentStatus);

    return {
      success: true,
      status: mapped,
      amount: response.paymentAmount ?? 0,
      currency: 'EGP',
      providerTransactionId: response.fawryRefNumber,
      metadata: { paymentStatus: response.paymentStatus, merchantRefNum },
    };
  }

  /**
   * Handle a Fawry webhook callback.
   *
   * Verifies the HMAC signature, then extracts the merchantRefNumber
   * (our order UUID) and the payment status.
   */
  async handleWebhook(
    input: WebhookInput,
    credentials: GatewayCredentials,
    _configuration: GatewayConfiguration,
  ): Promise<WebhookResult> {
    const creds = credentials as unknown as FawryCredentials;
    if (!creds?.securityKey) {
      logPaymentEvent({
        level: 'error',
        operation: 'handleWebhook',
        provider: 'fawry',
        success: false,
        errorCode: 'MISSING_CREDENTIALS',
        message: 'Fawry webhook received but securityKey is missing in gateway config',
      });
      return {
        success: false,
        provider: 'fawry',
        status: 'pending',
        metadata: { message: 'securityKey غير موجود في إعدادات البوابة' },
      };
    }

    let payload: FawryCallbackPayload;
    try {
      payload = JSON.parse(input.rawBody) as FawryCallbackPayload;
    } catch {
      logPaymentEvent({
        level: 'error',
        operation: 'handleWebhook',
        provider: 'fawry',
        success: false,
        errorCode: 'INVALID_JSON',
        message: 'Fawry webhook body is not valid JSON',
      });
      return {
        success: false,
        provider: 'fawry',
        status: 'pending',
        metadata: { message: 'Invalid JSON body' },
      };
    }

    // Verify HMAC signature
    const isVerified = verifyWebhookSignature(
      {
        merchantCode: payload.merchantCode,
        merchantRefNumber: payload.merchantRefNumber,
        paymentMethod: payload.paymentMethod,
        paymentAmount: payload.paymentAmount,
        paymentStatus: payload.paymentStatus,
        signature: payload.signature,
      },
      creds.securityKey,
    );

    if (!isVerified) {
      logPaymentEvent({
        level: 'error',
        operation: 'handleWebhook',
        provider: 'fawry',
        success: false,
        errorCode: 'WEBHOOK_VERIFICATION_FAILED',
        message: `Fawry webhook signature mismatch for merchantRefNumber=${payload.merchantRefNumber}`,
      });
      return {
        success: false,
        provider: 'fawry',
        orderId: payload.merchantRefNumber,
        status: 'pending',
        metadata: { message: 'HMAC signature mismatch' },
      };
    }

    const mapped = mapFawryStatus(payload.paymentStatus);

    logPaymentEvent({
      level: 'info',
      operation: 'handleWebhook',
      provider: 'fawry',
      success: true,
      orderId: payload.merchantRefNumber,
      paymentReference: payload.fawryRefNumber,
      message: `Fawry webhook verified — status=${mapped} amount=${payload.paymentAmount}`,
    });

    return {
      success: true,
      provider: 'fawry',
      orderId: payload.merchantRefNumber, // our order UUID
      status: mapped,
      amount: typeof payload.paymentAmount === 'number' ? payload.paymentAmount : Number(payload.paymentAmount),
      currency: 'EGP',
      paymentReference: payload.fawryRefNumber,
      providerTransactionId: payload.fawryRefNumber,
      metadata: {
        fawryRefNumber: payload.fawryRefNumber,
        paymentMethod: payload.paymentMethod,
        orderExpiryDate: payload.orderExpiryDate,
      },
    };
  }

  /**
   * Test Fawry connection — perform a status lookup on a non-existent
   * merchantRefNum. Fawry will return 997 ("Order not found") if the
   * credentials are valid; any other error means the creds are wrong
   * or the network is broken.
   */
  async testConnection(
    credentials: GatewayCredentials,
    _configuration: GatewayConfiguration,
  ): Promise<GatewayConnectionTestResult> {
    const creds = credentials as unknown as FawryCredentials;
    if (!creds?.merchantCode || !creds?.securityKey) {
      return {
        success: false,
        provider: 'fawry',
        message: 'بيانات الاعتماد غير مكتملة',
        testedAt: new Date().toISOString(),
      };
    }

    // Use a dummy UUID as merchantRefNum
    const dummyRef = '00000000-0000-0000-0000-000000000000';
    const signature = computeStatusSignature(
      creds.merchantCode,
      dummyRef,
      creds.securityKey,
    );

    const response = await getChargeStatus(
      creds.merchantCode,
      dummyRef,
      signature,
    );

    // 997 = order not found (expected for a dummy ref) → creds work
    if (response.statusCode === 997 || response.statusCode === 200) {
      return {
        success: true,
        provider: 'fawry',
        message: 'تم الاتصال بفوري بنجاح',
        testedAt: new Date().toISOString(),
      };
    }

    return {
      success: false,
      provider: 'fawry',
      message: `فشل الاتصال: ${response.statusDescription ?? response.statusCode}`,
      testedAt: new Date().toISOString(),
    };
  }

  // Fawry does not support automated refunds via API. Refunds are
  // manual (the merchant refunds the student in cash).
  async refundPayment(
    _input: RefundInput,
    _credentials: GatewayCredentials,
    _configuration: GatewayConfiguration,
  ): Promise<RefundResult> {
    return {
      success: false,
      amount: _input.amount,
      status: 'failed',
      metadata: { message: 'فوري لا يدعم الاسترداد التلقائي — يُرجع المبلغ يدوياً للطالب' },
    };
  }
}

export const fawryAdapter = new FawryAdapter();

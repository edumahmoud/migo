/**
 * Payment Gateway Core — Unified Error System
 *
 * All payment-layer errors extend PaymentError. Provider-specific
 * error formats are mapped to these unified errors inside each
 * adapter — they never leak to the application layer.
 *
 * The `toJSON()` method strips the `cause` field (which may contain
 * provider-specific data) to prevent information leakage in API
 * responses.
 */

export enum PaymentErrorCode {
  GatewayNotFound = 'GATEWAY_NOT_FOUND',
  GatewayDisabled = 'GATEWAY_DISABLED',
  GatewayNotImplemented = 'GATEWAY_NOT_IMPLEMENTED',
  GatewayConfigurationInvalid = 'GATEWAY_CONFIGURATION_INVALID',
  PaymentCreationFailed = 'PAYMENT_CREATION_FAILED',
  PaymentVerificationFailed = 'PAYMENT_VERIFICATION_FAILED',
  WebhookVerificationFailed = 'WEBHOOK_VERIFICATION_FAILED',
  UnsupportedCapability = 'UNSUPPORTED_CAPABILITY',
  CredentialsMissing = 'CREDENTIALS_MISSING',
  EncryptionKeyMissing = 'ENCRYPTION_KEY_MISSING',
}

export class PaymentError extends Error {
  constructor(
    public readonly code: PaymentErrorCode,
    message: string,
    public readonly provider?: string,
    // `cause` is intentionally NOT exposed in toJSON() — it may
    // contain provider-specific data that shouldn't leak to the
    // client or logs.
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = this.constructor.name;
    // Preserve stack trace in V8
    if (typeof Error.captureStackTrace === 'function') {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  /**
   * Safe serialization for API responses + logs.
   * Excludes `cause` (may contain provider data).
   */
  toJSON(): Record<string, unknown> {
    return {
      code: this.code,
      message: this.message,
      provider: this.provider ?? null,
    };
  }
}

// ─── Specific error subclasses for each code ───

export class GatewayNotFoundError extends PaymentError {
  constructor(provider?: string) {
    super(
      PaymentErrorCode.GatewayNotFound,
      `Payment gateway not found${provider ? `: ${provider}` : ''}`,
      provider,
    );
  }
}

export class GatewayDisabledError extends PaymentError {
  constructor(provider: string) {
    super(
      PaymentErrorCode.GatewayDisabled,
      `Payment gateway '${provider}' is disabled`,
      provider,
    );
  }
}

export class GatewayNotImplementedError extends PaymentError {
  constructor(provider: string) {
    super(
      PaymentErrorCode.GatewayNotImplemented,
      `Payment gateway '${provider}' is configured but no adapter is implemented`,
      provider,
    );
  }
}

export class GatewayConfigurationInvalidError extends PaymentError {
  constructor(provider: string, detail?: string) {
    super(
      PaymentErrorCode.GatewayConfigurationInvalid,
      `Configuration for gateway '${provider}' is invalid${detail ? `: ${detail}` : ''}`,
      provider,
    );
  }
}

export class PaymentCreationFailedError extends PaymentError {
  constructor(provider: string, detail?: string, cause?: unknown) {
    super(
      PaymentErrorCode.PaymentCreationFailed,
      `Failed to create payment via '${provider}'${detail ? `: ${detail}` : ''}`,
      provider,
      cause,
    );
  }
}

export class PaymentVerificationFailedError extends PaymentError {
  constructor(provider: string, detail?: string, cause?: unknown) {
    super(
      PaymentErrorCode.PaymentVerificationFailed,
      `Failed to verify payment via '${provider}'${detail ? `: ${detail}` : ''}`,
      provider,
      cause,
    );
  }
}

export class WebhookVerificationFailedError extends PaymentError {
  constructor(provider: string, detail?: string, cause?: unknown) {
    super(
      PaymentErrorCode.WebhookVerificationFailed,
      `Webhook verification failed for '${provider}'${detail ? `: ${detail}` : ''}`,
      provider,
      cause,
    );
  }
}

export class UnsupportedCapabilityError extends PaymentError {
  constructor(provider: string, capability: string) {
    super(
      PaymentErrorCode.UnsupportedCapability,
      `Gateway '${provider}' does not support capability '${capability}'`,
      provider,
    );
  }
}

export class CredentialsMissingError extends PaymentError {
  constructor(provider: string) {
    super(
      PaymentErrorCode.CredentialsMissing,
      `No credentials configured for gateway '${provider}'`,
      provider,
    );
  }
}

export class EncryptionKeyMissingError extends PaymentError {
  constructor() {
    super(
      PaymentErrorCode.EncryptionKeyMissing,
      'PAYMENT_CREDENTIALS_ENCRYPTION_KEY is not set in the environment',
    );
  }
}

/**
 * Check if an error is a PaymentError.
 */
export function isPaymentError(err: unknown): err is PaymentError {
  return err instanceof PaymentError;
}

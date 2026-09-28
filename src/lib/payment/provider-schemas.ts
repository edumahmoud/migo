/**
 * Provider Configuration Schemas
 *
 * Defines what credential + configuration fields each payment provider
 * needs. The admin UI reads from this to render forms dynamically.
 *
 * Adding a new provider (e.g., Fawry) only requires adding a new
 * entry to the schemas map — no UI or API changes needed.
 */

export interface ProviderFieldSchema {
  name: string;
  label: string;
  type: 'text' | 'password' | 'number' | 'array';
  required: boolean;
  placeholder?: string;
  helpText?: string;
}

export interface ProviderSchema {
  provider: string;
  displayName: string;
  credentialFields: ProviderFieldSchema[];
  configurationFields: ProviderFieldSchema[];
}

const schemas = new Map<string, ProviderSchema>();

// ─── Paymob schema ───
schemas.set('paymob', {
  provider: 'paymob',
  displayName: 'Paymob',
  credentialFields: [
    { name: 'secretKey', label: 'API Key', type: 'password', required: true, placeholder: 'Paymob Dashboard → Settings → API Keys', helpText: 'مفتاح API من لوحة تحكم Paymob' },
    { name: 'hmacSecret', label: 'HMAC Secret', type: 'password', required: true, placeholder: 'Paymob Dashboard → Settings → Webhooks → HMAC', helpText: 'سر HMAC من إعدادات Webhooks' },
    { name: 'integrationIds', label: 'Card Integration IDs', type: 'array', required: true, placeholder: '123456', helpText: '⚠️ معرّف تكامل الكروت (Visa/Mastercard) من Paymob Dashboard → Payment Integrations → Online Card integration (يُستخدم في طلب payment_keys للكروت)' },
    { name: 'iframeId', label: 'Card Iframe ID', type: 'number', required: true, placeholder: '789012', helpText: '⚠️ مختلف عن Integration ID! معرّف صفحة الدفع بالكروت المستضافة من Paymob Dashboard → Iframes (بدونه يظهر خطأ "IFrame matching query does not exist")' },
    { name: 'walletIntegrationId', label: 'Wallet Integration ID', type: 'number', required: false, placeholder: '345678', helpText: 'اختياري: معرّف تكامل محفظة الموبايل (Vodafone Cash, Etisalat Cash, إلخ) من Paymob Dashboard → Payment Integrations → Mobile Wallets. اتركه فارغًا لو مش عايز تقبل محافظ. لو مُدخل، الطالب هيقدر يختار الدفع بمحفظة بدل الكارت.' },
    { name: 'walletIframeId', label: 'Wallet Iframe ID', type: 'number', required: false, placeholder: '789013', helpText: 'اختياري: معرّف صفحة الدفع بمحفظة الموبايل. اتركه فارغًا لو كان نفس معرّف الـ Card Iframe (بعض حسابات Paymob بتشارك الـ iframe).' },
  ],
  configurationFields: [
    { name: 'notificationUrl', label: 'Webhook URL', type: 'text', required: true, placeholder: 'https://your-domain.com/api/payment/webhook?provider=paymob', helpText: 'رابط استقبال webhook (يجب أن يكون متاحًا للعموم)' },
    { name: 'redirectionUrl', label: 'Redirect URL (after checkout)', type: 'text', required: true, placeholder: 'https://your-domain.com/?payment_callback=success', helpText: 'رابط تحويل الطالب بعد إتمام الدفع' },
    { name: 'paymentMethods', label: 'Payment Methods', type: 'array', required: false, placeholder: '', helpText: 'اختياري — يُترك فارغًا عادةً (الـ Integration ID يحدد وسيلة الدفع)' },
  ],
});

export function getProviderSchema(provider: string): ProviderSchema | null {
  return schemas.get(provider) ?? null;
}

export function listProviderSchemas(): ProviderSchema[] {
  return Array.from(schemas.values());
}

export function registerProviderSchema(schema: ProviderSchema): void {
  schemas.set(schema.provider, schema);
}

/**
 * Validate that all required credential fields are present and non-empty.
 *
 * Returns an array of missing field LABELS (human-readable names).
 * Returns an empty array if all required fields are satisfied.
 *
 * This is GENERIC — works for any provider's schema.
 * Does NOT check field VALUES beyond emptiness (type validation is
 * the adapter's job via castCredentials).
 *
 * @param schema       The provider's schema
 * @param credentials  The credentials object to validate (may be undefined)
 * @returns            Array of missing field labels (empty = valid)
 */
export function validateRequiredCredentialFields(
  schema: ProviderSchema,
  credentials: Record<string, unknown> | undefined,
): string[] {
  const missing: string[] = [];
  for (const field of schema.credentialFields) {
    if (!field.required) continue;
    const value = credentials?.[field.name];
    if (value === undefined || value === null) {
      missing.push(field.label);
    } else if (typeof value === 'string' && value.trim() === '') {
      missing.push(field.label);
    } else if (Array.isArray(value) && value.length === 0) {
      missing.push(field.label);
    }
  }
  return missing;
}

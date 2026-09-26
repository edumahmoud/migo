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
    { name: 'secretKey', label: 'Secret Key', type: 'password', required: true, placeholder: 'sk_test_... or sk_live_...' },
    { name: 'hmacSecret', label: 'HMAC Secret', type: 'password', required: true, placeholder: 'From Paymob Dashboard → Settings → HMAC' },
    { name: 'integrationIds', label: 'Integration IDs', type: 'array', required: false, placeholder: '123456, 789012', helpText: 'Comma-separated Paymob integration IDs for specific payment methods' },
  ],
  configurationFields: [
    { name: 'notificationUrl', label: 'Webhook URL', type: 'text', required: true, placeholder: 'https://your-domain.com/api/payment/webhook?provider=paymob' },
    { name: 'redirectionUrl', label: 'Redirect URL (after checkout)', type: 'text', required: true, placeholder: 'https://your-domain.com/?payment_callback=success' },
    { name: 'paymentMethods', label: 'Payment Methods', type: 'array', required: false, placeholder: 'card, wallet', helpText: 'Comma-separated payment methods (leave empty to use integration IDs)' },
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

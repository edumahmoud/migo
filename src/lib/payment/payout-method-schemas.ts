/**
 * Payout Method Schemas — Phase 11
 *
 * Defines what fields each mobile wallet provider needs. Mirrors
 * the design of provider-schemas.ts (used for payment gateways).
 *
 * Phase 11 supports ONLY 4 Egyptian mobile wallets:
 *   - vodafone_cash
 *   - etisalat_cash
 *   - orange_cash
 *   - we_cash
 *
 * bank_account, instapay, fawry, etc. are explicitly OUT OF SCOPE
 * for Phase 11 (deferred to Phase 13).
 *
 * Each wallet has the same required fields:
 *   - wallet_number (Egyptian mobile: 11 digits, starts with 010/011/012/015)
 *   - holder_name   (the wallet holder's full name)
 *
 * Validation happens Server-Side (the regex here is enforced in the
 * API route, NOT in the frontend). The frontend may ALSO use the
 * pattern for inline UX feedback, but the server is the authority.
 */

export interface PayoutMethodFieldSchema {
  name: string;
  label: string;
  type: 'text' | 'password' | 'number';
  required: boolean;
  placeholder?: string;
  pattern?: string; // regex string for validation
  helpText?: string;
  maxLength?: number;
}

export interface PayoutMethodSchema {
  methodType: string;
  displayName: string; // localized display name (key into i18n)
  fields: PayoutMethodFieldSchema[];
}

// ─── Egyptian mobile wallet regex ───
// 11 digits starting with 010, 011, 012, or 015 (the four
// Egyptian mobile prefixes — Vodafone/Etisalat/Orange/WE).
export const EGYPTIAN_MOBILE_REGEX = /^01[0125][0-9]{8}$/;

const schemas = new Map<string, PayoutMethodSchema>();

// ─── Vodafone Cash ───
schemas.set('vodafone_cash', {
  methodType: 'vodafone_cash',
  displayName: 'فودافون كاش',
  fields: [
    {
      name: 'wallet_number',
      label: 'رقم المحفظة',
      type: 'text',
      required: true,
      pattern: EGYPTIAN_MOBILE_REGEX.source,
      maxLength: 11,
      placeholder: '01012345678',
      helpText: '11 رقم يبدأ بـ 010 / 011 / 012 / 015',
    },
    {
      name: 'holder_name',
      label: 'اسم صاحب المحفظة',
      type: 'text',
      required: true,
      placeholder: 'محمود أحمد',
      maxLength: 100,
      helpText: 'يجب أن يطابق الاسم المسجل على المحفظة',
    },
  ],
});

// ─── Etisalat Cash ───
schemas.set('etisalat_cash', {
  methodType: 'etisalat_cash',
  displayName: 'اتصالات كاش',
  fields: [
    {
      name: 'wallet_number',
      label: 'رقم المحفظة',
      type: 'text',
      required: true,
      pattern: EGYPTIAN_MOBILE_REGEX.source,
      maxLength: 11,
      placeholder: '01112345678',
      helpText: '11 رقم يبدأ بـ 010 / 011 / 012 / 015',
    },
    {
      name: 'holder_name',
      label: 'اسم صاحب المحفظة',
      type: 'text',
      required: true,
      placeholder: 'محمود أحمد',
      maxLength: 100,
      helpText: 'يجب أن يطابق الاسم المسجل على المحفظة',
    },
  ],
});

// ─── Orange Cash ───
schemas.set('orange_cash', {
  methodType: 'orange_cash',
  displayName: 'اورانج كاش',
  fields: [
    {
      name: 'wallet_number',
      label: 'رقم المحفظة',
      type: 'text',
      required: true,
      pattern: EGYPTIAN_MOBILE_REGEX.source,
      maxLength: 11,
      placeholder: '01212345678',
      helpText: '11 رقم يبدأ بـ 010 / 011 / 012 / 015',
    },
    {
      name: 'holder_name',
      label: 'اسم صاحب المحفظة',
      type: 'text',
      required: true,
      placeholder: 'محمود أحمد',
      maxLength: 100,
      helpText: 'يجب أن يطابق الاسم المسجل على المحفظة',
    },
  ],
});

// ─── WE Cash ───
schemas.set('we_cash', {
  methodType: 'we_cash',
  displayName: 'وي كاش',
  fields: [
    {
      name: 'wallet_number',
      label: 'رقم المحفظة',
      type: 'text',
      required: true,
      pattern: EGYPTIAN_MOBILE_REGEX.source,
      maxLength: 11,
      placeholder: '01512345678',
      helpText: '11 رقم يبدأ بـ 010 / 011 / 012 / 015',
    },
    {
      name: 'holder_name',
      label: 'اسم صاحب المحفظة',
      type: 'text',
      required: true,
      placeholder: 'محمود أحمد',
      maxLength: 100,
      helpText: 'يجب أن يطابق الاسم المسجل على المحفظة',
    },
  ],
});

/**
 * Get the schema for a payout method type.
 * Returns null if the type is not supported (defense in depth —
 * the DB CHECK constraint also rejects unknown types).
 */
export function getPayoutMethodSchema(methodType: string): PayoutMethodSchema | null {
  return schemas.get(methodType) ?? null;
}

/**
 * List all supported payout method schemas (for the providers API).
 */
export function listPayoutMethodSchemas(): PayoutMethodSchema[] {
  return Array.from(schemas.values());
}

/**
 * Validate a payout method's details against its schema.
 * Returns an array of missing/invalid field labels (empty = valid).
 *
 * This is SERVER-SIDE validation. The frontend MAY also use the
 * schema's `pattern` for UX feedback, but the server is authoritative.
 *
 * Validation rules:
 *   - All required fields must be present and non-empty.
 *   - wallet_number must match the Egyptian mobile regex.
 *   - holder_name must be at least 2 chars.
 *
 * @param schema       The payout method's schema
 * @param details      The details object to validate
 * @returns            Array of error messages (empty = valid)
 */
export function validatePayoutMethodDetails(
  schema: PayoutMethodSchema,
  details: Record<string, unknown> | undefined
): string[] {
  const errors: string[] = [];

  if (!details) {
    return ['البيانات مفقودة'];
  }

  // Check each field's required + pattern rules
  for (const field of schema.fields) {
    if (!field.required) continue;
    const value = details[field.name];
    if (value === undefined || value === null || String(value).trim() === '') {
      errors.push(`${field.label}: مطلوب`);
      continue;
    }
    // Regex validation
    if (field.pattern && typeof value === 'string') {
      const regex = new RegExp(`^${field.pattern}$`);
      if (!regex.test(value)) {
        errors.push(`${field.label}: الصيغة غير صحيحة`);
      }
    }
    // Max length
    if (field.maxLength && typeof value === 'string' && value.length > field.maxLength) {
      errors.push(`${field.label}: يتجاوز الحد الأقصى للطول (${field.maxLength})`);
    }
  }

  // Additional sanity check on holder_name (min 2 chars)
  const holderName = details.holder_name;
  if (typeof holderName === 'string' && holderName.trim().length > 0 && holderName.trim().length < 2) {
    errors.push('اسم صاحب المحفظة: قصير جدًا');
  }

  return errors;
}

/**
 * Check if a method type is supported (used by the API to reject
 * unknown types before hitting the DB CHECK constraint).
 */
export function isSupportedPayoutMethodType(methodType: string): boolean {
  return schemas.has(methodType);
}

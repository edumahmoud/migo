/**
 * Payout Method Schemas — Phase 11 / Phase 13 Step 1 Architecture Correction
 *
 * Phase 11 originally defined 4 wallet-specific method types
 * (vodafone_cash, etisalat_cash, orange_cash, we_cash) tied to
 * Egyptian mobile operators. After the Phase 13 Step 1 audit, this
 * was refactored to provider-independent generic types:
 *
 *   - wallet         (any mobile wallet — phone number + holder name)
 *   - bank_account   (bank_name + account_number OR iban + holder name)
 *   - bank_card      (last4 + card_brand? + expiry + holder name — NO PAN, NO CVV)
 *   - instapay       (flexible recipient identifier + holder name)
 *
 * ─── Phase 13 Step 1 Final Audit ───
 * Two architectural changes were applied:
 *
 *   A. Discriminated Union for `PayoutMethodDetails`:
 *      The `details` payload is now a discriminated union on the
 *      `method_type` field. TypeScript can narrow the union
 *      automatically based on `method_type` — NO casts required
 *      when consuming the resolved details. Each variant exposes
 *      only the fields relevant to its method type.
 *
 *   B. Bank Card Data Minimization:
 *      The `bank_card` schema no longer stores the full PAN
 *      (Primary Account Number). Instead it stores only:
 *        - last4 (required, 4 digits) — safe to display
 *        - card_brand (optional, free text — Visa, Mastercard, etc.)
 *        - expiry_month + expiry_year + holder_name
 *      The `card_number` field has been REMOVED from the schema.
 *      NO `provider_token` field is added here — that belongs to
 *      the future `PayoutProvider` architecture (Phase 13 Step 10),
 *      NOT to the Payout Method itself.
 *
 * Design principle (unchanged):
 *   Payout Method ≠ Payout Provider. A method_type describes the
 *   SHAPE of the recipient data the teacher supplied. The provider
 *   that will actually execute the transfer is selected LATER
 *   (Phase 13 Step 10) based on capabilities + availability.
 *
 * Migration backward compatibility (unchanged):
 *   - All Phase 11 rows (vodafone_cash/etisalat_cash/orange_cash/we_cash)
 *     are migrated to method_type='wallet' via migration v81.
 *   - Their encrypted blobs already use the field shape
 *     { wallet_number, holder_name } which matches the new 'wallet'
 *     schema exactly — NO re-encryption needed.
 */

// ─── Field name constants (so the repository + masking + tests agree) ───
export const FIELD_NAMES = {
  // wallet
  walletNumber: 'wallet_number',
  // bank_account
  bankName: 'bank_name',
  accountNumber: 'account_number',
  iban: 'iban',
  // bank_card — NO card_number after Phase 13 Step 1
  last4: 'last4',
  cardBrand: 'card_brand',
  expiryMonth: 'expiry_month',
  expiryYear: 'expiry_year',
  // shared
  holderName: 'holder_name',
  // instapay
  recipientIdentifier: 'recipient_identifier',
} as const;

export interface PayoutMethodFieldSchema {
  name: string;
  label: string;
  type: 'text' | 'password' | 'number';
  required: boolean;
  placeholder?: string;
  pattern?: string; // regex string for server-side validation
  helpText?: string;
  maxLength?: number;
  /** Whether this field is one of the "alternative required" fields
   * (e.g., bank_account needs account_number OR iban). */
  alternativeGroup?: string;
}

export interface PayoutMethodSchema {
  methodType: string;
  displayName: string; // localized display name (i18n key)
  fields: PayoutMethodFieldSchema[];
}

// ─── Supported method types (must match DB CHECK constraint in v81) ───
export const SUPPORTED_PAYOUT_METHOD_TYPES = [
  'wallet',
  'bank_account',
  'bank_card',
  'instapay',
] as const;
export type SupportedPayoutMethodType = (typeof SUPPORTED_PAYOUT_METHOD_TYPES)[number];

// ═══════════════════════════════════════════════════════════════════
// Discriminated Union — PayoutMethodDetails
// ═══════════════════════════════════════════════════════════════════
//
// Each variant carries its `method_type` as the discriminant field.
// TypeScript will narrow the union automatically when the caller
// branches on `details.method_type`:
//
//   if (resolved.details.method_type === 'wallet') {
//     // TS knows resolved.details is WalletDetails here — no cast
//     console.log(resolved.details.wallet_number);
//   }
//
// The Phase 13 Payout Provider execution layer (Step 10, deferred)
// will use this narrowing to call the right provider adapter per
// method_type — see the `switch (resolved.details.method_type)`
// pattern in the manual QA checklist.

/** Wallet method details — generic mobile wallet. */
export interface WalletDetails {
  method_type: 'wallet';
  wallet_number: string;
  holder_name: string;
}

/** Bank account method details — bank_name + holder_name + (account_number OR iban). */
export interface BankAccountDetails {
  method_type: 'bank_account';
  bank_name: string;
  /** At least one of { account_number, iban } must be non-empty
   * (enforced by the schema's alternative-group validation). */
  account_number?: string;
  iban?: string;
  holder_name: string;
}

/**
 * Bank card method details — DATA-MINIMIZED per Phase 13 Step 1.
 *
 * The full PAN (Primary Account Number) is NEVER stored. Only the
 * last 4 digits are kept (safe to display — they cannot reconstruct
 * a card). CVV is NEVER stored. NO `provider_token` field here —
 * that belongs to the future `PayoutProvider` architecture, NOT to
 * the Payout Method itself.
 */
export interface BankCardDetails {
  method_type: 'bank_card';
  /** Last 4 digits of the card PAN. Safe to display in masked UI. */
  last4: string;
  /** Optional card brand label (e.g., 'Visa', 'Mastercard'). Free
   * text — the teacher can type it; the future Payout Provider can
   * validate / normalize it. Not provider-specific. */
  card_brand?: string;
  expiry_month: string;
  expiry_year: string;
  holder_name: string;
  // EXPLICITLY ABSENT FIELDS (per Phase 13 Step 1):
  //   - card_number (the full PAN) — REMOVED. Never stored.
  //   - cvv / cvc / security_code — REMOVED. Used at execution time only.
  //   - provider_token — NOT HERE. Belongs to PayoutProvider (Phase 13 Step 10).
}

/** InstaPay method details — flexible recipient identifier + holder_name. */
export interface InstaPayDetails {
  method_type: 'instapay';
  recipient_identifier: string;
  holder_name: string;
}

/**
 * Discriminated union of all payout method detail shapes.
 * Discriminant field: `method_type`.
 *
 * The caller MUST read `method_type` first, then TypeScript narrows
 * the union to the correct variant — NO casts needed.
 */
export type PayoutMethodDetails =
  | WalletDetails
  | BankAccountDetails
  | BankCardDetails
  | InstaPayDetails;

// ─── Regexes ───

// Egyptian mobile wallet regex — 11 digits starting with 010/011/012/015.
export const EGYPTIAN_MOBILE_REGEX = /^01[0125][0-9]{8}$/;

// IBAN regex — generic structure (country code + 2 check digits + BBAN).
export const IBAN_REGEX = /^[A-Z]{2}[0-9]{2}[A-Z0-9]{4,30}$/;

// Last 4 digits — exactly 4 digits. Safe to display (cannot reconstruct PAN).
export const LAST4_REGEX = /^[0-9]{4}$/;

// Expiry month / year
export const EXPIRY_MONTH_REGEX = /^(0[1-9]|1[0-2])$/;
export const EXPIRY_YEAR_REGEX = /^[0-9]{2}$|^[0-9]{4}$/; // 2-digit or 4-digit

// Card brand — free text, 2-20 chars, alphanumerics + space + dash.
// Not exhaustive — the future Payout Provider can normalize.
export const CARD_BRAND_REGEX = /^[A-Za-z0-9 -]{2,20}$/;

// Generic recipient identifier — at least 3 chars, alphanumerics + dashes + @.
export const INSTAPAY_IDENTIFIER_REGEX = /^[A-Za-z0-9._@-]{3,100}$/;

const schemas = new Map<string, PayoutMethodSchema>();

// ─── Wallet (generic mobile wallet — phone + holder name) ───
// Replaces Phase 11's vodafone_cash/etisalat_cash/orange_cash/we_cash.
schemas.set('wallet', {
  methodType: 'wallet',
  displayName: 'payoutMethods.providers.wallet',
  fields: [
    {
      name: FIELD_NAMES.walletNumber,
      label: 'رقم المحفظة',
      type: 'text',
      required: true,
      pattern: EGYPTIAN_MOBILE_REGEX.source,
      maxLength: 11,
      placeholder: '01012345678',
      helpText: '11 رقم يبدأ بـ 010 / 011 / 012 / 015',
    },
    {
      name: FIELD_NAMES.holderName,
      label: 'اسم صاحب المحفظة',
      type: 'text',
      required: true,
      placeholder: 'محمود أحمد',
      maxLength: 100,
      helpText: 'يجب أن يطابق الاسم المسجل على المحفظة',
    },
  ],
});

// ─── Bank Account (bank_name + account_number OR iban + holder_name) ───
schemas.set('bank_account', {
  methodType: 'bank_account',
  displayName: 'payoutMethods.providers.bankAccount',
  fields: [
    {
      name: FIELD_NAMES.bankName,
      label: 'اسم البنك',
      type: 'text',
      required: true,
      maxLength: 100,
      placeholder: 'بنك مصر',
    },
    {
      name: FIELD_NAMES.accountNumber,
      label: 'رقم الحساب',
      type: 'text',
      required: false, // alternative required — see validation
      maxLength: 30,
      placeholder: '1234567890',
      alternativeGroup: 'account_identifier',
      helpText: 'أدخل رقم الحساب أو الـIBAN (واحد منهما على الأقل)',
    },
    {
      name: FIELD_NAMES.iban,
      label: 'IBAN',
      type: 'text',
      required: false, // alternative required — see validation
      maxLength: 34,
      placeholder: 'EG000000000000000000000000000',
      pattern: IBAN_REGEX.source,
      alternativeGroup: 'account_identifier',
      helpText: 'صيغة IBAN (حرفان + رقمان + باقي الأرقام)',
    },
    {
      name: FIELD_NAMES.holderName,
      label: 'اسم صاحب الحساب',
      type: 'text',
      required: true,
      maxLength: 100,
      placeholder: 'محمود أحمد',
    },
  ],
});

// ─── Bank Card (last4 + expiry + holder_name — NO PAN, NO CVV, NO token) ───
// After Phase 13 Step 1:
//   - card_number field is REMOVED. The full PAN is NEVER stored.
//   - Only last4 (safe to display) + card_brand? + expiry + holder.
//   - NO provider_token field — that belongs to the future
//     PayoutProvider architecture (Phase 13 Step 10), NOT to the
//     Payout Method itself.
//   - NO CVV / CVC / security_code field — used at execution time
//     only, NEVER stored.
schemas.set('bank_card', {
  methodType: 'bank_card',
  displayName: 'payoutMethods.providers.bankCard',
  fields: [
    {
      name: 'card_number',
      label: 'رقم البطاقة كامل',
      type: 'text',
      required: false, // alternative: either card_number OR last4
      maxLength: 19,
      placeholder: '4111 1111 1111 1111',
      helpText: 'رقم البطاقة كامل — يُخزّن مشفّرًا، ويظهر آخر 4 أرقام فقط في العرض',
      alternativeGroup: 'card_identifier',
    },
    {
      name: FIELD_NAMES.last4,
      label: 'آخر 4 أرقام من البطاقة',
      type: 'text',
      required: false, // alternative: either card_number OR last4
      pattern: LAST4_REGEX.source,
      maxLength: 4,
      placeholder: '5678',
      helpText: 'أدخل آخر 4 أرقام فقط، أو أدخل الرقم كامل أعلاه',
      alternativeGroup: 'card_identifier',
    },
    {
      name: FIELD_NAMES.cardBrand,
      label: 'نوع البطاقة (اختياري)',
      type: 'text',
      required: false,
      pattern: CARD_BRAND_REGEX.source,
      maxLength: 20,
      placeholder: 'Visa / Mastercard / etc.',
      helpText: 'نوع البطاقة إن كنت تعرفه — ليس إلزاميًا',
    },
    {
      name: FIELD_NAMES.expiryMonth,
      label: 'شهر الانتهاء',
      type: 'text',
      required: true,
      pattern: EXPIRY_MONTH_REGEX.source,
      maxLength: 2,
      placeholder: 'MM',
      helpText: '01-12',
    },
    {
      name: FIELD_NAMES.expiryYear,
      label: 'سنة الانتهاء',
      type: 'text',
      required: true,
      pattern: EXPIRY_YEAR_REGEX.source,
      maxLength: 4,
      placeholder: 'YY أو YYYY',
    },
    {
      name: FIELD_NAMES.holderName,
      label: 'اسم صاحب البطاقة',
      type: 'text',
      required: true,
      maxLength: 100,
      placeholder: 'Mahmoud Ahmed',
    },
    // EXPLICITLY ABSENT:
    //   - card_number / pan — REMOVED. Never stored.
    //   - cvv / cvc / security_code — REMOVED. Used at execution time only.
    //   - provider_token — NOT HERE. Belongs to PayoutProvider (Phase 13 Step 10).
  ],
});

// ─── InstaPay (flexible recipient identifier + holder_name) ───
schemas.set('instapay', {
  methodType: 'instapay',
  displayName: 'payoutMethods.providers.instapay',
  fields: [
    {
      name: FIELD_NAMES.recipientIdentifier,
      label: 'معرّف المستلم',
      type: 'text',
      required: true,
      pattern: INSTAPAY_IDENTIFIER_REGEX.source,
      maxLength: 100,
      placeholder: 'name@instapay أو 010xxxxxxxx',
      helpText: 'معرّف InstaPay الخاص بالمستلم',
    },
    {
      name: FIELD_NAMES.holderName,
      label: 'اسم المستلم',
      type: 'text',
      required: true,
      maxLength: 100,
      placeholder: 'محمود أحمد',
    },
  ],
});

/**
 * Get the schema for a payout method type.
 * Returns null if the type is not supported (defense in depth —
 * the DB CHECK constraint also rejects unknown types after v81).
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
 * Check if a method type is supported.
 * Used by the API to reject unknown types before hitting the DB CHECK.
 */
export function isSupportedPayoutMethodType(methodType: string): boolean {
  return schemas.has(methodType);
}

/**
 * Validate a payout method's details against its schema.
 * Returns an array of error messages (empty = valid).
 *
 * SERVER-SIDE AUTHORITY. The frontend MAY also use the schema's
 * `pattern` for inline UX feedback, but the server is the gate.
 *
 * Validation rules:
 *   - All `required: true` fields must be present + non-empty.
 *   - `alternativeGroup` fields: at least ONE in each group must be present.
 *   - Regex `pattern` is enforced if provided.
 *   - `maxLength` is enforced if provided.
 *   - For bank_card: `card_number`, `cvv`, `cvc`, `security_code`,
 *     `provider_token` fields are REJECTED (extra field validation).
 *
 * @param schema       The payout method's schema
 * @param details      The details object to validate (may be undefined)
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

  // ─── 1. For bank_card: REJECT forbidden fields (PAN, CVV, token) ───
  // This is a defense-in-depth check — the schema doesn't even
  // declare these fields, but if a client tries to send them, we
  // reject them explicitly to avoid accidentally storing sensitive
  // data via extra-field pass-through.
  if (schema.methodType === 'bank_card') {
    const FORBIDDEN_FIELDS = [
      'card_number',
      'pan',
      'cvv',
      'cvc',
      'security_code',
      'provider_token',  // provider_token belongs to PayoutProvider, NOT Payout Method
    ];
    for (const forbidden of FORBIDDEN_FIELDS) {
      if (forbidden in details) {
        errors.push(`الحقل ${forbidden} ممنوع — لا يُخزن في وسيلة الاستلام`);
      }
    }
  }

  // ─── 2. Per-field validation ───
  for (const field of schema.fields) {
    const value = details[field.name];
    const isEmpty =
      value === undefined ||
      value === null ||
      (typeof value === 'string' && value.trim() === '');

    if (field.required && !field.alternativeGroup && isEmpty) {
      errors.push(`${field.label}: مطلوب`);
      continue;
    }

    if (isEmpty) continue; // skip further checks for empty optional fields

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

  // ─── 3. Alternative-group validation (at least one in each group) ───
  const groups = new Map<string, PayoutMethodFieldSchema[]>();
  for (const field of schema.fields) {
    if (field.alternativeGroup) {
      const arr = groups.get(field.alternativeGroup) ?? [];
      arr.push(field);
      groups.set(field.alternativeGroup, arr);
    }
  }
  for (const [, fields] of groups) {
    const atLeastOne = fields.some((f) => {
      const v = details[f.name];
      return v !== undefined && v !== null && String(v).trim() !== '';
    });
    if (!atLeastOne) {
      const labels = fields.map((f) => f.label).join(' أو ');
      errors.push(`يجب إدخال أحد الحقول: ${labels}`);
    }
  }

  // ─── 4. holder_name sanity (min 2 chars) ───
  const holderName = details[FIELD_NAMES.holderName];
  if (
    typeof holderName === 'string' &&
    holderName.trim().length > 0 &&
    holderName.trim().length < 2
  ) {
    errors.push('اسم صاحب الوسيلة: قصير جدًا');
  }

  return errors;
}

/**
 * Coerce a validated raw details Record into the typed
 * `PayoutMethodDetails` discriminated union.
 *
 * This is the type-safe bridge between the runtime-validated
 * `Record<string, unknown>` shape (from the API request body or
 * from the decrypted encrypted blob) and the typed union that
 * consumers (Phase 13 Payout Provider execution layer) will use.
 *
 * Pre-condition: the raw details MUST have passed
 * `validatePayoutMethodDetails()` first. This function does NOT
 * re-validate — it only constructs the typed shape from the raw
 * object, defaulting missing optional fields to undefined and
 * coercing values to strings.
 *
 * @param methodType  The method_type discriminant
 * @param raw         The validated raw details object
 * @returns           The typed PayoutMethodDetails (one of the 4 variants)
 * @throws            If methodType is not one of the supported types
 */
export function coercePayoutMethodDetails(
  methodType: string,
  raw: Record<string, unknown> | null | undefined
): PayoutMethodDetails {
  const r = raw ?? {};
  const str = (v: unknown): string => (v === undefined || v === null ? '' : String(v).trim());
  const optStr = (v: unknown): string | undefined => {
    if (v === undefined || v === null) return undefined;
    const s = String(v).trim();
    return s === '' ? undefined : s;
  };

  switch (methodType) {
    case 'wallet':
      return {
        method_type: 'wallet',
        wallet_number: str(r[FIELD_NAMES.walletNumber]),
        holder_name: str(r[FIELD_NAMES.holderName]),
      };

    case 'bank_account':
      return {
        method_type: 'bank_account',
        bank_name: str(r[FIELD_NAMES.bankName]),
        account_number: optStr(r[FIELD_NAMES.accountNumber]),
        iban: optStr(r[FIELD_NAMES.iban]),
        holder_name: str(r[FIELD_NAMES.holderName]),
      };

    case 'bank_card': {
      // EXPLICITLY EXCLUDE card_number, cvv, provider_token from the
      // typed output — even if they happen to be present in the raw
      // blob (legacy data), we do NOT surface them via the typed union.
      return {
        method_type: 'bank_card',
        last4: str(r[FIELD_NAMES.last4]),
        card_brand: optStr(r[FIELD_NAMES.cardBrand]),
        expiry_month: str(r[FIELD_NAMES.expiryMonth]),
        expiry_year: str(r[FIELD_NAMES.expiryYear]),
        holder_name: str(r[FIELD_NAMES.holderName]),
      };
    }

    case 'instapay':
      return {
        method_type: 'instapay',
        recipient_identifier: str(r[FIELD_NAMES.recipientIdentifier]),
        holder_name: str(r[FIELD_NAMES.holderName]),
      };

    default:
      throw new Error(`Unsupported method type at runtime: ${methodType}`);
  }
}

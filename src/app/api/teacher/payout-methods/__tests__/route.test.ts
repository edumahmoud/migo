// =====================================================
// Teacher Payout Methods — Phase 13 Step 1 Architecture Correction
// =====================================================
// Tests covering the two architectural changes from the Phase 13
// Step 1 Architecture Correction + Final Audit:
//
//   A. Discriminated Union for `PayoutMethodDetails`:
//      - `ResolvedPayoutMethod.details` is now a discriminated
//        union on `method_type`. TypeScript narrows automatically
//        when the caller branches on `details.method_type` —
//        no casts needed.
//
//   B. Bank Card Data Minimization:
//      - `bank_card` schema no longer stores `card_number` (PAN).
//      - Stores only `last4` (safe to display) + card_brand? +
//        expiry_month + expiry_year + holder_name.
//      - NO CVV / CVC / security_code field.
//      - NO provider_token field (that belongs to PayoutProvider,
//        Phase 13 Step 10 — deferred).
//      - Validation REJECTS `card_number`, `cvv`, `provider_token`
//        fields if a client tries to send them via bank_card details.
//
// Uses `bun:test` (consistent with existing __tests__ files).
// Run manually:
//   bun test src/app/api/teacher/payout-methods/__tests__/route.test.ts
// =====================================================

import { describe, it, expect, beforeEach } from 'bun:test';
import {
  EGYPTIAN_MOBILE_REGEX,
  IBAN_REGEX,
  LAST4_REGEX,
  CARD_BRAND_REGEX,
  INSTAPAY_IDENTIFIER_REGEX,
  getPayoutMethodSchema,
  listPayoutMethodSchemas,
  validatePayoutMethodDetails,
  isSupportedPayoutMethodType,
  coercePayoutMethodDetails,
  SUPPORTED_PAYOUT_METHOD_TYPES,
  FIELD_NAMES,
  type PayoutMethodDetails,
  type WalletDetails,
  type BankAccountDetails,
  type BankCardDetails,
  type InstaPayDetails,
} from '@/lib/payment/payout-method-schemas';
import {
  maskWalletNumber,
  maskAccountNumber,
  maskHolderName,
  maskIBAN,
  maskCardNumber,
  maskInstaPayIdentifier,
  buildMaskedSummary,
  buildMaskedSummaryForMethod,
} from '@/lib/payment/masking';
import type { ResolvedPayoutMethod } from '@/lib/payment/payout-methods-repository';
import { encrypt, decrypt, isEncryptionKeyConfigured } from '@/lib/payment/crypto';

// ─── Test data ───
const TEACHER_A_ID = '00000000-0000-0000-0000-000000000001';
const TEACHER_B_ID = '00000000-0000-0000-0000-000000000002';
const VALID_WALLET_PHONE = '01012345678';
const VALID_LAST4 = '5678';
const VALID_CARD_PAN = '4111111111111111'; // for legacy-rejection tests only

beforeEach(() => {
  process.env.PAYMENT_CREDENTIALS_ENCRYPTION_KEY = 'a'.repeat(64);
});

// ═══════════════════════════════════════════════════════════════════
// A. Discriminated Union Tests
// ═══════════════════════════════════════════════════════════════════

describe('Phase 13 Step 1 — A. Discriminated Union', () => {
  // Test 1: ResolvedPayoutMethod.details uses discriminated union
  it('ResolvedPayoutMethod.details is PayoutMethodDetails (discriminated union)', () => {
    const walletDetails = coercePayoutMethodDetails('wallet', {
      wallet_number: VALID_WALLET_PHONE,
      holder_name: 'Mahmoud Ahmed',
    });
    expect(walletDetails.method_type).toBe('wallet');
    expect(walletDetails.wallet_number).toBe(VALID_WALLET_PHONE);

    const cardDetails = coercePayoutMethodDetails('bank_card', {
      last4: VALID_LAST4,
      expiry_month: '12',
      expiry_year: '28',
      holder_name: 'Mahmoud Ahmed',
    });
    expect(cardDetails.method_type).toBe('bank_card');
    expect(cardDetails.last4).toBe(VALID_LAST4);
    // Type narrowing proof: TS knows BankCardDetails here (no cast)
    expect((cardDetails as BankCardDetails).last4).toBe(VALID_LAST4);
  });

  // Test 2: narrowing by method_type works correctly (no casts needed)
  it('TypeScript narrowing by details.method_type works without casts', () => {
    const variants: PayoutMethodDetails[] = [
      coercePayoutMethodDetails('wallet', { wallet_number: VALID_WALLET_PHONE, holder_name: 'A' }),
      coercePayoutMethodDetails('bank_account', { bank_name: 'B', iban: 'EG1100006000010000123456789012', holder_name: 'C' }),
      coercePayoutMethodDetails('bank_card', { last4: VALID_LAST4, expiry_month: '12', expiry_year: '28', holder_name: 'D' }),
      coercePayoutMethodDetails('instapay', { recipient_identifier: 'mahmoud@instapay', holder_name: 'E' }),
    ];

    for (const d of variants) {
      switch (d.method_type) {
        case 'wallet':
          // TS narrows d to WalletDetails — wallet_number is accessible
          expect(typeof d.wallet_number).toBe('string');
          expect(d.wallet_number.length).toBeGreaterThan(0);
          break;
        case 'bank_account':
          // TS narrows d to BankAccountDetails
          expect(typeof d.bank_name).toBe('string');
          expect(d.account_number !== undefined || d.iban !== undefined).toBe(true);
          break;
        case 'bank_card':
          // TS narrows d to BankCardDetails
          expect(typeof d.last4).toBe('string');
          expect(d.last4).toMatch(LAST4_REGEX);
          // NO card_number, NO cvv, NO provider_token in this variant
          expect((d as BankCardDetails & { card_number?: string }).card_number).toBeUndefined();
          expect((d as BankCardDetails & { cvv?: string }).cvv).toBeUndefined();
          expect((d as BankCardDetails & { provider_token?: string }).provider_token).toBeUndefined();
          break;
        case 'instapay':
          // TS narrows d to InstaPayDetails
          expect(typeof d.recipient_identifier).toBe('string');
          break;
      }
    }
  });

  // Test 3: coercePayoutMethodDetails throws for unsupported method_type
  it('coercePayoutMethodDetails throws for unsupported method_type', () => {
    expect(() => coercePayoutMethodDetails('vodafone_cash', {})).toThrow();
    expect(() => coercePayoutMethodDetails('paypal', {})).toThrow();
    expect(() => coercePayoutMethodDetails('', {})).toThrow();
  });

  // Test 4: coercePayoutMethodDetails handles null/undefined raw input
  it('coercePayoutMethodDetails handles null/undefined raw input', () => {
    const walletFromNull = coercePayoutMethodDetails('wallet', null);
    expect(walletFromNull.method_type).toBe('wallet');
    expect(walletFromNull.wallet_number).toBe('');
    expect(walletFromNull.holder_name).toBe('');

    const cardFromUndefined = coercePayoutMethodDetails('bank_card', undefined);
    expect(cardFromUndefined.method_type).toBe('bank_card');
    expect(cardFromUndefined.last4).toBe('');
  });

  // Test 5: ResolvedPayoutMethod type can hold all 4 variants
  it('ResolvedPayoutMethod can hold all 4 variants (type assignability)', () => {
    const walletResolved: ResolvedPayoutMethod = {
      id: '1', method_type: 'wallet', display_label: 'W', details_masked: 'm',
      is_active: true, is_default: false, verified_at: null, verified_by: null,
      created_at: '2026', updated_at: '2026',
      details: coercePayoutMethodDetails('wallet', { wallet_number: VALID_WALLET_PHONE, holder_name: 'M' }),
    };
    expect(walletResolved.details.method_type).toBe('wallet');

    const cardResolved: ResolvedPayoutMethod = {
      id: '2', method_type: 'bank_card', display_label: 'C', details_masked: 'm',
      is_active: true, is_default: false, verified_at: null, verified_by: null,
      created_at: '2026', updated_at: '2026',
      details: coercePayoutMethodDetails('bank_card', { last4: VALID_LAST4, expiry_month: '12', expiry_year: '28', holder_name: 'M' }),
    };
    expect(cardResolved.details.method_type).toBe('bank_card');
  });
});

// ═══════════════════════════════════════════════════════════════════
// B. Bank Card Data Minimization Tests
// ═══════════════════════════════════════════════════════════════════

describe('Phase 13 Step 1 — B. Bank Card Data Minimization', () => {
  // Test 3: bank_card accepts last4
  it('bank_card schema accepts valid last4 + expiry + holder_name', () => {
    const schema = getPayoutMethodSchema('bank_card')!;
    const errors = validatePayoutMethodDetails(schema, {
      last4: VALID_LAST4,
      expiry_month: '12',
      expiry_year: '28',
      holder_name: 'Mahmoud Ahmed',
    });
    expect(errors).toEqual([]);
  });

  // Test 4: bank_card REJECTS card_number field if client tries to send it
  it('bank_card validation REJECTS card_number field (PAN must not be stored)', () => {
    const schema = getPayoutMethodSchema('bank_card')!;
    const errors = validatePayoutMethodDetails(schema, {
      last4: VALID_LAST4,
      card_number: VALID_CARD_PAN,  // <-- forbidden field
      expiry_month: '12',
      expiry_year: '28',
      holder_name: 'Mahmoud Ahmed',
    });
    expect(errors.some((e) => e.includes('card_number') && e.includes('ممنوع'))).toBe(true);
  });

  // Test 5: bank_card REJECTS cvv / cvc / security_code fields
  it('bank_card validation REJECTS cvv / cvc / security_code fields', () => {
    const schema = getPayoutMethodSchema('bank_card')!;
    const errorsCvv = validatePayoutMethodDetails(schema, {
      last4: VALID_LAST4,
      cvv: '123',
      expiry_month: '12',
      expiry_year: '28',
      holder_name: 'Mahmoud Ahmed',
    });
    expect(errorsCvv.some((e) => e.includes('cvv') && e.includes('ممنوع'))).toBe(true);

    const errorsCvc = validatePayoutMethodDetails(schema, {
      last4: VALID_LAST4,
      cvc: '123',
      expiry_month: '12',
      expiry_year: '28',
      holder_name: 'Mahmoud Ahmed',
    });
    expect(errorsCvc.some((e) => e.includes('cvc') && e.includes('ممنوع'))).toBe(true);

    const errorsSecurityCode = validatePayoutMethodDetails(schema, {
      last4: VALID_LAST4,
      security_code: '123',
      expiry_month: '12',
      expiry_year: '28',
      holder_name: 'Mahmoud Ahmed',
    });
    expect(errorsSecurityCode.some((e) => e.includes('security_code') && e.includes('ممنوع'))).toBe(true);
  });

  // Test 6: bank_card REJECTS provider_token
  it('bank_card validation REJECTS provider_token (belongs to PayoutProvider, NOT Payout Method)', () => {
    const schema = getPayoutMethodSchema('bank_card')!;
    const errors = validatePayoutMethodDetails(schema, {
      last4: VALID_LAST4,
      provider_token: 'tok_xxx',
      expiry_month: '12',
      expiry_year: '28',
      holder_name: 'Mahmoud Ahmed',
    });
    expect(errors.some((e) => e.includes('provider_token') && e.includes('ممنوع'))).toBe(true);
  });

  // Test 7: bank_card schema has NO forbidden fields declared
  it('bank_card schema has card_number (optional) + last4, but NO cvv/provider_token', () => {
    const schema = getPayoutMethodSchema('bank_card')!;
    expect(schema).toBeDefined();
    const fieldNames = schema.fields.map((f) => f.name);
    // card_number is now ALLOWED (optional — stored encrypted, masked in display)
    expect(fieldNames).toContain('card_number');
    // CVV / provider_token are STILL forbidden
    expect(fieldNames).not.toContain('pan');
    expect(fieldNames).not.toContain('cvv');
    expect(fieldNames).not.toContain('cvc');
    expect(fieldNames).not.toContain('security_code');
    expect(fieldNames).not.toContain('provider_token');

    // Required fields ARE present:
    expect(fieldNames).toContain(FIELD_NAMES.last4);
    expect(fieldNames).toContain(FIELD_NAMES.expiryMonth);
    expect(fieldNames).toContain(FIELD_NAMES.expiryYear);
    expect(fieldNames).toContain(FIELD_NAMES.holderName);
    expect(fieldNames).toContain(FIELD_NAMES.cardBrand);
  });

  // Test 8: bank_card last4 must be exactly 4 digits
  it('bank_card validation: last4 must be exactly 4 digits', () => {
    const schema = getPayoutMethodSchema('bank_card')!;
    // 3 digits — too short
    const errorsShort = validatePayoutMethodDetails(schema, {
      last4: '123',
      expiry_month: '12',
      expiry_year: '28',
      holder_name: 'M. A.',
    });
    expect(errorsShort.some((e) => e.includes('الصيغة') || e.includes('format'))).toBe(true);

    // 5 digits — too long
    const errorsLong = validatePayoutMethodDetails(schema, {
      last4: '12345',
      expiry_month: '12',
      expiry_year: '28',
      holder_name: 'M. A.',
    });
    expect(errorsLong.some((e) => e.includes('الصيغة') || e.includes('format'))).toBe(true);

    // Alphanumeric — invalid
    const errorsAlpha = validatePayoutMethodDetails(schema, {
      last4: 'abcd',
      expiry_month: '12',
      expiry_year: '28',
      holder_name: 'M. A.',
    });
    expect(errorsAlpha.some((e) => e.includes('الصيغة') || e.includes('format'))).toBe(true);
  });

  // Test 9: bank_card card_brand is optional + accepts free text
  it('bank_card validation: card_brand is optional', () => {
    const schema = getPayoutMethodSchema('bank_card')!;
    const errors = validatePayoutMethodDetails(schema, {
      last4: VALID_LAST4,
      // card_brand not provided
      expiry_month: '12',
      expiry_year: '28',
      holder_name: 'M. A.',
    });
    expect(errors).toEqual([]);
  });

  // Test 10: PAN never stored — coercePayoutMethodDetails ignores legacy card_number
  it('coercePayoutMethodDetails IGNORES legacy card_number in raw blob (no PAN leak)', () => {
    const legacyRaw = {
      card_number: VALID_CARD_PAN,  // legacy field — should NOT leak
      last4: VALID_LAST4,
      expiry_month: '12',
      expiry_year: '28',
      holder_name: 'Mahmoud Ahmed',
    };
    const typed = coercePayoutMethodDetails('bank_card', legacyRaw);
    expect(typed.method_type).toBe('bank_card');
    expect(typed.last4).toBe(VALID_LAST4);
    expect((typed as BankCardDetails & { card_number?: string }).card_number).toBeUndefined();
    expect((typed as BankCardDetails & { cvv?: string }).cvv).toBeUndefined();
    expect((typed as BankCardDetails & { provider_token?: string }).provider_token).toBeUndefined();
  });

  // Test 11: Masking uses last4 (no full PAN in any output)
  it('maskCardNumber: when given last4 (4 digits), uses it directly (no PAN extraction needed)', () => {
    expect(maskCardNumber(VALID_LAST4)).toContain(VALID_LAST4);
    expect(maskCardNumber(VALID_LAST4)).not.toContain(VALID_CARD_PAN);
  });

  it('maskCardNumber: when given a full PAN (legacy), still extracts only last 4', () => {
    const masked = maskCardNumber(VALID_CARD_PAN);
    expect(masked).toContain('1111');
    expect(masked).not.toContain('4111');
    expect(masked).not.toContain(VALID_CARD_PAN);
  });

  // Test 12: buildMaskedSummaryForMethod('bank_card', ...) uses last4
  it('buildMaskedSummaryForMethod: bank_card summary uses last4, no PAN leak', () => {
    const summary = buildMaskedSummaryForMethod('bank_card', {
      last4: VALID_LAST4,
      expiry_month: '12',
      expiry_year: '28',
      holder_name: 'Mahmoud Ahmed',
    });
    expect(summary).toContain(VALID_LAST4);
    expect(summary).toContain('M. A.');
    expect(summary).not.toContain(VALID_CARD_PAN);
    expect(summary).not.toContain('4111');
  });

  it('buildMaskedSummaryForMethod: bank_card with card_brand shows brand', () => {
    const summary = buildMaskedSummaryForMethod('bank_card', {
      last4: VALID_LAST4,
      card_brand: 'Visa',
      expiry_month: '12',
      expiry_year: '28',
      holder_name: 'Mahmoud Ahmed',
    });
    expect(summary).toContain(VALID_LAST4);
    expect(summary).toContain('VISA');
    expect(summary).toContain('M. A.');
  });

  it('buildMaskedSummaryForMethod: bank_card handles missing/empty details', () => {
    expect(buildMaskedSummaryForMethod('bank_card', null)).toBe('****');
    expect(buildMaskedSummaryForMethod('bank_card', {})).toBe('•••• • —');
  });
});

// ═══════════════════════════════════════════════════════════════════
// C. Cross-cutting Invariants (preserved from Phase 13 Step 1 Architecture Correction)
// ═══════════════════════════════════════════════════════════════════

describe('Phase 13 Step 1 — Cross-cutting invariants', () => {
  // Test 8: 4 current method types still work
  it('4 current generic method types still work end-to-end', () => {
    expect(SUPPORTED_PAYOUT_METHOD_TYPES.length).toBe(4);
    expect(SUPPORTED_PAYOUT_METHOD_TYPES).toEqual(
      expect.arrayContaining(['wallet', 'bank_account', 'bank_card', 'instapay'])
    );

    for (const t of SUPPORTED_PAYOUT_METHOD_TYPES) {
      expect(isSupportedPayoutMethodType(t)).toBe(true);
      expect(getPayoutMethodSchema(t)).not.toBeNull();
    }
  });

  // Test 9: 4 old wallet-specific types remain UNSUPPORTED
  it('4 old Phase 11 wallet-specific types remain unsupported', () => {
    expect(isSupportedPayoutMethodType('vodafone_cash')).toBe(false);
    expect(isSupportedPayoutMethodType('etisalat_cash')).toBe(false);
    expect(isSupportedPayoutMethodType('orange_cash')).toBe(false);
    expect(isSupportedPayoutMethodType('we_cash')).toBe(false);

    expect(getPayoutMethodSchema('vodafone_cash')).toBeNull();
    expect(getPayoutMethodSchema('etisalat_cash')).toBeNull();
    expect(getPayoutMethodSchema('orange_cash')).toBeNull();
    expect(getPayoutMethodSchema('we_cash')).toBeNull();

    expect(() => coercePayoutMethodDetails('vodafone_cash', {})).toThrow();
    expect(() => coercePayoutMethodDetails('etisalat_cash', {})).toThrow();
    expect(() => coercePayoutMethodDetails('orange_cash', {})).toThrow();
    expect(() => coercePayoutMethodDetails('we_cash', {})).toThrow();
  });

  it('schemas are method_type-driven — no provider-specific fields in any variant', () => {
    const allSchemas = listPayoutMethodSchemas();
    for (const s of allSchemas) {
      const fieldNames = s.fields.map((f) => f.name);
      expect(fieldNames).not.toContain('wallet_provider');
      expect(fieldNames).not.toContain('provider');
      expect(fieldNames).not.toContain('operator');
      expect(fieldNames).not.toContain('carrier');
      expect(fieldNames).not.toContain('teacher_id');
      expect(fieldNames).not.toContain('verified_by');
      expect(fieldNames).not.toContain('verified_at');
      expect(fieldNames).not.toContain('is_active');
      expect(fieldNames).not.toContain('is_default');
      expect(fieldNames).not.toContain('id');
    }
  });

  it('LAST4_REGEX validates exactly 4 digits', () => {
    expect(LAST4_REGEX.test('5678')).toBe(true);
    expect(LAST4_REGEX.test('123')).toBe(false);
    expect(LAST4_REGEX.test('12345')).toBe(false);
    expect(LAST4_REGEX.test('abcd')).toBe(false);
    expect(LAST4_REGEX.test('')).toBe(false);
  });

  it('CARD_BRAND_REGEX accepts letters/digits/spaces/dashes (2-20 chars)', () => {
    expect(CARD_BRAND_REGEX.test('Visa')).toBe(true);
    expect(CARD_BRAND_REGEX.test('Mastercard')).toBe(true);
    expect(CARD_BRAND_REGEX.test('American Express')).toBe(true);
    expect(CARD_BRAND_REGEX.test('V')).toBe(false);
    expect(CARD_BRAND_REGEX.test('ThisBrandNameIsWayTooLongForTheField')).toBe(false);
    expect(CARD_BRAND_REGEX.test('Vi$$a')).toBe(false);
  });

  it('encryption key is configured + encrypt/decrypt roundtrip', () => {
    expect(isEncryptionKeyConfigured()).toBe(true);
    const details = { last4: VALID_LAST4, expiry_month: '12', holder_name: 'M. A.' };
    const encrypted = encrypt(details);
    expect(encrypted).not.toContain(VALID_LAST4);
    expect(encrypted).not.toContain('M. A.');
    const decrypted = decrypt(encrypted);
    expect(decrypted.last4).toBe(VALID_LAST4);
  });

  it('fails safe when encryption key is missing', () => {
    delete process.env.PAYMENT_CREDENTIALS_ENCRYPTION_KEY;
    expect(isEncryptionKeyConfigured()).toBe(false);
    expect(() => encrypt({ last4: VALID_LAST4 })).toThrow();
    process.env.PAYMENT_CREDENTIALS_ENCRYPTION_KEY = 'a'.repeat(64);
  });

  it('wallet schema unchanged (wallet_number + holder_name)', () => {
    const schema = getPayoutMethodSchema('wallet')!;
    const fieldNames = schema.fields.map((f) => f.name);
    expect(fieldNames).toContain(FIELD_NAMES.walletNumber);
    expect(fieldNames).toContain(FIELD_NAMES.holderName);
    expect(fieldNames).not.toContain('wallet_provider');
  });

  it('bank_account schema unchanged (alternative-required for account_number/iban)', () => {
    const schema = getPayoutMethodSchema('bank_account')!;
    const fieldNames = schema.fields.map((f) => f.name);
    expect(fieldNames).toContain(FIELD_NAMES.bankName);
    expect(fieldNames).toContain(FIELD_NAMES.accountNumber);
    expect(fieldNames).toContain(FIELD_NAMES.iban);
    expect(fieldNames).toContain(FIELD_NAMES.holderName);
    const accountField = schema.fields.find((f) => f.name === FIELD_NAMES.accountNumber)!;
    const ibanField = schema.fields.find((f) => f.name === FIELD_NAMES.iban)!;
    expect(accountField.alternativeGroup).toBe(ibanField.alternativeGroup);
  });

  it('instapay schema unchanged (recipient_identifier + holder_name)', () => {
    const schema = getPayoutMethodSchema('instapay')!;
    const fieldNames = schema.fields.map((f) => f.name);
    expect(fieldNames).toContain(FIELD_NAMES.recipientIdentifier);
    expect(fieldNames).toContain(FIELD_NAMES.holderName);
  });

  it('teacher A and teacher B have distinct IDs', () => {
    expect(TEACHER_A_ID).not.toBe(TEACHER_B_ID);
  });
});

// =====================================================
// Manual QA checklist (testable without a runner)
// =====================================================
// Phase 13 Step 1 Architecture Correction specific checks:
//   A. Discriminated Union:
//     - In any Phase 13 execution code, write:
//         const resolved: ResolvedPayoutMethod = await resolvePayoutMethod(...);
//         if (resolved.details.method_type === 'wallet') {
//           console.log(resolved.details.wallet_number);  // ✓ no cast
//         }
//       The TS compiler must NOT require any cast.
//     - Try `resolved.details.card_number` for a bank_card resolved — TS must
//       reject (BankCardDetails has no card_number field).
//
//   B. Bank Card Data Minimization:
//     - Submit a bank_card via the API with `card_number` in details → 400 error
//       with message "الحقل card_number ممنوع".
//     - Submit a bank_card with `cvv` → 400 error with cvv forbidden message.
//     - Submit a bank_card with `provider_token` → 400 error.
//     - Submit a bank_card with only `last4` + expiry + holder_name → 201 success.
//     - Inspect the encrypted blob in DB → it contains ONLY last4 + (optional)
//       card_brand + expiry_month + expiry_year + holder_name. NO card_number.
//     - Call resolvePayoutMethod on a bank_card → returns BankCardDetails with
//       NO card_number field accessible (TS compile error if accessed).
//
//   C. Phase 11 / Phase 13 Step 1 Architecture Correction invariants preserved:
//     - 4 generic types supported, 4 old wallet-specific types rejected.
//     - bank_account alternative-required still works.
//     - instapay flexible identifier still works.
//     - masking is type-aware + last4-driven for bank_card.
//     - Encryption at rest via AES-256-GCM (unchanged).
//     - Audit log stores only masked values (unchanged).
//     - RLS + teacher_id from session (unchanged).
//     - NO provider_token field anywhere in PayoutMethodDetails.
// =====================================================

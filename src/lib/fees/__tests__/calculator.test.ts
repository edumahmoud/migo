import { describe, test, expect } from 'bun:test';
import { calculateFees, breakdownToJsonb, type FeeCatalogRow } from '../calculator';

describe('calculateFees', () => {
  const commission: FeeCatalogRow = {
    id: '1', code: 'platform_commission', name_ar: 'عمولة', name_en: 'Commission',
    fee_kind: 'percentage', value: 10, sort_order: 0,
  };
  const tax: FeeCatalogRow = {
    id: '2', code: 'tax', name_ar: 'ضريبة', name_en: 'Tax',
    fee_kind: 'percentage', value: 14, sort_order: 1,
  };
  const flat: FeeCatalogRow = {
    id: '3', code: 'processing_fee', name_ar: 'رسوم', name_en: 'Processing Fee',
    fee_kind: 'flat', value: 5, sort_order: 2,
  };

  test('base case: no fees → grand = base', () => {
    const r = calculateFees(100, []);
    expect(r.base_total).toBe(100);
    expect(r.fees_total).toBe(0);
    expect(r.grand_total).toBe(100);
    expect(r.fees.length).toBe(0);
  });

  test('single percentage fee: 10% of 100 = 10', () => {
    const r = calculateFees(100, [commission]);
    expect(r.fees.length).toBe(1);
    expect(r.fees[0].calculated_amount).toBe(10);
    expect(r.fees_total).toBe(10);
    expect(r.grand_total).toBe(110);
  });

  test('multiple percentage fees — NOT compounded (each computed against base)', () => {
    // 10% commission + 14% tax on 100 → 10 + 14 = 24 fees, grand = 124
    const r = calculateFees(100, [commission, tax]);
    expect(r.fees.length).toBe(2);
    expect(r.fees[0].calculated_amount).toBe(10); // commission
    expect(r.fees[1].calculated_amount).toBe(14); // tax
    expect(r.fees_total).toBe(24);
    expect(r.grand_total).toBe(124);
  });

  test('mixed percentage + flat fees', () => {
    // 100 base + 10 (commission 10%) + 14 (tax 14%) + 5 (flat) = 129
    const r = calculateFees(100, [commission, tax, flat]);
    expect(r.fees_total).toBe(29);
    expect(r.grand_total).toBe(129);
  });

  test('flat fee on 0 base still applies', () => {
    // flat fee is independent of base — even a 0-subscription order pays it
    const r = calculateFees(0, [flat]);
    expect(r.fees.length).toBe(1);
    expect(r.fees[0].calculated_amount).toBe(5);
    expect(r.fees_total).toBe(5);
    expect(r.grand_total).toBe(5);
  });

  test('percentage fee on 0 base = 0', () => {
    const r = calculateFees(0, [commission]);
    expect(r.fees[0].calculated_amount).toBe(0);
    expect(r.fees_total).toBe(0);
    expect(r.grand_total).toBe(0);
  });

  test('rounding: 15.5% of 200 = 31.00 (no float drift)', () => {
    const odd: FeeCatalogRow = {
      ...commission, value: 15.5,
    };
    const r = calculateFees(200, [odd]);
    expect(r.fees[0].calculated_amount).toBe(31);
    expect(r.grand_total).toBe(231);
  });

  test('negative base → returns zero', () => {
    const r = calculateFees(-100, [commission]);
    expect(r.base_total).toBe(0);
    expect(r.fees_total).toBe(0);
    expect(r.grand_total).toBe(0);
  });

  test('NaN base → returns zero', () => {
    const r = calculateFees(NaN, [commission]);
    expect(r.grand_total).toBe(0);
  });

  test('sort_order respected', () => {
    // Reverse the sort_order: tax first, then commission
    const taxFirst: FeeCatalogRow = { ...tax, sort_order: 0 };
    const commissionSecond: FeeCatalogRow = { ...commission, sort_order: 1 };
    const r = calculateFees(100, [commissionSecond, taxFirst]);
    expect(r.fees[0].code).toBe('tax');
    expect(r.fees[1].code).toBe('platform_commission');
  });
});

describe('breakdownToJsonb', () => {
  test('strips admin-only fields (id, sort_order)', () => {
    const r = calculateFees(100, [{
      id: 'abc-1', code: 'platform_commission', name_ar: 'عمولة', name_en: 'Commission',
      fee_kind: 'percentage', value: 10, sort_order: 5,
    }]);
    const jsonb = breakdownToJsonb(r);
    expect(jsonb.length).toBe(1);
    expect(jsonb[0]).not.toHaveProperty('id');
    expect(jsonb[0]).not.toHaveProperty('sort_order');
    expect(jsonb[0].code).toBe('platform_commission');
    expect(jsonb[0].calculated_amount).toBe(10);
  });

  test('empty breakdown → empty array', () => {
    const r = calculateFees(100, []);
    expect(breakdownToJsonb(r)).toEqual([]);
  });
});

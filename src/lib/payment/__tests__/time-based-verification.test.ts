import { describe, test, expect } from 'bun:test';
import { evaluateTimeBasedVerification } from '../time-based-verification';

describe('evaluateTimeBasedVerification — no activation without proof of capture', () => {
  test('Paymob API success transaction → verified', () => {
    expect(evaluateTimeBasedVerification({
      apiQuerySucceeded: true,
      transactions: [{ success: true, pending: false, is_refunded: false }],
      redirectHmacValid: false,
      redirectSuccess: false,
    })).toBe('verified');
  });

  test('refunded "success" transaction does NOT count as captured', () => {
    expect(evaluateTimeBasedVerification({
      apiQuerySucceeded: true,
      transactions: [{ success: true, pending: false, is_refunded: true }],
      redirectHmacValid: false,
      redirectSuccess: false,
    })).toBe('refused');
  });

  test('declined/failed transaction → refused (the old code activated this!)', () => {
    expect(evaluateTimeBasedVerification({
      apiQuerySucceeded: true,
      transactions: [{ success: false, pending: false, is_refunded: false }],
      redirectHmacValid: false,
      redirectSuccess: false,
    })).toBe('refused');
  });

  test('pending transaction → inconclusive (do not refuse, do not activate)', () => {
    expect(evaluateTimeBasedVerification({
      apiQuerySucceeded: true,
      transactions: [{ success: false, pending: true, is_refunded: false }],
      redirectHmacValid: false,
      redirectSuccess: false,
    })).toBe('inconclusive');
  });

  test('abandoned checkout (API ok, no transactions) → inconclusive, never verified', () => {
    expect(evaluateTimeBasedVerification({
      apiQuerySucceeded: true,
      transactions: [],
      redirectHmacValid: false,
      redirectSuccess: false,
    })).toBe('inconclusive');
  });

  test('Paymob API unreachable → inconclusive (order stays pending for webhook/cron)', () => {
    expect(evaluateTimeBasedVerification({
      apiQuerySucceeded: false,
      transactions: [],
      redirectHmacValid: false,
      redirectSuccess: false,
    })).toBe('inconclusive');
  });

  test('valid redirect HMAC + success=true → verified even when the API fails', () => {
    expect(evaluateTimeBasedVerification({
      apiQuerySucceeded: false,
      transactions: [],
      redirectHmacValid: true,
      redirectSuccess: true,
    })).toBe('verified');
  });

  test('valid redirect HMAC but success=false → NOT verified', () => {
    expect(evaluateTimeBasedVerification({
      apiQuerySucceeded: true,
      transactions: [{ success: false, pending: false }],
      redirectHmacValid: true,
      redirectSuccess: false,
    })).toBe('refused');
  });

  test('unsigned/tampered redirect params never verify', () => {
    expect(evaluateTimeBasedVerification({
      apiQuerySucceeded: true,
      transactions: [{ success: true, pending: false, is_refunded: false }],
      redirectHmacValid: false,
      redirectSuccess: true,
    })).toBe('verified'); // verified via API, not via the unsigned params
    expect(evaluateTimeBasedVerification({
      apiQuerySucceeded: false,
      transactions: [],
      redirectHmacValid: false,
      redirectSuccess: true,
    })).toBe('inconclusive');
  });
});

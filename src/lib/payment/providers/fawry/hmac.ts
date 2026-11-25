/**
 * Fawry signature utilities.
 *
 * Fawry signs with a PLAIN SHA-256 of the concatenated field values
 * (no separators) with the merchant's secure key appended at the end.
 * It is NOT an HMAC. Amounts are always in two-decimal form ("100.00").
 *
 * Sources (Fawry developer docs):
 *   Charge  : sha256(merchantCode + merchantRefNum + customerProfileId + paymentMethod + amount + secureKey)
 *   Status  : sha256(merchantCode + merchantRefNumber + secureKey)
 *   Notify v2: sha256(fawryRefNumber + merchantRefNumber + paymentAmount + orderAmount
 *                     + orderStatus + paymentMethod + paymentRefrenceNumber + secureKey)
 */

import { createHash, timingSafeEqual } from 'crypto';

function sha256Hex(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

/** Two-decimal form Fawry expects. Accepts numbers or numeric strings. */
export function fawryAmount(v: number | string | undefined | null): string {
  if (v === undefined || v === null || v === '') return '';
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n.toFixed(2) : String(v);
}

export function computeChargeSignature(
  fields: {
    merchantCode: string;
    merchantRefNum: string;
    customerProfileId: string;
    paymentMethod: string;
    amount: string;
  },
  securityKey: string,
): string {
  return sha256Hex(
    [
      fields.merchantCode,
      fields.merchantRefNum,
      fields.customerProfileId,
      fields.paymentMethod,
      fields.amount,
      securityKey,
    ].join(''),
  );
}

export function computeStatusSignature(
  merchantCode: string,
  merchantRefNum: string,
  securityKey: string,
): string {
  return sha256Hex([merchantCode, merchantRefNum, securityKey].join(''));
}

export interface FawryNotificationFields {
  fawryRefNumber?: string | number;
  merchantRefNumber?: string;
  paymentAmount?: number | string;
  orderAmount?: number | string;
  orderStatus?: string;
  paymentMethod?: string;
  paymentRefrenceNumber?: string; // sic: Fawry's own spelling
  messageSignature?: string;
}

export function computeNotificationSignature(p: FawryNotificationFields, securityKey: string): string {
  return sha256Hex(
    [
      p.fawryRefNumber ?? '',
      p.merchantRefNumber ?? '',
      fawryAmount(p.paymentAmount),
      fawryAmount(p.orderAmount),
      p.orderStatus ?? '',
      p.paymentMethod ?? '',
      p.paymentRefrenceNumber ?? '',
      securityKey,
    ].join(''),
  );
}

/** Constant-time verification of a server notification V2. */
export function verifyWebhookSignature(p: FawryNotificationFields, securityKey: string): boolean {
  if (!securityKey || !p.messageSignature) return false;
  const expected = computeNotificationSignature(p, securityKey);
  const got = String(p.messageSignature).toLowerCase();
  if (expected.length !== got.length) return false;
  try {
    return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(got, 'hex'));
  } catch {
    return false;
  }
}

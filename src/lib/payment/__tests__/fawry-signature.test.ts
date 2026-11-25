import { describe, it, expect } from 'bun:test';
import { createHash } from 'crypto';
import { computeChargeSignature, computeStatusSignature, verifyWebhookSignature } from '../providers/fawry/hmac';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

describe('fawry signatures (plain SHA-256, key appended)', () => {
  it('charge', () => {
    expect(computeChargeSignature({ merchantCode: 'M', merchantRefNum: 'R', customerProfileId: 'C', paymentMethod: 'PAYATFAWRY', amount: '100.00' }, 'K'))
      .toBe(sha('MRCPAYATFAWRY100.00K'));
  });
  it('status', () => {
    expect(computeStatusSignature('M', 'R', 'K')).toBe(sha('MRK'));
  });
  it('notification v2 verifies and rejects tampering', () => {
    const p = { fawryRefNumber: '970177', merchantRefNumber: 'R', paymentAmount: 152, orderAmount: '150.00', orderStatus: 'PAID', paymentMethod: 'PAYATFAWRY', paymentRefrenceNumber: 'X1', messageSignature: '' };
    p.messageSignature = sha('970177R152.00150.00PAIDPAYATFAWRYX1K');
    expect(verifyWebhookSignature(p, 'K')).toBe(true);
    expect(verifyWebhookSignature({ ...p, orderStatus: 'NEW' }, 'K')).toBe(false);
    expect(verifyWebhookSignature(p, 'other')).toBe(false);
  });
});

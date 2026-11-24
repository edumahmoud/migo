import { describe, test, expect } from 'bun:test';
import { applyContactEmail, validateContactEmail } from '../legal';
import { DEFAULT_POLICY_MD } from '../legal-defaults';

describe('legal contact email', () => {
  test('replaces every placeholder', () => {
    expect(applyContactEmail('a {{contact_email}} b {{contact_email}}', 'x@y.com')).toBe('a x@y.com b x@y.com');
  });
  test('defaults use the placeholder, not a hardcoded address', () => {
    for (const md of Object.values(DEFAULT_POLICY_MD)) {
      expect(md).toContain('{{contact_email}}');
      expect(md).not.toMatch(/@gmail\.com/);
    }
  });
  test('validates email format', () => {
    expect(validateContactEmail('a@b.co')).toBeNull();
    expect(validateContactEmail('not-an-email')).not.toBeNull();
    expect(validateContactEmail('a b@c.com')).not.toBeNull();
  });
});

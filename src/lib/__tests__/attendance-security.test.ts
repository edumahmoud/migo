import { describe, it, expect } from 'bun:test';
import { issueAttendanceQr, verifyAttendanceQr, validPosition, UUID_PATTERN } from '../attendance-security';

const secret = 'test-only-secret-not-used-in-production';
const session = 'c52ecac1-f431-4bda-95bd-3e1aaf5d794d';
const started = '2026-11-23T12:00:00Z';
const now = 1795435200000;

describe('attendance QR challenge', () => {
  it('accepts a correctly signed current-session challenge', () => {
    const qr = issueAttendanceQr(session, started, secret, now);
    expect(verifyAttendanceQr(qr.token, session, started, secret, now)).toBe(true);
  });
  it('expires after 30 seconds, including at the boundary', () => {
    const qr = issueAttendanceQr(session, started, secret, now);
    expect(verifyAttendanceQr(qr.token, session, started, secret, now + 29000)).toBe(true);
    expect(verifyAttendanceQr(qr.token, session, started, secret, now + 30000)).toBe(false);
  });
  it('rejects another session, session restart, and another key', () => {
    const qr = issueAttendanceQr(session, started, secret, now);
    expect(verifyAttendanceQr(qr.token, 'other-session', started, secret, now)).toBe(false);
    expect(verifyAttendanceQr(qr.token, session, 'new-start', secret, now)).toBe(false);
    expect(verifyAttendanceQr(qr.token, session, started, 'another-key', now)).toBe(false);
  });
  it('rejects modified payloads and signatures', () => {
    const qr = issueAttendanceQr(session, started, secret, now);
    expect(verifyAttendanceQr(qr.token.replace('attendo:v1:', 'attendo:v1:x'), session, started, secret, now)).toBe(false);
    expect(verifyAttendanceQr(qr.token + 'a', session, started, secret, now)).toBe(false);
  });
  it('rejects old bare-ID and rotating-string formats', () => {
    expect(verifyAttendanceQr(session, session, started, secret, now)).toBe(false);
    expect(verifyAttendanceQr(session + '::1::1', session, started, secret, now)).toBe(false);
  });
  it('rejects malformed, oversized and non-string inputs without throwing', () => {
    for (const token of [null, 1, {}, '', 'attendo:v1:bad', 'x'.repeat(2100), 'attendo:v1:..']) {
      expect(verifyAttendanceQr(token, session, started, secret, now)).toBe(false);
    }
  });
  it('fails closed without a signing key', () => {
    expect(() => issueAttendanceQr(session, started, '', now)).toThrow();
    expect(verifyAttendanceQr('anything', session, started, '', now)).toBe(false);
  });
  it('rejects tokens issued in the future and generates random nonces', () => {
    const a = issueAttendanceQr(session, started, secret, now);
    const b = issueAttendanceQr(session, started, secret, now);
    expect(a.token).not.toBe(b.token);
    expect(verifyAttendanceQr(a.token, session, started, secret, now - 1000)).toBe(false);
  });
});

describe('attendance GPS input', () => {
  it('accepts good positions including zero latitude or longitude separately', () => {
    expect(validPosition(30, 31, 5)).toBe(true);
    expect(validPosition(0, 31, 5)).toBe(true);
    expect(validPosition(30, 0, 5)).toBe(true);
    expect(validPosition(-90, -180, 50)).toBe(true);
  });
  it('rejects missing, nonfinite and out-of-range positions and poor accuracy', () => {
    for (const coords of [[0, 0, 5], [91, 31, 5], [30, 181, 5], [NaN, 31, 5], [30, Infinity, 5], [30, 31, Infinity], [30, 31, 51], [30, 31, 0], [30, 31, -1], [null, 31, 5], ['30', 31, 5]]) {
      expect(validPosition(...coords as [unknown, unknown, unknown])).toBe(false);
    }
  });
  it('rejects malformed IDs', () => {
    expect(UUID_PATTERN.test(session)).toBe(true);
    expect(UUID_PATTERN.test('test-session')).toBe(false);
  });
});

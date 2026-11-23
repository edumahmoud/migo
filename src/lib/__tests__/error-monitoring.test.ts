import { describe, it, expect } from 'bun:test';
import { scrubErrorEvent } from '../error-monitoring';
import { GET } from '../../app/api/health/route';

describe('monitoring privacy', () => {
  it('removes user/request/console data and error messages', () => {
    const event = scrubErrorEvent({ user: { email: 'private@example.invalid' }, request: { url: 'https://example.invalid/?token=secret', headers: { authorization: 'secret' } }, extra: { secret: true }, breadcrumbs: [{ message: 'secret' }], message: 'secret', exception: { values: [{ type: 'PrivateName', value: 'secret', stacktrace: { frames: [{ filename: 'https://example.invalid/app.js?token=secret', lineno: 3, vars: { token: 'secret' } }] } }] } });
    expect(event.user).toBeUndefined();
    expect(event.request).toBeUndefined();
    expect(event.extra).toBeUndefined();
    expect(event.breadcrumbs).toBeUndefined();
    expect(event.message).toBeUndefined();
    expect(JSON.stringify(event)).not.toContain('secret');
    expect(event.exception?.values?.[0].stacktrace?.frames?.[0].lineno).toBe(3);
  });
  it('health returns no-cache liveness without infrastructure details', async () => {
    const response = GET();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(await response.json()).toEqual({ status: 'ok', service: 'attendo' });
  });
});

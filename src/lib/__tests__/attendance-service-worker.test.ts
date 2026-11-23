import { describe, it, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function worker() {
  const handlers: Record<string, (event: unknown) => void> = {};
  const fetched: Array<{ url: string; options: unknown }> = [];
  let cacheReads = 0;
  const context = {
    self: { location: { origin: 'https://app.test' }, addEventListener: (name: string, fn: (event: unknown) => void) => { handlers[name] = fn; } },
    caches: { match: async () => { cacheReads++; return new Response('stale'); } },
    fetch: async (request: Request, options: unknown) => { fetched.push({ url: request.url, options }); return new Response('fresh'); },
    URL, Response, console,
  };
  vm.runInNewContext(readFileSync('public/sw.js', 'utf8'), context);
  return { handlers, fetched, cacheReads: () => cacheReads };
}

describe('attendance service worker freshness', () => {
  for (const table of ['attendance_sessions', 'attendance_records']) {
    it(`never serves cached ${table}`, async () => {
      const w = worker();
      let response: Promise<Response> | undefined;
      w.handlers.fetch({ request: new Request(`https://project.supabase.co/rest/v1/${table}?select=*`), respondWith: (r: Promise<Response>) => { response = r; } });
      expect(await (await response!).text()).toBe('fresh');
      expect(w.fetched[0].options).toEqual({ cache: 'no-store' });
      expect(w.cacheReads()).toBe(0);
    });
  }
});

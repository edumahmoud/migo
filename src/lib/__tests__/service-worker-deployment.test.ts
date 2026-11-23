import { describe, it, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function worker(offline = false) {
  const handlers: Record<string, (event: any) => void> = {};
  const deleted: string[] = [];
  const added: string[] = [];
  let reads = 0;
  const context = {
    self: { location: { origin: 'https://app.test' }, clients: { claim: async () => {} }, skipWaiting: () => {}, addEventListener: (name: string, fn: any) => { handlers[name] = fn; } },
    caches: {
      keys: async () => ['atendo-static-v9', 'atendo-dynamic-v9', 'atendo-api-v9', 'atendo-static-v10'],
      delete: async (key: string) => { deleted.push(key); return true; },
      open: async () => ({ add: async (url: string) => { added.push(url); } }),
      match: async (url: string) => { reads++; return new Response(url === '/offline' ? 'offline page' : 'stale shell'); },
    },
    fetch: async () => { if (offline) throw new Error('offline'); return new Response('fresh deployment'); },
    URL, Response, console,
  };
  vm.runInNewContext(readFileSync('public/sw.js', 'utf8'), context);
  return { handlers, deleted, added, reads: () => reads };
}

describe('deployment-safe service worker', () => {
  it('never serves stale precached root HTML online', async () => {
    const w = worker(); let response: Promise<Response>;
    w.handlers.fetch({ request: new Request('https://app.test/', { headers: { accept: 'text/html' } }), respondWith: (r: Promise<Response>) => { response = r; } });
    expect(await (await response!).text()).toBe('fresh deployment');
    expect(w.reads()).toBe(0);
  });
  it('uses a dedicated offline page rather than an obsolete shell', async () => {
    const w = worker(true); let response: Promise<Response>;
    w.handlers.fetch({ request: new Request('https://app.test/', { headers: { accept: 'text/html' } }), respondWith: (r: Promise<Response>) => { response = r; } });
    expect(await (await response!).text()).toBe('offline page');
  });
  it('deletes all v9 caches on activation', async () => {
    const w = worker(); let work: Promise<unknown>;
    w.handlers.activate({ waitUntil: (p: Promise<unknown>) => { work = p; } }); await work!;
    expect(w.deleted).toEqual(['atendo-static-v9', 'atendo-dynamic-v9', 'atendo-api-v9']);
  });
  it('does not precache the root document', async () => {
    const w = worker(); let work: Promise<unknown>;
    w.handlers.install({ waitUntil: (p: Promise<unknown>) => { work = p; } }); await work!;
    expect(w.added).not.toContain('/');
    expect(w.added).toContain('/offline');
  });
});

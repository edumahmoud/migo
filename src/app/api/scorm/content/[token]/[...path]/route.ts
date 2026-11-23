import { NextRequest, NextResponse } from 'next/server';
import JSZip from 'jszip';
import { supabaseServer } from '@/lib/supabase-server';
import { contentTypeFor, safeZipPath, verifyContentToken } from '@/lib/scorm-content';
import { buildCmiData } from '@/lib/scorm-cmi';

export const maxDuration = 60;

// GET /api/scorm/content/<token>/<path inside the package>
// Serves a file out of the stored SCORM ZIP. The token is signed by /api/scorm/launch
// (iframes cannot send an Authorization header), is bound to one package + user and expires.
// Everything the SCO loads uses relative URLs, so the token stays in the base path.

interface CacheEntry {
  zip: JSZip;
  names: Map<string, string>; // lower-case -> exact entry name
  at: number;
}
const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX = 3;
const cache = new Map<string, CacheEntry>();

async function loadZip(packageId: string, storagePath: string): Promise<CacheEntry> {
  const key = `${packageId}:${storagePath}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit;

  const { data, error } = await supabaseServer.storage.from('scorm-packages').download(storagePath);
  if (error || !data) throw new Error('Package file not found in storage');
  const zip = await JSZip.loadAsync(Buffer.from(await data.arrayBuffer()));
  const names = new Map<string, string>();
  for (const name of Object.keys(zip.files)) {
    if (!zip.files[name].dir) names.set(name.toLowerCase(), name);
  }
  const entry: CacheEntry = { zip, names, at: Date.now() };
  cache.set(key, entry);
  while (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
  return entry;
}

function plain(status: number, message: string) {
  return new NextResponse(message, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ token: string; path: string[] }> },
) {
  try {
    const { token, path } = await context.params;

    let payload;
    try {
      payload = verifyContentToken(token);
    } catch {
      return plain(500, 'SCORM content is not configured');
    }
    if (!payload) return plain(403, 'Link expired or invalid. Reopen the lesson.');

    const entryPath = safeZipPath(path);
    if (!entryPath) return plain(400, 'Invalid path');

    const { data: pkg } = await supabaseServer
      .from('scorm_packages')
      .select('id, storage_path, status, version')
      .eq('id', payload.p)
      .maybeSingle();
    if (!pkg) return plain(404, 'Package not found');
    if (pkg.status !== 'active' && payload.m !== 1) return plain(403, 'Package is not active');

    const { zip, names } = await loadZip(pkg.id, pkg.storage_path);
    const exact = zip.files[entryPath] && !zip.files[entryPath].dir ? entryPath : names.get(entryPath.toLowerCase());
    if (!exact) return plain(404, 'File not found in package');

    let bytes = await zip.files[exact].async('uint8array');
    const type = contentTypeFor(exact);

    // HTML pages get the SCORM API injected (it runs inside the sandboxed frame)
    if (type.startsWith('text/html') && payload.r && (pkg.version === '1.2' || pkg.version === '2004')) {
      let tracking: Record<string, unknown> | null = null;
      if (payload.t === 1) {
        const { data } = await supabaseServer
          .from('scorm_tracking')
          .select('*')
          .eq('student_id', payload.u)
          .eq('resource_id', payload.r)
          .maybeSingle();
        tracking = data || null;
      }
      const { data: learner } = await supabaseServer.from('users').select('name').eq('id', payload.u).maybeSingle();
      const cmi = buildCmiData(pkg.version, tracking, learner?.name || '', payload.u, payload.t !== 1);
      bytes = injectShim(bytes, pkg.version, cmi);
    }

    return new NextResponse(bytes as unknown as BodyInit, {
      status: 200,
      headers: {
        'Content-Type': type,
        'Content-Length': String(bytes.byteLength),
        'Cache-Control': type.startsWith('text/html') ? 'private, no-store' : 'private, max-age=300',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
        // The package is untrusted code: give it an opaque origin so it cannot touch the app
        // (cookies, storage, parent window) even if someone opens this URL directly.
        'Content-Security-Policy': 'sandbox allow-scripts allow-forms allow-popups allow-modals allow-downloads',
        // Opaque-origin pages need CORS for their own XHR/fetch/font requests. The token is the secret.
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error) {
    console.error('[SCORM Content] GET error:', error);
    return plain(500, 'Failed to load SCORM content');
  }
}

/** Insert the API bootstrap right after <head> (or at the top). Works on bytes so the page's encoding is untouched. */
function injectShim(bytes: Uint8Array, version: string, cmi: Record<string, unknown>): Uint8Array {
  const boot = JSON.stringify({ version, cmi })
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
    .replace(/[\u0080-\uffff]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
  const snippet = `<script>window.__SCORM_BOOT=${boot};</script><script src="/scorm-shim.js"></script>`;
  const html = Buffer.from(bytes).toString('latin1');
  const m = /<head[^>]*>/i.exec(html);
  const at = m ? m.index + m[0].length : 0;
  return Buffer.from(html.slice(0, at) + snippet + html.slice(at), 'latin1');
}

import { NextRequest, NextResponse } from 'next/server';
import JSZip from 'jszip';
import { supabaseServer } from '@/lib/supabase-server';
import { contentTypeFor, safeZipPath, verifyContentToken } from '@/lib/scorm-content';

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
      .select('id, storage_path, status')
      .eq('id', payload.p)
      .maybeSingle();
    if (!pkg) return plain(404, 'Package not found');
    if (pkg.status !== 'active' && payload.m !== 1) return plain(403, 'Package is not active');

    const { zip, names } = await loadZip(pkg.id, pkg.storage_path);
    const exact = zip.files[entryPath] && !zip.files[entryPath].dir ? entryPath : names.get(entryPath.toLowerCase());
    if (!exact) return plain(404, 'File not found in package');

    const bytes = await zip.files[exact].async('uint8array');
    return new NextResponse(bytes as unknown as BodyInit, {
      status: 200,
      headers: {
        'Content-Type': contentTypeFor(exact),
        'Content-Length': String(bytes.byteLength),
        'Cache-Control': 'private, max-age=300',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
      },
    });
  } catch (error) {
    console.error('[SCORM Content] GET error:', error);
    return plain(500, 'Failed to load SCORM content');
  }
}

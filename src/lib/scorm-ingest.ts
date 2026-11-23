// =====================================================
// SCORM package ingestion (server only)
// Validates a ZIP, parses imsmanifest.xml, stores the ZIP in the private
// "scorm-packages" bucket and writes package + resource rows.
// The ZIP is served later by /api/scorm/content, so nothing is unzipped into storage.
// =====================================================

import JSZip from 'jszip';
import { randomBytes } from 'crypto';
import { supabaseServer } from '@/lib/supabase-server';
import { parseScormManifest, type ParsedScormManifest } from '@/lib/scorm-manifest';
import type { ScormVersion } from '@/lib/scorm-types';

export const MAX_SCORM_ZIP_BYTES = 50 * 1024 * 1024;
const MAX_ENTRIES = 10000;
const MAX_UNCOMPRESSED_BYTES = 500 * 1024 * 1024;

export class ScormIngestError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export interface InspectedPackage {
  zip: JSZip;
  manifestXml: string;
  parsed: ParsedScormManifest;
  warnings: string[];
}

/** Find a zip entry ignoring case, returning the exact entry name. */
function findEntry(zip: JSZip, name: string): string | null {
  const lower = name.toLowerCase();
  for (const key of Object.keys(zip.files)) {
    if (!zip.files[key].dir && key.toLowerCase() === lower) return key;
  }
  return null;
}

export async function inspectScormZip(buffer: Buffer): Promise<InspectedPackage> {
  if (buffer.byteLength === 0) throw new ScormIngestError('The ZIP file is empty');
  if (buffer.byteLength > MAX_SCORM_ZIP_BYTES) throw new ScormIngestError('File size exceeds the 50MB limit');

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch {
    throw new ScormIngestError('Invalid or corrupted ZIP file');
  }

  const names = Object.keys(zip.files);
  if (names.length > MAX_ENTRIES) throw new ScormIngestError('The ZIP contains too many files');
  let total = 0;
  for (const n of names) {
    const size = (zip.files[n] as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize;
    if (typeof size === 'number') total += size;
  }
  if (total > MAX_UNCOMPRESSED_BYTES) throw new ScormIngestError('The ZIP expands to more than 500MB');

  const manifestName = findEntry(zip, 'imsmanifest.xml');
  if (!manifestName) {
    throw new ScormIngestError(
      'imsmanifest.xml not found in the ZIP root. Zip the contents of the SCORM folder, not the folder itself.',
    );
  }
  const manifestXml = (await zip.files[manifestName].async('string')).replace(/^\uFEFF/, '');
  if (!manifestXml.trim()) throw new ScormIngestError('imsmanifest.xml is empty');

  const parsed = parseScormManifest(manifestXml);
  if (parsed.totalLaunchable === 0) {
    throw new ScormIngestError('No launchable content found in the manifest. The package may be empty or malformed.');
  }

  const warnings: string[] = [];
  const lowerNames = new Set(names.map((n) => n.toLowerCase()));
  for (const node of parsed.nodes) {
    if (!node.isLeaf) continue;
    let path: string;
    try {
      path = decodeURIComponent(node.href.split('#')[0].split('?')[0]);
    } catch {
      path = node.href.split('#')[0].split('?')[0];
    }
    if (/^[a-z][a-z0-9+.-]*:/i.test(path)) continue; // external URL
    if (!lowerNames.has(path.toLowerCase())) warnings.push(`Missing file: ${path}`);
  }
  if (warnings.length > 0 && warnings.length >= parsed.totalLaunchable) {
    throw new ScormIngestError('None of the launch files listed in the manifest exist in the ZIP');
  }

  return { zip, manifestXml, parsed, warnings };
}

function storageKey(prefix: string): string {
  return `${prefix}/${Date.now()}_${randomBytes(6).toString('hex')}.zip`;
}

export interface StorePackageInput {
  buffer: Buffer;
  /** Already uploaded to the bucket (direct upload flow): skip the re-upload */
  existingKey?: string;
  inspected: InspectedPackage;
  userId: string;
  title: string;
  description?: string | null;
  /** null = platform library package */
  subjectId: string | null;
  versionOverride?: ScormVersion | null;
}

export async function storeScormPackage(input: StorePackageInput) {
  const { buffer, inspected, userId, title, description, subjectId, versionOverride } = input;
  const { parsed, manifestXml } = inspected;
  const key = input.existingKey || storageKey(subjectId || 'library');

  if (!input.existingKey) {
    const { error: uploadError } = await supabaseServer.storage
      .from('scorm-packages')
      .upload(key, buffer, { contentType: 'application/zip', upsert: false });
    if (uploadError) {
      throw new ScormIngestError(storageErrorMessage(uploadError.message), 500);
    }
  }

  const packageRow: Record<string, unknown> = {
    title: title.trim() || parsed.title || 'SCORM package',
    description: description?.trim() || null,
    version: versionOverride || parsed.version,
    manifest_xml: manifestXml,
    uploaded_by: userId,
    subject_id: subjectId,
    status: 'active',
    entry_point: parsed.entryPoint,
    total_objects: parsed.totalLaunchable,
    package_size: buffer.byteLength,
    storage_path: key,
  };

  const { data: pkg, error: pkgError } = await supabaseServer
    .from('scorm_packages')
    .insert(packageRow)
    .select()
    .single();
  if (pkgError || !pkg) {
    await supabaseServer.storage.from('scorm-packages').remove([key]);
    throw new ScormIngestError('Failed to save the SCORM package: ' + (pkgError?.message || 'unknown error'), 500);
  }

  const resourceRows = parsed.nodes.map((n) => ({
    package_id: pkg.id,
    identifier: n.identifier,
    title: n.title,
    type: n.scormType === 'sco' ? 'sco' : 'asset',
    href: n.isLeaf ? n.href : null,
    scorm_type: n.scormType,
    parent_identifier: n.parentIdentifier,
    order_index: n.orderIndex,
    launch_url: n.isLeaf ? n.href : '',
  }));

  const { data: resources, error: resError } = await supabaseServer
    .from('scorm_resources')
    .insert(resourceRows)
    .select();
  if (resError) {
    // Without resources the package cannot be played: roll everything back
    await supabaseServer.from('scorm_packages').delete().eq('id', pkg.id);
    await supabaseServer.storage.from('scorm-packages').remove([key]);
    throw new ScormIngestError('Failed to save the SCORM resources: ' + resError.message, 500);
  }

  return { pkg, resources: resources || [], warnings: inspected.warnings };
}

// ─── Direct-to-storage upload (Vercel limits request bodies to 4.5MB) ───

export function newUploadKey(userId: string): string {
  return `uploads/${userId}/${Date.now()}_${randomBytes(6).toString('hex')}.zip`;
}

export function isOwnUploadKey(key: unknown, userId: string): key is string {
  return typeof key === 'string' && key.startsWith(`uploads/${userId}/`) && key.endsWith('.zip') && !key.includes('..');
}

export async function createUploadTicket(userId: string, sizeBytes: number, filename: string) {
  if (!filename.toLowerCase().endsWith('.zip')) throw new ScormIngestError('Only ZIP files are accepted');
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) throw new ScormIngestError('Invalid file size');
  if (sizeBytes > MAX_SCORM_ZIP_BYTES) throw new ScormIngestError('File size exceeds the 50MB limit');
  const path = newUploadKey(userId);
  const { data, error } = await supabaseServer.storage.from('scorm-packages').createSignedUploadUrl(path);
  if (error || !data) {
    throw new ScormIngestError(storageErrorMessage(error?.message || 'unknown error'), 500);
  }
  return { path, token: data.token };
}

export async function downloadUpload(key: string): Promise<Buffer> {
  const { data, error } = await supabaseServer.storage.from('scorm-packages').download(key);
  if (error || !data) throw new ScormIngestError('Uploaded file not found. Please upload again.', 404);
  return Buffer.from(await data.arrayBuffer());
}

export async function removeUpload(key: string) {
  await supabaseServer.storage.from('scorm-packages').remove([key]);
}

export function storageErrorMessage(message: string): string {
  if (/bucket.*not found|bucket.*does not exist/i.test(message)) {
    return 'SCORM storage is not set up. Ask the administrator to create the private scorm-packages bucket (50MB limit) in Supabase, then try again.';
  }
  return 'Could not store the SCORM package: ' + message;
}

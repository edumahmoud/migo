import { NextRequest, NextResponse } from 'next/server';
import { requireTeacher, authErrorResponse, getUserRole } from '@/lib/auth-helpers';
import { isSubjectTeacher, UUID_REGEX } from '@/lib/scorm-access';
import { ScormIngestError, createUploadTicket, downloadUpload, inspectScormZip, isOwnUploadKey, removeUpload, storeScormPackage } from '@/lib/scorm-ingest';
import type { ScormVersion } from '@/lib/scorm-types';

/** Shared by course uploads and the teacher-only platform library. */
export async function handleScormUpload(request: NextRequest, library: boolean) {
  const auth = await requireTeacher(request);
  if (!auth.success) return authErrorResponse(auth);
  const userId = auth.user.id;
  // The platform library is teacher-upload only; admins manage but do not upload.
  if (library && (await getUserRole(userId)) !== 'teacher') {
    return NextResponse.json({ success: false, error: 'رفع الحزم إلى المكتبة متاح للمعلمين فقط' }, { status: 403 });
  }
  let ownedKey: string | undefined;
  try {
    let fields: Record<string, unknown>;
    let buffer: Buffer | undefined;
    let filename = '';
    if (request.headers.get('content-type')?.includes('application/json')) {
      fields = await request.json();
      filename = String(fields.filename || '');
    } else {
      // Bound consumption before formData allocates the multipart body. Larger
      // packages must use the signed direct-to-storage flow.
      const reader = request.body?.getReader();
      if (!reader) throw new ScormIngestError('A ZIP file is required');
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > 4 * 1024 * 1024) {
          await reader.cancel();
          throw new ScormIngestError('Use direct upload for files larger than 3.5MB', 413);
        }
        chunks.push(value);
      }
      const form = await new Response(Buffer.concat(chunks), {
        headers: { 'content-type': request.headers.get('content-type') || '' },
      }).formData();
      fields = Object.fromEntries(form.entries());
      const file = form.get('file');
      if (!(file instanceof File)) throw new ScormIngestError('A ZIP file is required');
      filename = file.name;
      if (!filename.toLowerCase().endsWith('.zip')) throw new ScormIngestError('Only ZIP files are accepted');
      if (file.size > 50 * 1024 * 1024) throw new ScormIngestError('File size exceeds the 50MB limit');
      buffer = Buffer.from(await file.arrayBuffer());
    }
    const subjectId = library ? null : String(fields.subjectId || '');
    if (!library) {
      if (!subjectId || !UUID_REGEX.test(subjectId)) throw new ScormIngestError('A valid subjectId is required');
      const role = await getUserRole(userId);
      if (role !== 'admin' && role !== 'superadmin' && !(await isSubjectTeacher(userId, subjectId))) {
        throw new ScormIngestError('You may only upload to courses you teach', 403);
      }
    }
    if (fields.action === 'init') {
      return NextResponse.json({ success: true, data: await createUploadTicket(userId, Number(fields.size), filename) });
    }
    if (fields.action === 'complete') {
      if (!isOwnUploadKey(fields.path, userId)) throw new ScormIngestError('Invalid upload reference');
      ownedKey = fields.path;
      buffer = await downloadUpload(ownedKey);
    } else if (fields.action) {
      throw new ScormIngestError('Unknown upload action');
    }
    if (!buffer) throw new ScormIngestError('A ZIP file is required');
    const inspected = await inspectScormZip(buffer);
    const version: ScormVersion | null = fields.version === '2004' ? '2004' : fields.version === '1.2' ? '1.2' : null;
    const result = await storeScormPackage({ buffer, inspected, userId, subjectId,
      title: String(fields.title || inspected.parsed.title || filename.replace(/\.zip$/i, '')),
      description: fields.description ? String(fields.description) : null, versionOverride: version });
    // Commit to a new server-generated key, never adopt the staging key. Retrying
    // completion cannot make failure cleanup delete an earlier committed ZIP.
    if (ownedKey) await removeUpload(ownedKey).catch(() => {});
    ownedKey = undefined;
    return NextResponse.json({ success: true, data: { ...result.pkg, resources: result.resources, warnings: result.warnings } });
  } catch (error) {
    if (error instanceof ScormIngestError) return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    console.error('[SCORM Upload]', error);
    return NextResponse.json({ success: false, error: 'SCORM upload failed. Please try again.' }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { requireTeacher, authErrorResponse } from '@/lib/auth-helpers';
import {
  ScormIngestError,
  createUploadTicket,
  downloadUpload,
  inspectScormZip,
  isOwnUploadKey,
  removeUpload,
  storeScormPackage,
} from '@/lib/scorm-ingest';
import type { ScormVersion } from '@/lib/scorm-types';

export const maxDuration = 120;

// POST /api/scorm/platform-import
// Imports a SCORM ZIP as a new subject (course) owned by the caller, with one draft lesson per launchable item.
//  - JSON { action: 'init', filename, size } -> signed upload ticket (file goes straight to storage)
//  - JSON { action: 'complete', path, name, description?, version? } -> create the subject + package
//  - multipart { file, name, description?, version? } -> small files only (Vercel body limit 4.5MB)
export async function POST(request: NextRequest) {
  const authResult = await requireTeacher(request);
  if (!authResult.success) return authErrorResponse(authResult);
  const userId = authResult.user.id;

  let uploadedKey: string | null = null;
  let createdSubjectId: string | null = null;
  try {
    const contentType = request.headers.get('content-type') || '';
    let action = 'multipart';
    let buffer: Buffer | null = null;
    let subjectName = '';
    let subjectDescription: string | null = null;
    let version: ScormVersion | null = null;
    let filename = '';
    let size = 0;

    if (contentType.includes('application/json')) {
      const body = await request.json();
      action = String(body.action || '');
      subjectName = String(body.name || '');
      subjectDescription = body.description ? String(body.description) : null;
      version = body.version === '2004' ? '2004' : body.version === '1.2' ? '1.2' : null;
      filename = String(body.filename || '');
      size = Number(body.size || 0);
      uploadedKey = body.path || null;
    } else {
      const form = await request.formData();
      const file = form.get('file') as File | null;
      subjectName = String(form.get('name') || '');
      subjectDescription = (form.get('description') as string | null) || null;
      const v = form.get('version');
      version = v === '2004' ? '2004' : v === '1.2' ? '1.2' : null;
      if (!file) return NextResponse.json({ success: false, error: 'A ZIP file is required' }, { status: 400 });
      if (!file.name.toLowerCase().endsWith('.zip')) {
        return NextResponse.json({ success: false, error: 'Only ZIP files are accepted' }, { status: 400 });
      }
      filename = file.name;
      buffer = Buffer.from(await file.arrayBuffer());
    }

    if (action === 'init') {
      return NextResponse.json({ success: true, data: await createUploadTicket(userId, size, filename) });
    }

    if (!subjectName.trim()) {
      return NextResponse.json({ success: false, error: 'Subject name is required' }, { status: 400 });
    }

    let existingKey: string | undefined;
    if (action === 'complete') {
      if (!isOwnUploadKey(uploadedKey, userId)) {
        return NextResponse.json({ success: false, error: 'Invalid upload reference' }, { status: 400 });
      }
      existingKey = uploadedKey;
      buffer = await downloadUpload(uploadedKey);
    } else if (action !== 'multipart' || !buffer) {
      return NextResponse.json({ success: false, error: 'Unknown action' }, { status: 400 });
    }

    // Validate the package before creating anything
    const inspected = await inspectScormZip(buffer);

    const { data: subject, error: subjectError } = await supabaseServer
      .from('subjects')
      .insert({
        teacher_id: userId,
        name: subjectName.trim(),
        description: subjectDescription?.trim() || null,
        educational_level: 'university',
        code: `SCORM_${Date.now()}`,
      })
      .select()
      .single();
    if (subjectError || !subject) {
      throw new ScormIngestError('Failed to create subject: ' + (subjectError?.message || 'Unknown error'), 500);
    }
    createdSubjectId = subject.id;

    const result = await storeScormPackage({
      buffer,
      existingKey,
      inspected,
      userId,
      title: subjectName,
      description: subjectDescription?.trim() || `SCORM ${version || inspected.parsed.version} package imported for subject: ${subjectName.trim()}`,
      subjectId: subject.id,
      versionOverride: version,
    });
    uploadedKey = null; // owned by the package record now

    // One draft lesson per launchable item, in manifest order
    const lessonRows = inspected.parsed.nodes
      .filter((n) => n.isLeaf)
      .map((n, index) => ({
        subject_id: subject.id,
        title: n.title,
        content_html:
          '<div class="scorm-imported-lesson"><p>This lesson was imported from a SCORM package. Launch it via the SCORM player to view the original content.</p></div>',
        status: 'draft',
        order_index: index,
      }));
    const { data: lessons, error: lessonsError } = await supabaseServer.from('lessons').insert(lessonRows).select();
    if (lessonsError) console.error('[SCORM Platform Import] Lessons creation error:', lessonsError.message);

    return NextResponse.json({
      success: true,
      data: {
        subject,
        lessons: lessons || [],
        package: result.pkg,
        resources: result.resources,
        warnings: result.warnings,
      },
    });
  } catch (error) {
    if (createdSubjectId) await supabaseServer.from('subjects').delete().eq('id', createdSubjectId);
    if (uploadedKey && isOwnUploadKey(uploadedKey, userId)) await removeUpload(uploadedKey).catch(() => {});
    if (error instanceof ScormIngestError) {
      return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    }
    console.error('[SCORM Platform Import] POST error:', error);
    const message = error instanceof Error ? error.message : 'An unexpected error occurred';
    return NextResponse.json({ success: false, error: 'Platform SCORM import failed: ' + message }, { status: 500 });
  }
}

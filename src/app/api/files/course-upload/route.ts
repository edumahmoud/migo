import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateRequest, authErrorResponse, verifyOwnership, getUserRole } from '@/lib/auth-helpers';

const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'text/plain',
  'text/csv',
  'application/zip',
  'video/mp4',
  'audio/mpeg',
  'audio/wav',
];

// SECURITY: When a mobile browser sends application/octet-stream (unknown MIME),
// we fall back to validating by file extension instead.
const ALLOWED_EXTENSIONS = [
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.jpg', '.jpeg', '.png', '.gif', '.webp',
  '.txt', '.csv', '.zip',
  '.mp4', '.mp3', '.wav',
];

const DANGEROUS_EXTENSIONS = [
  '.exe', '.bat', '.cmd', '.sh', '.bash', '.ps1', '.vbs', '.js', '.mjs',
  '.html', '.htm', '.svg', '.dll', '.so', '.app', '.deb', '.rpm',
  '.jar', '.war', '.msi', '.com', '.scr', '.pif', '.cpl',
];

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
const MAX_JSON_FILE_SIZE = 50 * 1024 * 1024; // 50MB (same limit for JSON mode)

// Allowed Supabase storage URL patterns — prevents SSRF via arbitrary URLs
const ALLOWED_STORAGE_URL_PATTERNS = [
  '/storage/v1/object/public/',
  '/storage/v1/object/sign/',
];

/**
 * Check for duplicate file names in a subject.
 * Same name + same extension → reject (DUPLICATE_NAME)
 * Same base name + different extension → allow
 */
async function checkDuplicateFileName(
  subjectId: string,
  displayName: string
): Promise<NextResponse | null> {
  const { data: existingFiles } = await supabaseServer
    .from('subject_files')
    .select('file_name')
    .eq('subject_id', subjectId);

  if (existingFiles && existingFiles.length > 0) {
    const exactDuplicate = existingFiles.some((f: { file_name: string }) =>
      f.file_name.toLowerCase() === displayName.toLowerCase()
    );
    if (exactDuplicate) {
      return NextResponse.json(
        { success: false, error: 'يوجد ملف بنفس الاسم والامتداد. يرجى تغيير اسم الملف', code: 'DUPLICATE_NAME' },
        { status: 409 }
      );
    }
    // Note: Same base name but different extension is ALLOWED
    // (e.g., "report.pdf" and "report.docx" can coexist)
  }
  return null; // No duplicate found
}

export async function POST(request: NextRequest) {
  const authResult = await authenticateRequest(request);
  if (!authResult.success) return authErrorResponse(authResult);

  try {
    const contentType = request.headers.get('content-type') || '';

    // ── Mode 1: JSON body (file already uploaded to Supabase Storage directly) ──
    // This mode is used by the mobile PWA upload flow to bypass Vercel's 4.5MB body limit.
    // The file was uploaded directly to Supabase Storage from the client, and only
    // metadata is sent here to create the DB record.
    if (contentType.includes('application/json')) {
      const body = await request.json();
      const { subjectId, uploadedBy, displayName, fileUrl, storagePath, fileSize, fileType: rawFileType, category, customName, description, userFileId } = body;

      if (!subjectId || !uploadedBy || !fileUrl) {
        return NextResponse.json(
          { success: false, error: 'معرف المقرر ومعرف المستخدم ورابط الملف مطلوبون' },
          { status: 400 }
        );
      }

      // Verify that the authenticated user matches the uploadedBy user
      const ownershipError = verifyOwnership(authResult.user.id, uploadedBy);
      if (ownershipError) return authErrorResponse(ownershipError);

      // SECURITY FIX: Verify the user is a teacher/admin of the subject.
      // Previously, any authenticated user (including students) could upload files.
      const uploaderRole = await getUserRole(authResult.user.id);
      if (!uploaderRole || (uploaderRole !== 'teacher' && uploaderRole !== 'admin' && uploaderRole !== 'superadmin')) {
        return NextResponse.json(
          { success: false, error: 'رفع الملفات متاح للمعلمين والمشرفين فقط' },
          { status: 403 }
        );
      }

      // Verify the teacher/admin is associated with the subject
      if (uploaderRole === 'teacher') {
        const { data: teacherLink } = await supabaseServer
          .from('subjects')
          .select('id')
          .eq('id', subjectId)
          .eq('teacher_id', authResult.user.id)
          .maybeSingle();
        const { data: coTeacherLink } = await supabaseServer
          .from('subject_teachers')
          .select('id')
          .eq('subject_id', subjectId)
          .eq('teacher_id', authResult.user.id)
          .maybeSingle();
        if (!teacherLink && !coTeacherLink) {
          return NextResponse.json(
            { success: false, error: 'غير مصرح برفع ملفات في هذا المقرر' },
            { status: 403 }
          );
        }
      }

      // SECURITY FIX: Validate file size in JSON mode.
      // Previously, JSON mode had no size limit — clients could claim any size.
      if (fileSize && fileSize > MAX_JSON_FILE_SIZE) {
        return NextResponse.json(
          { success: false, error: 'حجم الملف يتجاوز الحد الأقصى (50 ميجابايت)' },
          { status: 400 }
        );
      }

      // SECURITY FIX: Validate fileUrl is a legitimate Supabase storage URL.
      // Prevents SSRF — previously clients could pass any arbitrary URL.
      if (fileUrl && !ALLOWED_STORAGE_URL_PATTERNS.some(pattern => fileUrl.includes(pattern))) {
        return NextResponse.json(
          { success: false, error: 'رابط الملف غير صالح — يجب أن يكون رابط تخزين معتمد' },
          { status: 400 }
        );
      }

      // ── Duplicate name check for JSON mode ──
      const effectiveDisplayName = displayName || customName || 'ملف';
      const dupCheck = await checkDuplicateFileName(subjectId, effectiveDisplayName);
      if (dupCheck) return dupCheck;

      // Determine file type from MIME
      let fileType = 'other';
      if (rawFileType?.startsWith('image/')) fileType = 'image';
      else if (rawFileType === 'application/pdf') fileType = 'pdf';
      else if (rawFileType?.includes('word') || rawFileType?.includes('document')) fileType = 'document';
      else if (rawFileType?.includes('sheet') || rawFileType?.includes('excel')) fileType = 'spreadsheet';
      else if (rawFileType?.includes('presentation') || rawFileType?.includes('powerpoint')) fileType = 'presentation';
      else if (rawFileType === 'text/plain' || rawFileType === 'text/csv') fileType = 'text';
      else if (rawFileType?.includes('zip') || rawFileType?.includes('compressed')) fileType = 'archive';

      // Insert into subject_files
      const insertDataFull: Record<string, unknown> = {
        subject_id: subjectId,
        uploaded_by: uploadedBy,
        file_name: effectiveDisplayName,
        file_type: fileType,
        file_size: fileSize || 0,
        file_url: fileUrl,
        description: description || null,
        category: category || null,
        visibility: 'public',
      };

      if (userFileId) {
        insertDataFull.user_file_id = userFileId;
      }

      let fileRecord = null;
      let dbError = null;

      // First attempt: with full columns
      const fullResult = await supabaseServer
        .from('subject_files')
        .insert(insertDataFull)
        .select()
        .single();

      if (fullResult.error) {
        const errMsg = fullResult.error.message || '';
        if (errMsg.includes('user_file_id') || errMsg.includes('visibility') || errMsg.includes('does not exist') || errMsg.includes('schema cache')) {
          console.warn('subject_files missing columns, retrying without visibility/user_file_id. Run v6 migration:', errMsg);
          const insertDataBasic: Record<string, unknown> = {
            subject_id: subjectId,
            uploaded_by: uploadedBy,
            file_name: effectiveDisplayName,
            file_type: fileType,
            file_size: fileSize || 0,
            file_url: fileUrl,
            description: description || null,
            category: category || null,
          };

          const basicResult = await supabaseServer
            .from('subject_files')
            .insert(insertDataBasic)
            .select()
            .single();

          fileRecord = basicResult.data;
          dbError = basicResult.error;
        } else {
          dbError = fullResult.error;
        }
      } else {
        fileRecord = fullResult.data;
      }

      if (dbError) {
        console.error('DB insert error (JSON mode):', dbError);
        // Try to clean up the storage file since the DB record failed
        if (storagePath) {
          await supabaseServer.storage.from('user-files').remove([storagePath]);
        }
        return NextResponse.json(
          { success: false, error: 'حدث خطأ أثناء حفظ بيانات الملف' },
          { status: 500 }
        );
      }

      return NextResponse.json({
        success: true,
        data: fileRecord,
      });
    }

    // ── Mode 2: FormData body (file uploaded through this endpoint) ──
    // This is the original flow where the file is sent as FormData through Vercel.
    // Kept for backward compatibility but subject to Vercel's 4.5MB body size limit.
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const subjectId = formData.get('subjectId') as string | null;
    const uploadedBy = formData.get('uploadedBy') as string | null;
    const description = formData.get('description') as string | null;
    const category = formData.get('category') as string | null;
    const customName = formData.get('customName') as string | null;
    const visibility = formData.get('visibility') as string | null;
    const userFileId = formData.get('userFileId') as string | null;

    if (!file || !subjectId || !uploadedBy) {
      return NextResponse.json(
        { success: false, error: 'الملف ومعرف المقرر ومعرف المستخدم مطلوبون' },
        { status: 400 }
      );
    }

    // Verify that the authenticated user matches the uploadedBy user
    const ownershipError = verifyOwnership(authResult.user.id, uploadedBy);
    if (ownershipError) return authErrorResponse(ownershipError);

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { success: false, error: 'حجم الملف يتجاوز الحد الأقصى (50 ميجابايت)' },
        { status: 400 }
      );
    }

    if (!ALLOWED_MIME_TYPES.includes(file.type)) {
      // SECURITY: Mobile browsers often send application/octet-stream for known file types.
      // Fall back to extension-based validation when the MIME type is unrecognized.
      const ext = file.name.includes('.') ? '.' + file.name.split('.').pop()?.toLowerCase() : '';
      const isDangerous = DANGEROUS_EXTENSIONS.includes(ext);
      const isAllowedExt = ALLOWED_EXTENSIONS.includes(ext);

      if (isDangerous || !isAllowedExt) {
        return NextResponse.json(
          { success: false, error: `نوع الملف غير مدعوم: ${file.type || 'غير معروف'}${ext ? ` (${ext})` : ''}` },
          { status: 400 }
        );
      }
      // Extension is allowed — proceed with the upload
    }

    // Determine the display name and storage file name
    const originalExt = file.name.includes('.') ? '.' + file.name.split('.').pop() : '';
    const displayName = customName?.trim() ? customName.trim() + originalExt : file.name;

    // ── Duplicate name check for FormData mode ──
    const dupCheck = await checkDuplicateFileName(subjectId, displayName);
    if (dupCheck) return dupCheck;

    // Use a safe ASCII path for storage (timestamp + sanitized) but store the display name in DB
    const safeStorageName = `${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    const filePath = `courses/${subjectId}/${safeStorageName}`;

    const { error: uploadError } = await supabaseServer.storage
      .from('user-files')
      .upload(filePath, file, { upsert: false });

    if (uploadError) {
      console.error('Storage upload error:', uploadError);
      return NextResponse.json(
        { success: false, error: 'حدث خطأ أثناء رفع الملف' },
        { status: 500 }
      );
    }

    const { data: urlData } = supabaseServer.storage
      .from('user-files')
      .getPublicUrl(filePath);

    const fileUrl = urlData?.publicUrl || '';

    // Determine file type
    let fileType = 'other';
    if (file.type.startsWith('image/')) fileType = 'image';
    else if (file.type === 'application/pdf') fileType = 'pdf';
    else if (file.type.includes('word') || file.type.includes('document')) fileType = 'document';
    else if (file.type.includes('sheet') || file.type.includes('excel')) fileType = 'spreadsheet';
    else if (file.type.includes('presentation') || file.type.includes('powerpoint')) fileType = 'presentation';
    else if (file.type === 'text/plain' || file.type === 'text/csv') fileType = 'text';
    else if (file.type.includes('zip') || file.type.includes('compressed')) fileType = 'archive';

    // Insert into subject_files
    // Try with full columns first (visibility, user_file_id), fall back to basic columns if migration not yet applied
    const insertDataFull: Record<string, unknown> = {
      subject_id: subjectId,
      uploaded_by: uploadedBy,
      file_name: displayName,
      file_type: fileType,
      file_size: file.size,
      file_url: fileUrl,
      description: description || null,
      category: category || null,
      visibility: 'public',
    };

    if (userFileId) {
      insertDataFull.user_file_id = userFileId;
    }

    let fileRecord = null;
    let dbError = null;

    // First attempt: with full columns
    const fullResult = await supabaseServer
      .from('subject_files')
      .insert(insertDataFull)
      .select()
      .single();

    if (fullResult.error) {
      // Check if error is due to missing columns (migration not applied)
      const errMsg = fullResult.error.message || '';
      if (errMsg.includes('user_file_id') || errMsg.includes('visibility') || errMsg.includes('does not exist') || errMsg.includes('schema cache')) {
        console.warn('subject_files missing columns, retrying without visibility/user_file_id. Run v6 migration:', errMsg);
        // Second attempt: without optional columns
        const insertDataBasic: Record<string, unknown> = {
          subject_id: subjectId,
          uploaded_by: uploadedBy,
          file_name: displayName,
          file_type: fileType,
          file_size: file.size,
          file_url: fileUrl,
          description: description || null,
          category: category || null,
        };

        const basicResult = await supabaseServer
          .from('subject_files')
          .insert(insertDataBasic)
          .select()
          .single();

        fileRecord = basicResult.data;
        dbError = basicResult.error;
      } else {
        dbError = fullResult.error;
      }
    } else {
      fileRecord = fullResult.data;
    }

    if (dbError) {
      console.error('DB insert error:', dbError);
      await supabaseServer.storage.from('user-files').remove([filePath]);
      return NextResponse.json(
        { success: false, error: 'حدث خطأ أثناء حفظ بيانات الملف' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      data: fileRecord,
    });
  } catch (error) {
    console.error('Course file upload error:', error);
    return NextResponse.json(
      { success: false, error: 'حدث خطأ غير متوقع' },
      { status: 500 }
    );
  }
}

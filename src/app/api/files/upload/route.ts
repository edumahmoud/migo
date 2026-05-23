import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateRequest, authErrorResponse, verifyOwnership } from '@/lib/auth-helpers';

/**
 * POST /api/files/upload
 *
 * Upload a personal file (to "my files" / user_files table).
 * Supports FormData mode (file sent directly) and is the PRIMARY
 * upload path for the personal-files-section component.
 *
 * The client also has a fallback (direct Supabase Storage upload + create-record),
 * but this route is preferred because:
 * 1. It handles storage + DB in one atomic operation
 * 2. It preserves the original MIME type
 * 3. It stores the storagePath for proper deletion later
 */

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

export async function POST(request: NextRequest) {
  const authResult = await authenticateRequest(request);
  if (!authResult.success) return authErrorResponse(authResult);

  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const userId = formData.get('userId') as string | null;
    const customName = formData.get('customName') as string | null;

    if (!file || !userId) {
      return NextResponse.json(
        { success: false, error: 'الملف ومعرف المستخدم مطلوبان' },
        { status: 400 }
      );
    }

    // Verify that the authenticated user matches the requested userId
    const ownershipError = verifyOwnership(authResult.user.id, userId);
    if (ownershipError) return authErrorResponse(ownershipError);

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { success: false, error: 'حجم الملف يتجاوز الحد الأقصى (50 ميجابايت)' },
        { status: 400 }
      );
    }

    // Validate MIME type (with extension fallback for mobile browsers)
    if (!ALLOWED_MIME_TYPES.includes(file.type)) {
      const ext = file.name.includes('.') ? '.' + file.name.split('.').pop()?.toLowerCase() : '';
      const isDangerous = DANGEROUS_EXTENSIONS.includes(ext);
      const isAllowedExt = ALLOWED_EXTENSIONS.includes(ext);

      if (isDangerous || !isAllowedExt) {
        return NextResponse.json(
          { success: false, error: `نوع الملف غير مدعوم: ${file.type || 'غير معروف'}${ext ? ` (${ext})` : ''}` },
          { status: 400 }
        );
      }
    }

    // Determine display name and storage path
    const originalExt = file.name.includes('.') ? '.' + file.name.split('.').pop() : '';
    const displayName = customName?.trim() ? customName.trim() + originalExt : file.name;
    const safeStorageName = `${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    const storagePath = `personal/${userId}/${safeStorageName}`;

    // Upload to Supabase Storage (server-side, bypasses CORS and client issues)
    const { error: uploadError } = await supabaseServer.storage
      .from('user-files')
      .upload(storagePath, file, { upsert: false });

    if (uploadError) {
      console.error('[files/upload] Storage upload error:', uploadError);
      return NextResponse.json(
        { success: false, error: 'حدث خطأ أثناء رفع الملف' },
        { status: 500 }
      );
    }

    // Get public URL
    const { data: urlData } = supabaseServer.storage
      .from('user-files')
      .getPublicUrl(storagePath);

    const fileUrl = urlData?.publicUrl || '';

    // Determine file type category from MIME type
    let fileTypeCategory = 'other';
    if (file.type.startsWith('image/')) fileTypeCategory = 'image';
    else if (file.type === 'application/pdf') fileTypeCategory = 'pdf';
    else if (file.type.includes('word') || file.type.includes('document')) fileTypeCategory = 'document';
    else if (file.type.includes('sheet') || file.type.includes('excel')) fileTypeCategory = 'spreadsheet';
    else if (file.type.includes('presentation') || file.type.includes('powerpoint')) fileTypeCategory = 'presentation';
    else if (file.type === 'text/plain' || file.type === 'text/csv') fileTypeCategory = 'text';
    else if (file.type.includes('zip') || file.type.includes('compressed')) fileTypeCategory = 'archive';
    else if (file.type.startsWith('video/')) fileTypeCategory = 'video';
    else if (file.type.startsWith('audio/')) fileTypeCategory = 'audio';
    // Extension-based fallback for mobile browsers that send application/octet-stream
    else if (originalExt && /\.(pdf|docx?|xlsx?|pptx?|jpe?g|png|gif|webp|txt|csv|zip|mp[34]|wav)$/i.test(originalExt)) {
      if (/\.pdf$/i.test(originalExt)) fileTypeCategory = 'pdf';
      else if (/\.docx?$/i.test(originalExt)) fileTypeCategory = 'document';
      else if (/\.xlsx?$/i.test(originalExt)) fileTypeCategory = 'spreadsheet';
      else if (/\.pptx?$/i.test(originalExt)) fileTypeCategory = 'presentation';
      else if (/\.(jpe?g|png|gif|webp)$/i.test(originalExt)) fileTypeCategory = 'image';
      else if (/\.mp4$/i.test(originalExt)) fileTypeCategory = 'video';
      else if (/\.mp3|\.wav$/i.test(originalExt)) fileTypeCategory = 'audio';
      else if (/\.txt|\.csv$/i.test(originalExt)) fileTypeCategory = 'text';
    }

    // Insert into user_files table
    // Try with storage_path first (column may not exist on older schemas)
    const insertDataFull: Record<string, unknown> = {
      user_id: userId,
      file_name: displayName,
      file_type: fileTypeCategory,
      file_size: file.size,
      file_url: fileUrl,
      storage_path: storagePath,
    };

    let fileRecord = null;
    let dbError = null;

    const fullResult = await supabaseServer
      .from('user_files')
      .insert(insertDataFull)
      .select()
      .single();

    if (fullResult.error) {
      const errMsg = fullResult.error.message || '';
      if (errMsg.includes('storage_path') || errMsg.includes('does not exist') || errMsg.includes('schema cache')) {
        // Retry without storage_path column
        console.warn('[files/upload] storage_path column missing, retrying without it:', errMsg);
        const insertDataBasic: Record<string, unknown> = {
          user_id: userId,
          file_name: displayName,
          file_type: fileTypeCategory,
          file_size: file.size,
          file_url: fileUrl,
        };

        const basicResult = await supabaseServer
          .from('user_files')
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

    if (dbError || !fileRecord) {
      console.error('[files/upload] DB insert error:', dbError);
      // Clean up the storage file since the DB record failed
      await supabaseServer.storage.from('user-files').remove([storagePath]);
      return NextResponse.json(
        { success: false, error: 'حدث خطأ أثناء حفظ بيانات الملف' },
        { status: 500 }
      );
    }

    console.log('[files/upload] Success:', displayName, '→', storagePath);
    return NextResponse.json({
      success: true,
      data: fileRecord,
    });
  } catch (error) {
    console.error('[files/upload] Unexpected error:', error);
    return NextResponse.json(
      { success: false, error: 'حدث خطأ غير متوقع' },
      { status: 500 }
    );
  }
}

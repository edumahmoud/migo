import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateRequest, authErrorResponse, verifyOwnership } from '@/lib/auth-helpers';

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
];

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

export async function POST(request: NextRequest) {
  const authResult = await authenticateRequest(request);
  if (!authResult.success) return authErrorResponse(authResult);

  try {
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
      return NextResponse.json(
        { success: false, error: `نوع الملف غير مدعوم: ${file.type || 'غير معروف'}` },
        { status: 400 }
      );
    }

    // Determine the display name and storage file name
    const originalExt = file.name.includes('.') ? '.' + file.name.split('.').pop() : '';
    const displayName = customName?.trim() ? customName.trim() + originalExt : file.name;
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

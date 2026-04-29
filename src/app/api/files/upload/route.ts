import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateRequest, authErrorResponse, verifyOwnership } from '@/lib/auth-helpers';

// Allowed MIME types
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
  'image/svg+xml',
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'audio/mpeg',
  'audio/wav',
  'audio/ogg',
  'text/plain',
  'text/csv',
  'application/zip',
  'application/x-rar-compressed',
];

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

export async function POST(request: NextRequest) {
  const authResult = await authenticateRequest(request);
  if (!authResult.success) return authErrorResponse(authResult);

  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const userId = formData.get('userId') as string | null;
    const assignmentId = formData.get('assignmentId') as string | null;
    const customName = formData.get('customName') as string | null;

    if (!file) {
      return NextResponse.json(
        { success: false, error: 'لم يتم اختيار ملف' },
        { status: 400 }
      );
    }

    if (!userId) {
      return NextResponse.json(
        { success: false, error: 'معرف المستخدم مطلوب' },
        { status: 401 }
      );
    }

    // Verify that the authenticated user matches the requested userId
    const ownershipError = verifyOwnership(authResult.user.id, userId);
    if (ownershipError) return authErrorResponse(ownershipError);

    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { success: false, error: 'حجم الملف يتجاوز الحد الأقصى (50 ميجابايت)' },
        { status: 400 }
      );
    }

    // Validate file type
    if (!ALLOWED_MIME_TYPES.includes(file.type)) {
      return NextResponse.json(
        { success: false, error: `نوع الملف غير مدعوم: ${file.type || 'غير معروف'}. الأنواع المدعومة: PDF, Word, Excel, PowerPoint, صور, فيديو, صوت, نصوص, ملفات مضغوطة` },
        { status: 400 }
      );
    }

    // Determine the display name and storage file name
    const originalExt = file.name.includes('.') ? '.' + file.name.split('.').pop() : '';
    const displayName = customName?.trim() ? customName.trim() + originalExt : file.name;
    // Use a safe ASCII path for storage (timestamp + sanitized) but store the display name in DB
    const safeStorageName = `${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    const filePath = `${userId}/${safeStorageName}`;

    // Upload to Supabase Storage
    const { data: uploadData, error: uploadError } = await supabaseServer.storage
      .from('user-files')
      .upload(filePath, file, { upsert: false });

    if (uploadError) {
      console.error('Storage upload error:', uploadError);
      return NextResponse.json(
        { success: false, error: 'حدث خطأ أثناء رفع الملف' },
        { status: 500 }
      );
    }

    // Get public URL (bucket is public, so getPublicUrl works)
    const { data: urlData } = supabaseServer.storage
      .from('user-files')
      .getPublicUrl(filePath);

    const fileUrl = urlData?.publicUrl || '';

    // Determine file type category
    let fileType = 'other';
    if (file.type.startsWith('image/')) fileType = 'image';
    else if (file.type.startsWith('video/')) fileType = 'video';
    else if (file.type.startsWith('audio/')) fileType = 'audio';
    else if (file.type === 'application/pdf') fileType = 'pdf';
    else if (file.type.includes('word') || file.type.includes('document')) fileType = 'document';
    else if (file.type.includes('sheet') || file.type.includes('excel')) fileType = 'spreadsheet';
    else if (file.type.includes('presentation') || file.type.includes('powerpoint')) fileType = 'presentation';
    else if (file.type === 'text/plain' || file.type === 'text/csv') fileType = 'text';
    else if (file.type.includes('zip') || file.type.includes('rar') || file.type.includes('compressed')) fileType = 'archive';

    // Insert file record into user_files table
    const insertData: Record<string, unknown> = {
      user_id: userId,
      file_name: displayName,
      file_type: fileType,
      file_size: file.size,
      file_url: fileUrl,
    };

    if (assignmentId) {
      insertData.assignment_id = assignmentId;
    }

    const { data: fileRecord, error: dbError } = await supabaseServer
      .from('user_files')
      .insert(insertData)
      .select()
      .single();

    if (dbError) {
      console.error('DB insert error:', dbError);
      // Try to clean up uploaded file
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
    console.error('File upload error:', error);
    return NextResponse.json(
      { success: false, error: 'حدث خطأ غير متوقع أثناء رفع الملف' },
      { status: 500 }
    );
  }
}

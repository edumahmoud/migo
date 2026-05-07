import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateRequest, authErrorResponse, verifyOwnership } from '@/lib/auth-helpers';

/**
 * POST /api/files/upload
 * 
 * Server-side file upload route that handles the entire upload flow:
 *   1. Receives file via FormData from the client (same-origin request)
 *   2. Uploads file to Supabase Storage from the server (server-to-server, no CORS)
 *   3. Creates DB record in user_files table
 *   4. Returns the result
 * 
 * This is the PRIMARY upload method for mobile PWA because:
 *   - Same-origin fetch() works reliably on mobile PWA (proven by text summaries)
 *   - No cross-origin XHR/fetch to Supabase Storage (which fails on some mobile browsers)
 *   - Server-side auth uses the request's Authorization header + cookie fallback
 * 
 * Subject to Vercel's 4.5MB body size limit on Hobby plan.
 * For larger files, the client should fall back to direct Supabase Storage upload.
 */
export async function POST(request: NextRequest) {
  const authResult = await authenticateRequest(request);
  if (!authResult.success) return authErrorResponse(authResult);

  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const userId = formData.get('userId') as string | null;
    const customName = formData.get('customName') as string | null;
    const assignmentId = formData.get('assignmentId') as string | null;

    if (!file || !userId) {
      return NextResponse.json(
        { success: false, error: 'الملف ومعرف المستخدم مطلوبان' },
        { status: 400 }
      );
    }

    // Verify that the authenticated user matches the requested userId
    const ownershipError = verifyOwnership(authResult.user.id, userId);
    if (ownershipError) return authErrorResponse(ownershipError);

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
    else if (file.type.includes('zip') || file.type.includes('compressed')) fileType = 'archive';

    // Build display name and storage path
    const originalExt = file.name.includes('.') ? '.' + file.name.split('.').pop() : '';
    const displayName = customName?.trim() ? customName.trim() + originalExt : file.name;
    const safeStorageName = `${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    const storagePath = `${userId}/${safeStorageName}`;

    // Upload to Supabase Storage (server-to-server, no CORS issues)
    const { error: uploadError } = await supabaseServer.storage
      .from('user-files')
      .upload(storagePath, file, {
        cacheControl: '3600',
        contentType: file.type || 'application/octet-stream',
        upsert: false,
      });

    if (uploadError) {
      console.error('[Upload] Storage upload error:', uploadError);
      return NextResponse.json(
        { success: false, error: 'حدث خطأ أثناء رفع الملف إلى التخزين' },
        { status: 500 }
      );
    }

    // Get public URL
    const { data: urlData } = supabaseServer.storage
      .from('user-files')
      .getPublicUrl(storagePath);

    const fileUrl = urlData?.publicUrl || '';

    // Insert record into user_files
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
      console.error('[Upload] DB insert error:', dbError);
      // Try to clean up the orphaned storage file
      await supabaseServer.storage.from('user-files').remove([storagePath]);
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
    console.error('[Upload] File upload error:', error);
    return NextResponse.json(
      { success: false, error: 'حدث خطأ غير متوقع أثناء رفع الملف' },
      { status: 500 }
    );
  }
}

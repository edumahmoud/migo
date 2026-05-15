import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateRequest, authErrorResponse, verifyOwnership } from '@/lib/auth-helpers';

/**
 * POST /api/files/create-record
 * 
 * Creates a user_files DB record for a file that was already uploaded
 * directly to Supabase Storage from the client.
 * 
 * This is a lightweight endpoint that only receives metadata (no file body),
 * so it's not subject to Vercel's 4.5MB body size limit.
 * 
 * Body (JSON):
 *   - userId: string
 *   - fileName: string (display name with extension)
 *   - fileType: string (category: image, video, audio, pdf, document, etc.)
 *   - fileSize: number (bytes)
 *   - fileUrl: string (public URL from Supabase Storage)
 *   - storagePath: string (path in the bucket, for future deletion)
 *   - assignmentId?: string
 */
export async function POST(request: NextRequest) {
  const authResult = await authenticateRequest(request);
  if (!authResult.success) return authErrorResponse(authResult);

  try {
    const body = await request.json();
    const { userId, fileName, fileType, fileSize, fileUrl, storagePath, assignmentId } = body;

    if (!userId || !fileName || !fileType || !fileSize || !fileUrl) {
      return NextResponse.json(
        { success: false, error: 'بيانات الملف غير مكتملة' },
        { status: 400 }
      );
    }

    // Verify that the authenticated user matches the requested userId
    const ownershipError = verifyOwnership(authResult.user.id, userId);
    if (ownershipError) return authErrorResponse(ownershipError);

    // Insert file record into user_files table
    // Note: storage_path is NOT included because the column may not exist in the table.
    // The file_url contains enough info for deletion (existing code extracts path from URL).
    const insertData: Record<string, unknown> = {
      user_id: userId,
      file_name: fileName,
      file_type: fileType,
      file_size: fileSize,
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
      console.error('DB insert error (create-record):', dbError);
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
    console.error('Create file record error:', error);
    return NextResponse.json(
      { success: false, error: 'حدث خطأ غير متوقع' },
      { status: 500 }
    );
  }
}

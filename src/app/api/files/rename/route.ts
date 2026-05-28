import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateRequest, authErrorResponse } from '@/lib/auth-helpers';

/**
 * PUT /api/files/rename
 *
 * Renames a file in user_files table (server-side with proper auth).
 * This is more reliable than client-side Supabase update because it uses
 * the server-side Supabase client, bypassing potential RLS issues from
 * expired/silent browser sessions.
 *
 * Body (JSON):
 *   - fileId: string (UUID of the file in user_files)
 *   - newName: string (new file name including extension)
 */
export async function PUT(request: NextRequest) {
  const authResult = await authenticateRequest(request);
  if (!authResult.success) return authErrorResponse(authResult);

  try {
    const body = await request.json();
    const { fileId, newName } = body;

    if (!fileId || !newName?.trim()) {
      return NextResponse.json(
        { success: false, error: 'بيانات غير مكتملة' },
        { status: 400 }
      );
    }

    // Verify the file belongs to the authenticated user
    const { data: file, error: fetchError } = await supabaseServer
      .from('user_files')
      .select('id, user_id, file_name')
      .eq('id', fileId)
      .single();

    if (fetchError || !file) {
      return NextResponse.json(
        { success: false, error: 'الملف غير موجود' },
        { status: 404 }
      );
    }

    if (file.user_id !== authResult.user.id) {
      return NextResponse.json(
        { success: false, error: 'غير مصرح بتعديل هذا الملف' },
        { status: 403 }
      );
    }

    // Update the file name
    const { data: updated, error: updateError } = await supabaseServer
      .from('user_files')
      .update({ file_name: newName.trim(), updated_at: new Date().toISOString() })
      .eq('id', fileId)
      .select()
      .single();

    if (updateError) {
      console.error('Rename file DB error:', updateError);
      return NextResponse.json(
        { success: false, error: 'حدث خطأ أثناء تحديث اسم الملف' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      data: updated,
    });
  } catch (error) {
    console.error('Rename file error:', error);
    return NextResponse.json(
      { success: false, error: 'حدث خطأ غير متوقع' },
      { status: 500 }
    );
  }
}

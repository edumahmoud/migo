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
 * Also syncs the new name to subject_files records that reference this file
 * via user_file_id, so course-linked copies stay consistent.
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

    const trimmedName = newName.trim();

    // Verify the file belongs to the authenticated user
    const { data: file, error: fetchError } = await supabaseServer
      .from('user_files')
      .select('id, user_id, file_name')
      .eq('id', fileId)
      .single();

    if (fetchError || !file) {
      console.error('[rename] File not found:', fileId, fetchError?.message);
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

    // Skip update if the name hasn't changed
    if (file.file_name === trimmedName) {
      return NextResponse.json({
        success: true,
        data: file,
        message: 'لم يتغير الاسم',
      });
    }

    // Update the file name in user_files
    const { data: updated, error: updateError } = await supabaseServer
      .from('user_files')
      .update({ file_name: trimmedName, updated_at: new Date().toISOString() })
      .eq('id', fileId)
      .select()
      .single();

    if (updateError) {
      console.error('[rename] DB update error:', updateError.message, updateError.details);
      return NextResponse.json(
        { success: false, error: 'حدث خطأ أثناء تحديث اسم الملف' },
        { status: 500 }
      );
    }

    if (!updated) {
      console.error('[rename] Update returned no data for fileId:', fileId);
      return NextResponse.json(
        { success: false, error: 'فشل تحديث اسم الملف - لم يتم إرجاع بيانات' },
        { status: 500 }
      );
    }

    // ─── Post-update verification: re-read to confirm persistence ───
    const { data: verified, error: verifyError } = await supabaseServer
      .from('user_files')
      .select('id, file_name, updated_at')
      .eq('id', fileId)
      .single();

    if (verifyError || !verified || verified.file_name !== trimmedName) {
      console.error('[rename] Verification failed! Expected:', trimmedName,
        'Got:', verified?.file_name, 'Error:', verifyError?.message);
      return NextResponse.json(
        { success: false, error: 'فشل التحقق من تحديث اسم الملف - يرجى المحاولة مرة أخرى' },
        { status: 500 }
      );
    }

    console.log('[rename] Verified: file', fileId, 'renamed to', trimmedName);

    // ─── Sync: Update subject_files records that reference this file ───
    // When a personal file is linked to courses via subject_files.user_file_id,
    // the course copy should also reflect the new name.
    try {
      const { data: linkedSubjectFiles, error: linkedError } = await supabaseServer
        .from('subject_files')
        .select('id, file_name')
        .eq('user_file_id', fileId);

      if (!linkedError && linkedSubjectFiles && linkedSubjectFiles.length > 0) {
        // Only update subject_files that still have the OLD name (avoid overwriting customized names)
        const toUpdate = linkedSubjectFiles.filter(sf => sf.file_name === file.file_name);

        if (toUpdate.length > 0) {
          const { error: syncError } = await supabaseServer
            .from('subject_files')
            .update({ file_name: trimmedName })
            .in('id', toUpdate.map(sf => sf.id));

          if (syncError) {
            console.warn('[rename] Failed to sync subject_files:', syncError.message);
          } else {
            console.log('[rename] Synced', toUpdate.length, 'subject_files records');
          }
        }
      }
    } catch (syncErr) {
      // Non-critical: subject_files sync failure shouldn't block the rename
      console.warn('[rename] subject_files sync error:', syncErr);
    }

    return NextResponse.json({
      success: true,
      data: updated,
    });
  } catch (error) {
    console.error('[rename] Unexpected error:', error);
    return NextResponse.json(
      { success: false, error: 'حدث خطأ غير متوقع' },
      { status: 500 }
    );
  }
}

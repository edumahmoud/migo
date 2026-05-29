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
 * Sync propagation:
 *   1. user_files.file_name        ← primary update
 *   2. subject_files.file_name     ← via user_file_id FK
 *   3. lecture_notes.content       ← embedded as [FILE|||url|||name] or [FILE:url:name]
 *
 * Tables that DON'T need sync (they read via FK JOIN at query time):
 *   - file_shares, file_requests, submissions
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
      .select('id, user_id, file_name, file_url')
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

    const oldName = file.file_name;
    const fileUrl = file.file_url;

    // ─── STEP 1: Update user_files (source of truth) ───
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

    console.log('[rename] Verified: file', fileId, 'renamed from', oldName, 'to', trimmedName);

    // Track sync results for logging
    const syncResults: string[] = [];

    // ─── STEP 2: Sync subject_files ───
    // When a personal file is linked to courses via subject_files.user_file_id,
    // the course copy should also reflect the new name.
    try {
      const { data: linkedSubjectFiles, error: linkedError } = await supabaseServer
        .from('subject_files')
        .select('id, file_name')
        .eq('user_file_id', fileId);

      if (!linkedError && linkedSubjectFiles && linkedSubjectFiles.length > 0) {
        // Only update subject_files that still have the OLD name (avoid overwriting customized names)
        const toUpdate = linkedSubjectFiles.filter(sf => sf.file_name === oldName);

        if (toUpdate.length > 0) {
          const { error: syncError } = await supabaseServer
            .from('subject_files')
            .update({ file_name: trimmedName })
            .in('id', toUpdate.map(sf => sf.id));

          if (syncError) {
            console.warn('[rename] Failed to sync subject_files:', syncError.message);
          } else {
            syncResults.push(`subject_files: ${toUpdate.length} records`);
          }
        }
      }
    } catch (syncErr) {
      console.warn('[rename] subject_files sync error:', syncErr);
    }

    // ─── STEP 3: Sync lecture_notes.content ───
    // Lecture notes embed file references as:
    //   New format:    [FILE|||url|||name]
    //   Legacy format: [FILE:url:name]
    // We need to find all notes containing the old file reference and update the name.
    if (fileUrl) {
      try {
        // Search for notes containing the file URL (both formats embed it)
        // Use ilike with the URL as a substring match
        const encodedUrl = fileUrl.replace(/%/g, '\\%').replace(/_/g, '\\_');

        const { data: lectureNotes, error: notesError } = await supabaseServer
          .from('lecture_notes')
          .select('id, content')
          .ilike('content', `%${encodedUrl}%`);

        if (!notesError && lectureNotes && lectureNotes.length > 0) {
          let updatedCount = 0;

          for (const note of lectureNotes) {
            if (!note.content) continue;

            let newContent = note.content;

            // Replace new format: [FILE|||url|||oldName] → [FILE|||url|||newName]
            const newFormatRegex = new RegExp(
              `\\[FILE\\|\\|\\|${escapeRegex(fileUrl)}\\|\\|\\|${escapeRegex(oldName)}\\]`,
              'g'
            );
            newContent = newContent.replace(newFormatRegex, `[FILE|||${fileUrl}|||${trimmedName}]`);

            // Replace legacy format: [FILE:url:oldName] → [FILE:url:newName]
            const legacyFormatRegex = new RegExp(
              `\\[FILE:${escapeRegex(fileUrl)}:${escapeRegex(oldName)}\\]`,
              'g'
            );
            newContent = newContent.replace(legacyFormatRegex, `[FILE:${fileUrl}:${trimmedName}]`);

            // Only update if content actually changed
            if (newContent !== note.content) {
              const { error: noteUpdateError } = await supabaseServer
                .from('lecture_notes')
                .update({ content: newContent })
                .eq('id', note.id);

              if (noteUpdateError) {
                console.warn('[rename] Failed to sync lecture_note', note.id, ':', noteUpdateError.message);
              } else {
                updatedCount++;
              }
            }
          }

          if (updatedCount > 0) {
            syncResults.push(`lecture_notes: ${updatedCount} records`);
          }
        }
      } catch (notesSyncErr) {
        console.warn('[rename] lecture_notes sync error:', notesSyncErr);
      }
    }

    if (syncResults.length > 0) {
      console.log('[rename] Sync completed:', syncResults.join(', '));
    }

    return NextResponse.json({
      success: true,
      data: updated,
      synced: syncResults,
    });
  } catch (error) {
    console.error('[rename] Unexpected error:', error);
    return NextResponse.json(
      { success: false, error: 'حدث خطأ غير متوقع' },
      { status: 500 }
    );
  }
}

/**
 * Escape special regex characters in a string for use in RegExp constructor.
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

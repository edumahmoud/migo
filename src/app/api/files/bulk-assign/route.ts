import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateRequest, authErrorResponse, verifyOwnership } from '@/lib/auth-helpers';

/**
 * Bulk assign user files to courses (subjects) without re-uploading.
 * Creates subject_files records by referencing existing user_file data.
 */
export async function POST(request: NextRequest) {
  const authResult = await authenticateRequest(request);
  if (!authResult.success) return authErrorResponse(authResult);

  try {
    const body = await request.json();
    const { fileIds, subjectIds, userId } = body as {
      fileIds: string[];
      subjectIds: string[];
      userId: string;
    };

    if (!fileIds?.length || !subjectIds?.length || !userId) {
      return NextResponse.json(
        { success: false, error: 'معرفات الملفات والمقررات ومعرف المستخدم مطلوبة' },
        { status: 400 }
      );
    }

    // Verify that the authenticated user matches the requested userId
    const ownershipError = verifyOwnership(authResult.user.id, userId);
    if (ownershipError) return authErrorResponse(ownershipError);

    // Fetch all user_files by IDs
    const { data: userFiles, error: fetchError } = await supabaseServer
      .from('user_files')
      .select('*')
      .in('id', fileIds);

    if (fetchError || !userFiles?.length) {
      return NextResponse.json(
        { success: false, error: 'لم يتم العثور على الملفات' },
        { status: 404 }
      );
    }

    // Only allow public files to be assigned
    const publicFiles = userFiles.filter((f: Record<string, unknown>) => f.visibility === 'public');
    if (publicFiles.length === 0) {
      return NextResponse.json(
        { success: false, error: 'فقط الملفات العامة يمكن إسنادها للمقررات' },
        { status: 400 }
      );
    }

    // Check for existing assignments to avoid duplicates
    const { data: existingAssignments } = await supabaseServer
      .from('subject_files')
      .select('user_file_id, subject_id')
      .in('user_file_id', publicFiles.map((f: Record<string, unknown>) => f.id))
      .in('subject_id', subjectIds);

    const existingSet = new Set(
      (existingAssignments || []).map((a: Record<string, unknown>) => `${a.user_file_id}||${a.subject_id}`)
    );

    let created = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const file of publicFiles) {
      for (const subjectId of subjectIds) {
        const key = `${file.id}||${subjectId}`;
        if (existingSet.has(key)) {
          skipped++;
          continue;
        }

        const insertData: Record<string, unknown> = {
          subject_id: subjectId,
          uploaded_by: userId,
          file_name: file.file_name,
          file_type: file.file_type,
          file_size: file.file_size,
          file_url: file.file_url,
          visibility: 'public',
          user_file_id: file.id,
        };

        const { error: insertError } = await supabaseServer
          .from('subject_files')
          .insert(insertData);

        if (insertError) {
          // Try without visibility/user_file_id if columns don't exist yet
          if (insertError.message?.includes('does not exist') || insertError.message?.includes('schema cache')) {
            const basicData: Record<string, unknown> = {
              subject_id: subjectId,
              uploaded_by: userId,
              file_name: file.file_name,
              file_type: file.file_type,
              file_size: file.file_size,
              file_url: file.file_url,
            };
            const { error: basicError } = await supabaseServer
              .from('subject_files')
              .insert(basicData);
            if (basicError) {
              errors.push(`فشل إسناد ${file.file_name}: ${basicError.message}`);
            } else {
              created++;
            }
          } else {
            errors.push(`فشل إسناد ${file.file_name}: ${insertError.message}`);
          }
        } else {
          created++;
        }
      }
    }

    return NextResponse.json({
      success: true,
      data: { created, skipped, errors: errors.length > 0 ? errors : undefined },
    });
  } catch (error) {
    console.error('Bulk assign error:', error);
    return NextResponse.json(
      { success: false, error: 'حدث خطأ غير متوقع' },
      { status: 500 }
    );
  }
}

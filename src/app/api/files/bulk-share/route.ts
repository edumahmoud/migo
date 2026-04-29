import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateRequest, authErrorResponse, verifyOwnership } from '@/lib/auth-helpers';

/**
 * Bulk share multiple user files with multiple users.
 * Creates file_shares records for all combinations.
 */
export async function POST(request: NextRequest) {
  const authResult = await authenticateRequest(request);
  if (!authResult.success) return authErrorResponse(authResult);

  try {
    const body = await request.json();
    const { fileIds, userIds, permission, sharedBy } = body as {
      fileIds: string[];
      userIds: string[];
      permission: 'view' | 'edit' | 'download';
      sharedBy: string;
    };

    if (!fileIds?.length || !userIds?.length || !sharedBy) {
      return NextResponse.json(
        { success: false, error: 'معرفات الملفات والمستخدمين مطلوبة' },
        { status: 400 }
      );
    }

    // Verify that the authenticated user matches the sharedBy user
    const ownershipError = verifyOwnership(authResult.user.id, sharedBy);
    if (ownershipError) return authErrorResponse(ownershipError);

    const perm = permission || 'view';

    // Verify all files are public
    const { data: userFiles, error: fetchError } = await supabaseServer
      .from('user_files')
      .select('id, visibility')
      .in('id', fileIds);

    if (fetchError || !userFiles?.length) {
      return NextResponse.json(
        { success: false, error: 'لم يتم العثور على الملفات' },
        { status: 404 }
      );
    }

    const publicFileIds = userFiles
      .filter((f: Record<string, unknown>) => f.visibility === 'public')
      .map((f: Record<string, unknown>) => f.id);

    if (publicFileIds.length === 0) {
      return NextResponse.json(
        { success: false, error: 'فقط الملفات العامة يمكن مشاركتها' },
        { status: 400 }
      );
    }

    // Check existing shares to avoid duplicates
    const { data: existingShares } = await supabaseServer
      .from('file_shares')
      .select('file_id, shared_with')
      .in('file_id', publicFileIds)
      .in('shared_with', userIds);

    const existingSet = new Set(
      (existingShares || []).map((s: Record<string, unknown>) => `${s.file_id}||${s.shared_with}`)
    );

    let created = 0;
    let skipped = 0;

    const inserts: Record<string, unknown>[] = [];

    for (const fileId of publicFileIds) {
      for (const userId of userIds) {
        // Don't share with yourself
        if (userId === sharedBy) {
          skipped++;
          continue;
        }
        const key = `${fileId}||${userId}`;
        if (existingSet.has(key)) {
          skipped++;
          continue;
        }
        inserts.push({
          file_id: fileId,
          shared_by: sharedBy,
          shared_with: userId,
          permission: perm,
        });
      }
    }

    if (inserts.length > 0) {
      const { error: insertError } = await supabaseServer
        .from('file_shares')
        .insert(inserts);

      if (insertError) {
        // Fallback: insert one by one
        for (const insert of inserts) {
          const { error } = await supabaseServer
            .from('file_shares')
            .insert(insert);
          if (error && error.code !== '23505') {
            console.error('Share insert error:', error);
          } else if (!error) {
            created++;
          } else {
            skipped++;
          }
        }
      } else {
        created = inserts.length;
      }
    }

    return NextResponse.json({
      success: true,
      data: { created, skipped },
    });
  } catch (error) {
    console.error('Bulk share error:', error);
    return NextResponse.json(
      { success: false, error: 'حدث خطأ غير متوقع' },
      { status: 500 }
    );
  }
}

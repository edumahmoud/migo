import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateRequest, authErrorResponse, verifyOwnership } from '@/lib/auth-helpers';
import { notifyUser } from '@/lib/notifications-service';

/**
 * Share a file with a user by their email address.
 * Unlike bulk-share, this endpoint allows sharing ANY file the owner owns
 * (not restricted to public-only files).
 */
export async function POST(request: NextRequest) {
  const authResult = await authenticateRequest(request);
  if (!authResult.success) return authErrorResponse(authResult);

  try {
    const body = await request.json();
    const { fileId, email, permission, sharedBy } = body as {
      fileId: string;
      email: string;
      permission: 'view' | 'edit' | 'download';
      sharedBy: string;
    };

    // Validate required fields
    if (!fileId || !email || !sharedBy) {
      return NextResponse.json(
        { success: false, error: 'معرف الملف والبريد الإلكتروني مطلوبان' },
        { status: 400 }
      );
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      return NextResponse.json(
        { success: false, error: 'صيغة البريد الإلكتروني غير صحيحة' },
        { status: 400 }
      );
    }

    // Verify that the authenticated user matches the sharedBy user
    const ownershipError = verifyOwnership(authResult.user.id, sharedBy);
    if (ownershipError) return authErrorResponse(ownershipError);

    const perm = permission || 'view';

    // Verify the file exists and belongs to the authenticated user (owner can share any file they own)
    const { data: fileData, error: fileError } = await supabaseServer
      .from('user_files')
      .select('id, file_name, user_id')
      .eq('id', fileId)
      .single();

    if (fileError || !fileData) {
      return NextResponse.json(
        { success: false, error: 'لم يتم العثور على الملف' },
        { status: 404 }
      );
    }

    if (fileData.user_id !== sharedBy) {
      return NextResponse.json(
        { success: false, error: 'يمكنك مشاركة الملفات التي تملكها فقط' },
        { status: 403 }
      );
    }

    // Look up the target user by email
    const { data: targetUser, error: userError } = await supabaseServer
      .from('users')
      .select('id, name, email')
      .eq('email', email.trim().toLowerCase())
      .single();

    if (userError || !targetUser) {
      return NextResponse.json(
        { success: false, error: 'لم يتم العثور على مستخدم بهذا البريد الإلكتروني' },
        { status: 404 }
      );
    }

    // Don't share with yourself
    if (targetUser.id === sharedBy) {
      return NextResponse.json(
        { success: false, error: 'لا يمكنك مشاركة الملف مع نفسك' },
        { status: 400 }
      );
    }

    // Check if already shared with this user
    const { data: existingShare } = await supabaseServer
      .from('file_shares')
      .select('id, permission')
      .eq('file_id', fileId)
      .eq('shared_with', targetUser.id)
      .maybeSingle();

    if (existingShare) {
      // Update the permission if already shared
      const { error: updateError } = await supabaseServer
        .from('file_shares')
        .update({ permission: perm })
        .eq('id', existingShare.id);

      if (updateError) {
        console.error('Share update error:', updateError);
        return NextResponse.json(
          { success: false, error: 'حدث خطأ أثناء تحديث المشاركة' },
          { status: 500 }
        );
      }

      // Send notification about updated share
      await notifyUser(
        targetUser.id,
        'file',
        'تم تحديث صلاحية ملف مشارك',
        `تم تحديث صلاحية الملف "${fileData.file_name}" إلى ${perm === 'view' ? 'عرض' : perm === 'edit' ? 'تعديل' : 'تحميل'}`,
        'files'
      );

      return NextResponse.json({
        success: true,
        data: {
          created: 0,
          updated: 1,
          user: { id: targetUser.id, name: targetUser.name, email: targetUser.email },
        },
      });
    }

    // Create new share
    const { error: insertError } = await supabaseServer
      .from('file_shares')
      .insert({
        file_id: fileId,
        shared_by: sharedBy,
        shared_with: targetUser.id,
        permission: perm,
      });

    if (insertError) {
      if (insertError.code === '23505') {
        // Duplicate - already shared (race condition)
        return NextResponse.json({
          success: true,
          data: {
            created: 0,
            updated: 0,
            user: { id: targetUser.id, name: targetUser.name, email: targetUser.email },
          },
        });
      }
      console.error('Share insert error:', insertError);
      return NextResponse.json(
        { success: false, error: 'حدث خطأ أثناء إنشاء المشاركة' },
        { status: 500 }
      );
    }

    // Send notification to the recipient
    const { data: sharerProfile } = await supabaseServer
      .from('users')
      .select('name')
      .eq('id', sharedBy)
      .single();

    await notifyUser(
      targetUser.id,
      'file',
      'ملف جديد مشارك معك',
      `شارك معك ${sharerProfile?.name || 'مستخدم'} الملف "${fileData.file_name}"`,
      'files'
    );

    return NextResponse.json({
      success: true,
      data: {
        created: 1,
        updated: 0,
        user: { id: targetUser.id, name: targetUser.name, email: targetUser.email },
      },
    });
  } catch (error) {
    console.error('Share by email error:', error);
    return NextResponse.json(
      { success: false, error: 'حدث خطأ غير متوقع' },
      { status: 500 }
    );
  }
}

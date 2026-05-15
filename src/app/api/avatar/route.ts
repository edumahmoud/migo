import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateRequest, authErrorResponse, verifyOwnership } from '@/lib/auth-helpers';

const MAX_AVATAR_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

export async function POST(request: NextRequest) {
  const authResult = await authenticateRequest(request);
  if (!authResult.success) return authErrorResponse(authResult);

  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const userId = formData.get('userId') as string | null;

    if (!file) {
      return NextResponse.json({ error: 'لم يتم اختيار ملف' }, { status: 400 });
    }

    if (!userId) {
      return NextResponse.json({ error: 'معرف المستخدم مطلوب' }, { status: 401 });
    }

    // Verify that the authenticated user matches the requested userId
    const ownershipError = verifyOwnership(authResult.user.id, userId);
    if (ownershipError) return authErrorResponse(ownershipError);

    // Validate file type
    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json(
        { error: 'نوع الملف غير مدعوم. يُسمح بـ JPEG, PNG, GIF, WebP فقط' },
        { status: 400 }
      );
    }

    // Validate file size
    if (file.size > MAX_AVATAR_SIZE) {
      return NextResponse.json(
        { error: 'حجم الصورة يجب أن يكون أقل من 5 ميجابايت' },
        { status: 400 }
      );
    }

    // Use a clean filename for storage
    const ext = file.name.split('.').pop() || 'jpg';
    const storagePath = `${userId}/avatar_${Date.now()}.${ext}`;

    // Upload to Supabase Storage (user-files bucket)
    const { error: uploadError } = await supabaseServer.storage
      .from('user-files')
      .upload(storagePath, file, { upsert: false });

    if (uploadError) {
      console.error('Avatar upload error:', uploadError);
      return NextResponse.json({ error: 'حدث خطأ أثناء رفع الصورة' }, { status: 500 });
    }

    // Get public URL
    const { data: urlData } = supabaseServer.storage
      .from('user-files')
      .getPublicUrl(storagePath);

    const avatarUrl = urlData?.publicUrl || '';

    if (!avatarUrl) {
      return NextResponse.json({ error: 'فشل في الحصول على رابط الصورة' }, { status: 500 });
    }

    // Update the user's avatar_url directly using service role (bypasses RLS)
    const { data: updatedUser, error: updateError } = await supabaseServer
      .from('users')
      .update({ avatar_url: avatarUrl })
      .eq('id', userId)
      .select()
      .single();

    if (updateError) {
      console.error('Avatar URL update error:', updateError);
      // Try to clean up uploaded file
      await supabaseServer.storage.from('user-files').remove([storagePath]);
      return NextResponse.json({ error: 'حدث خطأ أثناء تحديث الصورة الشخصية' }, { status: 500 });
    }

    // Try to remove old avatar files (cleanup)
    try {
      const { data: oldFiles } = await supabaseServer.storage
        .from('user-files')
        .list(userId, { limit: 100 });

      if (oldFiles && oldFiles.length > 0) {
        // Keep only the latest avatar, remove old ones
        const avatarFiles = oldFiles
          .filter((f) => f.name.startsWith('avatar_') && f.name !== storagePath.split('/').pop())
          .map((f) => `${userId}/${f.name}`);

        if (avatarFiles.length > 0) {
          await supabaseServer.storage.from('user-files').remove(avatarFiles);
        }
      }
    } catch {
      // Silently ignore cleanup errors
    }

    return NextResponse.json({
      success: true,
      data: {
        avatar_url: avatarUrl,
        user: updatedUser,
      },
    });
  } catch (error) {
    console.error('Avatar API error:', error);
    return NextResponse.json({ error: 'حدث خطأ غير متوقع' }, { status: 500 });
  }
}

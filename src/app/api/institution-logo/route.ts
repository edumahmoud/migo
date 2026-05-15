import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helpers';

const MAX_LOGO_SIZE = 2 * 1024 * 1024; // 2MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml'];

export async function POST(request: NextRequest) {
  const authResult = await requireAdmin(request);
  if (!authResult.success) return authErrorResponse(authResult);

  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ error: 'لم يتم اختيار ملف' }, { status: 400 });
    }

    // Validate file type
    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json(
        { error: 'نوع الملف غير مدعوم. يُسمح بـ JPEG, PNG, GIF, WebP, SVG فقط' },
        { status: 400 }
      );
    }

    // Validate file size
    if (file.size > MAX_LOGO_SIZE) {
      return NextResponse.json(
        { error: 'حجم الشعار يجب أن يكون أقل من 2 ميجابايت' },
        { status: 400 }
      );
    }

    // Use a clean filename for storage — separate from user avatars
    const ext = file.name.split('.').pop() || 'png';
    const storagePath = `institution/logos/logo_${Date.now()}.${ext}`;

    // Upload to Supabase Storage (user-files bucket, but in a separate folder)
    const { error: uploadError } = await supabaseServer.storage
      .from('user-files')
      .upload(storagePath, file, { upsert: false });

    if (uploadError) {
      console.error('Institution logo upload error:', uploadError);
      return NextResponse.json({ error: 'حدث خطأ أثناء رفع الشعار' }, { status: 500 });
    }

    // Get public URL
    const { data: urlData } = supabaseServer.storage
      .from('user-files')
      .getPublicUrl(storagePath);

    const logoUrl = urlData?.publicUrl || '';

    if (!logoUrl) {
      return NextResponse.json({ error: 'فشل في الحصول على رابط الشعار' }, { status: 500 });
    }

    // Try to remove old logo files (cleanup)
    try {
      const { data: oldFiles } = await supabaseServer.storage
        .from('user-files')
        .list('institution/logos', { limit: 100 });

      if (oldFiles && oldFiles.length > 0) {
        // Keep only the latest logo, remove old ones
        const oldLogoFiles = oldFiles
          .filter((f) => f.name.startsWith('logo_') && f.name !== storagePath.split('/').pop())
          .map((f) => `institution/logos/${f.name}`);

        if (oldLogoFiles.length > 0) {
          await supabaseServer.storage.from('user-files').remove(oldLogoFiles);
        }
      }
    } catch {
      // Silently ignore cleanup errors
    }

    // ⚠️ IMPORTANT: We do NOT update the users table here!
    // The logo URL will be saved to institution_settings when the user saves the form.
    return NextResponse.json({
      success: true,
      url: logoUrl,
    });
  } catch (error) {
    console.error('Institution logo API error:', error);
    return NextResponse.json({ error: 'حدث خطأ غير متوقع' }, { status: 500 });
  }
}

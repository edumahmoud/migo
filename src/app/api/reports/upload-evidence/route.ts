// =====================================================
// Report Evidence Upload API
// Uploads images to Supabase Storage for report evidence
// =====================================================
import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateRequest } from '@/lib/auth-helpers';

// POST /api/reports/upload-evidence — Upload image evidence for a report
export async function POST(request: NextRequest) {
  try {
    const authResult = await authenticateRequest(request);
    if (!authResult.success) {
      return NextResponse.json({ success: false, error: authResult.error }, { status: authResult.status });
    }

    const userId = authResult.user.id;
    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ success: false, error: 'لم يتم اختيار ملف' }, { status: 400 });
    }

    // Validate file type
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json(
        { success: false, error: 'نوع الملف غير مدعوم. يُسمح فقط بصور JPEG, PNG, GIF, WebP' },
        { status: 400 }
      );
    }

    // Validate file size (max 5MB)
    const maxSize = 5 * 1024 * 1024;
    if (file.size > maxSize) {
      return NextResponse.json(
        { success: false, error: 'حجم الملف كبير جداً. الحد الأقصى 5 ميجابايت' },
        { status: 400 }
      );
    }

    // Generate storage path
    const ext = file.name.split('.').pop() || 'jpg';
    const timestamp = Date.now();
    const randomSuffix = Math.random().toString(36).substring(2, 8);
    const storagePath = `${userId}/${timestamp}_${randomSuffix}.${ext}`;

    // Upload to Supabase Storage
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const { error: uploadError } = await supabaseServer.storage
      .from('report-evidence')
      .upload(storagePath, buffer, {
        contentType: file.type,
        upsert: false,
      });

    if (uploadError) {
      console.error('[Reports Upload] Storage error:', uploadError.message);
      return NextResponse.json(
        { success: false, error: 'فشل رفع الملف' },
        { status: 500 }
      );
    }

    // Get public URL
    const { data: urlData } = supabaseServer.storage
      .from('report-evidence')
      .getPublicUrl(storagePath);

    return NextResponse.json({
      success: true,
      data: {
        url: urlData.publicUrl,
        name: file.name,
        type: file.type,
        path: storagePath,
      },
    });
  } catch (error) {
    console.error('[Reports Upload] POST error:', error);
    return NextResponse.json(
      { success: false, error: 'حدث خطأ غير متوقع' },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateRequest, authErrorResponse, verifyOwnership, getUserRole } from '@/lib/auth-helpers';

// Creates the subject_videos row after the client uploaded the video straight to
// Supabase Storage (bucket video-files). The storage quota trigger on subject_videos
// rejects the insert with STORAGE_FULL when the uploader has no space left.
export async function POST(request: NextRequest) {
  const authResult = await authenticateRequest(request);
  if (!authResult.success) return authErrorResponse(authResult);

  try {
    const body = await request.json();
    const { subjectId, uploadedBy, title, description, videoUrl, storagePath, videoType, videoSize, thumbnailUrl } = body;

    if (!subjectId || !uploadedBy || !title || !videoUrl) {
      return NextResponse.json({ success: false, error: 'بيانات الفيديو غير مكتملة' }, { status: 400 });
    }

    const ownershipError = verifyOwnership(authResult.user.id, uploadedBy);
    if (ownershipError) return authErrorResponse(ownershipError);

    if (typeof videoUrl !== 'string' || !videoUrl.includes('/storage/v1/object/')) {
      return NextResponse.json({ success: false, error: 'رابط الفيديو غير صالح' }, { status: 400 });
    }
    if (thumbnailUrl && (typeof thumbnailUrl !== 'string' || !thumbnailUrl.includes('/storage/v1/object/'))) {
      return NextResponse.json({ success: false, error: 'رابط الصورة المصغرة غير صالح' }, { status: 400 });
    }

    const role = await getUserRole(authResult.user.id);
    if (!role || (role !== 'teacher' && role !== 'admin' && role !== 'superadmin')) {
      return NextResponse.json({ success: false, error: 'رفع الفيديوهات متاح للمعلمين والمشرفين فقط' }, { status: 403 });
    }

    if (role === 'teacher') {
      const { data: owner } = await supabaseServer
        .from('subjects').select('id').eq('id', subjectId).eq('teacher_id', authResult.user.id).maybeSingle();
      const { data: coTeacher } = await supabaseServer
        .from('subject_teachers').select('id').eq('subject_id', subjectId).eq('teacher_id', authResult.user.id).maybeSingle();
      if (!owner && !coTeacher) {
        return NextResponse.json({ success: false, error: 'غير مصرح برفع فيديوهات في هذا المقرر' }, { status: 403 });
      }
    }

    // The path must be inside the uploader's own folder.
    if (storagePath && (typeof storagePath !== 'string' || !storagePath.startsWith(`${authResult.user.id}/`))) {
      return NextResponse.json({ success: false, error: 'مسار الفيديو غير صالح' }, { status: 400 });
    }

    const { data: video, error: dbError } = await supabaseServer
      .from('subject_videos')
      .insert({
        subject_id: subjectId,
        uploaded_by: authResult.user.id,
        title: String(title).trim(),
        description: description || null,
        video_url: videoUrl,
        video_type: videoType || 'video/mp4',
        video_size: Number(videoSize) || 0,
        thumbnail_url: thumbnailUrl || null,
        video_source: 'upload',
      })
      .select()
      .single();

    if (dbError && String(dbError.message || '').includes('STORAGE_FULL')) {
      return NextResponse.json(
        { success: false, error: 'مساحة التخزين ممتلئة. امسح بعض الملفات أو جدد الاشتراك لرفع ملفات جديدة', code: 'STORAGE_FULL' },
        { status: 403 }
      );
    }
    if (dbError) {
      console.error('DB insert error (videos/upload):', dbError);
      return NextResponse.json({ success: false, error: 'حدث خطأ أثناء حفظ بيانات الفيديو' }, { status: 500 });
    }

    return NextResponse.json({ success: true, data: video });
  } catch (error) {
    console.error('Video upload record error:', error);
    return NextResponse.json({ success: false, error: 'حدث خطأ غير متوقع' }, { status: 500 });
  }
}

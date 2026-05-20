import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateRequest, authErrorResponse, verifyOwnership } from '@/lib/auth-helpers';

// Allowed video MIME types
const ALLOWED_VIDEO_MIMES = [
  'video/mp4',
  'video/webm',
  'video/ogg',
  'video/quicktime',
  'video/x-msvideo',
  'video/x-matroska',
];

// Fallback: allowed extensions when mobile sends application/octet-stream
const ALLOWED_VIDEO_EXTENSIONS = [
  '.mp4', '.webm', '.ogg', '.ogv',
  '.mov', '.avi', '.mkv',
  '.m4v', '.3gp',
];

const MAX_VIDEO_SIZE = 500 * 1024 * 1024; // 500MB for videos

/**
 * POST /api/videos/upload
 *
 * Creates a subject_videos record after the client has uploaded the file
 * directly to Supabase Storage. This is the "JSON mode" — only metadata
 * is sent here; the actual file upload happens client-side.
 *
 * Body (JSON):
 *   subjectId, uploadedBy, title, description?,
 *   videoUrl, storagePath, videoType, videoSize
 */
export async function POST(request: NextRequest) {
  const authResult = await authenticateRequest(request);
  if (!authResult.success) return authErrorResponse(authResult);

  try {
    const body = await request.json();
    const {
      subjectId,
      uploadedBy,
      title,
      description,
      videoUrl,
      storagePath,
      videoType,
      videoSize,
    } = body;

    // Validate required fields
    if (!subjectId || !uploadedBy || !title?.trim() || !videoUrl) {
      return NextResponse.json(
        { success: false, error: 'معرف المقرر ومعرف المستخدم والعنوان ورابط الفيديو مطلوبون' },
        { status: 400 }
      );
    }

    // Verify ownership
    const ownershipError = verifyOwnership(authResult.user.id, uploadedBy);
    if (ownershipError) return authErrorResponse(ownershipError);

    // Validate video size
    const size = Number(videoSize) || 0;
    if (size > MAX_VIDEO_SIZE) {
      // Clean up the uploaded file since validation failed
      if (storagePath) {
        await supabaseServer.storage.from('video-files').remove([storagePath]);
      }
      return NextResponse.json(
        { success: false, error: 'حجم الفيديو يتجاوز الحد الأقصى (500 ميجابايت)' },
        { status: 400 }
      );
    }

    // Validate MIME type (with extension fallback for mobile)
    const rawType = videoType || '';
    if (!ALLOWED_VIDEO_MIMES.includes(rawType) && rawType !== 'application/octet-stream' && rawType !== '') {
      // Check extension fallback
      const ext = storagePath?.includes('.')
        ? '.' + storagePath.split('.').pop()?.toLowerCase()
        : '';
      if (!ALLOWED_VIDEO_EXTENSIONS.includes(ext)) {
        if (storagePath) {
          await supabaseServer.storage.from('video-files').remove([storagePath]);
        }
        return NextResponse.json(
          { success: false, error: `نوع الفيديو غير مدعوم: ${rawType}${ext ? ` (${ext})` : ''}` },
          { status: 400 }
        );
      }
    }

    // Insert into subject_videos
    const { data: videoRecord, error: insertError } = await supabaseServer
      .from('subject_videos')
      .insert({
        subject_id: subjectId,
        uploaded_by: uploadedBy,
        title: title.trim(),
        description: description?.trim() || null,
        video_url: videoUrl,
        video_type: rawType || 'video/mp4',
        video_size: size,
        comments_enabled: true,
      })
      .select()
      .single();

    if (insertError) {
      console.error('[Video Upload] DB insert error:', insertError);
      // Clean up storage file since DB record failed
      if (storagePath) {
        await supabaseServer.storage.from('video-files').remove([storagePath]);
      }
      return NextResponse.json(
        { success: false, error: 'حدث خطأ أثناء حفظ بيانات الفيديو' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      data: videoRecord,
    });
  } catch (error) {
    console.error('[Video Upload] Error:', error);
    return NextResponse.json(
      { success: false, error: 'حدث خطأ غير متوقع' },
      { status: 500 }
    );
  }
}

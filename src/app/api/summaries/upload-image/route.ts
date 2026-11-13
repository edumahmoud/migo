import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateRequest, authErrorResponse } from '@/lib/auth-helpers';

// Allowed MIME types for summary content images
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const MAX_FILE_SIZE = 8 * 1024 * 1024; // 8MB
// Reuse the public 'lesson-images' bucket (known to exist with public URLs)
// so the same image works both in summaries and in lessons assigned from them.
const BUCKET_NAME = 'lesson-images';

export const runtime = 'nodejs';

/**
 * POST /api/summaries/upload-image
 *
 * v135e: Upload an image embedded in a source document (PDF/DOCX) so it can
 * be referenced from the summary/transcription Markdown as ![صورة](url).
 *
 * Body: FormData with file (File|Blob)
 * Returns: { url: string }
 */
export async function POST(request: NextRequest) {
  try {
    const authResult = await authenticateRequest(request);
    if (!authResult.success) return authErrorResponse(authResult);

    const userId = authResult.user.id;

    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    // Validate file type (browsers set blob type from canvas.toBlob → image/jpeg|png)
    const mime = file.type || 'image/jpeg';
    if (!ALLOWED_MIME_TYPES.includes(mime)) {
      return NextResponse.json(
        { error: `Invalid file type. Allowed: ${ALLOWED_MIME_TYPES.join(', ')}` },
        { status: 400 }
      );
    }

    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: `Image too large. Maximum size: ${MAX_FILE_SIZE / (1024 * 1024)}MB` },
        { status: 400 }
      );
    }

    const ext = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : mime === 'image/gif' ? 'gif' : 'jpg';
    const storagePath = `summary-images/${userId}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;

    const arrayBuffer = await file.arrayBuffer();
    const { data: uploadData, error: uploadError } = await supabaseServer.storage
      .from(BUCKET_NAME)
      .upload(storagePath, arrayBuffer, { contentType: mime, upsert: false });

    if (uploadError) {
      console.error('[Summary Image API] Upload error:', uploadError.message);
      return NextResponse.json({ error: 'Failed to upload image' }, { status: 500 });
    }

    const { data: urlData } = supabaseServer.storage
      .from(BUCKET_NAME)
      .getPublicUrl(uploadData.path);

    const publicUrl = urlData?.publicUrl;
    if (!publicUrl) {
      await supabaseServer.storage.from(BUCKET_NAME).remove([storagePath]);
      return NextResponse.json({ error: 'Failed to generate public URL' }, { status: 500 });
    }

    return NextResponse.json({ url: publicUrl });
  } catch (error) {
    console.error('[Summary Image API] Unexpected error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

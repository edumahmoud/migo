import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { authenticateRequest, authErrorResponse } from '@/lib/auth-helpers';

// Allowed MIME types for lesson images
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml'];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const BUCKET_NAME = 'lesson-images';

/**
 * POST /api/lessons/upload-image
 *
 * Upload an image for the lesson editor.
 * The image is stored in Supabase Storage bucket 'lesson-images'
 * with path: lessons/{subject_id}/{user_id}/{timestamp}_{filename}
 *
 * Body: FormData with file (File) and subject_id (string)
 *
 * Returns: { url: string }
 */
export async function POST(request: NextRequest) {
  try {
    const authResult = await authenticateRequest(request);
    if (!authResult.success) return authErrorResponse(authResult);

    const userId = authResult.user.id;

    // Parse FormData
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const subjectId = formData.get('subject_id') as string | null;

    if (!file) {
      return NextResponse.json(
        { error: 'No file provided' },
        { status: 400 },
      );
    }

    if (!subjectId) {
      return NextResponse.json(
        { error: 'subject_id is required' },
        { status: 400 },
      );
    }

    // Validate file type
    if (!ALLOWED_MIME_TYPES.includes(file.type)) {
      return NextResponse.json(
        { error: `Invalid file type. Allowed: ${ALLOWED_MIME_TYPES.join(', ')}` },
        { status: 400 },
      );
    }

    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: `File too large. Maximum size: ${MAX_FILE_SIZE / (1024 * 1024)}MB` },
        { status: 400 },
      );
    }

    // Sanitize filename: remove special characters, keep extension
    const originalName = file.name || 'image.png';
    const extension = originalName.split('.').pop()?.toLowerCase() || 'png';
    const safeTimestamp = Date.now();
    const sanitizedFilename = `${safeTimestamp}_${originalName.replace(/[^a-zA-Z0-9._-]/g, '_')}`;

    // Build the storage path: lessons/{subject_id}/{user_id}/{timestamp}_{filename}
    const storagePath = `lessons/${subjectId}/${userId}/${sanitizedFilename}`;

    // Convert File to ArrayBuffer for Supabase upload
    const arrayBuffer = await file.arrayBuffer();

    // Ensure the bucket exists (Supabase should have this configured)
    // Upload the file to Supabase Storage
    const { data: uploadData, error: uploadError } = await supabaseServer.storage
      .from(BUCKET_NAME)
      .upload(storagePath, arrayBuffer, {
        contentType: file.type,
        upsert: false,
      });

    if (uploadError) {
      console.error('[Lessons API] Image upload error:', uploadError.message);
      return NextResponse.json(
        { error: 'Failed to upload image' },
        { status: 500 },
      );
    }

    // Get the public URL for the uploaded file
    const { data: urlData } = supabaseServer.storage
      .from(BUCKET_NAME)
      .getPublicUrl(uploadData.path);

    const publicUrl = urlData?.publicUrl;

    if (!publicUrl) {
      // Try to clean up the uploaded file if URL generation fails
      await supabaseServer.storage.from(BUCKET_NAME).remove([storagePath]);
      return NextResponse.json(
        { error: 'Failed to generate public URL for uploaded image' },
        { status: 500 },
      );
    }

    return NextResponse.json({ url: publicUrl });
  } catch (error) {
    console.error('[Lessons API] Upload image unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}

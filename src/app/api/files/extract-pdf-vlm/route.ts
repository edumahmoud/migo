import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest, authErrorResponse } from '@/lib/auth-helpers';
import { checkRateLimit } from '@/lib/api-security';
import { supabaseServer } from '@/lib/supabase-server';

// VLM-based PDF text extraction for image-heavy / scanned PDFs.
// When pdfjs-dist returns little or no text, this endpoint uses
// the z-ai-web-dev-sdk VLM to "read" the PDF pages and extract text.

export const maxDuration = 60;
export const runtime = 'nodejs';

const MAX_TEXT_LENGTH = 50000;

/**
 * POST /api/files/extract-pdf-vlm
 *
 * Accepts a Supabase Storage URL or storage path, downloads the PDF,
 * and uses the VLM (Vision Language Model) to extract text from it.
 * This is the fallback for scanned/image-only PDFs where pdfjs-dist
 * cannot extract text.
 *
 * Body: { url?: string, storagePath?: string, fileName?: string }
 * Returns: { success: true, data: { text: string, sourceFileType: 'pdf' } }
 */
export async function POST(request: NextRequest) {
  try {
    // Auth check
    const authResult = await authenticateRequest(request);
    if (!authResult.success) return authErrorResponse(authResult);

    // Rate limiting — VLM calls are expensive, use stricter limits
    const rateLimit = checkRateLimit(request, authResult.user.id);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { success: false, error: 'طلبات كثيرة جداً. يرجى المحاولة لاحقاً' },
        { status: 429 }
      );
    }

    // Parse request body
    let body: { url?: string; storagePath?: string; fileName?: string };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { success: false, error: 'فشل في قراءة الطلب' },
        { status: 400 }
      );
    }

    const { url, storagePath, fileName } = body;

    if (!url && !storagePath) {
      return NextResponse.json(
        { success: false, error: 'رابط الملف مطلوب' },
        { status: 400 }
      );
    }

    // Extract storage path from URL or use the provided storagePath
    let resolvedStoragePath = storagePath || '';

    if (!resolvedStoragePath && url) {
      const pathMatch = url.match(/\/storage\/v1\/object\/public\/user-files\/(.+)$/);
      if (pathMatch) {
        resolvedStoragePath = pathMatch[1];
      }
      if (!resolvedStoragePath) {
        const signMatch = url.match(/\/storage\/v1\/object\/sign\/user-files\/(.+)$/);
        if (signMatch) resolvedStoragePath = signMatch[1];
      }
      if (!resolvedStoragePath) {
        const authMatch = url.match(/\/storage\/v1\/object\/authenticated\/user-files\/(.+)$/);
        if (authMatch) resolvedStoragePath = authMatch[1];
      }
    }

    // Get a public or signed URL for the VLM to access
    let fileUrl = url || '';

    // If we have a storage path, try to create a signed URL (works with private buckets)
    if (resolvedStoragePath && !fileUrl) {
      try {
        const { data: signedUrlData } = await supabaseServer.storage
          .from('user-files')
          .createSignedUrl(resolvedStoragePath, 3600); // 1 hour
        if (signedUrlData?.signedUrl) {
          fileUrl = signedUrlData.signedUrl;
        }
      } catch {
        // Signed URL creation failed
      }
    }

    // Fallback: construct public URL from storage path
    if (!fileUrl && resolvedStoragePath) {
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      if (supabaseUrl) {
        fileUrl = `${supabaseUrl}/storage/v1/object/public/user-files/${resolvedStoragePath}`;
      }
    }

    if (!fileUrl) {
      return NextResponse.json(
        { success: false, error: 'فشل في الحصول على رابط الملف' },
        { status: 400 }
      );
    }

    console.log('[Extract PDF VLM] Processing file for user:', authResult.user.id, 'URL:', fileUrl.substring(0, 80) + '...');

    // Use z-ai-web-dev-sdk VLM to extract text from the PDF
    const ZAI = (await import('z-ai-web-dev-sdk')).default;
    const zai = await ZAI.create();

    const response = await zai.chat.completions.createVision({
      model: 'default',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `أنت مساعد لاستخراج النصوص من المستندات. قم باستخراج كل النص المكتوب في هذا الملف PDF. حافظ على الترتيب والتنسيق قدر الإمكان. اكتب النص المستخرج فقط بدون أي تعليقات إضافية. إذا كان الملف يحتوي على صور مع نصوص مكتوبة عليها، استخرج النصوص من الصور أيضاً. إذا كان هناك جداول، حافظ على ترتيبها. إذا كان الملف يحتوي على معادلات رياضية، اكتبها بشكل مقروء.`,
            },
            {
              type: 'file_url',
              file_url: { url: fileUrl },
            },
          ],
        },
      ],
      thinking: { type: 'disabled' },
    });

    let extractedText = response.choices?.[0]?.message?.content || '';

    if (!extractedText.trim()) {
      return NextResponse.json(
        { success: false, error: 'لم يتم العثور على نص في الملف حتى باستخدام التعرف البصري. تأكد أن الملف يحتوي على محتوى مقروء' },
        { status: 400 }
      );
    }

    // Truncate to max length
    if (extractedText.length > MAX_TEXT_LENGTH) {
      console.log(`[Extract PDF VLM] Text truncated from ${extractedText.length} to ${MAX_TEXT_LENGTH} chars`);
      extractedText = extractedText.substring(0, MAX_TEXT_LENGTH);
    }

    console.log('[Extract PDF VLM] Extracted text length:', extractedText.length);

    return NextResponse.json({
      success: true,
      data: {
        text: extractedText,
        sourceFileType: 'pdf',
      },
    });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error('[Extract PDF VLM] Error:', errMsg);

    if (errMsg.includes('RATE_LIMIT') || errMsg.includes('rate')) {
      return NextResponse.json(
        { success: false, error: 'طلبات كثيرة جداً على خدمة التعرف البصري. يرجى المحاولة لاحقاً' },
        { status: 429 }
      );
    }

    return NextResponse.json(
      { success: false, error: 'فشل في استخراج النص باستخدام التعرف البصري: ' + errMsg },
      { status: 500 }
    );
  }
}

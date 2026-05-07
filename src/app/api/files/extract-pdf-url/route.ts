import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest, authErrorResponse } from '@/lib/auth-helpers';
import { checkRateLimit } from '@/lib/api-security';

// Server-side PDF text extraction from a Supabase Storage URL
// This endpoint downloads the PDF from Supabase Storage (server-to-server,
// no body size limit) and extracts text from it.
// This is the RELIABLE path for mobile devices where:
// 1. Client-side pdfjs-dist Web Worker fails to load
// 2. Uploading the full PDF to Vercel API hits the 4.5MB body size limit

export const maxDuration = 30;
export const runtime = 'nodejs';

const MAX_TEXT_LENGTH = 50000;

/**
 * POST /api/files/extract-pdf-url
 *
 * Accepts a Supabase Storage URL and extracts text from the PDF.
 * This bypasses Vercel's 4.5MB body size limit for serverless functions
 * because the PDF is downloaded server-to-server from Supabase Storage.
 *
 * Body: { url: string, storagePath?: string }
 * Returns: { success: true, data: { text: string, pages: number } }
 */
export async function POST(request: NextRequest) {
  try {
    // Auth check
    const authResult = await authenticateRequest(request);
    if (!authResult.success) return authErrorResponse(authResult);

    // Rate limiting
    const rateLimit = checkRateLimit(request, authResult.user.id);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { success: false, error: 'طلبات كثيرة جداً. يرجى المحاولة لاحقاً' },
        { status: 429 }
      );
    }

    // Parse request body
    let body: { url?: string; storagePath?: string };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { success: false, error: 'فشل في قراءة الطلب' },
        { status: 400 }
      );
    }

    const { url, storagePath } = body;

    if (!url && !storagePath) {
      return NextResponse.json(
        { success: false, error: 'رابط الملف مطلوب' },
        { status: 400 }
      );
    }

    // Build the full URL
    let fileUrl = url;
    if (!fileUrl && storagePath) {
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
      fileUrl = `${supabaseUrl}/storage/v1/object/public/user-files/${storagePath}`;
    }

    if (!fileUrl) {
      return NextResponse.json(
        { success: false, error: 'رابط الملف غير صالح' },
        { status: 400 }
      );
    }

    console.log('[Extract PDF URL API] Downloading from:', fileUrl, 'user:', authResult.user.id);

    // Download the PDF from Supabase Storage (server-to-server, no body size limit)
    const downloadRes = await fetch(fileUrl, {
      headers: {
        // Use service role for authentication if it's a private bucket
        ...(process.env.SUPABASE_SERVICE_ROLE_KEY ? {
          'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
        } : {}),
      },
    });

    if (!downloadRes.ok) {
      console.error('[Extract PDF URL API] Download failed:', downloadRes.status, downloadRes.statusText);
      return NextResponse.json(
        { success: false, error: `فشل في تحميل الملف من التخزين (${downloadRes.status})` },
        { status: 400 }
      );
    }

    const arrayBuffer = await downloadRes.arrayBuffer();

    // Validate file size (10MB max)
    const MAX_FILE_SIZE = 10 * 1024 * 1024;
    if (arrayBuffer.byteLength > MAX_FILE_SIZE) {
      return NextResponse.json(
        { success: false, error: 'حجم الملف يتجاوز الحد الأقصى (10 MB)' },
        { status: 400 }
      );
    }

    console.log('[Extract PDF URL API] Downloaded, size:', arrayBuffer.byteLength, 'bytes');

    // Extract text using the same server-side function
    const result = await extractPdfTextServer(arrayBuffer);

    console.log('[Extract PDF URL API] Extracted text, length:', result.text.length, 'pages:', result.pages);

    return NextResponse.json({
      success: true,
      data: result,
    });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error('[Extract PDF URL API] Error:', errMsg);

    if (errMsg.includes('password') || errMsg.includes('encrypted')) {
      return NextResponse.json(
        { success: false, error: 'الملف محمي بكلمة مرور. يرجى رفع ملف غير محمي' },
        { status: 400 }
      );
    }
    if (errMsg.includes('Invalid PDF') || errMsg.includes('Invalid header')) {
      return NextResponse.json(
        { success: false, error: 'الملف تالف أو ليس ملف PDF صالح' },
        { status: 400 }
      );
    }
    if (errMsg === 'NO_TEXT_EXTRACTED') {
      return NextResponse.json(
        { success: false, error: 'لم يتم العثور على نص في الملف. تأكد أن الملف ليس ممسوحاً ضوئياً' },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { success: false, error: 'فشل في استخراج النص من الملف: ' + errMsg },
      { status: 500 }
    );
  }
}

/**
 * Server-side PDF text extraction using pdfjs-dist LEGACY build.
 */
async function extractPdfTextServer(arrayBuffer: ArrayBuffer): Promise<{ text: string; pages: number }> {
  let pdfjsLib: typeof import('pdfjs-dist');

  try {
    pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
    console.log('[Extract PDF Server] Loaded pdfjs-dist LEGACY build');
  } catch (legacyErr) {
    console.warn('[Extract PDF Server] Legacy build failed, trying default:', legacyErr);
    try {
      pdfjsLib = await import('pdfjs-dist');
    } catch (defaultErr) {
      console.error('[Extract PDF Server] Both builds failed:', defaultErr);
      throw new Error('فشل تحميل مكتبة استخراج النص من PDF');
    }
  }

  pdfjsLib.GlobalWorkerOptions.workerSrc = '';

  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;

  const numPages = pdf.numPages;
  const textParts: string[] = [];

  for (let i = 1; i <= numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();

    const items = textContent.items as Array<{ str: string; transform: number[] }>;
    let lastY: number | null = null;
    let pageText = '';

    for (const item of items) {
      if (item.str === undefined) continue;
      const y = item.transform[5];
      if (lastY !== null && Math.abs(y - lastY) > 2) {
        pageText += '\n';
      } else if (lastY !== null) {
        pageText += ' ';
      }
      pageText += item.str;
      lastY = y;
    }

    textParts.push(pageText);
  }

  let fullText = textParts.join('\n\n');

  if (!fullText.trim()) {
    throw new Error('NO_TEXT_EXTRACTED');
  }

  if (fullText.length > MAX_TEXT_LENGTH) {
    fullText = fullText.substring(0, MAX_TEXT_LENGTH);
  }

  return { text: fullText, pages: numPages };
}

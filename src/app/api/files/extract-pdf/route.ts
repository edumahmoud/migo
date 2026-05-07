import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest, authErrorResponse } from '@/lib/auth-helpers';
import { checkRateLimit } from '@/lib/api-security';

// Server-side PDF text extraction
// Uses pdfjs-dist LEGACY build in Node.js (no DOMMatrix dependency, no web worker)
// This is the RELIABLE path for mobile devices where client-side extraction fails.

export const maxDuration = 30; // 30s is enough for text extraction (no AI call)
export const runtime = 'nodejs';

const MAX_TEXT_LENGTH = 50000; // Match client-side limit

/**
 * POST /api/files/extract-pdf
 *
 * Accepts a PDF file and returns extracted text.
 * Supports TWO input formats:
 *   1. FormData with 'file' field (Blob/File upload)
 *   2. JSON with 'data' field (Base64-encoded PDF) — more reliable on mobile
 *
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

    // Determine input format: FormData or JSON (Base64)
    let arrayBuffer: ArrayBuffer;

    const contentType = request.headers.get('content-type') || '';

    if (contentType.includes('multipart/form-data') || contentType.includes('application/octet-stream')) {
      // ─── FormData path ───
      let formData: FormData;
      try {
        formData = await request.formData();
      } catch (formErr) {
        console.error('[Extract PDF API] FormData parsing failed:', formErr);
        return NextResponse.json(
          { success: false, error: 'فشل في قراءة بيانات الملف' },
          { status: 400 }
        );
      }

      const file = formData.get('file') as File | null;
      if (!file) {
        return NextResponse.json(
          { success: false, error: 'لم يتم العثور على ملف' },
          { status: 400 }
        );
      }

      // Validate file type
      if (!file.name.toLowerCase().endsWith('.pdf') && file.type !== 'application/pdf') {
        return NextResponse.json(
          { success: false, error: 'يجب أن يكون الملف بصيغة PDF' },
          { status: 400 }
        );
      }

      // Validate file size (10MB max)
      const MAX_FILE_SIZE = 10 * 1024 * 1024;
      if (file.size > MAX_FILE_SIZE) {
        return NextResponse.json(
          { success: false, error: 'حجم الملف يتجاوز الحد الأقصى (10 MB)' },
          { status: 400 }
        );
      }

      console.log('[Extract PDF API] FormData received, file:', file.name, 'size:', file.size, 'user:', authResult.user.id);
      arrayBuffer = await file.arrayBuffer();
    } else {
      // ─── JSON/Base64 path ───
      let body: { data?: string; name?: string };
      try {
        body = await request.json();
      } catch {
        return NextResponse.json(
          { success: false, error: 'فشل في قراءة الطلب' },
          { status: 400 }
        );
      }

      if (!body.data) {
        return NextResponse.json(
          { success: false, error: 'بيانات الملف مفقودة' },
          { status: 400 }
        );
      }

      console.log('[Extract PDF API] Base64 received, name:', body.name, 'data length:', body.data.length, 'user:', authResult.user.id);

      // Decode Base64 to ArrayBuffer
      try {
        const buffer = Buffer.from(body.data, 'base64');
        arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
      } catch {
        return NextResponse.json(
          { success: false, error: 'فشل في فك تشفير بيانات الملف' },
          { status: 400 }
        );
      }

      // Validate size
      const MAX_FILE_SIZE = 10 * 1024 * 1024;
      if (arrayBuffer.byteLength > MAX_FILE_SIZE) {
        return NextResponse.json(
          { success: false, error: 'حجم الملف يتجاوز الحد الأقصى (10 MB)' },
          { status: 400 }
        );
      }
    }

    // Extract text using pdfjs-dist in Node.js
    const result = await extractPdfTextServer(arrayBuffer);

    console.log('[Extract PDF API] Extracted text, length:', result.text.length, 'pages:', result.pages);

    return NextResponse.json({
      success: true,
      data: result,
    });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error('[Extract PDF API] Error:', errMsg);

    // Return user-friendly Arabic error messages
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
 *
 * CRITICAL: We MUST use the legacy build (pdfjs-dist/legacy/build/pdf.mjs)
 * because the default build requires browser-only APIs (DOMMatrix, etc.)
 * that crash with "ReferenceError: DOMMatrix is not defined" in Node.js.
 *
 * The legacy build is specifically designed for Node.js environments
 * and doesn't depend on any browser APIs.
 *
 * We also disable the web worker (workerSrc = '') since Node.js has no
 * DOM Worker API. The "fake worker" runs parsing synchronously on the
 * main thread, which is fine for text extraction.
 */
async function extractPdfTextServer(arrayBuffer: ArrayBuffer): Promise<{ text: string; pages: number }> {
  let pdfjsLib: typeof import('pdfjs-dist');

  try {
    // CRITICAL FIX: Use the LEGACY build of pdfjs-dist in Node.js.
    // The default build crashes in Node.js with "ReferenceError: DOMMatrix is not defined".
    pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
    console.log('[Extract PDF Server] Loaded pdfjs-dist LEGACY build');
  } catch (legacyErr) {
    // If the legacy build fails to load (e.g., not bundled on Vercel),
    // try the default build as a last resort
    console.warn('[Extract PDF Server] Legacy build failed to load, trying default build:', legacyErr);
    try {
      pdfjsLib = await import('pdfjs-dist');
      console.log('[Extract PDF Server] Loaded pdfjs-dist DEFAULT build (may crash!)');
    } catch (defaultErr) {
      console.error('[Extract PDF Server] Both pdfjs-dist builds failed to load:', defaultErr);
      throw new Error('فشل تحميل مكتبة استخراج النص من PDF على الخادم');
    }
  }

  // Disable web worker for Node.js environment.
  // In Node.js, there's no DOM Worker API, so we must use the "fake worker"
  // which runs parsing on the main thread.
  pdfjsLib.GlobalWorkerOptions.workerSrc = '';

  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;

  const numPages = pdf.numPages;
  const textParts: string[] = [];

  for (let i = 1; i <= numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();

    // Group text items by Y position to reconstruct lines
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

  // Truncate to max length
  if (fullText.length > MAX_TEXT_LENGTH) {
    console.log(`[Extract PDF Server] Text truncated from ${fullText.length} to ${MAX_TEXT_LENGTH} chars`);
    fullText = fullText.substring(0, MAX_TEXT_LENGTH);
  }

  return { text: fullText, pages: numPages };
}

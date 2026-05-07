import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest, authErrorResponse } from '@/lib/auth-helpers';
import { checkRateLimit } from '@/lib/api-security';

// Server-side PDF text extraction
// Uses pdfjs-dist in Node.js (no web worker needed — runs on main thread)
// This is the RELIABLE fallback for mobile devices where client-side
// pdfjs-dist web worker fails to load.

export const maxDuration = 30; // 30s is enough for text extraction (no AI call)
export const runtime = 'nodejs';

const MAX_TEXT_LENGTH = 50000; // Match client-side limit

/**
 * POST /api/files/extract-pdf
 *
 * Accepts a PDF file as FormData and returns extracted text.
 * Used as a fallback when client-side PDF extraction fails on mobile.
 *
 * FormData fields:
 *   - file: PDF file (required)
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

    // Parse FormData
    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
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

    console.log('[Extract PDF API] Processing file:', file.name, 'size:', file.size, 'user:', authResult.user.id);

    // Extract text using pdfjs-dist in Node.js
    const arrayBuffer = await file.arrayBuffer();
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
      { success: false, error: 'فشل في استخراج النص من الملف' },
      { status: 500 }
    );
  }
}

/**
 * Server-side PDF text extraction using pdfjs-dist.
 * In Node.js, we use the "fake worker" mode which runs on the main thread
 * — no web worker needed, so it's 100% reliable.
 */
async function extractPdfTextServer(arrayBuffer: ArrayBuffer): Promise<{ text: string; pages: number }> {
  // Dynamic import — pdfjs-dist is ESM-compatible in Node.js
  const pdfjsLib = await import('pdfjs-dist');

  // CRITICAL: Disable web worker for Node.js environment
  // In Node.js, there's no DOM Worker API, so we must use the "fake worker"
  // which runs parsing on the main thread. This is exactly what we want
  // for server-side processing.
  //
  // Setting workerSrc to empty string tells pdfjs-dist to use its built-in
  // fake worker that doesn't need a separate script file.
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

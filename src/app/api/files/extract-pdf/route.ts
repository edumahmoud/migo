import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest, authErrorResponse } from '@/lib/auth-helpers';
import { checkRateLimit } from '@/lib/api-security';

// Server-side text extraction from PDF and DOCX files
// Uses pdfjs-dist LEGACY build for PDF and mammoth for DOCX in Node.js
// This is the RELIABLE path for mobile devices where client-side extraction fails.

export const maxDuration = 30; // 30s is enough for text extraction (no AI call)
export const runtime = 'nodejs';

const MAX_TEXT_LENGTH = 50000; // Match client-side limit

interface ExtractionResult {
  text: string;
  pages: number;
  sourceFileType: 'pdf' | 'docx';
}

/**
 * POST /api/files/extract-pdf
 *
 * Accepts a PDF or DOCX file and returns extracted text.
 * Supports TWO input formats:
 *   1. FormData with 'file' field (Blob/File upload)
 *   2. JSON with 'data' field (Base64-encoded file) — more reliable on mobile
 *
 * Returns: { success: true, data: { text: string, pages: number, sourceFileType: 'pdf' | 'docx' } }
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
    let fileName: string;

    const contentType = request.headers.get('content-type') || '';

    if (contentType.includes('multipart/form-data') || contentType.includes('application/octet-stream')) {
      // ─── FormData path ───
      let formData: FormData;
      try {
        formData = await request.formData();
      } catch (formErr) {
        console.error('[Extract API] FormData parsing failed:', formErr);
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

      // Validate file type — support PDF and DOCX
      const isPdf = file.name.toLowerCase().endsWith('.pdf') || file.type === 'application/pdf';
      const isDocx = /\.(docx|doc)$/i.test(file.name) || file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      if (!isPdf && !isDocx) {
        return NextResponse.json(
          { success: false, error: 'يجب أن يكون الملف بصيغة PDF أو Word (DOCX)' },
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

      console.log('[Extract API] FormData received, file:', file.name, 'size:', file.size, 'user:', authResult.user.id);
      arrayBuffer = await file.arrayBuffer();
      fileName = file.name;
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

      fileName = body.name || '';
      console.log('[Extract API] Base64 received, name:', body.name, 'data length:', body.data.length, 'user:', authResult.user.id);

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

    // Detect file type
    const isDocx = /\.(docx|doc)$/i.test(fileName);
    let result: ExtractionResult;

    if (isDocx) {
      // ─── DOCX extraction using mammoth ───
      result = await extractDocxTextServer(arrayBuffer);
    } else {
      // ─── PDF extraction using pdfjs-dist ───
      result = await extractPdfTextServer(arrayBuffer);
    }

    console.log('[Extract API] Extracted text, length:', result.text.length, 'type:', result.sourceFileType, 'pages:', result.pages);

    return NextResponse.json({
      success: true,
      data: result,
    });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error('[Extract API] Error:', errMsg);

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
    if (errMsg.includes('Invalid') && errMsg.includes('Word')) {
      return NextResponse.json(
        { success: false, error: 'الملف تالف أو ليس ملف Word صالح' },
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
async function extractPdfTextServer(arrayBuffer: ArrayBuffer): Promise<ExtractionResult> {
  let pdfjsLib: typeof import('pdfjs-dist');

  try {
    pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
    console.log('[Extract PDF Server] Loaded pdfjs-dist LEGACY build');
  } catch (legacyErr) {
    console.warn('[Extract PDF Server] Legacy build failed to load, trying default build:', legacyErr);
    try {
      pdfjsLib = await import('pdfjs-dist');
      console.log('[Extract PDF Server] Loaded pdfjs-dist DEFAULT build (may crash!)');
    } catch (defaultErr) {
      console.error('[Extract PDF Server] Both pdfjs-dist builds failed to load:', defaultErr);
      throw new Error('فشل تحميل مكتبة استخراج النص من PDF على الخادم');
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
    console.log(`[Extract PDF Server] Text truncated from ${fullText.length} to ${MAX_TEXT_LENGTH} chars`);
    fullText = fullText.substring(0, MAX_TEXT_LENGTH);
  }

  return { text: fullText, pages: numPages, sourceFileType: 'pdf' };
}

/**
 * Server-side DOCX text extraction using mammoth.
 */
async function extractDocxTextServer(arrayBuffer: ArrayBuffer): Promise<ExtractionResult> {
  try {
    const mammoth = await import('mammoth');
    console.log('[Extract DOCX Server] Loaded mammoth');

    const result = await mammoth.extractRawText({ arrayBuffer });

    let fullText = result.value;

    // Strip leading whitespace from each line (same as client-side)
    fullText = fullText
      .split('\n')
      .map(line => line.trimStart())
      .join('\n');

    // Collapse multiple consecutive blank lines into max 2
    fullText = fullText.replace(/\n{3,}/g, '\n\n');

    if (!fullText.trim()) {
      throw new Error('NO_TEXT_EXTRACTED');
    }

    if (fullText.length > MAX_TEXT_LENGTH) {
      console.log(`[Extract DOCX Server] Text truncated from ${fullText.length} to ${MAX_TEXT_LENGTH} chars`);
      fullText = fullText.substring(0, MAX_TEXT_LENGTH);
    }

    return { text: fullText, pages: 0, sourceFileType: 'docx' };
  } catch (err) {
    if (err instanceof Error && err.message === 'NO_TEXT_EXTRACTED') {
      throw err;
    }
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error('[Extract DOCX Server] Extraction failed:', errMsg);

    if (errMsg.includes('password') || errMsg.includes('encrypted')) {
      throw new Error('الملف محمي بكلمة مرور. يرجى رفع ملف غير محمي');
    }
    if (errMsg.includes('Invalid') || errMsg.includes('Could not find') || errMsg.includes('corrupted')) {
      throw new Error('الملف تالف أو ليس ملف Word صالح');
    }

    throw new Error(`فشل في قراءة ملف Word: ${errMsg}`);
  }
}

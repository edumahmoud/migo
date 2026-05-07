import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest, authErrorResponse } from '@/lib/auth-helpers';
import { checkRateLimit } from '@/lib/api-security';

// Server-side text extraction from a Supabase Storage URL
// Supports both PDF and DOCX (Word) files.
// This endpoint downloads the file from Supabase Storage (server-to-server,
// no body size limit) and extracts text from it.
// This is the RELIABLE path for mobile devices where:
// 1. Client-side pdfjs-dist Web Worker fails to load
// 2. Uploading the full file to Vercel API hits the 4.5MB body size limit
// 3. Client-side fetch to Supabase Storage fails due to CORS/auth issues

export const maxDuration = 30;
export const runtime = 'nodejs';

const MAX_TEXT_LENGTH = 50000;

export interface ExtractionResult {
  text: string;
  pages: number;
  sourceFileType: 'pdf' | 'docx';
}

/**
 * POST /api/files/extract-pdf-url
 *
 * Accepts a Supabase Storage URL and extracts text from the file (PDF or DOCX).
 * This bypasses Vercel's 4.5MB body size limit for serverless functions
 * because the file is downloaded server-to-server from Supabase Storage.
 *
 * Body: { url: string, storagePath?: string, fileName?: string }
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

    // Detect file type from URL or fileName
    const nameToCheck = fileName || fileUrl;
    const isDocx = /\.(docx|doc)$/i.test(nameToCheck);
    const isPdf = /\.pdf$/i.test(nameToCheck);

    console.log('[Extract URL API] Downloading from:', fileUrl, 'user:', authResult.user.id, 'type:', isDocx ? 'docx' : isPdf ? 'pdf' : 'unknown');

    // Download the file from Supabase Storage (server-to-server, no body size limit)
    const downloadRes = await fetch(fileUrl, {
      headers: {
        // Use service role for authentication if it's a private bucket
        ...(process.env.SUPABASE_SERVICE_ROLE_KEY ? {
          'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
        } : {}),
      },
    });

    if (!downloadRes.ok) {
      console.error('[Extract URL API] Download failed:', downloadRes.status, downloadRes.statusText);
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

    console.log('[Extract URL API] Downloaded, size:', arrayBuffer.byteLength, 'bytes');

    let result: ExtractionResult;

    if (isDocx) {
      // ─── DOCX extraction using mammoth ───
      result = await extractDocxTextServer(arrayBuffer);
    } else {
      // ─── PDF extraction using pdfjs-dist ───
      result = await extractPdfTextServer(arrayBuffer);
    }

    console.log('[Extract URL API] Extracted text, length:', result.text.length, 'type:', result.sourceFileType, 'pages:', result.pages);

    return NextResponse.json({
      success: true,
      data: result,
    });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error('[Extract URL API] Error:', errMsg);

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
    // to prevent code block rendering artifacts in ReactMarkdown
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

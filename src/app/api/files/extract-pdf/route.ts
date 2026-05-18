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
    console.error('[Extract PDF Server] Legacy build failed to load:', legacyErr);
    throw new Error('فشل تحميل مكتبة استخراج النص من PDF على الخادم');
  }

  // pdfjs-dist v5: Don't set workerSrc — v5 auto-detects Node.js and uses fake worker mode.
  // Setting workerSrc = '' was the v4 way to disable the worker, but in v5 it causes
  // import('') to fail with "No GlobalWorkerOptions.workerSrc specified".

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

    // ─── Use convertToHtml instead of extractRawText ───
    // extractRawText strips ALL formatting and loses tables, headings, lists, etc.
    // convertToHtml preserves document structure which we then convert to Markdown.
    const result = await mammoth.convertToHtml({ arrayBuffer });
    let fullText = serverHtmlToMarkdown(result.value);

    if (!fullText.trim()) {
      throw new Error('NO_TEXT_EXTRACTED');
    }

    if (fullText.length > MAX_TEXT_LENGTH) {
      console.log(`[Extract DOCX Server] Text truncated from ${fullText.length} to ${MAX_TEXT_LENGTH} chars`);
      const truncated = fullText.substring(0, MAX_TEXT_LENGTH);
      const lastParagraph = truncated.lastIndexOf('\n\n');
      if (lastParagraph > MAX_TEXT_LENGTH * 0.7) {
        fullText = truncated.substring(0, lastParagraph);
      } else {
        fullText = truncated;
      }
      fullText += '\n\n[... تم اقتطاع جزء من المحتوى لتجاوز الحد الأقصى ...]';
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

/**
 * Server-side HTML to Markdown converter (mirrors client-side logic in pdf-client.ts).
 * Preserves: headings, bold, italic, lists, tables, links, and paragraphs.
 */
function serverHtmlToMarkdown(html: string): string {
  let md = html;

  // Headings
  md = md.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, (_, c) => `# ${stripTags(c).trim()}\n\n`);
  md = md.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, (_, c) => `## ${stripTags(c).trim()}\n\n`);
  md = md.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, (_, c) => `### ${stripTags(c).trim()}\n\n`);
  md = md.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, (_, c) => `#### ${stripTags(c).trim()}\n\n`);

  // Bold and italic
  md = md.replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, '**$2**');
  md = md.replace(/<(em|i)[^>]*>([\s\S]*?)<\/\1>/gi, '*$2*');

  // Links
  md = md.replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)');

  // Lists
  md = md.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, c) => `- ${stripTags(c).trim()}\n`);

  // Tables
  md = md.replace(/<table[^>]*>([\s\S]*?)<\/table>/gi, (_, tableContent) => {
    const rows: string[][] = [];
    for (const rowMatch of tableContent.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const cells: string[] = [];
      for (const cellMatch of rowMatch[1].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)) {
        cells.push(stripTags(cellMatch[1]).trim().replace(/\n/g, ' '));
      }
      if (cells.length > 0) rows.push(cells);
    }
    if (rows.length === 0) return '';
    const maxCols = Math.max(...rows.map(r => r.length));
    const normalized = rows.map(r => { while (r.length < maxCols) r.push(''); return r; });
    let t = '| ' + normalized[0].join(' | ') + ' |\n';
    t += '| ' + normalized[0].map(() => '---').join(' | ') + ' |\n';
    for (let i = 1; i < normalized.length; i++) t += '| ' + normalized[i].join(' | ') + ' |\n';
    return '\n' + t + '\n';
  });

  // Paragraphs
  md = md.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, '$1\n\n');
  // Line breaks
  md = md.replace(/<br\s*\/?>/gi, '\n');
  // Remove remaining tags
  md = stripTags(md);
  // Collapse blank lines
  md = md.replace(/\n{3,}/g, '\n\n');

  return md.trim();
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, '');
}

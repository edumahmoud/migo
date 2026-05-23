import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest, authErrorResponse } from '@/lib/auth-helpers';
import { checkRateLimit } from '@/lib/api-security';
import { supabaseServer } from '@/lib/supabase-server';

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

    // Extract storage path from URL or use the provided storagePath
    // The file_url stored in DB looks like: https://<supabase-url>/storage/v1/object/public/user-files/<path>
    // We need just the <path> part for supabaseServer.storage.download()
    let resolvedStoragePath = storagePath || '';

    if (!resolvedStoragePath && url) {
      // Try to extract the storage path from the URL
      // Pattern 1: /object/public/user-files/<path>
      const pathMatch = url.match(/\/storage\/v1\/object\/public\/user-files\/(.+)$/);
      if (pathMatch) {
        resolvedStoragePath = pathMatch[1];
      }
      // Pattern 2: /object/sign/user-files/<path>
      if (!resolvedStoragePath) {
        const signMatch = url.match(/\/storage\/v1\/object\/sign\/user-files\/(.+)$/);
        if (signMatch) {
          resolvedStoragePath = signMatch[1];
        }
      }
      // Pattern 3: /object/authenticated/user-files/<path>
      if (!resolvedStoragePath) {
        const authMatch = url.match(/\/storage\/v1\/object\/authenticated\/user-files\/(.+)$/);
        if (authMatch) {
          resolvedStoragePath = authMatch[1];
        }
      }
    }

    if (!resolvedStoragePath && !url) {
      return NextResponse.json(
        { success: false, error: 'رابط الملف مطلوب' },
        { status: 400 }
      );
    }

    // Detect file type from fileName or URL
    const nameToCheck = fileName || url || '';
    const isDocx = /\.(docx|doc)$/i.test(nameToCheck);
    const isPdf = /\.pdf$/i.test(nameToCheck);

    console.log('[Extract URL API] user:', authResult.user.id, 'type:', isDocx ? 'docx' : isPdf ? 'pdf' : 'unknown', 'storagePath:', resolvedStoragePath || 'N/A');

    // ─── Download strategy: SDK first (works with private buckets), HTTP fallback ───
    let arrayBuffer: ArrayBuffer = new ArrayBuffer(0);
    let downloadSucceeded = false;

    // Strategy A: Use Supabase SDK with service role key (works with BOTH public and private buckets)
    if (resolvedStoragePath) {
      try {
        const { data: fileData, error: downloadError } = await supabaseServer.storage
          .from('user-files')
          .download(resolvedStoragePath);

        if (!downloadError && fileData) {
          arrayBuffer = await fileData.arrayBuffer();
          downloadSucceeded = true;
          console.log('[Extract URL API] SDK download succeeded, size:', arrayBuffer.byteLength, 'bytes');
        } else {
          console.warn('[Extract URL API] SDK download failed:', downloadError?.message || 'unknown error', '— trying HTTP fallback');
        }
      } catch (sdkErr) {
        console.warn('[Extract URL API] SDK download error:', sdkErr instanceof Error ? sdkErr.message : sdkErr, '— trying HTTP fallback');
      }
    }

    // Strategy B: HTTP fetch fallback (works with public buckets, or public/signed URLs)
    if (!downloadSucceeded && url) {
      try {
        const downloadRes = await fetch(url, {
          headers: {
            ...(process.env.SUPABASE_SERVICE_ROLE_KEY ? {
              'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
            } : {}),
          },
        });

        if (downloadRes.ok) {
          arrayBuffer = await downloadRes.arrayBuffer();
          downloadSucceeded = true;
          console.log('[Extract URL API] HTTP download succeeded, size:', arrayBuffer.byteLength, 'bytes');
        } else {
          console.error('[Extract URL API] HTTP download failed:', downloadRes.status, downloadRes.statusText);
          return NextResponse.json(
            { success: false, error: `فشل في تحميل الملف من التخزين (${downloadRes.status})` },
            { status: 400 }
          );
        }
      } catch (httpErr) {
        console.error('[Extract URL API] HTTP download error:', httpErr instanceof Error ? httpErr.message : httpErr);
        return NextResponse.json(
          { success: false, error: 'فشل في تحميل الملف من التخزين' },
          { status: 400 }
        );
      }
    }

    if (!downloadSucceeded) {
      return NextResponse.json(
        { success: false, error: 'فشل في تحميل الملف — لا يمكن الوصول للتخزين' },
        { status: 400 }
      );
    }

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
    console.error('[Extract PDF Server] Legacy build failed to load:', legacyErr);
    throw new Error('فشل تحميل مكتبة استخراج النص من PDF');
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
    const result = await mammoth.convertToHtml({ arrayBuffer });
    let fullText = urlHtmlToMarkdown(result.value);

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

function urlHtmlToMarkdown(html: string): string {
  let md = html;
  md = md.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, (_, c) => `# ${urlStripTags(c).trim()}\n\n`);
  md = md.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, (_, c) => `## ${urlStripTags(c).trim()}\n\n`);
  md = md.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, (_, c) => `### ${urlStripTags(c).trim()}\n\n`);
  md = md.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, (_, c) => `#### ${urlStripTags(c).trim()}\n\n`);
  md = md.replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, '**$2**');
  md = md.replace(/<(em|i)[^>]*>([\s\S]*?)<\/\1>/gi, '*$2*');
  md = md.replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)');
  md = md.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, c) => `- ${urlStripTags(c).trim()}\n`);
  md = md.replace(/<table[^>]*>([\s\S]*?)<\/table>/gi, (_, tableContent) => {
    const rows: string[][] = [];
    for (const rowMatch of tableContent.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const cells: string[] = [];
      for (const cellMatch of rowMatch[1].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)) {
        cells.push(urlStripTags(cellMatch[1]).trim().replace(/\n/g, ' '));
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
  md = md.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, '$1\n\n');
  md = md.replace(/<br\s*\/?>/gi, '\n');
  md = urlStripTags(md);
  md = md.replace(/\n{3,}/g, '\n\n');
  return md.trim();
}

function urlStripTags(html: string): string {
  return html.replace(/<[^>]+>/g, '');
}

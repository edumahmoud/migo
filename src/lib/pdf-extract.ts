/**
 * PDF Text Extraction Utility
 *
 * Centralized PDF text extraction using pdfjs-dist (v5).
 * pdfjs-dist v5 provides better CMap support (critical for Arabic/RTL text),
 * modern PDF handling, and is actively maintained.
 *
 * Key design decisions:
 * - Uses the legacy build for Node.js server-side rendering
 * - Does NOT override GlobalWorkerOptions.workerSrc — pdfjs-dist v5 detects
 *   Node.js automatically, disables the web Worker, and uses a "fake worker"
 *   that dynamically imports the worker module relative to itself. Overriding
 *   workerSrc with an absolute path breaks this in Vercel/serverless where
 *   process.cwd()/node_modules doesn't exist.
 * - CMap URL is resolved using require.resolve instead of process.cwd() for
 *   the same reason — the module location is reliable in all environments.
 * - Falls back to pdf-parse (loaded via createRequire to avoid the ESM
 *   module.parent bug) if pdfjs-dist fails.
 */

import path from 'path';
import { createRequire } from 'module';
import { NextResponse } from 'next/server';

export interface PdfExtractionResult {
  text: string;
  pages: number;
}

/**
 * Resolve the CMap directory path in a way that works in all environments
 * (local dev, Vercel serverless, Docker, etc.).
 *
 * We resolve the path relative to the pdfjs-dist module itself, NOT relative
 * to process.cwd(). The cmaps directory is at node_modules/pdfjs-dist/cmaps/.
 */
function resolveCMapUrl(): string {
  try {
    // require.resolve finds the actual file path regardless of cwd
    const pdfModulePath = require.resolve('pdfjs-dist/legacy/build/pdf.mjs');
    // pdfModulePath = .../node_modules/pdfjs-dist/legacy/build/pdf.mjs
    // cmaps are at  .../node_modules/pdfjs-dist/cmaps/
    const cMapDir = path.resolve(path.dirname(pdfModulePath), '..', '..', 'cmaps');
    return cMapDir + path.sep;
  } catch {
    // Fallback: try process.cwd() based path (works in local dev)
    const fallback = path.join(process.cwd(), 'node_modules', 'pdfjs-dist', 'cmaps') + path.sep;
    console.warn('[PDF] Could not resolve pdfjs-dist module path for CMap URL, using fallback:', fallback);
    return fallback;
  }
}

/**
 * Extract text from a PDF buffer using pdfjs-dist v5.
 * Dynamically imports the legacy build for server-side Node.js usage.
 * Falls back to pdf-parse if pdfjs-dist fails.
 */
export async function extractPdfText(buffer: Buffer): Promise<PdfExtractionResult> {
  // Try pdfjs-dist first (better Arabic support)
  try {
    return await extractWithPdfjs(buffer);
  } catch (pdfjsErr) {
    console.warn('[PDF] pdfjs-dist extraction failed, trying pdf-parse fallback:', pdfjsErr instanceof Error ? pdfjsErr.message : String(pdfjsErr));

    // Fallback to pdf-parse
    try {
      return await extractWithPdfParse(buffer);
    } catch (parseErr) {
      console.error('[PDF] pdf-parse fallback also failed:', parseErr instanceof Error ? parseErr.message : String(parseErr));
      // If both fail, throw the original pdfjs-dist error (it has better error categorization)
      throw pdfjsErr;
    }
  }
}

/**
 * Extract text using pdfjs-dist v5 (primary method).
 *
 * CRITICAL: Do NOT set GlobalWorkerOptions.workerSrc!
 * In pdfjs-dist v5, when running in Node.js (isNodeJS === true):
 *   1. #isWorkerDisabled is automatically set to true
 *   2. workerSrc defaults to "./pdf.worker.mjs" (relative to pdf.mjs)
 *   3. The fake worker uses import(workerSrc) which resolves correctly
 *      because it's relative to the module, not process.cwd()
 *
 * Overriding workerSrc with an absolute file:// URL breaks this mechanism
 * in Vercel/serverless environments where process.cwd()/node_modules doesn't
 * exist at the expected path.
 */
async function extractWithPdfjs(buffer: Buffer): Promise<PdfExtractionResult> {
  let pdfjsLib: typeof import('pdfjs-dist');

  try {
    // Dynamic import of the legacy build for Node.js server-side usage
    pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
  } catch (importErr) {
    console.error('[PDF] Failed to import pdfjs-dist:', importErr);
    throw new Error('pdfjs-dist module is not available. Ensure pdfjs-dist is installed.');
  }

  // DO NOT set GlobalWorkerOptions.workerSrc!
  // pdfjs-dist v5 auto-detects Node.js and uses the fake worker with
  // relative import("./pdf.worker.mjs") which resolves correctly.
  // Setting it to an absolute path breaks in serverless environments.

  // Resolve CMap URL relative to the module (not process.cwd())
  const cMapUrl = resolveCMapUrl();

  let doc: Awaited<ReturnType<typeof pdfjsLib.getDocument>['promise']>;

  try {
    const loadingTask = pdfjsLib.getDocument({
      data: new Uint8Array(buffer),
      useSystemFonts: true,
      disableFontFace: true,
      cMapUrl,
      cMapPacked: true,
    });

    doc = await loadingTask.promise;
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);

    console.error('[PDF] pdfjs-dist getDocument failed:', errMsg);

    // Re-throw with recognizable error patterns for getPdfErrorMessage
    if (errMsg.includes('password') || errMsg.includes('encrypted') || errMsg.includes('Password')) {
      throw new Error('password protected or encrypted PDF');
    }
    if (errMsg.includes('Invalid PDF') || errMsg.includes('Invalid document')) {
      throw new Error('Invalid PDF structure');
    }

    throw new Error(`Failed to load PDF: ${errMsg}`);
  }

  const numPages = doc.numPages;
  const pageTexts: string[] = [];

  for (let pageNum = 1; pageNum <= numPages; pageNum++) {
    try {
      const page = await doc.getPage(pageNum);
      const textContent = await page.getTextContent({
        normalizeWhitespace: true,
        disableCombineTextItems: false,
      });

      // Build text with proper line reconstruction based on Y-position
      // This handles RTL Arabic text better than simple string joining
      interface TextItem {
        str: string;
        dir: string;
        transform: number[];
        width: number;
        height: number;
        fontName: string;
        hasEOL: boolean;
      }

      const items = textContent.items
        .filter((item): item is TextItem => 'str' in item && typeof item.str === 'string');

      if (items.length === 0) {
        pageTexts.push('');
        continue;
      }

      // Group items by approximate Y position (same line) then sort by X position
      // For RTL, we sort by X descending within each line
      const LINE_THRESHOLD = 3; // pixels tolerance for same line
      const lines: TextItem[][] = [];
      let currentLine: TextItem[] = [items[0]];
      let lastY = items[0].transform[5]; // Y position from transform matrix

      for (let i = 1; i < items.length; i++) {
        const item = items[i];
        const y = item.transform[5];

        if (Math.abs(y - lastY) < LINE_THRESHOLD) {
          // Same line
          currentLine.push(item);
        } else {
          // New line
          lines.push(currentLine);
          currentLine = [item];
          lastY = y;
        }
      }
      lines.push(currentLine); // Don't forget the last line

      // For each line, sort items by X position
      // RTL text: sort descending by X (right-to-left reading order)
      // LTR text: sort ascending by X (left-to-right reading order)
      const pageText = lines.map(line => {
        // Detect direction: if most items have 'rtl' direction, sort RTL
        const rtlCount = line.filter(item => item.dir === 'rtl').length;
        const isRtl = rtlCount > line.length / 2;

        const sorted = [...line].sort((a, b) => {
          const xA = a.transform[4]; // X position
          const xB = b.transform[4];
          return isRtl ? xB - xA : xA - xB; // RTL: descending, LTR: ascending
        });

        return sorted.map(item => item.str).join(isRtl ? '' : ' ');
      }).join('\n');

      pageTexts.push(pageText);
    } catch (pageErr) {
      // If a single page fails, add empty text and continue with other pages
      console.warn(`[PDF] Failed to extract text from page ${pageNum}:`, pageErr instanceof Error ? pageErr.message : String(pageErr));
      pageTexts.push('');
    }
  }

  // Clean up the document
  doc.destroy();

  const text = pageTexts.join('\n\n');

  if (!text.trim()) {
    throw new Error('NO_TEXT_EXTRACTED');
  }

  return { text, pages: numPages };
}

/**
 * Extract text using pdf-parse (fallback method).
 *
 * CRITICAL: pdf-parse must be loaded via createRequire() instead of
 * dynamic import(). The pdf-parse package checks `module.parent` to decide
 * whether to run in debug mode (which tries to read a test PDF file).
 * When loaded via ESM dynamic import(), module.parent is undefined, which
 * triggers the debug path and causes an ENOENT error.
 * Using createRequire() properly sets module.parent and avoids this bug.
 */
async function extractWithPdfParse(buffer: Buffer): Promise<PdfExtractionResult> {
  try {
    // Use createRequire to load pdf-parse as CommonJS (avoids module.parent bug)
    const require = createRequire(import.meta.url);
    const pdfParse: (data: Buffer) => Promise<{ text: string; numpages: number }> = require('pdf-parse');

    const result = await pdfParse(buffer);

    if (!result.text || !result.text.trim()) {
      throw new Error('NO_TEXT_EXTRACTED');
    }

    return { text: result.text, pages: result.numpages };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    // Re-throw with more context
    if (errMsg.includes('ENOENT') || errMsg.includes('test/data')) {
      throw new Error('pdf-parse fallback module is misconfigured');
    }
    throw err;
  }
}

/**
 * Validate a file from a FormData request for PDF processing.
 * Returns the File object or an error response.
 */
export function validatePdfFile(formData: FormData): { file: File } | { error: NextResponse } {
  const file = formData.get('file');

  if (!file || !(file instanceof File)) {
    return {
      error: NextResponse.json(
        { success: false, error: 'يرجى اختيار ملف PDF' },
        { status: 400 }
      ),
    };
  }

  if (!file.name.toLowerCase().endsWith('.pdf') && file.type !== 'application/pdf') {
    return {
      error: NextResponse.json(
        { success: false, error: 'يجب أن يكون الملف بصيغة PDF' },
        { status: 400 }
      ),
    };
  }

  if (file.size > 20 * 1024 * 1024) {
    return {
      error: NextResponse.json(
        { success: false, error: 'حجم الملف كبير جداً (الحد الأقصى 20 ميجابايت)' },
        { status: 400 }
      ),
    };
  }

  return { file };
}

/**
 * Map PDF extraction errors to user-friendly Arabic error messages.
 */
export function getPdfErrorMessage(error: unknown): { message: string; status: number } {
  const errMsg = error instanceof Error ? error.message : String(error);

  if (errMsg === 'NO_TEXT_EXTRACTED') {
    return {
      message: 'لم يتم العثور على نص في الملف. تأكد أن الملف ليس ممسوحاً ضوئياً',
      status: 400,
    };
  }

  if (errMsg.includes('Invalid PDF') || errMsg.includes('Invalid document')) {
    return {
      message: 'الملف تالف أو ليس ملف PDF صالح',
      status: 400,
    };
  }

  if (errMsg.includes('password') || errMsg.includes('encrypted') || errMsg.includes('Password')) {
    return {
      message: 'الملف محمي بكلمة مرور. يرجى رفع ملف غير محمي',
      status: 400,
    };
  }

  if (errMsg.includes('workerSrc') || errMsg.includes('worker') || errMsg.includes('fake worker')) {
    return {
      message: 'خطأ في إعداد معالج PDF. يرجى إعادة المحاولة أو استخدام نص مباشر',
      status: 500,
    };
  }

  if (errMsg.includes('module is not available') || errMsg.includes('pdfjs-dist')) {
    return {
      message: 'خدمة قراءة PDF غير متوفرة حالياً. يرجى المحاولة لاحقاً',
      status: 503,
    };
  }

  if (errMsg.includes('ENOENT') || errMsg.includes('Cannot find module')) {
    return {
      message: 'خطأ في تحميل مكونات PDF. يرجى إعادة المحاولة',
      status: 500,
    };
  }

  return {
    message: 'توجد مشكلة في قراءة ملف PDF. تأكد أن الملف ليس محمياً أو تالفاً',
    status: 400,
  };
}

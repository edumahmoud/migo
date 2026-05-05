/**
 * PDF Text Extraction Utility
 *
 * Uses pdf-parse as the PRIMARY extraction method (most reliable in all
 * environments including Vercel serverless), with pdfjs-dist v5 as a
 * secondary method for enhanced Arabic/RTL text support.
 *
 * Design rationale:
 * - pdf-parse bundles its own pdfjs (v1.10.100) and works reliably in
 *   Vercel serverless, Docker, and local dev without any worker configuration.
 * - pdfjs-dist v5 has better CMap/RTL support but requires the legacy build
 *   to be available at runtime. In Vercel serverless, the dynamic import of
 *   pdfjs-dist can fail because serverExternalPackages prevents bundling and
 *   the module may not be in the serverless function's node_modules.
 * - pdf-parse MUST be loaded via createRequire() instead of ESM dynamic
 *   import(). The pdf-parse package checks `module.parent` to decide whether
 *   to run in debug mode (which tries to read a non-existent test PDF).
 *   ESM dynamic import() sets module.parent to undefined, triggering the
 *   debug path and causing ENOENT errors.
 */

import path from 'path';
import { createRequire } from 'module';
import { NextResponse } from 'next/server';

export interface PdfExtractionResult {
  text: string;
  pages: number;
}

// Singleton: load pdf-parse once via createRequire and cache it
let _pdfParse: ((data: Buffer) => Promise<{ text: string; numpages: number }>) | null = null;

function getPdfParse() {
  if (_pdfParse) return _pdfParse;
  try {
    const require = createRequire(import.meta.url);
    _pdfParse = require('pdf-parse');
    return _pdfParse;
  } catch (err) {
    console.error('[PDF] Failed to load pdf-parse via createRequire:', err);
    return null;
  }
}

/**
 * Extract text from a PDF buffer.
 *
 * Strategy: Try pdf-parse first (reliable in all environments),
 * then try pdfjs-dist if available (better Arabic/RTL support).
 */
export async function extractPdfText(buffer: Buffer): Promise<PdfExtractionResult> {
  // ─── Method 1: pdf-parse (PRIMARY — works in all environments) ───
  try {
    return await extractWithPdfParse(buffer);
  } catch (pdfParseErr) {
    console.warn('[PDF] pdf-parse extraction failed:', pdfParseErr instanceof Error ? pdfParseErr.message : String(pdfParseErr));
  }

  // ─── Method 2: pdfjs-dist v5 (SECONDARY — better Arabic, may not work in serverless) ───
  try {
    return await extractWithPdfjs(buffer);
  } catch (pdfjsErr) {
    console.warn('[PDF] pdfjs-dist extraction also failed:', pdfjsErr instanceof Error ? pdfjsErr.message : String(pdfjsErr));
  }

  // ─── Both methods failed ───
  throw new Error('PDF_EXTRACTION_FAILED');
}

/**
 * Extract text using pdf-parse (PRIMARY method).
 *
 * pdf-parse bundles its own pdfjs v1.10.100, so it doesn't require any
 * external worker configuration. It works reliably in Vercel serverless
 * because the entire library is self-contained.
 *
 * CRITICAL: Must be loaded via createRequire() to avoid the ESM
 * module.parent bug. See module-level getPdfParse() for details.
 */
async function extractWithPdfParse(buffer: Buffer): Promise<PdfExtractionResult> {
  const pdfParse = getPdfParse();
  if (!pdfParse) {
    throw new Error('pdf-parse module is not available');
  }

  const result = await pdfParse(buffer);

  if (!result.text || !result.text.trim()) {
    throw new Error('NO_TEXT_EXTRACTED');
  }

  return { text: result.text, pages: result.numpages };
}

/**
 * Extract text using pdfjs-dist v5 (SECONDARY method).
 *
 * This method provides better Arabic/RTL text extraction because pdfjs-dist
 * v5 has improved CMap support and can detect text direction (RTL vs LTR).
 *
 * However, it requires the pdfjs-dist legacy build to be available at
 * runtime, which may not work in Vercel serverless. If the import fails,
 * the method gracefully fails and the caller falls back to pdf-parse.
 *
 * CRITICAL: Do NOT set GlobalWorkerOptions.workerSrc!
 * In pdfjs-dist v5, when running in Node.js:
 *   1. #isWorkerDisabled is automatically set to true
 *   2. workerSrc defaults to "./pdf.worker.mjs" (relative to pdf.mjs)
 *   3. The fake worker uses import(workerSrc) which resolves correctly
 *      because it's relative to the module, not process.cwd()
 */
async function extractWithPdfjs(buffer: Buffer): Promise<PdfExtractionResult> {
  let pdfjsLib: typeof import('pdfjs-dist');

  try {
    pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
  } catch {
    throw new Error('pdfjs-dist module is not available');
  }

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
      const LINE_THRESHOLD = 3;
      const lines: TextItem[][] = [];
      let currentLine: TextItem[] = [items[0]];
      let lastY = items[0].transform[5];

      for (let i = 1; i < items.length; i++) {
        const item = items[i];
        const y = item.transform[5];

        if (Math.abs(y - lastY) < LINE_THRESHOLD) {
          currentLine.push(item);
        } else {
          lines.push(currentLine);
          currentLine = [item];
          lastY = y;
        }
      }
      lines.push(currentLine);

      const pageText = lines.map(line => {
        const rtlCount = line.filter(item => item.dir === 'rtl').length;
        const isRtl = rtlCount > line.length / 2;

        const sorted = [...line].sort((a, b) => {
          const xA = a.transform[4];
          const xB = b.transform[4];
          return isRtl ? xB - xA : xA - xB;
        });

        return sorted.map(item => item.str).join(isRtl ? '' : ' ');
      }).join('\n');

      pageTexts.push(pageText);
    } catch (pageErr) {
      console.warn(`[PDF] Failed to extract text from page ${pageNum}:`, pageErr instanceof Error ? pageErr.message : String(pageErr));
      pageTexts.push('');
    }
  }

  doc.destroy();

  const text = pageTexts.join('\n\n');

  if (!text.trim()) {
    throw new Error('NO_TEXT_EXTRACTED');
  }

  return { text, pages: numPages };
}

/**
 * Resolve the CMap directory path relative to the pdfjs-dist module.
 * Works in all environments (local dev, Vercel serverless, Docker, etc.).
 */
function resolveCMapUrl(): string {
  try {
    const pdfModulePath = require.resolve('pdfjs-dist/legacy/build/pdf.mjs');
    const cMapDir = path.resolve(path.dirname(pdfModulePath), '..', '..', 'cmaps');
    return cMapDir + path.sep;
  } catch {
    const fallback = path.join(process.cwd(), 'node_modules', 'pdfjs-dist', 'cmaps') + path.sep;
    console.warn('[PDF] Could not resolve pdfjs-dist module path for CMap URL, using fallback:', fallback);
    return fallback;
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

  if (errMsg === 'PDF_EXTRACTION_FAILED') {
    return {
      message: 'توجد مشكلة في قراءة ملف PDF. تأكد أن الملف ليس محمياً أو تالفاً',
      status: 400,
    };
  }

  if (errMsg.includes('Invalid PDF') || errMsg.includes('Invalid document') || errMsg.includes('bad XRef')) {
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

  if (errMsg.includes('workerSrc') || errMsg.includes('fake worker')) {
    return {
      message: 'خطأ في إعداد معالج PDF. يرجى إعادة المحاولة أو استخدام نص مباشر',
      status: 500,
    };
  }

  return {
    message: 'توجد مشكلة في قراءة ملف PDF. تأكد أن الملف ليس محمياً أو تالفاً',
    status: 400,
  };
}

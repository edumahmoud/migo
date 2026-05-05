/**
 * PDF Text Extraction Utility
 *
 * Centralized PDF text extraction using pdfjs-dist (v5).
 * pdfjs-dist v5 provides better CMap support (critical for Arabic/RTL text),
 * modern PDF handling, and is actively maintained.
 *
 * Uses the legacy build for Node.js server-side rendering.
 * Falls back to pdf-parse if pdfjs-dist fails.
 */

import path from 'path';
import { NextResponse } from 'next/server';

export interface PdfExtractionResult {
  text: string;
  pages: number;
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
      // If both fail, throw the original pdfjs-dist error (it has better error categorization)
      throw pdfjsErr;
    }
  }
}

/**
 * Extract text using pdfjs-dist v5 (primary method).
 */
async function extractWithPdfjs(buffer: Buffer): Promise<PdfExtractionResult> {
  let pdfjsLib: typeof import('pdfjs-dist');

  try {
    // Dynamic import of the legacy build for Node.js server-side usage
    pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
  } catch {
    throw new Error('pdfjs-dist module is not available. Ensure pdfjs-dist is installed.');
  }

  // Set the worker source — use file:// URL for compatibility with Next.js runtime
  // pdfjs-dist v5 requires a worker even in Node.js server-side
  const workerPath = path.join(process.cwd(), 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.worker.mjs');
  const workerUrl = 'file://' + workerPath;
  try {
    pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;
  } catch {
    // If file:// URL fails, try the bare file path
    try {
      pdfjsLib.GlobalWorkerOptions.workerSrc = workerPath;
    } catch {
      // Last resort — leave empty and hope for the best
    }
  }

  // Set CMap URL for proper character mapping (critical for Arabic, CJK, etc.)
  const cMapUrl = path.join(process.cwd(), 'node_modules', 'pdfjs-dist', 'cmaps') + path.sep;

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
    } catch {
      // If a single page fails, add empty text and continue with other pages
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
 * pdf-parse is older but works without worker configuration.
 */
async function extractWithPdfParse(buffer: Buffer): Promise<PdfExtractionResult> {
  let pdfParse: (data: Buffer) => Promise<{ text: string; numpages: number }>;

  try {
    const mod = await import('pdf-parse');
    pdfParse = mod.default || mod;
  } catch {
    throw new Error('pdf-parse fallback is not available');
  }

  const result = await pdfParse(buffer);

  if (!result.text || !result.text.trim()) {
    throw new Error('NO_TEXT_EXTRACTED');
  }

  return { text: result.text, pages: result.numpages };
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

  if (errMsg.includes('workerSrc') || errMsg.includes('worker')) {
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

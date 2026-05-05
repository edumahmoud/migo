/**
 * PDF Text Extraction Utility
 *
 * Centralized PDF text extraction using pdfjs-dist (v5).
 * pdfjs-dist v5 provides better CMap support (critical for Arabic/RTL text),
 * modern PDF handling, and is actively maintained.
 *
 * Uses the legacy build for Node.js server-side rendering.
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
 */
export async function extractPdfText(buffer: Buffer): Promise<PdfExtractionResult> {
  let pdfjsLib: typeof import('pdfjs-dist');

  try {
    // Dynamic import of the legacy build for Node.js server-side usage
    pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
  } catch {
    throw new Error('pdfjs-dist module is not available. Ensure pdfjs-dist is installed.');
  }

  // Disable worker for server-side usage (workers are browser-only)
  pdfjsLib.GlobalWorkerOptions.workerSrc = '';

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

      // Combine text items, preserving spatial ordering
      // Text items are ordered by their position in the PDF content stream
      const pageText = textContent.items
        .filter((item): item is { str: string; dir: string; transform: number[]; width: number; height: number; fontName: string; hasEOL: boolean } => 'str' in item)
        .map((item) => {
          let str = item.str;
          // Add a newline if the item has an end-of-line marker
          if (item.hasEOL) {
            str += '\n';
          }
          return str;
        })
        .join(' ');

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

  return {
    message: 'توجد مشكلة في قراءة ملف PDF. تأكد أن الملف ليس محمياً أو تالفاً',
    status: 400,
  };
}

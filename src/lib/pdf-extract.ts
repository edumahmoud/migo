/**
 * PDF Text Extraction Utility
 *
 * Uses pdf-parse EXCLUSIVELY for PDF text extraction.
 * pdf-parse bundles its own pdfjs v1.10.100 internally and works
 * reliably in ALL environments: local dev, Vercel serverless, Docker.
 *
 * Key requirements:
 * - pdf-parse MUST be listed in next.config.ts serverExternalPackages
 *   to prevent webpack from bundling it (which breaks its internal
 *   dynamic require() calls).
 * - pdf-parse MUST be loaded via createRequire() instead of ESM dynamic
 *   import(). The package checks `module.parent` to decide whether to run
 *   in debug mode. ESM dynamic import() sets module.parent to undefined,
 *   triggering the debug path and causing ENOENT errors.
 */

import { createRequire } from 'module';
import { NextResponse } from 'next/server';

export interface PdfExtractionResult {
  text: string;
  pages: number;
}

// Singleton: load pdf-parse once via createRequire and cache it.
// Using a singleton avoids re-creating the require function on every call
// and ensures module.parent is set correctly.
let _pdfParse: ((data: Buffer) => Promise<{ text: string; numpages: number }>) | null = null;

function getPdfParse() {
  if (_pdfParse) return _pdfParse;

  try {
    const require = createRequire(import.meta.url);
    _pdfParse = require('pdf-parse');
    console.log('[PDF] pdf-parse loaded successfully via createRequire');
    return _pdfParse;
  } catch (err) {
    console.error('[PDF] Failed to load pdf-parse via createRequire:', err);
    return null;
  }
}

/**
 * Extract text from a PDF buffer using pdf-parse.
 *
 * pdf-parse bundles its own pdfjs v1.10.100, so it doesn't require any
 * external worker configuration, CMap files, or font files. The entire
 * library is self-contained and works in all Node.js environments.
 */
export async function extractPdfText(buffer: Buffer): Promise<PdfExtractionResult> {
  console.log('[PDF] Starting extraction, buffer size:', buffer.length);

  const pdfParse = getPdfParse();

  if (!pdfParse) {
    console.error('[PDF] pdf-parse module is not available');
    throw new Error('pdf-parse module is not available');
  }

  try {
    const result = await pdfParse(buffer);

    if (!result.text || !result.text.trim()) {
      console.warn('[PDF] Extraction succeeded but no text found');
      throw new Error('NO_TEXT_EXTRACTED');
    }

    console.log('[PDF] Extraction successful, text length:', result.text.length, 'pages:', result.numpages);
    return { text: result.text, pages: result.numpages };
  } catch (err) {
    // Re-throw our custom errors as-is
    if (err instanceof Error && err.message === 'NO_TEXT_EXTRACTED') {
      throw err;
    }

    // Log the actual error for debugging
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error('[PDF] pdf-parse extraction failed:', errMsg);

    // Wrap in a recognizable error
    if (errMsg.includes('password') || errMsg.includes('encrypted') || errMsg.includes('Password')) {
      throw new Error('password protected or encrypted PDF');
    }
    if (errMsg.includes('Invalid PDF') || errMsg.includes('Invalid document') || errMsg.includes('bad XRef')) {
      throw new Error('Invalid PDF structure');
    }

    throw new Error(`PDF extraction failed: ${errMsg}`);
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

  if (errMsg.includes('module is not available') || errMsg.includes('pdf-parse')) {
    return {
      message: 'خدمة قراءة PDF غير متوفرة حالياً. يرجى المحاولة لاحقاً',
      status: 503,
    };
  }

  return {
    message: 'توجد مشكلة في قراءة ملف PDF. تأكد أن الملف ليس محمياً أو تالفاً',
    status: 400,
  };
}

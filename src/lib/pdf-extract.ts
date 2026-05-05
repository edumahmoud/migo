/**
 * PDF Text Extraction Utility
 *
 * Uses pdf-parse for PDF text extraction.
 *
 * CRITICAL: pdf-parse MUST be in serverExternalPackages in next.config.ts
 * because its internal dynamic require(`./pdf.js/${version}/build/pdf.js`)
 * cannot be bundled by webpack/turbopack.
 *
 * Loading strategy:
 * - eval('require') bypasses webpack static analysis so the bundler
 *   doesn't try (and fail) to resolve pdf-parse's dynamic internals.
 * - serverExternalPackages ensures Vercel includes pdf-parse in node_modules.
 * - At runtime, Node.js resolves pdf-parse from node_modules normally.
 */

import { NextResponse } from 'next/server';

export interface PdfExtractionResult {
  text: string;
  pages: number;
}

// Singleton for pdf-parse module
let _pdfParse: ((data: Buffer) => Promise<{ text: string; numpages: number }>) | null = null;

/**
 * Load pdf-parse using eval('require') to bypass webpack/turbopack.
 * This is the ORIGINAL approach that was working before pdfjs-dist was introduced.
 *
 * Why eval('require')?
 * - webpack/turbopack can't see the require, so they don't try to bundle pdf-parse
 * - serverExternalPackages in next.config.ts tells Vercel to include it in node_modules
 * - At runtime, Node.js resolves it normally from node_modules
 */
function loadPdfParse() {
  if (_pdfParse) return _pdfParse;

  try {
    // eslint-disable-next-line no-eval
    const pdfParse = eval('require')('pdf-parse');
    if (pdfParse && typeof pdfParse === 'function') {
      _pdfParse = pdfParse;
      console.log('[PDF] pdf-parse loaded successfully via eval(require)');
      return _pdfParse;
    }
    console.error('[PDF] pdf-parse loaded but is not a function:', typeof pdfParse);
  } catch (err) {
    console.error('[PDF] eval(require)("pdf-parse") failed:', err instanceof Error ? err.message : String(err));
  }

  // Fallback: try createRequire (in case eval is blocked)
  try {
    const { createRequire } = require('module');
    const req = createRequire(process.cwd() + '/package.json');
    const pdfParse = req('pdf-parse');
    if (pdfParse && typeof pdfParse === 'function') {
      _pdfParse = pdfParse;
      console.log('[PDF] pdf-parse loaded via createRequire fallback');
      return _pdfParse;
    }
  } catch (err) {
    console.error('[PDF] createRequire fallback failed:', err instanceof Error ? err.message : String(err));
  }

  console.error('[PDF] All methods to load pdf-parse failed. cwd:', process.cwd());
  return null;
}

/**
 * Extract text from a PDF buffer using pdf-parse.
 */
export async function extractPdfText(buffer: Buffer): Promise<PdfExtractionResult> {
  console.log('[PDF] Starting extraction, buffer size:', buffer.length);

  const pdfParse = loadPdfParse();

  if (!pdfParse) {
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
    if (err instanceof Error && err.message === 'NO_TEXT_EXTRACTED') {
      throw err;
    }

    const errMsg = err instanceof Error ? err.message : String(err);
    console.error('[PDF] pdf-parse extraction failed:', errMsg);

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

  if (errMsg.includes('module is not available')) {
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

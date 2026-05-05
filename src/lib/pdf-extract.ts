/**
 * PDF Text Extraction Utility
 *
 * Uses pdf-parse for PDF text extraction. pdf-parse bundles its own
 * pdfjs v1.10.100 internally and is self-contained.
 *
 * CRITICAL for Vercel serverless:
 * - pdf-parse MUST be in serverExternalPackages (prevents broken webpack bundling)
 * - pdf-parse files MUST be in outputFileTracingIncludes (ensures they're deployed)
 * - pdf-parse MUST be loaded via createRequire() (avoids ESM module.parent bug)
 * - createResolve MUST use process.cwd() as base (import.meta.url fails in Vercel)
 */

import { createRequire } from 'module';
import path from 'path';
import { NextResponse } from 'next/server';

export interface PdfExtractionResult {
  text: string;
  pages: number;
}

// Singleton for pdf-parse module
let _pdfParse: ((data: Buffer) => Promise<{ text: string; numpages: number }>) | null = null;
let _loadError: string | null = null;

/**
 * Load pdf-parse using multiple fallback methods.
 *
 * In Vercel serverless:
 * - import.meta.url points to /var/task/.next/server/chunks/xxx.js
 * - node_modules is at /var/task/node_modules/
 * - createRequire(import.meta.url) resolves from the chunks dir, which works
 *   because Node.js walks up to find node_modules
 * - createRequire(process.cwd() + '/package.json') resolves from project root
 *   which is more direct and reliable
 *
 * In local dev:
 * - Both methods work fine
 */
function loadPdfParse() {
  if (_pdfParse) return _pdfParse;

  // Method 1: createRequire from process.cwd() (most reliable in Vercel)
  try {
    const cwdRequire = createRequire(path.join(process.cwd(), 'package.json'));
    const mod = cwdRequire('pdf-parse');
    if (mod && typeof mod === 'function') {
      _pdfParse = mod;
      console.log('[PDF] pdf-parse loaded via createRequire(process.cwd)');
      return _pdfParse;
    }
  } catch (err) {
    console.warn('[PDF] Method 1 (createRequire from cwd) failed:', err instanceof Error ? err.message : String(err));
  }

  // Method 2: createRequire from import.meta.url
  try {
    const urlRequire = createRequire(import.meta.url);
    const mod = urlRequire('pdf-parse');
    if (mod && typeof mod === 'function') {
      _pdfParse = mod;
      console.log('[PDF] pdf-parse loaded via createRequire(import.meta.url)');
      return _pdfParse;
    }
  } catch (err) {
    console.warn('[PDF] Method 2 (createRequire from import.meta.url) failed:', err instanceof Error ? err.message : String(err));
  }

  // Method 3: Try global require (works in some Next.js setups)
  try {
    // @ts-ignore - require might be available in some Next.js contexts
    if (typeof require === 'function') {
      // @ts-ignore
      const mod = require('pdf-parse');
      if (mod && typeof mod === 'function') {
        _pdfParse = mod;
        console.log('[PDF] pdf-parse loaded via global require');
        return _pdfParse;
      }
    }
  } catch (err) {
    console.warn('[PDF] Method 3 (global require) failed:', err instanceof Error ? err.message : String(err));
  }

  _loadError = 'All methods to load pdf-parse failed';
  console.error('[PDF]', _loadError, '- process.cwd():', process.cwd());
  return null;
}

/**
 * Extract text from a PDF buffer using pdf-parse.
 */
export async function extractPdfText(buffer: Buffer): Promise<PdfExtractionResult> {
  console.log('[PDF] Starting extraction, buffer size:', buffer.length, 'cwd:', process.cwd());

  const pdfParse = loadPdfParse();

  if (!pdfParse) {
    console.error('[PDF] pdf-parse module is not available. Load error:', _loadError);
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

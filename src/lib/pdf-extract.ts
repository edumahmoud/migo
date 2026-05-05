/**
 * PDF Text Extraction Utility
 *
 * Centralized PDF text extraction that works reliably across
 * all deployment environments (local, Vercel, Docker, etc.).
 *
 * Uses a multi-strategy approach:
 *  1. Direct require() — works when pdf-parse is in serverExternalPackages
 *  2. eval('require') — fallback for Turbopack dev mode
 *  3. Dynamic import() — fallback for ESM-first environments
 */

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

export interface PdfExtractionResult {
  text: string;
  pages: number;
}

/**
 * Extract text from a PDF buffer using pdf-parse.
 * Tries multiple loading strategies for maximum compatibility.
 */
export async function extractPdfText(buffer: Buffer): Promise<PdfExtractionResult> {
  // Strategy 1: Direct require (works with serverExternalPackages in next.config)
  let pdfParse: ((buf: Buffer) => Promise<{ text: string; numpages: number }>) | null = null;

  try {
    pdfParse = require('pdf-parse');
  } catch {
    // Strategy 2: eval('require') to bypass Turbopack static analysis in dev
    try {
      // eslint-disable-next-line no-eval
      pdfParse = eval('require')('pdf-parse');
    } catch {
      // Strategy 3: Dynamic import (ESM fallback)
      try {
        const mod = await import('pdf-parse');
        pdfParse = mod.default || mod;
      } catch {
        throw new Error('pdf-parse module is not available. Ensure pdf-parse is installed and listed in serverExternalPackages.');
      }
    }
  }

  if (!pdfParse || typeof pdfParse !== 'function') {
    throw new Error('pdf-parse module loaded but is not a function');
  }

  const data = await pdfParse(buffer);
  const text = data.text || '';
  const pages = data.numpages || 0;

  if (!text.trim()) {
    throw new Error('NO_TEXT_EXTRACTED');
  }

  return { text, pages };
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

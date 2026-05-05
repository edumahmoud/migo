import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest, authErrorResponse } from '@/lib/auth-helpers';
import { extractPdfText, validatePdfFile, getPdfErrorMessage } from '@/lib/pdf-extract';

/**
 * POST /api/gemini/extract-pdf
 *
 * Accepts a PDF file as multipart/form-data, extracts text server-side
 * using pdf-parse, and returns the extracted text.
 */
export async function POST(request: NextRequest) {
  try {
    // Auth check
    const authResult = await authenticateRequest(request);
    if (!authResult.success) return authErrorResponse(authResult);

    // Parse multipart form data
    const formData = await request.formData();
    const validation = validatePdfFile(formData);

    if ('error' in validation) {
      return validation.error;
    }

    const file = validation.file;

    console.log('[Extract PDF API] Processing file:', file.name, 'size:', file.size);

    try {
      const buffer = Buffer.from(await file.arrayBuffer());
      const { text, pages } = await extractPdfText(buffer);

      console.log('[Extract PDF API] Extracted text length:', text.length, 'pages:', pages);

      return NextResponse.json({
        success: true,
        data: {
          text: text.trim(),
          pages,
        },
      });
    } catch (pdfErr) {
      const { message, status } = getPdfErrorMessage(pdfErr);
      return NextResponse.json(
        { success: false, error: message },
        { status }
      );
    }
  } catch (error: unknown) {
    console.error('[Extract PDF API] Unexpected error:', error);
    // Distinguish between auth errors and other unexpected errors
    const errMsg = error instanceof Error ? error.message : String(error);
    if (errMsg.includes('auth') || errMsg.includes('token') || errMsg.includes('Unauthorized')) {
      return NextResponse.json(
        { success: false, error: 'يرجى تسجيل الدخول مرة أخرى' },
        { status: 401 }
      );
    }
    return NextResponse.json(
      { success: false, error: 'حدث خطأ غير متوقع أثناء معالجة الملف. يرجى المحاولة مرة أخرى' },
      { status: 500 }
    );
  }
}

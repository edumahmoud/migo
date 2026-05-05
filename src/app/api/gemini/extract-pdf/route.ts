import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest, authErrorResponse } from '@/lib/auth-helpers';
import { extractPdfText, validatePdfFile, getPdfErrorMessage } from '@/lib/pdf-extract';

/**
 * POST /api/gemini/extract-pdf
 *
 * Accepts a PDF file as multipart/form-data, extracts text server-side
 * using pdfjs-dist, and returns the extracted text.
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
    console.error('[Extract PDF API] Error:', error);
    return NextResponse.json(
      { success: false, error: 'توجد مشكلة في قراءة ملف PDF. تأكد أن الملف ليس محمياً أو تالفاً' },
      { status: 500 }
    );
  }
}

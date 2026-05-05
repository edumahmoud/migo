import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest, authErrorResponse } from '@/lib/auth-helpers';

/**
 * POST /api/gemini/extract-pdf
 *
 * Accepts a PDF file as multipart/form-data, extracts text server-side
 * using pdf-parse, and returns the extracted text.
 * This avoids client-side pdfjs-dist compatibility issues.
 */
export async function POST(request: NextRequest) {
  try {
    // Auth check
    const authResult = await authenticateRequest(request);
    if (!authResult.success) return authErrorResponse(authResult);

    // Parse multipart form data
    const formData = await request.formData();
    const file = formData.get('file');

    if (!file || !(file instanceof File)) {
      return NextResponse.json(
        { success: false, error: 'يرجى اختيار ملف PDF' },
        { status: 400 }
      );
    }

    // Validate file type
    if (!file.name.toLowerCase().endsWith('.pdf') && file.type !== 'application/pdf') {
      return NextResponse.json(
        { success: false, error: 'يجب أن يكون الملف بصيغة PDF' },
        { status: 400 }
      );
    }

    // Validate file size (max 20MB)
    if (file.size > 20 * 1024 * 1024) {
      return NextResponse.json(
        { success: false, error: 'حجم الملف كبير جداً (الحد الأقصى 20 ميجابايت)' },
        { status: 400 }
      );
    }

    console.log('[Extract PDF API] Processing file:', file.name, 'size:', file.size);

    // Use dynamic require via eval to bypass Turbopack static analysis
    // pdf-parse is a CommonJS module that Turbopack can't resolve with import()
    const buffer = Buffer.from(await file.arrayBuffer());
    const pdfParse = eval('require')('pdf-parse');
    const data = await pdfParse(buffer);
    const text = data.text || '';

    if (!text.trim()) {
      return NextResponse.json(
        { success: false, error: 'لم يتم العثور على نص في الملف. تأكد أن الملف ليس ممسوحاً ضوئياً' },
        { status: 400 }
      );
    }

    console.log('[Extract PDF API] Extracted text length:', text.length, 'pages:', data.numpages);

    return NextResponse.json({
      success: true,
      data: {
        text: text.trim(),
        pages: data.numpages,
      },
    });
  } catch (error: unknown) {
    console.error('[Extract PDF API] Error:', error);

    const errMsg = error instanceof Error ? error.message : String(error);

    if (errMsg.includes('Invalid PDF') || errMsg.includes('Invalid document')) {
      return NextResponse.json(
        { success: false, error: 'الملف تالف أو ليس ملف PDF صالح' },
        { status: 400 }
      );
    }

    if (errMsg.includes('password') || errMsg.includes('encrypted') || errMsg.includes('Password')) {
      return NextResponse.json(
        { success: false, error: 'الملف محمي بكلمة مرور. يرجى رفع ملف غير محمي' },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { success: false, error: 'توجد مشكلة في قراءة ملف PDF. تأكد أن الملف ليس محمياً أو تالفاً' },
      { status: 500 }
    );
  }
}

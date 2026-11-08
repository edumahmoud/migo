import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest, authErrorResponse } from '@/lib/auth-helpers';
import { checkRateLimit } from '@/lib/api-security';
import { supabaseServer } from '@/lib/supabase-server';
import { geminiProvider } from '@/lib/ai/providers/gemini';
import { isAiError } from '@/lib/ai/types';
import { PDF_OCR_PROMPT } from '@/lib/ai/prompts';

// OCR-based PDF text extraction for image-heavy / scanned PDFs.
//
// When pdfjs-dist returns little or no text (scanned PDFs have no text layer),
// this endpoint "reads" the PDF using AI vision:
//
//   Engine A (PRIMARY): Gemini inline-PDF OCR — the raw PDF bytes are sent
//   directly to Gemini (native document understanding, works on scans,
//   no public URL needed, uses the existing key pool with rotation).
//
//   Engine B (FALLBACK): z-ai-web-dev-sdk VLM — the PDF's URL is passed to
//   the VLM which fetches and reads it itself. Requires a reachable URL.
//
// Input (JSON): { url?, storagePath?, fileName?, data? }
//   - data: base64-encoded PDF bytes (used when the file was NOT uploaded
//     to storage, e.g. upload failed — bounded by Vercel's 4.5MB body limit,
//     so the client only sends it for files ≤ 3MB)
//   - url / storagePath: located file (server downloads the bytes itself,
//     bypassing the body limit entirely)
//
// Returns: { success: true, data: { text, sourceFileType: 'pdf', engine } }

export const maxDuration = 60;
export const runtime = 'nodejs';

const MAX_TEXT_LENGTH = 50000;
const MAX_PDF_BYTES = 10 * 1024 * 1024; // 10MB — matches the extract endpoints

// Total budget for the OCR engines, leaving headroom inside Vercel's 60s
// maxDuration for auth + download + response serialization.
const OCR_TOTAL_BUDGET_MS = 52000;
// Gemini OCR gets the lion's share; if it fails we still want ~15s for the VLM.
const GEMINI_OCR_BUDGET_MS = 38000;
const MIN_VLM_BUDGET_MS = 15000;

/**
 * POST /api/files/extract-pdf-vlm
 */
export async function POST(request: NextRequest) {
  const requestStartTime = Date.now();

  try {
    // Auth check
    const authResult = await authenticateRequest(request);
    if (!authResult.success) return authErrorResponse(authResult);

    // Rate limiting — OCR calls are expensive, use stricter limits
    const rateLimit = checkRateLimit(request, authResult.user.id);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { success: false, error: 'طلبات كثيرة جداً. يرجى المحاولة لاحقاً' },
        { status: 429 }
      );
    }

    // Parse request body
    let body: { url?: string; storagePath?: string; fileName?: string; data?: string };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { success: false, error: 'فشل في قراءة الطلب' },
        { status: 400 }
      );
    }

    const { url, storagePath, fileName, data } = body;

    if (!url && !storagePath && !data) {
      return NextResponse.json(
        { success: false, error: 'رابط الملف أو بياناته مطلوبة' },
        { status: 400 }
      );
    }

    // ─── Resolve storage path from URL (for SDK download + signed URLs) ───
    let resolvedStoragePath = storagePath || '';

    if (!resolvedStoragePath && url) {
      const pathMatch = url.match(/\/storage\/v1\/object\/public\/user-files\/(.+)$/);
      if (pathMatch) {
        resolvedStoragePath = pathMatch[1];
      }
      if (!resolvedStoragePath) {
        const signMatch = url.match(/\/storage\/v1\/object\/sign\/user-files\/(.+)$/);
        if (signMatch) resolvedStoragePath = signMatch[1];
      }
      if (!resolvedStoragePath) {
        const authMatch = url.match(/\/storage\/v1\/object\/authenticated\/user-files\/(.+)$/);
        if (authMatch) resolvedStoragePath = authMatch[1];
      }
    }

    console.log('[PDF OCR] user:', authResult.user.id,
      'input:', data ? 'inline-base64' : resolvedStoragePath ? 'storage-path' : 'url',
      'name:', fileName || 'N/A');

    // ─── Resolve PDF bytes: inline base64 → SDK download → HTTP fetch ───
    let pdfBytes: Buffer | null = null;

    if (data) {
      try {
        const buffer = Buffer.from(data, 'base64');
        if (buffer.byteLength === 0) {
          return NextResponse.json(
            { success: false, error: 'بيانات الملف فارغة' },
            { status: 400 }
          );
        }
        if (buffer.byteLength > MAX_PDF_BYTES) {
          return NextResponse.json(
            { success: false, error: 'حجم الملف يتجاوز الحد الأقصى (10 MB)' },
            { status: 400 }
          );
        }
        pdfBytes = buffer;
      } catch {
        return NextResponse.json(
          { success: false, error: 'فشل في فك تشفير بيانات الملف' },
          { status: 400 }
        );
      }
    }

    if (!pdfBytes && resolvedStoragePath) {
      try {
        const { data: fileData, error: downloadError } = await supabaseServer.storage
          .from('user-files')
          .download(resolvedStoragePath);

        if (!downloadError && fileData) {
          const buffer = Buffer.from(await fileData.arrayBuffer());
          if (buffer.byteLength <= MAX_PDF_BYTES) {
            pdfBytes = buffer;
            console.log('[PDF OCR] SDK download succeeded, size:', buffer.byteLength, 'bytes');
          } else {
            console.warn('[PDF OCR] SDK download exceeded size limit:', buffer.byteLength);
          }
        } else {
          console.warn('[PDF OCR] SDK download failed:', downloadError?.message || 'unknown error');
        }
      } catch (sdkErr) {
        console.warn('[PDF OCR] SDK download error:', sdkErr instanceof Error ? sdkErr.message : sdkErr);
      }
    }

    if (!pdfBytes && url) {
      try {
        const downloadRes = await fetch(url, {
          headers: {
            ...(process.env.SUPABASE_SERVICE_ROLE_KEY ? {
              'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
            } : {}),
          },
        });
        if (downloadRes.ok) {
          const buffer = Buffer.from(await downloadRes.arrayBuffer());
          if (buffer.byteLength <= MAX_PDF_BYTES) {
            pdfBytes = buffer;
            console.log('[PDF OCR] HTTP download succeeded, size:', buffer.byteLength, 'bytes');
          } else {
            console.warn('[PDF OCR] HTTP download exceeded size limit:', buffer.byteLength);
          }
        } else {
          console.warn('[PDF OCR] HTTP download failed:', downloadRes.status);
        }
      } catch (httpErr) {
        console.warn('[PDF OCR] HTTP download error:', httpErr instanceof Error ? httpErr.message : httpErr);
      }
    }

    // ─── Engine A: Gemini inline-PDF OCR (PRIMARY) ───
    // Requires the raw bytes and a %PDF magic header (be strict — sending a
    // non-PDF to Gemini inline would waste the whole OCR budget).
    const isPdfBytes = !!pdfBytes && pdfBytes.length > 5 && pdfBytes.subarray(0, 5).toString('latin1') === '%PDF-';

    if (isPdfBytes && pdfBytes) {
      const remaining = OCR_TOTAL_BUDGET_MS - (Date.now() - requestStartTime);
      if (remaining > 8000) {
        const budget = Math.min(GEMINI_OCR_BUDGET_MS, remaining - 3000);
        try {
          const pdfBase64 = pdfBytes.toString('base64');
          const extractedText = await geminiProvider.ocrPdf(pdfBase64, PDF_OCR_PROMPT, budget);

          if (extractedText.trim()) {
            const text = truncate(extractedText);
            console.log('[PDF OCR] Gemini engine succeeded, text length:', text.length,
              'total time:', Date.now() - requestStartTime, 'ms');
            return NextResponse.json({
              success: true,
              data: { text, sourceFileType: 'pdf', engine: 'gemini-ocr' },
            });
          }
        } catch (geminiErr) {
          const code = isAiError(geminiErr) ? geminiErr.code : 'UNKNOWN';
          const msg = geminiErr instanceof Error ? geminiErr.message : String(geminiErr);
          console.warn('[PDF OCR] Gemini engine failed:', code, '—', msg);
        }
      } else {
        console.warn('[PDF OCR] Skipping Gemini engine — only', remaining, 'ms of budget left');
      }
    } else if (!isPdfBytes) {
      console.warn('[PDF OCR] No PDF bytes available for Gemini engine',
        pdfBytes ? '(magic header mismatch — not a PDF?)' : '(download/decode failed)');
    }

    // ─── Resolve a file URL for the VLM engine ───
    let fileUrl = url || '';

    if (!fileUrl && resolvedStoragePath) {
      try {
        const { data: signedUrlData } = await supabaseServer.storage
          .from('user-files')
          .createSignedUrl(resolvedStoragePath, 3600); // 1 hour
        if (signedUrlData?.signedUrl) {
          fileUrl = signedUrlData.signedUrl;
        }
      } catch {
        // Signed URL creation failed
      }

      if (!fileUrl) {
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
        if (supabaseUrl) {
          fileUrl = `${supabaseUrl}/storage/v1/object/public/user-files/${resolvedStoragePath}`;
        }
      }
    }

    if (!fileUrl) {
      return NextResponse.json(
        {
          success: false,
          error: 'تعذر استخراج النص من الملف: فشل تحميل بيانات الملف ومحرك القراءة الاحتياطي يحتاج رابطاً للملف. يرجى المحاولة مرة أخرى',
        },
        { status: 400 }
      );
    }

    // ─── Engine B: z-ai VLM (FALLBACK) ───
    const remainingForVlm = OCR_TOTAL_BUDGET_MS - (Date.now() - requestStartTime);
    if (remainingForVlm < MIN_VLM_BUDGET_MS) {
      console.warn('[PDF OCR] Skipping VLM engine — only', remainingForVlm, 'ms of budget left');
      return NextResponse.json(
        { success: false, error: 'انتهت مهلة استخراج النص من الملف. الملف قد يكون كبيراً جداً — جرب ملفاً أصغر حجماً' },
        { status: 504 }
      );
    }

    const ZAI = (await import('z-ai-web-dev-sdk')).default;
    const zai = await ZAI.create();

    const response = await zai.chat.completions.createVision({
      model: 'default',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `أنت مساعد لاستخراج النصوص من المستندات. قم باستخراج كل النص المكتوب في هذا الملف PDF. حافظ على الترتيب والتنسيق قدر الإمكان. اكتب النص المستخرج فقط بدون أي تعليقات إضافية. إذا كان الملف يحتوي على صور مع نصوص مكتوبة عليها، استخرج النصوص من الصور أيضاً. إذا كان هناك جداول، حافظ على ترتيبها. إذا كان الملف يحتوي على معادلات رياضية، اكتبها بشكل مقروء.`,
            },
            {
              type: 'file_url',
              file_url: { url: fileUrl },
            },
          ],
        },
      ],
      thinking: { type: 'disabled' },
    });

    let extractedText = response.choices?.[0]?.message?.content || '';

    if (!extractedText.trim()) {
      return NextResponse.json(
        { success: false, error: 'لم يتم العثور على نص في الملف حتى باستخدام التعرف البصري. تأكد أن الملف يحتوي على محتوى مقروء' },
        { status: 400 }
      );
    }

    const text = truncate(extractedText);
    console.log('[PDF OCR] VLM engine succeeded, text length:', text.length,
      'total time:', Date.now() - requestStartTime, 'ms');

    return NextResponse.json({
      success: true,
      data: { text, sourceFileType: 'pdf', engine: 'vlm' },
    });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error('[PDF OCR] Error:', errMsg);

    if (errMsg.includes('RATE_LIMIT') || errMsg.includes('rate')) {
      return NextResponse.json(
        { success: false, error: 'طلبات كثيرة جداً على خدمة التعرف البصري. يرجى المحاولة لاحقاً' },
        { status: 429 }
      );
    }

    return NextResponse.json(
      { success: false, error: 'فشل في استخراج النص باستخدام التعرف البصري: ' + errMsg },
      { status: 500 }
    );
  }
}

function truncate(text: string): string {
  if (text.length > MAX_TEXT_LENGTH) {
    console.log(`[PDF OCR] Text truncated from ${text.length} to ${MAX_TEXT_LENGTH} chars`);
    return text.substring(0, MAX_TEXT_LENGTH);
  }
  return text;
}

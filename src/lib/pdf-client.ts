/**
 * Client-side PDF Text Extraction
 *
 * Uses pdfjs-dist to extract text from PDF files IN THE BROWSER.
 * This avoids all server-side PDF library compatibility issues
 * (pdf-parse dynamic requires, Vercel serverless module resolution, etc.)
 *
 * CRITICAL: pdfjs-dist is loaded dynamically to prevent SSR issues.
 * It uses browser-only APIs (DOMMatrix, canvas, etc.) that don't exist in Node.js.
 */

export interface PdfExtractionResult {
  text: string;
  pages: number;
}

/**
 * Extract text from a PDF File in the browser.
 *
 * Uses dynamic import to load pdfjs-dist ONLY in the browser,
 * preventing SSR/prerender errors from browser-only APIs.
 *
 * @param file - The PDF File object from an <input type="file">
 * @returns Extracted text and page count
 * @throws Error if not in browser or extraction fails
 */
export async function extractPdfTextClient(file: File): Promise<PdfExtractionResult> {
  if (typeof window === 'undefined') {
    throw new Error('PDF extraction is only available in the browser');
  }

  try {
    // Dynamic import — only loads pdfjs-dist in the browser
    const pdfjsLib = await import('pdfjs-dist');

    // Configure worker — served from our own /public directory
    // (CDN URLs are unreliable for specific versions like 5.6.205)
    pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

    const numPages = pdf.numPages;
    const textParts: string[] = [];

    for (let i = 1; i <= numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();

      // Group text items by Y position to reconstruct lines
      const items = textContent.items as Array<{ str: string; transform: number[] }>;
      let lastY: number | null = null;
      let pageText = '';

      for (const item of items) {
        if (item.str === undefined) continue;
        const y = item.transform[5];
        if (lastY !== null && Math.abs(y - lastY) > 2) {
          pageText += '\n';
        } else if (lastY !== null) {
          pageText += ' ';
        }
        pageText += item.str;
        lastY = y;
      }

      textParts.push(pageText);
    }

    const fullText = textParts.join('\n\n');

    if (!fullText.trim()) {
      throw new Error('NO_TEXT_EXTRACTED');
    }

    return { text: fullText, pages: numPages };
  } catch (err) {
    if (err instanceof Error && err.message === 'NO_TEXT_EXTRACTED') {
      throw err;
    }

    const errMsg = err instanceof Error ? err.message : String(err);
    console.error('[PDF Client] Extraction failed:', errMsg);

    if (errMsg.includes('password') || errMsg.includes('encrypted')) {
      throw new Error('الملف محمي بكلمة مرور. يرجى رفع ملف غير محمي');
    }
    if (errMsg.includes('Invalid PDF')) {
      throw new Error('الملف تالف أو ليس ملف PDF صالح');
    }

    throw new Error(`فشل في قراءة ملف PDF: ${errMsg}`);
  }
}

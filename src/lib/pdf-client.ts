/**
 * Client-side PDF Text Extraction
 *
 * Uses pdfjs-dist to extract text from PDF files IN THE BROWSER.
 * This avoids all server-side PDF library compatibility issues
 * (pdf-parse dynamic requires, Vercel serverless module resolution, etc.)
 *
 * CRITICAL: pdfjs-dist is loaded dynamically to prevent SSR issues.
 * Worker is DISABLED because we only extract text (no rendering needed),
 * and loading the worker from CDN/self-hosted causes CORS/fetch issues.
 */

export interface PdfExtractionResult {
  text: string;
  pages: number;
}

/** Max chars to send to the AI (matches server-side sanitizeString limit) */
const MAX_TEXT_LENGTH = 200000;

/**
 * Extract text from a PDF File in the browser.
 *
 * Uses dynamic import to load pdfjs-dist ONLY in the browser,
 * preventing SSR/prerender errors from browser-only APIs.
 *
 * Worker is disabled — for text extraction we don't need it,
 * and it avoids CORS/fetch errors loading the worker script.
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

    // Use worker from our own /public directory (copied from node_modules/pdfjs-dist)
    // CDN doesn't host v5.6.205, and empty workerSrc causes an error.
    pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;

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

    let fullText = textParts.join('\n\n');

    if (!fullText.trim()) {
      throw new Error('NO_TEXT_EXTRACTED');
    }

    // Truncate to 200K chars (matches server-side limit)
    // AI models can't process more than this anyway
    if (fullText.length > MAX_TEXT_LENGTH) {
      console.log(`[PDF Client] Text truncated from ${fullText.length} to ${MAX_TEXT_LENGTH} chars`);
      fullText = fullText.substring(0, MAX_TEXT_LENGTH);
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

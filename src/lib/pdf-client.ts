/**
 * Client-side PDF Text Extraction
 *
 * Uses pdfjs-dist to extract text from PDF files IN THE BROWSER.
 *
 * CRITICAL: On mobile browsers, the pdfjs-dist Web Worker often fails to load,
 * causing getDocument() to hang indefinitely. To fix this:
 * - On mobile: Worker is DISABLED (fake worker mode, runs on main thread)
 * - On desktop: Worker is enabled from /public/pdf.worker.min.mjs (faster)
 *
 * IMPORTANT: On mobile browsers, File objects can become invalid when the
 * <input> element is unmounted from the DOM. Callers should pre-read the
 * file data (via file.arrayBuffer()) BEFORE closing the modal/form, and
 * pass the ArrayBuffer instead of the File object to avoid this issue.
 */

export interface PdfExtractionResult {
  text: string;
  pages: number;
}

/** Max chars to send to the AI (matches server-side sanitizeString limit) */
const MAX_TEXT_LENGTH = 50000;

/**
 * Detect if we're on a mobile device where the web worker is unreliable.
 */
function isMobileBrowser(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

/**
 * Extract text from a PDF File or pre-read ArrayBuffer in the browser.
 *
 * Uses dynamic import to load pdfjs-dist ONLY in the browser,
 * preventing SSR/prerender errors from browser-only APIs.
 *
 * On mobile, the Web Worker is disabled to prevent hanging — pdf.js
 * runs on the main thread instead (slower but reliable).
 *
 * @param source - The PDF File object OR a pre-read ArrayBuffer
 * @returns Extracted text and page count
 * @throws Error if not in browser or extraction fails
 */
export async function extractPdfTextClient(source: File | ArrayBuffer): Promise<PdfExtractionResult> {
  if (typeof window === 'undefined') {
    throw new Error('PDF extraction is only available in the browser');
  }

  const isMobile = isMobileBrowser();

  try {
    // Dynamic import — only loads pdfjs-dist in the browser
    const pdfjsLib = await import('pdfjs-dist');

    if (isMobile) {
      // ─── MOBILE: Disable Web Worker ───
      // On mobile browsers (especially iOS Safari, Android Chrome PWA mode),
      // the Web Worker script (/pdf.worker.min.mjs) often fails to load due to:
      // 1. CORS restrictions in PWA standalone mode
      // 2. Service Worker intercepting the worker script request
      // 3. Memory limitations killing the worker process
      // When the worker fails, getDocument() hangs indefinitely with no error.
      //
      // FIX: Set workerSrc to empty string to use "fake worker" mode.
      // This runs pdf.js on the main thread (no Worker needed).
      // It's slightly slower but 100% reliable on mobile.
      pdfjsLib.GlobalWorkerOptions.workerSrc = '';
      console.log('[PDF Client] Mobile detected — worker DISABLED (fake worker mode)');
    } else {
      // ─── DESKTOP: Use Web Worker for better performance ───
      pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
    }

    // Accept either a File object or a pre-read ArrayBuffer
    const arrayBuffer = source instanceof ArrayBuffer ? source : await source.arrayBuffer();

    // Create document with a timeout to prevent indefinite hangs
    // On mobile, getDocument can hang if the worker isn't properly disabled
    const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) });

    // Set a per-document timeout (30s) to prevent infinite loading
    const docTimeoutMs = 30000;
    const docTimeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => {
        loadingTask.destroy().catch(() => {}); // Clean up the loading task
        reject(new Error('PDF_LOADING_TIMEOUT'));
      }, docTimeoutMs)
    );

    const pdf = await Promise.race([loadingTask.promise, docTimeoutPromise]);

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

    // Truncate to max length
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

    if (errMsg === 'PDF_LOADING_TIMEOUT') {
      throw new Error('انتهت مهلة تحميل ملف PDF. يرجى المحاولة مرة أخرى');
    }
    if (errMsg.includes('password') || errMsg.includes('encrypted')) {
      throw new Error('الملف محمي بكلمة مرور. يرجى رفع ملف غير محمي');
    }
    if (errMsg.includes('Invalid PDF')) {
      throw new Error('الملف تالف أو ليس ملف PDF صالح');
    }

    throw new Error(`فشل في قراءة ملف PDF: ${errMsg}`);
  }
}

// -------------------------------------------------------
// DOCX (Word document) text extraction
// -------------------------------------------------------

export interface DocxExtractionResult {
  text: string;
}

/**
 * Extract text from a Word document (.docx) File or pre-read ArrayBuffer in the browser.
 *
 * Uses the mammoth library to convert .docx files to plain text.
 * Works entirely client-side — no server upload needed.
 *
 * @param source - The .docx File object OR a pre-read ArrayBuffer
 * @returns Extracted text
 * @throws Error if not in browser or extraction fails
 */
export async function extractDocxTextClient(source: File | ArrayBuffer): Promise<DocxExtractionResult> {
  if (typeof window === 'undefined') {
    throw new Error('DOCX extraction is only available in the browser');
  }

  try {
    // Dynamic import — only loads mammoth in the browser
    const mammoth = await import('mammoth');

    // Accept either a File object or a pre-read ArrayBuffer
    const arrayBuffer = source instanceof ArrayBuffer ? source : await source.arrayBuffer();

    // Extract text using mammoth
    const result = await mammoth.extractRawText({ arrayBuffer });

    let fullText = result.value;

    if (!fullText.trim()) {
      throw new Error('NO_TEXT_EXTRACTED');
    }

    // Truncate to max length
    if (fullText.length > MAX_TEXT_LENGTH) {
      console.log(`[DOCX Client] Text truncated from ${fullText.length} to ${MAX_TEXT_LENGTH} chars`);
      fullText = fullText.substring(0, MAX_TEXT_LENGTH);
    }

    return { text: fullText };
  } catch (err) {
    if (err instanceof Error && err.message === 'NO_TEXT_EXTRACTED') {
      throw err;
    }

    const errMsg = err instanceof Error ? err.message : String(err);
    console.error('[DOCX Client] Extraction failed:', errMsg);

    if (errMsg.includes('password') || errMsg.includes('encrypted')) {
      throw new Error('الملف محمي بكلمة مرور. يرجى رفع ملف غير محمي');
    }
    if (errMsg.includes('Invalid') || errMsg.includes('corrupted') || errMsg.includes('Could not find')) {
      throw new Error('الملف تالف أو ليس ملف Word صالح');
    }

    throw new Error(`فشل في قراءة ملف Word: ${errMsg}`);
  }
}

/**
 * Detect file type from a File object and extract text accordingly.
 * Supports PDF and Word (.docx) files.
 *
 * @param source - The File object OR a pre-read ArrayBuffer
 * @param fileName - The file name (used to detect type when source is ArrayBuffer)
 * @returns Extracted text and page count (pages is 0 for docx)
 */
export async function extractTextFromFile(source: File | ArrayBuffer, fileName?: string): Promise<PdfExtractionResult> {
  const name = source instanceof File ? source.name : (fileName || '');
  const isDocx = /\.(docx|doc)$/i.test(name);

  if (isDocx) {
    const result = await extractDocxTextClient(source);
    return { text: result.text, pages: 0 };
  }

  // Default: treat as PDF
  return extractPdfTextClient(source);
}

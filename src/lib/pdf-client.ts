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
  /** Source file type: 'pdf' or 'docx' or 'pptx' or 'txt' */
  sourceFileType?: 'pdf' | 'docx' | 'pptx' | 'txt';
  /** v135e: number of document images embedded into the text as Markdown */
  images?: number;
}

/** Max chars to send to the AI (matches server-side sanitizeString limit) */
const MAX_TEXT_LENGTH = 50000;

/**
 * v135e: callback used to persist extracted document images.
 * Receives the image blob, returns its public URL (or null to skip it).
 */
export type UploadImageCallback = (blob: Blob) => Promise<string | null>;

/**
 * v135e: convenience uploader matching /api/summaries/upload-image.
 * Returns null on any failure so extraction can silently skip the image.
 */
export function createSummaryImageUploader(): UploadImageCallback {
  return async (blob: Blob): Promise<string | null> => {
    try {
      const { getCachedAuthHeaders } = await import('@/lib/client-auth');
      const headers = await getCachedAuthHeaders();
      // FormData sets its own multipart Content-Type — drop the JSON one
      delete headers['Content-Type'];
      const fd = new FormData();
      fd.append('file', blob, 'image.jpg');
      const res = await fetch('/api/summaries/upload-image', {
        method: 'POST',
        headers,
        body: fd,
      });
      if (res.ok) {
        const data = (await res.json()) as { url?: string };
        return data.url || null;
      }
      return null;
    } catch {
      return null;
    }
  };
}

/** v135e: cap on embedded images per document (keeps uploads + AI input sane) */
const MAX_EXTRACTED_IMAGES = 24;
/** Skip tiny images (icons, bullets, separators) */
const MIN_IMAGE_DIMENSION = 64;
/** Downscale larger images so uploads stay small */
const MAX_IMAGE_DIMENSION = 1400;

// -------------------------------------------------------
// OCR helpers (used by the extract-pdf-vlm fallback flow)
// -------------------------------------------------------

/**
 * Max binary size the client will inline as base64 in the OCR request body.
 * Vercel serverless functions cap request bodies at 4.5MB; 3MB of binary
 * becomes ~4MB of base64 which leaves headroom for the JSON wrapper.
 * Larger files must go through their storage URL instead (server downloads
 * the bytes itself with no body limit).
 */
export const MAX_OCR_INLINE_BYTES = 3 * 1024 * 1024;

/**
 * Target size for client-side PDF chunks when a scanned PDF is TOO BIG to
 * inline in one request (> MAX_OCR_INLINE_BYTES) and has no storage URL
 * (student flow / failed upload). The PDF is split into page-range chunks of
 * about this size and each chunk is sent as its own OCR request.
 */
export const OCR_CHUNK_TARGET_BYTES = 2.6 * 1024 * 1024;

/**
 * Hard page ceiling per client-side chunk (matches the server's chunking
 * sweet spot — Gemini reliably reads ~10-12 scanned pages per call).
 */
export const OCR_CHUNK_MAX_PAGES = 12;

/**
 * Per-request timeout for OCR calls. The server route has maxDuration = 60s
 * with its own 52s internal budget; 70s leaves margin for network + JSON.
 */
export const OCR_REQUEST_TIMEOUT_MS = 70000;

export interface OcrPageChunk {
  buffer: ArrayBuffer;
  startPage: number;
  endPage: number;
}

/**
 * Pure chunk-boundary computation (unit-testable, no pdf-lib needed):
 * Given a page count and total byte size, decide how many pages each inline
 * OCR chunk should carry. Chunks are bounded BOTH by bytes (Vercel body
 * limit) and by pages (per-call OCR reliability).
 *
 * Returns the list of [startPage, endPage] boundaries (1-inclusive).
 */
export function computeInlineOcrChunkBoundaries(
  pageCount: number,
  totalBytes: number,
): Array<[number, number]> {
  if (pageCount <= 0) return [];

  const fitsInline = totalBytes <= MAX_OCR_INLINE_BYTES;
  const fitsPages = pageCount <= OCR_CHUNK_MAX_PAGES;
  if (fitsInline && fitsPages) {
    return [[1, pageCount]];
  }

  // How many chunks the byte budget demands…
  const chunksByBytes = Math.max(1, Math.ceil(totalBytes / OCR_CHUNK_TARGET_BYTES));
  // …and how many the page ceiling demands.
  const chunksByPages = Math.max(1, Math.ceil(pageCount / OCR_CHUNK_MAX_PAGES));
  const chunkCount = Math.max(chunksByBytes, chunksByPages);
  const pagesPerChunk = Math.max(1, Math.ceil(pageCount / chunkCount));

  const boundaries: Array<[number, number]> = [];
  for (let start = 1; start <= pageCount; start += pagesPerChunk) {
    boundaries.push([start, Math.min(start + pagesPerChunk - 1, pageCount)]);
  }
  return boundaries;
}

/**
 * Split a scanned PDF into page-range chunks small enough to inline in OCR
 * requests. Used ONLY when the file has no storage URL and exceeds the single
 * request body limit (students never upload the source file; teacher uploads
 * can fail).
 *
 * ≤3MB and ≤12 pages → the original buffer untouched (single request).
 * Otherwise → independent PDFs built with pdf-lib copyPages (dynamic import —
 * pdf-lib is ~350KB and only loads when a big scanned PDF actually needs it).
 *
 * @throws Error if pdf-lib fails to load or the PDF cannot be parsed —
 *   callers should treat this as "OCR unavailable", not a hard failure.
 */
export async function splitPdfForInlineOcr(buffer: ArrayBuffer): Promise<OcrPageChunk[]> {
  const { PDFDocument } = await import('pdf-lib');
  const doc = await PDFDocument.load(buffer, { ignoreEncryption: true });
  const pageCount = doc.getPageCount();
  const boundaries = computeInlineOcrChunkBoundaries(pageCount, buffer.byteLength);

  if (boundaries.length === 1) {
    // Single chunk: keep the ORIGINAL bytes (no re-serialization).
    return [{ buffer, startPage: 1, endPage: pageCount }];
  }

  const chunks: OcrPageChunk[] = [];
  for (const [start, end] of boundaries) {
    const out = await PDFDocument.create();
    const pageIndices = Array.from({ length: end - start + 1 }, (_, k) => start - 1 + k);
    const copied = await out.copyPages(doc, pageIndices);
    copied.forEach(p => out.addPage(p));

    // Copy the saved bytes into a standalone ArrayBuffer (pdf-lib's save()
    // returns a Uint8Array that may be a view over a larger internal buffer).
    const saved = await out.save();
    const chunkBuffer = new ArrayBuffer(saved.byteLength);
    new Uint8Array(chunkBuffer).set(saved);

    chunks.push({ buffer: chunkBuffer, startPage: start, endPage: end });
  }
  return chunks;
}

/**
 * Unified client-side OCR fallback runner for scanned PDFs.
 *
 * Strategy (first that applies wins):
 *   1. storage URL available (teacher upload succeeded) → ONE request with
 *      the URL; the server downloads the bytes and parallel-chunks itself.
 *   2. buffer ≤ 3MB → ONE request with inline base64 (the server chunks
 *      long documents in parallel).
 *   3. bigger buffer → split into page chunks client-side and send them as
 *      SEQUENTIAL inline requests, joining the text in page order.
 *
 * @returns the extracted text, or null when every attempt failed.
 */
export async function runOcrExtraction(params: {
  url?: string | null;
  buffer?: ArrayBuffer | null;
  fileName?: string;
  token: string;
  /** Outer abort signal (e.g. the background-task safety net). */
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
}): Promise<string | null> {
  const { url, buffer, fileName, token, signal, onProgress } = params;

  const postOcr = async (body: Record<string, string>): Promise<string | null> => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), OCR_REQUEST_TIMEOUT_MS);
    const onOuterAbort = () => controller.abort();
    signal?.addEventListener('abort', onOuterAbort, { once: true });

    try {
      const res = await fetch('/api/files/extract-pdf-vlm', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const data = await res.json();
      if (res.ok && data.success && data.data?.text) {
        return data.data.text as string;
      }
      console.warn('[OCR Runner] request failed:', res.status, data.error || 'unknown');
      return null;
    } catch (err) {
      if (signal?.aborted) throw err; // outer cancellation must propagate
      console.warn('[OCR Runner] request error:', err instanceof Error ? err.message : err);
      return null;
    } finally {
      clearTimeout(timeoutId);
      signal?.removeEventListener('abort', onOuterAbort);
    }
  };

  // Strategy 1: storage URL — the server handles everything (incl. chunking).
  if (url) {
    const text = await postOcr({ url, fileName: fileName || '' });
    onProgress?.(1, 1);
    return text;
  }

  if (!buffer) return null;

  // Strategy 2: small enough to inline in one request.
  if (buffer.byteLength <= MAX_OCR_INLINE_BYTES) {
    const text = await postOcr({ data: arrayBufferToBase64(buffer), fileName: fileName || '' });
    onProgress?.(1, 1);
    return text;
  }

  // Strategy 3: client-side split + sequential inline requests.
  let chunks: OcrPageChunk[];
  try {
    chunks = await splitPdfForInlineOcr(buffer);
  } catch (splitErr) {
    console.warn('[OCR Runner] client-side PDF split failed:', splitErr instanceof Error ? splitErr.message : splitErr);
    return null;
  }

  if (chunks.length <= 1) {
    // Split decided one chunk fits after all (or page count is tiny).
    const text = await postOcr({ data: arrayBufferToBase64(buffer), fileName: fileName || '' });
    onProgress?.(1, 1);
    return text;
  }

  console.log('[OCR Runner] Large scanned PDF without URL — split into', chunks.length, 'chunks');
  const texts: string[] = [];
  let okCount = 0;
  for (let i = 0; i < chunks.length; i++) {
    if (signal?.aborted) throw new Error('Aborted');
    const text = await postOcr({
      data: arrayBufferToBase64(chunks[i].buffer),
      fileName: `${fileName || 'document'} (جزء ${i + 1}/${chunks.length})`,
    });
    if (text && text.trim()) {
      okCount++;
      texts.push(text);
    }
    onProgress?.(i + 1, chunks.length);
  }

  if (okCount === 0) return null;
  if (okCount < chunks.length) {
    console.warn('[OCR Runner] Partial OCR:', okCount + '/' + chunks.length, 'chunks succeeded');
  }
  return texts.join('\n\n');
}

/**
 * Convert an ArrayBuffer to a base64 string (browser-safe, chunked to avoid
 * call-stack overflow on large buffers).
 */
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000; // 32KB chunks — safe for String.fromCharCode spread
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

/**
 * Heuristic: does this extracted text look garbled/corrupted?
 *
 * Catches two common pdfjs failure modes on Arabic/encoded PDFs:
 * 1. Unicode replacement characters (U+FFFD '�') from broken CID font maps
 * 2. Suspiciously low "real letter" ratio (mojibake punctuation soup)
 *
 * When true, the caller should retry extraction with OCR
 * (/api/files/extract-pdf-vlm) even though "some" text was extracted.
 */
export function looksGarbled(text: string): boolean {
  if (!text) return true;
  const trimmed = text.trim();
  if (trimmed.length < 10) return true;

  // More than 2% replacement characters → broken encoding
  const replacements = (trimmed.match(/\uFFFD/g) || []).length;
  if (replacements > 0 && replacements / trimmed.length > 0.02) {
    return true;
  }

  // Fewer than 30% letters/digits/spaces (Arabic or Latin) → likely mojibake
  const meaningful = (trimmed.match(/[\u0600-\u06FF\u0750-\u077FA-Za-z0-9\s]/g) || []).length;
  if (meaningful / trimmed.length < 0.3) {
    return true;
  }

  return false;
}

/**
 * Detect if we're on a mobile device where the web worker is unreliable.
 */
function isMobileBrowser(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

// -------------------------------------------------------
// v135e: Document image extraction helpers
// -------------------------------------------------------

/**
 * Convert a pdfjs image object ({width, height, data: RGB(A) Uint8ClampedArray}
 * or {width, height, bitmap: ImageBitmap}) to a scaled JPEG/PNG Blob.
 * Returns null for tiny images or unsupported formats.
 */
async function pdfImageObjectToBlob(
  img: { width?: number; height?: number; data?: unknown; bitmap?: ImageBitmap | null } | null | undefined,
): Promise<Blob | null> {
  if (!img || !img.width || !img.height) return null;
  if (img.width < MIN_IMAGE_DIMENSION || img.height < MIN_IMAGE_DIMENSION) return null;

  try {
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    if (img.bitmap) {
      // pdfjs v5 decoded the image to an ImageBitmap in the worker
      ctx.drawImage(img.bitmap, 0, 0, w, h);
    } else if (img.data && (img.data as Uint8ClampedArray).length) {
      const raw = img.data as Uint8ClampedArray;
      const channels = raw.length / (img.width * img.height);
      if (channels !== 3 && channels !== 4) return null;
      // Upscale raw RGB/RGBA into a full-size ImageData, then draw scaled
      const full = ctx.createImageData(img.width, img.height);
      const target = full.data;
      for (let p = 0; p < img.width * img.height; p++) {
        const srcIdx = p * channels;
        const dstIdx = p * 4;
        target[dstIdx] = raw[srcIdx];
        target[dstIdx + 1] = raw[srcIdx + 1];
        target[dstIdx + 2] = raw[srcIdx + 2];
        target[dstIdx + 3] = channels === 4 ? raw[srcIdx + 3] : 255;
      }
      // Draw on a temp canvas at full size, then scale down
      const tmp = document.createElement('canvas');
      tmp.width = img.width;
      tmp.height = img.height;
      const tmpCtx = tmp.getContext('2d');
      if (!tmpCtx) return null;
      tmpCtx.putImageData(full, 0, 0);
      ctx.drawImage(tmp, 0, 0, w, h);
    } else {
      return null;
    }

    return await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.82);
    });
  } catch (err) {
    console.warn('[PDF Client] Image object conversion failed:', err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Extract embedded images from a pdfjs page via its operator list.
 * Best-effort: any failure skips the image without breaking text extraction.
 * Returns Markdown image lines (empty array when nothing extracted/uploaded).
 */
async function extractPageImages(
  pdfjsLib: typeof import('pdfjs-dist'),
  page: { objs: { get(objId: string, callback?: (data: unknown) => void): unknown; has(objId: string): boolean }; commonObjs: { get(objId: string, callback?: (data: unknown) => void): unknown; has(objId: string): boolean }; getOperatorList(): Promise<{ fnArray: number[]; argsArray: unknown[][] }> },
  onImage: UploadImageCallback,
  imageCount: { count: number },
): Promise<string[]> {
  const markdownLines: string[] = [];
  // pdfjs-dist v5 image ops (paintJpegXObject was removed in v5; masks are 1-bit stencils — skipped)
  const imageOps = new Set<number>([
    pdfjsLib.OPS.paintImageXObject,
    pdfjsLib.OPS.paintImageXObjectRepeat,
    pdfjsLib.OPS.paintInlineImageXObject,
  ]);

  try {
    const opList = await page.getOperatorList();
    const seenObjIds = new Set<string>();

    for (let k = 0; k < opList.fnArray.length; k++) {
      if (imageCount.count >= MAX_EXTRACTED_IMAGES) break;
      if (!imageOps.has(opList.fnArray[k])) continue;

      const arg0 = opList.argsArray[k]?.[0];
      // Inline images carry the object directly; named XObjects need objs lookup
      const candidates: unknown[] = [];
      if (typeof arg0 === 'string') {
        if (seenObjIds.has(arg0)) continue;
        seenObjIds.add(arg0);
        for (const store of [page.objs, page.commonObjs]) {
          try {
            const obj = await new Promise<unknown>((resolve) => {
              try {
                if (store.has(arg0)) {
                  resolve(store.get(arg0));
                } else {
                  store.get(arg0, (data: unknown) => resolve(data));
                  // Resolve null after a short wait in case the callback never fires
                  setTimeout(() => resolve(null), 4000);
                }
              } catch {
                resolve(null);
              }
            });
            if (obj) candidates.push(obj);
          } catch {
            // skip store
          }
        }
      } else if (arg0 && typeof arg0 === 'object') {
        candidates.push(arg0);
      }

      for (const candidate of candidates) {
        const blob = await pdfImageObjectToBlob(candidate as { width?: number; height?: number });
        if (!blob) continue;
        try {
          const url = await onImage(blob);
          if (url) {
            imageCount.count++;
            markdownLines.push(`\n\n![صورة من المستند](${url})\n\n`);
          }
        } catch {
          // Upload failed — skip image, keep text flow
        }
        if (imageCount.count >= MAX_EXTRACTED_IMAGES) break;
      }
    }
  } catch (err) {
    console.warn('[PDF Client] Operator-list image scan failed (non-fatal):', err instanceof Error ? err.message : err);
  }

  return markdownLines;
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
export async function extractPdfTextClient(source: File | ArrayBuffer, onImage?: UploadImageCallback): Promise<PdfExtractionResult> {
  if (typeof window === 'undefined') {
    throw new Error('PDF extraction is only available in the browser');
  }

  const isMobile = isMobileBrowser();

  try {
    // Dynamic import — only loads pdfjs-dist in the browser
    const pdfjsLib = await import('pdfjs-dist');

    // ─── Set worker source for both mobile and desktop ───
    // pdfjs-dist v5: Always point to the worker script. If Worker creation fails
    // (common on mobile PWA), v5 will automatically fall back to "fake worker" mode
    // which uses dynamic import() of the worker URL — this works reliably in browsers.
    // The old approach of setting workerSrc = '' caused v5 to fail with
    // "No GlobalWorkerOptions.workerSrc specified" because v5 changed how
    // fake worker mode works internally.
    pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
    console.log('[PDF Client] Worker source set to /pdf.worker.min.mjs');

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
    // v135e: extract embedded images (best-effort) alongside the text
    const imageCount = { count: 0 };

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

      // v135e: append embedded page images right after the page text
      if (onImage && imageCount.count < MAX_EXTRACTED_IMAGES) {
        const imageLines = await extractPageImages(pdfjsLib, page as unknown as Parameters<typeof extractPageImages>[1], onImage, imageCount);
        if (imageLines.length > 0) {
          pageText += imageLines.join('');
        }
      }

      textParts.push(pageText);
    }

    let fullText = textParts.join('\n\n');

    if (!fullText.trim()) {
      // This typically happens with scanned/image-only PDFs
      throw new Error('SCANNED_PDF_NO_TEXT');
    }

    // Truncate to max length
    if (fullText.length > MAX_TEXT_LENGTH) {
      console.log(`[PDF Client] Text truncated from ${fullText.length} to ${MAX_TEXT_LENGTH} chars`);
      fullText = fullText.substring(0, MAX_TEXT_LENGTH);
    }

    return { text: fullText, pages: numPages, sourceFileType: 'pdf', images: imageCount.count };
  } catch (err) {
    if (err instanceof Error && (err.message === 'NO_TEXT_EXTRACTED' || err.message === 'SCANNED_PDF_NO_TEXT')) {
      throw new Error('الملف يبدو أنه ملف PDF ممسوح ضوئياً (صور فقط). لا يمكن استخراج نص من الصور. يرجى رفع ملف يحتوي على نص قابل للتحديد أو نسخ المحتوى يدوياً');
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
// HTML to Markdown converter (for DOCX extraction)
// -------------------------------------------------------

/**
 * Convert HTML from mammoth.convertToHtml() to Markdown.
 * Preserves: headings, bold, italic, lists, tables, links, and paragraphs.
 * This gives much richer output than mammoth.extractRawText() which
 * strips all structure (losing tables, headings, lists, etc.).
 */
function htmlToMarkdown(html: string): string {
  let md = html;

  // Headings: h1-h6 → # to ######
  md = md.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, (_, content) => `# ${cleanHtmlTags(content).trim()}\n\n`);
  md = md.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, (_, content) => `## ${cleanHtmlTags(content).trim()}\n\n`);
  md = md.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, (_, content) => `### ${cleanHtmlTags(content).trim()}\n\n`);
  md = md.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, (_, content) => `#### ${cleanHtmlTags(content).trim()}\n\n`);
  md = md.replace(/<h5[^>]*>([\s\S]*?)<\/h5>/gi, (_, content) => `##### ${cleanHtmlTags(content).trim()}\n\n`);
  md = md.replace(/<h6[^>]*>([\s\S]*?)<\/h6>/gi, (_, content) => `###### ${cleanHtmlTags(content).trim()}\n\n`);

  // Bold and italic
  md = md.replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, '**$2**');
  md = md.replace(/<(em|i)[^>]*>([\s\S]*?)<\/\1>/gi, '*$2*');

  // Links: <a href="url">text</a> → [text](url)
  md = md.replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)');

  // Unordered lists: <li> → - item
  md = md.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, content) => `- ${cleanHtmlTags(content).trim()}\n`);

  // Tables: convert to Markdown table format
  md = convertTablesToMarkdown(md);

  // Paragraphs: <p>content</p> → content\n\n
  md = md.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, '$1\n\n');

  // Line breaks
  md = md.replace(/<br\s*\/?>/gi, '\n');

  // Remove remaining HTML tags
  md = cleanHtmlTags(md);

  // Collapse multiple blank lines
  md = md.replace(/\n{3,}/g, '\n\n');

  return md.trim();
}

/**
 * Remove all remaining HTML tags from text.
 */
function cleanHtmlTags(html: string): string {
  return html.replace(/<[^>]+>/g, '');
}

/**
 * v135e: Extract <img src="data:..."> blobs from mammoth HTML, upload each
 * via the callback, and replace them with Markdown image refs.
 * Images whose upload fails are dropped (text flow is unaffected).
 */
async function embedDocxImages(html: string, onImage: UploadImageCallback): Promise<{ html: string; count: number }> {
  const dataUriPattern = /<img[^>]*src="(data:image\/(?:png|jpeg|jpg|gif|webp);base64,([A-Za-z0-9+/=\s]+))"[^>]*\/>?/gi;
  const matches = [...html.matchAll(dataUriPattern)];
  if (matches.length === 0) return { html, count: 0 };

  let count = 0;
  let out = html;
  for (const match of matches) {
    if (count >= MAX_EXTRACTED_IMAGES) break;
    const [fullTag, dataUri, base64] = match;
    try {
      // Decode base64 → Blob
      const cleanB64 = base64.replace(/\s+/g, '');
      const byteString = atob(cleanB64);
      const bytes = new Uint8Array(byteString.length);
      for (let b = 0; b < byteString.length; b++) {
        bytes[b] = byteString.charCodeAt(b);
      }
      const mime = (dataUri.match(/^data:([^;]+);/)?.[1] || 'image/png') as string;
      // Skip tiny icons/bullets (< 3KB) and huge images (> 8MB)
      if (bytes.length < 3 * 1024 || bytes.length > 8 * 1024 * 1024) {
        out = out.replace(fullTag, '');
        continue;
      }
      const blob = new Blob([bytes], { type: mime });
      const url = await onImage(blob);
      if (url) {
        count++;
        out = out.replace(fullTag, `\n\n<!--IMG-->![](${url})\n\n`);
      } else {
        out = out.replace(fullTag, '');
      }
    } catch {
      out = out.replace(fullTag, '');
    }
  }
  return { html: out, count };
}

/**
 * Convert HTML tables to Markdown table format.
 * Handles <table>, <thead>, <tbody>, <tr>, <th>, <td>.
 */
function convertTablesToMarkdown(html: string): string {
  // Process each table
  return html.replace(/<table[^>]*>([\s\S]*?)<\/table>/gi, (_, tableContent) => {
    const rows: string[][] = [];

    // Extract all rows (from thead, tbody, or directly)
    const rowMatches = tableContent.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi);
    for (const rowMatch of rowMatches) {
      const cells: string[] = [];
      const cellMatches = rowMatch[1].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi);
      for (const cellMatch of cellMatches) {
        cells.push(cleanHtmlTags(cellMatch[1]).trim().replace(/\n/g, ' '));
      }
      if (cells.length > 0) {
        rows.push(cells);
      }
    }

    if (rows.length === 0) return '';

    // Build Markdown table
    // Normalize column count
    const maxCols = Math.max(...rows.map(r => r.length));
    const normalizedRows = rows.map(r => {
      while (r.length < maxCols) r.push('');
      return r;
    });

    let mdTable = '';

    // Header row (first row)
    mdTable += '| ' + normalizedRows[0].join(' | ') + ' |\n';
    // Separator row
    mdTable += '| ' + normalizedRows[0].map(() => '---').join(' | ') + ' |\n';
    // Data rows
    for (let i = 1; i < normalizedRows.length; i++) {
      mdTable += '| ' + normalizedRows[i].join(' | ') + ' |\n';
    }

    return '\n' + mdTable + '\n';
  });
}

// -------------------------------------------------------
// DOCX (Word document) text extraction
// -------------------------------------------------------

export interface DocxExtractionResult {
  text: string;
  /** Source file type is always 'docx' for Word documents */
  sourceFileType: 'docx';
  /** v135e: number of embedded images uploaded and referenced in the text */
  images?: number;
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
export async function extractDocxTextClient(source: File | ArrayBuffer, onImage?: UploadImageCallback): Promise<DocxExtractionResult> {
  if (typeof window === 'undefined') {
    throw new Error('DOCX extraction is only available in the browser');
  }

  try {
    // Dynamic import — only loads mammoth in the browser
    const mammoth = await import('mammoth');

    // Accept either a File object or a pre-read ArrayBuffer
    const arrayBuffer = source instanceof ArrayBuffer ? source : await source.arrayBuffer();

    // ─── Use convertToHtml instead of extractRawText ───
    // extractRawText strips ALL formatting and loses tables, headings, lists, etc.
    // convertToHtml preserves document structure (tables, headings, bold, lists)
    // which we then convert to Markdown for both AI processing and ReactMarkdown display.
    const result = await mammoth.convertToHtml({ arrayBuffer });
    let htmlContent = result.value;

    // v135e: persist embedded images and reference them from the Markdown
    let imageCount = 0;
    if (onImage) {
      const embedded = await embedDocxImages(htmlContent, onImage);
      htmlContent = embedded.html;
      imageCount = embedded.count;
    }

    // Convert HTML to Markdown to preserve structure while being compatible
    // with ReactMarkdown and AI summarization
    let fullText = htmlToMarkdown(htmlContent);

    if (!fullText.trim()) {
      throw new Error('DOCX_NO_TEXT_EXTRACTED');
    }

    // Truncate to max length with indicator
    if (fullText.length > MAX_TEXT_LENGTH) {
      console.log(`[DOCX Client] Text truncated from ${fullText.length} to ${MAX_TEXT_LENGTH} chars`);
      // Try to truncate at a paragraph boundary
      const truncated = fullText.substring(0, MAX_TEXT_LENGTH);
      const lastParagraph = truncated.lastIndexOf('\n\n');
      if (lastParagraph > MAX_TEXT_LENGTH * 0.7) {
        fullText = truncated.substring(0, lastParagraph);
      } else {
        fullText = truncated;
      }
      fullText += '\n\n[... تم اقتطاع جزء من المحتوى لتجاوز الحد الأقصى ...]';
    }

    return { text: fullText, sourceFileType: 'docx', images: imageCount };
  } catch (err) {
    if (err instanceof Error && err.message === 'DOCX_NO_TEXT_EXTRACTED') {
      throw new Error('ملف Word فارغ أو لا يحتوي على نص قابل للاستخراج');
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
 * Supports PDF, Word (.docx), PowerPoint (.pptx), and plain text (.txt) files.
 *
 * @param source - The File object OR a pre-read ArrayBuffer
 * @param fileName - The file name (used to detect type when source is ArrayBuffer)
 * @returns Extracted text and page count (pages is 0 for non-PDF files)
 */
export async function extractTextFromFile(source: File | ArrayBuffer, fileName?: string, onImage?: UploadImageCallback): Promise<PdfExtractionResult> {
  const name = source instanceof File ? source.name : (fileName || '');

  // Word documents (.docx, .doc)
  if (/\.(docx|doc)$/i.test(name)) {
    const result = await extractDocxTextClient(source, onImage);
    return { text: result.text, pages: 0, sourceFileType: 'docx', images: result.images };
  }

  // Plain text files (.txt, .csv, .md)
  if (/\.(txt|csv|md)$/i.test(name)) {
    const arrayBuffer = source instanceof ArrayBuffer ? source : await source.arrayBuffer();
    const text = new TextDecoder('utf-8').decode(arrayBuffer);
    if (!text.trim()) {
      throw new Error('الملف النصي فارغ');
    }
    const truncated = text.length > MAX_TEXT_LENGTH ? text.substring(0, MAX_TEXT_LENGTH) : text;
    return { text: truncated, pages: 0, sourceFileType: 'txt' };
  }

  // PowerPoint files (.pptx) — extract text from XML slides
  if (/\.pptx$/i.test(name)) {
    const result = await extractPptxTextClient(source);
    return { text: result.text, pages: result.slides, sourceFileType: 'pptx' };
  }

  // Unsupported file types with clear error messages
  if (/\.(ppt|xls|xlsx|rtf|odt|ods|odp)$/i.test(name)) {
    const ext = name.split('.').pop()?.toUpperCase() || '';
    throw new Error(`نوع الملف ${ext} غير مدعوم حالياً. الأنواع المدعومة: PDF، Word (DOCX)، PowerPoint (PPTX)، والملفات النصية (TXT)`);
  }

  // Default: treat as PDF
  return extractPdfTextClient(source, onImage);
}

// -------------------------------------------------------
// PPTX (PowerPoint) text extraction
// -------------------------------------------------------

export interface PptxExtractionResult {
  text: string;
  slides: number;
  sourceFileType: 'pptx';
}

/**
 * Extract text from a PowerPoint (.pptx) file.
 * PPTX files are ZIP archives containing XML slides.
 * We parse the XML to extract text from each slide.
 */
async function extractPptxTextClient(source: File | ArrayBuffer): Promise<PptxExtractionResult> {
  if (typeof window === 'undefined') {
    throw new Error('PPTX extraction is only available in the browser');
  }

  try {
    // Dynamic import of JSZip for reading the PPTX archive
    const JSZip = (await import('jszip')).default;

    const arrayBuffer = source instanceof ArrayBuffer ? source : await source.arrayBuffer();
    const zip = await JSZip.loadAsync(arrayBuffer);

    // Find all slide files (ppt/slides/slide1.xml, slide2.xml, etc.)
    const slideFiles = Object.keys(zip.files)
      .filter(name => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
      .sort((a, b) => {
        const numA = parseInt(a.match(/slide(\d+)/i)?.[1] || '0');
        const numB = parseInt(b.match(/slide(\d+)/i)?.[1] || '0');
        return numA - numB;
      });

    if (slideFiles.length === 0) {
      throw new Error('لا تحتوي ملفات شرائح في العرض التقديمي');
    }

    const slideTexts: string[] = [];

    for (const slidePath of slideFiles) {
      const xmlContent = await zip.files[slidePath].async('text');
      // Extract text from <a:t> tags in the XML
      const textMatches = xmlContent.match(/<a:t[^>]*>([\s\S]*?)<\/a:t>/gi) || [];
      const slideText = textMatches
        .map(match => match.replace(/<\/?a:t[^>]*>/gi, '').trim())
        .filter(text => text.length > 0)
        .join('\n');

      if (slideText.trim()) {
        slideTexts.push(`--- شريحة ---\n${slideText}`);
      }
    }

    let fullText = slideTexts.join('\n\n');

    if (!fullText.trim()) {
      throw new Error('العرض التقديمي لا يحتوي على نص قابل للاستخراج. قد يحتوي على صور فقط');
    }

    // Truncate to max length
    if (fullText.length > MAX_TEXT_LENGTH) {
      console.log(`[PPTX Client] Text truncated from ${fullText.length} to ${MAX_TEXT_LENGTH} chars`);
      fullText = fullText.substring(0, MAX_TEXT_LENGTH);
    }

    return { text: fullText, slides: slideFiles.length, sourceFileType: 'pptx' };
  } catch (err) {
    // Re-throw user-friendly errors
    if (err instanceof Error && (
      err.message.includes('لا تحتوي') ||
      err.message.includes('لا يحتوي') ||
      err.message.includes('غير مدعوم')
    )) {
      throw err;
    }

    const errMsg = err instanceof Error ? err.message : String(err);
    console.error('[PPTX Client] Extraction failed:', errMsg);

    if (errMsg.includes('password') || errMsg.includes('encrypted') || errMsg.includes('encrypted')) {
      throw new Error('الملف محمي بكلمة مرور. يرجى رفع ملف غير محمي');
    }
    if (errMsg.includes('Corrupted') || errMsg.includes('Invalid') || errMsg.includes('not a valid zip')) {
      throw new Error('الملف تالف أو ليس ملف PowerPoint صالح');
    }

    throw new Error(`فشل في قراءة ملف PowerPoint: ${errMsg}`);
  }
}

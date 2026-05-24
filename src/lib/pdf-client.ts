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
      // This typically happens with scanned/image-only PDFs
      throw new Error('SCANNED_PDF_NO_TEXT');
    }

    // Truncate to max length
    if (fullText.length > MAX_TEXT_LENGTH) {
      console.log(`[PDF Client] Text truncated from ${fullText.length} to ${MAX_TEXT_LENGTH} chars`);
      fullText = fullText.substring(0, MAX_TEXT_LENGTH);
    }

    return { text: fullText, pages: numPages, sourceFileType: 'pdf' };
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

    // ─── Use convertToHtml instead of extractRawText ───
    // extractRawText strips ALL formatting and loses tables, headings, lists, etc.
    // convertToHtml preserves document structure (tables, headings, bold, lists)
    // which we then convert to Markdown for both AI processing and ReactMarkdown display.
    const result = await mammoth.convertToHtml({ arrayBuffer });
    const htmlContent = result.value;

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

    return { text: fullText, sourceFileType: 'docx' };
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
export async function extractTextFromFile(source: File | ArrayBuffer, fileName?: string): Promise<PdfExtractionResult> {
  const name = source instanceof File ? source.name : (fileName || '');

  // Word documents (.docx, .doc)
  if (/\.(docx|doc)$/i.test(name)) {
    const result = await extractDocxTextClient(source);
    return { text: result.text, pages: 0, sourceFileType: 'docx' };
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
  return extractPdfTextClient(source);
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

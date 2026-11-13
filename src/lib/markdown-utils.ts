/**
 * Markdown utilities — v135e
 *
 * 1. markdownToHtml: converts summary Markdown (the format produced by
 *    SUMMARY/REFINE prompts) into clean HTML for TipTap lesson content
 *    (used when a teacher assigns a summary as a lesson).
 *
 * 2. cleanMarkdownForDisplay: light client-side cleanup applied right before
 *    ReactMarkdown renders summary content — decodes stray HTML entities
 *    (&nbsp; &amp; …) and converts common leftover HTML tags to Markdown so
 *    raw markup never appears in the rendered content.
 *
 * Both functions are intentionally dependency-free (no remark/rehype) to keep
 * the client bundle small.
 */

// -------------------------------------------------------
// Markdown → HTML (for lesson assignment)
// -------------------------------------------------------

/**
 * Escape text for safe inclusion in HTML.
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Inline Markdown → HTML: bold, italic, code, links, images.
 */
function inlineMarkdownToHtml(text: string): string {
  let out = escapeHtml(text);

  // Images: ![alt](src) — must run before links
  out = out.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_m, alt: string, src: string) => {
    return `<img src="${src}" alt="${alt}" />`;
  });

  // Links: [text](url)
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_m, label: string, href: string) => {
    return `<a href="${href}">${label}</a>`;
  });

  // Bold: **text** or __text__
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/__([^_]+)__/g, '<strong>$1</strong>');

  // Italic: *text* or _text_
  out = out.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
  out = out.replace(/(^|[^_\w])_([^_\n]+)_(?![\w_])/g, '$1<em>$2</em>');

  // Inline code: `code`
  out = out.replace(/`([^`\n]+)`/g, '<code>$1</code>');

  return out;
}

/**
 * Convert summary Markdown to HTML suitable for TipTap (lesson content).
 * Supports: headings, bold/italic, inline code, code blocks, links, images,
 * ordered/unordered lists, blockquotes, horizontal rules, and tables.
 */
export function markdownToHtml(markdown: string): string {
  if (!markdown) return '';

  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const htmlParts: string[] = [];

  let i = 0;
  const n = lines.length;

  const isListItem = (line: string) => /^\s*[-*+]\s+/.test(line);
  const isOrderedItem = (line: string) => /^\s*\d+[.)]\s+/.test(line);

  while (i < n) {
    const line = lines[i];

    // ─── Fenced code block ───
    if (/^```/.test(line.trim())) {
      const codeLines: string[] = [];
      i++;
      while (i < n && !/^```/.test(lines[i].trim())) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing fence
      htmlParts.push(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
      continue;
    }

    // ─── Empty line ───
    if (line.trim() === '') {
      i++;
      continue;
    }

    // ─── Horizontal rule ───
    if (/^\s*([-*_])\s*(\1\s*){2,}$/.test(line)) {
      htmlParts.push('<hr />');
      i++;
      continue;
    }

    // ─── Heading ───
    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      const level = Math.min(headingMatch[1].length, 3); // TipTap: levels 1-3
      htmlParts.push(`<h${level}>${inlineMarkdownToHtml(headingMatch[2].trim())}</h${level}>`);
      i++;
      continue;
    }

    // ─── Table (line with | followed by a separator row) ───
    if (line.includes('|') && i + 1 < n && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[i + 1])) {
      const parseRow = (rowLine: string) =>
        rowLine
          .trim()
          .replace(/^\||\|$/g, '')
          .split('|')
          .map((c) => c.trim());

      const headerCells = parseRow(line);
      i += 2; // skip header + separator
      const bodyRows: string[][] = [];
      while (i < n && lines[i].includes('|') && lines[i].trim() !== '') {
        bodyRows.push(parseRow(lines[i]));
        i++;
      }

      let tableHtml = '<table><thead><tr>';
      for (const cell of headerCells) {
        tableHtml += `<th>${inlineMarkdownToHtml(cell)}</th>`;
      }
      tableHtml += '</tr></thead><tbody>';
      for (const row of bodyRows) {
        tableHtml += '<tr>';
        for (let c = 0; c < headerCells.length; c++) {
          tableHtml += `<td>${inlineMarkdownToHtml(row[c] ?? '')}</td>`;
        }
        tableHtml += '</tr>';
      }
      tableHtml += '</tbody></table>';
      htmlParts.push(tableHtml);
      continue;
    }

    // ─── Blockquote ───
    if (/^\s*>\s?/.test(line)) {
      const quoteLines: string[] = [];
      while (i < n && /^\s*>\s?/.test(lines[i])) {
        quoteLines.push(lines[i].replace(/^\s*>\s?/, ''));
        i++;
      }
      htmlParts.push(`<blockquote><p>${inlineMarkdownToHtml(quoteLines.join(' '))}</p></blockquote>`);
      continue;
    }

    // ─── Unordered list ───
    if (isListItem(line)) {
      const items: string[] = [];
      while (i < n && isListItem(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*+]\s+/, ''));
        i++;
      }
      htmlParts.push(
        `<ul>${items.map((it) => `<li>${inlineMarkdownToHtml(it)}</li>`).join('')}</ul>`
      );
      continue;
    }

    // ─── Ordered list ───
    if (isOrderedItem(line)) {
      const items: string[] = [];
      while (i < n && isOrderedItem(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+[.)]\s+/, ''));
        i++;
      }
      htmlParts.push(
        `<ol>${items.map((it) => `<li>${inlineMarkdownToHtml(it)}</li>`).join('')}</ol>`
      );
      continue;
    }

    // ─── Paragraph (consume consecutive plain lines) ───
    const paraLines: string[] = [];
    while (
      i < n &&
      lines[i].trim() !== '' &&
      !/^#{1,6}\s/.test(lines[i]) &&
      !/^```/.test(lines[i].trim()) &&
      !isListItem(lines[i]) &&
      !isOrderedItem(lines[i]) &&
      !/^\s*>\s?/.test(lines[i])
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    if (paraLines.length > 0) {
      htmlParts.push(`<p>${inlineMarkdownToHtml(paraLines.join(' '))}</p>`);
    } else {
      i++; // safety: never loop forever
    }
  }

  return htmlParts.join('\n');
}

// -------------------------------------------------------
// Display cleanup (before ReactMarkdown)
// -------------------------------------------------------

/** HTML entities that leak into extracted text */
const HTML_ENTITIES: Record<string, string> = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&mdash;': '—',
  '&ndash;': '–',
  '&hellip;': '…',
  '&laquo;': '«',
  '&raquo;': '»',
  '&middot;': '·',
  '&bull;': '•',
  '&times;': '×',
  '&divide;': '÷',
  '&copy;': '©',
  '&reg;': '®',
  '&trade;': '™',
};

/**
 * Clean summary Markdown right before rendering so unwanted HTML never
 * shows up in the content:
 *  1. Converts common HTML tags to their Markdown equivalents
 *     (p/br/div → line breaks, b/strong → **bold**, i/em → *italic*,
 *     u → underline kept as text, headings → #)
 *  2. Decodes HTML entities (&nbsp; etc.)
 *  3. Strips any remaining stray tags OUTSIDE fenced code blocks
 *
 * Fenced code blocks (``` … ```) are preserved untouched so programming
 * examples that legitimately contain HTML keep working.
 */
export function cleanMarkdownForDisplay(markdown: string): string {
  if (!markdown) return '';

  // Split by fenced code blocks — only clean outside them
  const segments = markdown.split(/(```[\s\S]*?```)/g);

  const cleanedSegments = segments.map((segment) => {
    if (/^```[\s\S]*```$/.test(segment)) {
      return segment; // code block — leave untouched
    }

    let out = segment;

    // ─── Convert common HTML tags to Markdown ───
    // Headings
    out = out.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, level: string, content: string) => {
      return `\n\n${'#'.repeat(Math.min(Number(level), 6))} ${content.replace(/<[^>]+>/g, '').trim()}\n\n`;
    });
    // Bold
    out = out.replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, (_m, _tag: string, content: string) => `**${content.trim()}**`);
    // Italic
    out = out.replace(/<(em|i)[^>]*>([\s\S]*?)<\/\1>/gi, (_m, _tag: string, content: string) => `*${content.trim()}*`);
    // Underline → keep text (no Markdown underline)
    out = out.replace(/<u[^>]*>([\s\S]*?)<\/u>/gi, '$1');
    // Line breaks
    out = out.replace(/<br\s*\/?>/gi, '\n');
    // Paragraphs / divs → paragraph breaks
    out = out.replace(/<\/(p|div|section|article)>/gi, '\n\n');
    out = out.replace(/<(p|div|section|article)[^>]*>/gi, '');
    // HTML img → Markdown image (before generic tag strip)
    out = out.replace(/<img[^>]*src=["']([^"']+)["'][^>]*>/gi, (_m, src: string) => `\n\n![](${src})\n\n`);
    // HTML links → Markdown links
    out = out.replace(/<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, label: string) => `[${label.replace(/<[^>]+>/g, '').trim()}](${href})`);
    // List items → dash items
    out = out.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_m, content: string) => `\n- ${content.replace(/<[^>]+>/g, '').trim()}`);
    // Strip any remaining tags
    out = out.replace(/<\/?[a-zA-Z][^>]*>/g, '');

    // ─── Decode HTML entities ───
    for (const [entity, char] of Object.entries(HTML_ENTITIES)) {
      out = out.split(entity).join(char);
    }
    // Numeric entities: &#123; and &#x1F680;
    out = out.replace(/&#(\d+);/g, (_m, code: string) => {
      try { return String.fromCodePoint(Number(code)); } catch { return ''; }
    });
    out = out.replace(/&#x([0-9a-fA-F]+);/g, (_m, hex: string) => {
      try { return String.fromCodePoint(parseInt(hex, 16)); } catch { return ''; }
    });

    // Collapse excessive blank lines
    out = out.replace(/\n{4,}/g, '\n\n\n');

    return out;
  });

  return cleanedSegments.join('');
}

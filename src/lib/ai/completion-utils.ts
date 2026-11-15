/**
 * AI Layer — Completion Enforcement Utilities (v135j)
 *
 * User-facing contract: summaries / refined texts / translations must NEVER be
 * returned or saved incomplete ("اجبر الAI ميجبش الملخص ناقص").
 *
 * Root causes of truncated output this module defends against:
 *   1. maxOutputTokens exhaustion (finishReason = MAX_TOKENS) — on Gemini 2.5
 *      the model's internal thinking tokens count against maxOutputTokens,
 *      so the visible text gets cut while the provider layer reported success.
 *   2. Mid-stream network errors where the provider returns the accumulated
 *      partial text.
 *   3. Overall timeout cuts.
 *
 * Cases 1-3 all embed an explicit Arabic truncation marker into the text
 * (see providers/gemini.ts). This module detects those markers plus a
 * conservative "mid-sentence ending" heuristic, and merges continuation
 * responses onto the truncated prefix deterministically.
 */

/**
 * Markers the provider layer embeds when a response is KNOWN to be cut off.
 * NOTE: deliberately does NOT include "[... تم تقليص المحتوى ...]" — that
 * marker is added to the INPUT content when it exceeds the processing limit;
 * if the model copies it into the output it says nothing about whether the
 * OUTPUT itself is complete.
 */
const TRUNCATION_MARKERS = [
  '[... تم قطع الاستجابة',
  '[...تم قطع الاستجابة',
];

/** Regex matching any provider truncation marker (with its reason suffix). */
const TRUNCATION_MARKER_REGEX = /\s*\[\.\.\.\s*تم قطع الاستجابة[^\]]*\]/g;

/**
 * Detect likely-truncated AI text output.
 *
 * Signal 1 — explicit truncation marker embedded by the provider layer
 * (timeout cut / MAX_TOKENS cut / stream-error partial). Always trusted.
 *
 * Signal 2 — mid-sentence ending heuristic: the final non-empty line is long
 * prose that ends on a letter/digit with no terminal punctuation. Short final
 * lines (bullets, headings) legitimately end without punctuation and are given
 * the benefit of the doubt to keep false positives near zero.
 */
export function isTruncatedText(text: string): boolean {
  const t = text.trim();
  if (t.length === 0) return true;

  // Signal 1: explicit provider marker.
  for (const marker of TRUNCATION_MARKERS) {
    if (t.includes(marker)) return true;
  }

  // Signal 2: mid-sentence ending heuristic.
  const lastChar = t[t.length - 1];
  // Endings that indicate a completed thought: terminal punctuation
  // (Latin/Arabic/Devanagari), ellipsis, colon/semicolon, closing quotes and
  // brackets, markdown emphasis/bold, table borders, percent signs.
  if (/[.!?؟।…:;)"'”»%*_\]}|]/.test(lastChar)) return false;

  // Last char is a letter/digit — possibly cut. Check the final line length:
  // only long prose-like lines are flagged; short bullets/headings pass.
  const lines = t.split('\n').filter(l => l.trim().length > 0);
  const lastLine = lines[lines.length - 1] || '';
  const cleanLine = lastLine.replace(/^[\s>*#\-\d.)]+/, '').trim();
  if (cleanLine.length < 40) return false;

  return /[\p{L}\p{N}]$/u.test(cleanLine);
}

/**
 * Remove provider truncation markers from the text.
 * Used before sending the text for continuation (so the model repeats the real
 * final line, not the marker) and before returning a completed result.
 */
export function stripTruncationMarkers(text: string): string {
  return text.replace(TRUNCATION_MARKER_REGEX, '').trimEnd();
}

/** Minimum anchor length for a trusted overlap join. */
const MIN_OVERLAP_CHARS = 8;

/** Maximum suffix length checked when searching for the repeated anchor. */
const MAX_OVERLAP_CHARS = 600;

/**
 * Merge a continuation response onto a (possibly truncated) prefix.
 *
 * The continuation prompts instruct the model to START its output by repeating
 * the final line of the given text, which makes the join point discoverable
 * deterministically: the longest suffix of `prefix` that also starts
 * `continuation`. This handles both word-boundary and mid-word cuts without
 * guessing where to insert a space.
 *
 * If the model responds with the literal sentinel `[COMPLETE]` (text was
 * already complete), the prefix is returned unchanged.
 */
export function mergeContinuation(prefix: string, continuation: string): string {
  const cont = continuation.trim();

  // Model signaled the text was already complete → keep prefix untouched.
  if (!cont || cont.includes('[COMPLETE]')) {
    return prefix;
  }

  // Strip code fences the model may have wrapped the continuation in.
  let body = cont
    .replace(/^```[a-zA-Z]*\n?/, '')
    .replace(/\n?```\s*$/, '')
    .trim();

  // Find the longest suffix of prefix that starts the continuation (the
  // repeated anchor). Searching from the longest candidate down guarantees
  // the model repeating MORE than the final line still splices correctly.
  const maxCheck = Math.min(prefix.length, MAX_OVERLAP_CHARS);
  for (let len = maxCheck; len >= MIN_OVERLAP_CHARS; len--) {
    const suffix = prefix.slice(prefix.length - len);
    if (body.startsWith(suffix)) {
      return prefix + body.slice(len);
    }
  }

  // No anchor found (model disobeyed the repeat instruction) — join
  // defensively: block-level starts get a newline, inline text a space.
  if (/^(\n|#|-|\*|\||>|\d+\.)/.test(body)) {
    return `${prefix}\n${body}`;
  }
  return `${prefix} ${body}`;
}

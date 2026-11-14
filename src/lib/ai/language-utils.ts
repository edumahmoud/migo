/**
 * AI Layer — Deterministic Language Detection (Unicode script analysis)
 *
 * WHY THIS EXISTS (v135f):
 * Quiz generation from English content kept coming back in Arabic even with
 * bilingual language rules embedded in an otherwise-Arabic prompt. LLMs anchor
 * their output language to the DOMINANT language of the instructions, not to a
 * single rule. The radical fix is to stop ASKING the model to keep the language
 * and start ENFORCING it:
 *
 *   1. Detect the source content's dominant script deterministically (below).
 *   2. Serve a fully English prompt for non-Arabic content (see prompts.ts).
 *   3. Validate the OUTPUT script after generation and retry if it drifted
 *      (see generateQuiz in provider-manager.ts).
 *
 * This module contains ZERO AI calls — it is pure Unicode math and therefore
 * 100% reliable, testable, and instant.
 */

export type ScriptId =
  | 'arabic'
  | 'latin'
  | 'cyrillic'
  | 'greek'
  | 'hebrew'
  | 'cjk'
  | 'unknown';

export interface ScriptAnalysis {
  /** Dominant script by letter count */
  script: ScriptId;
  /** Ratio of Arabic letters among all counted letters (0..1) */
  arabicRatio: number;
  /** Ratio of Latin letters among all counted letters (0..1) */
  latinRatio: number;
  /** Total letters counted after noise stripping */
  totalLetters: number;
  /** True when Arabic is the clearly dominant script */
  isArabicDominant: boolean;
  /** True when not enough letters to decide (treated as "keep Arabic UI default") */
  isAmbiguous: boolean;
}

/**
 * Remove content that should NOT influence language detection:
 * - fenced / inline code blocks
 * - Markdown images and links (URLs)
 * - bare URLs
 * - HTML tags
 * - digits, punctuation and whitespace (handled implicitly by counting letters only)
 */
export function stripNonLinguisticNoise(text: string): string {
  return text
    // fenced code blocks ```...```
    .replace(/```[\s\S]*?```/g, ' ')
    // inline code `...`
    .replace(/`[^`\n]*`/g, ' ')
    // markdown images ![alt](url) and links [text](url) — keep only the alt/text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    // bare URLs
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/www\.\S+/g, ' ')
    // HTML tags
    .replace(/<[^>]+>/g, ' ');
}

/** Count letters belonging to each Unicode script. */
function countScriptLetters(cleanText: string): Record<ScriptId, number> {
  const counts: Record<ScriptId, number> = {
    arabic: 0,
    latin: 0,
    cyrillic: 0,
    greek: 0,
    hebrew: 0,
    cjk: 0,
    unknown: 0,
  };

  for (const ch of cleanText) {
    const code = ch.codePointAt(0);
    if (code === undefined) continue;

    // ASCII / Latin-1 letters (includes accented French/German/Spanish chars)
    if (
      (code >= 0x41 && code <= 0x5a) ||   // A-Z
      (code >= 0x61 && code <= 0x7a) ||   // a-z
      (code >= 0xc0 && code <= 0xff && code !== 0xd7 && code !== 0xf7) // À-ÿ (× ÷ excluded)
    ) {
      counts.latin++;
      continue;
    }
    // Arabic block + Arabic Supplement/AEXT (covers Persian/Urdu letters too)
    if (
      (code >= 0x0600 && code <= 0x06ff) ||
      (code >= 0x0750 && code <= 0x077f) ||
      (code >= 0x08a0 && code <= 0x08ff)
    ) {
      counts.arabic++;
      continue;
    }
    // Cyrillic
    if (code >= 0x0400 && code <= 0x04ff) {
      counts.cyrillic++;
      continue;
    }
    // Greek
    if (code >= 0x0370 && code <= 0x03ff) {
      counts.greek++;
      continue;
    }
    // Hebrew
    if (code >= 0x0590 && code <= 0x05ff) {
      counts.hebrew++;
      continue;
    }
    // CJK (Chinese/Japanese/Korean)
    if (
      (code >= 0x4e00 && code <= 0x9fff) ||
      (code >= 0x3040 && code <= 0x30ff) ||
      (code >= 0xac00 && code <= 0xd7af)
    ) {
      counts.cjk++;
      continue;
    }
  }

  return counts;
}

/**
 * Analyze which script dominates a piece of text.
 *
 * Decision rule: Arabic is "dominant" only when it holds a strict majority of
 * all counted letters. Anything else (English, French, German, Spanish,
 * Turkish, Russian, ...) routes the quiz pipeline to the English prompt track.
 */
export function analyzeScript(text: string): ScriptAnalysis {
  const cleaned = stripNonLinguisticNoise(text || '');
  const counts = countScriptLetters(cleaned);
  const total =
    counts.arabic + counts.latin + counts.cyrillic + counts.greek +
    counts.hebrew + counts.cjk;

  if (total < 20) {
    // Too little linguistic material to decide — default to Arabic track
    // (the app's primary audience is Arabic-speaking).
    return {
      script: 'unknown',
      arabicRatio: 0,
      latinRatio: 0,
      totalLetters: total,
      isArabicDominant: true,
      isAmbiguous: true,
    };
  }

  const otherScripts: ScriptId[] = ['arabic', 'cyrillic', 'greek', 'hebrew', 'cjk'];
  let best: ScriptId = 'latin';
  let bestCount = counts.latin;
  for (const s of otherScripts) {
    if (counts[s] > bestCount) {
      best = s;
      bestCount = counts[s];
    }
  }

  return {
    script: best,
    arabicRatio: counts.arabic / total,
    latinRatio: counts.latin / total,
    totalLetters: total,
    isArabicDominant: best === 'arabic',
    isAmbiguous: false,
  };
}

/**
 * Human-readable language label used inside prompt reinforcement text.
 * Returns the language NAME (not the script) when it can be inferred from
 * common Latin-script language markers; otherwise names the script family.
 */
export function describeDetectedLanguage(analysis: ScriptAnalysis): string {
  switch (analysis.script) {
    case 'arabic':
      return 'Arabic (العربية)';
    case 'cyrillic':
      return 'Russian / Cyrillic';
    case 'greek':
      return 'Greek';
    case 'hebrew':
      return 'Hebrew';
    case 'cjk':
      return 'Chinese / Japanese / Korean';
    case 'latin':
      return 'a Latin-script language (English, French, German, Spanish, Turkish, …)';
    default:
      return 'the source content language';
  }
}

/**
 * Concatenate every human-readable string of a parsed quiz so its output
 * language can be validated against the source content's language.
 */
export function quizQuestionsText(questions: Array<{
  question?: string;
  options?: string[];
  correctAnswer?: string;
  pairs?: { key: string; value: string }[];
}>): string {
  const parts: string[] = [];
  for (const q of questions) {
    if (q.question) parts.push(q.question);
    if (Array.isArray(q.options)) parts.push(q.options.join(' '));
    if (q.correctAnswer) parts.push(q.correctAnswer);
    if (Array.isArray(q.pairs)) {
      for (const p of q.pairs) {
        parts.push(p.key || '');
        parts.push(p.value || '');
      }
    }
  }
  return parts.join('\n');
}

/**
 * Map boolean (true/false) option labels between Arabic and English,
 * used for the deterministic post-generation patch.
 */
export function patchBooleanOptions<
  Q extends { type: string; options?: string[]; correctAnswer?: string },
>(questions: Q[], targetArabic: boolean): Q[] {
  return questions.map((q) => {
    if (q.type !== 'boolean' || !Array.isArray(q.options) || q.options.length === 0) {
      return q;
    }

    const toEnglish = (v: string) =>
      ['صح', 'صحيح', 'true', 'نعم'].includes(String(v).trim().toLowerCase()) ? 'True' : 'False';
    const toArabic = (v: string) =>
      ['true', 't', 'yes', 'صح', 'صحيح', 'نعم'].includes(String(v).trim().toLowerCase()) ? 'صح' : 'خطأ';

    const optionsAreArabic = q.options.some((o) => /[\u0600-\u06FF]/.test(String(o)));
    const fixCorrect = (answer: string | undefined): string | undefined => {
      if (!answer) return answer;
      return targetArabic ? toArabic(answer) : toEnglish(answer);
    };

    // Only patch when the labels are in the WRONG script for the target
    if (targetArabic && !optionsAreArabic) {
      return { ...q, options: ['صح', 'خطأ'], correctAnswer: fixCorrect(q.correctAnswer) };
    }
    if (!targetArabic && optionsAreArabic) {
      return { ...q, options: ['True', 'False'], correctAnswer: fixCorrect(q.correctAnswer) };
    }
    return q;
  });
}

// -------------------------------------------------------
// Display directionality (RTL / LTR) — used by client components
// -------------------------------------------------------

/**
 * Determine the HTML directionality ('rtl' or 'ltr') for a piece of text.
 *
 * Uses dominant-script analysis for text long enough to be reliable; for short
 * or ambiguous strings (e.g. a single option label like "True" or "صح") falls
 * back to the Unicode first-strong-character rule — the same heuristic browsers
 * use to determine paragraph direction.
 *
 * This function is safe to import from client components: language-utils.ts
 * has zero server-only imports.
 */
export function textDir(text: string): 'rtl' | 'ltr' {
  if (!text) return 'ltr';

  const analysis = analyzeScript(text);
  if (!analysis.isAmbiguous) {
    return analysis.script === 'arabic' || analysis.script === 'hebrew' ? 'rtl' : 'ltr';
  }

  // Short / ambiguous text: first strong directional character wins.
  const cleaned = stripNonLinguisticNoise(text);
  for (const ch of cleaned) {
    const code = ch.codePointAt(0);
    if (code === undefined) continue;
    // Arabic / Arabic Supplement / Arabic Extended-A / Hebrew → RTL
    if (
      (code >= 0x0600 && code <= 0x06ff) ||
      (code >= 0x0750 && code <= 0x077f) ||
      (code >= 0x08a0 && code <= 0x08ff) ||
      (code >= 0x0590 && code <= 0x05ff)
    ) {
      return 'rtl';
    }
    // Latin / Latin-1 supplement / Cyrillic / Greek → LTR
    if (
      (code >= 0x41 && code <= 0x5a) ||
      (code >= 0x61 && code <= 0x7a) ||
      (code >= 0xc0 && code <= 0xff && code !== 0xd7 && code !== 0xf7) ||
      (code >= 0x0400 && code <= 0x04ff) ||
      (code >= 0x0370 && code <= 0x03ff)
    ) {
      return 'ltr';
    }
  }
  return 'ltr';
}

/**
 * Determine directionality for a parsed quiz question by concatenating all of
 * its human-readable text (question + options + answer + pairs). The combined
 * text is virtually always long enough for reliable dominant-script detection,
 * so per-option short-string fallbacks are rarely needed.
 */
export function questionDir(question: {
  question?: string;
  options?: string[];
  correctAnswer?: string;
  pairs?: { key: string; value: string }[];
}): 'rtl' | 'ltr' {
  const parts: string[] = [question.question || ''];
  if (Array.isArray(question.options)) parts.push(question.options.join(' '));
  if (question.correctAnswer) parts.push(question.correctAnswer);
  if (Array.isArray(question.pairs)) {
    for (const p of question.pairs) {
      parts.push(p.key || '');
      parts.push(p.value || '');
    }
  }
  return textDir(parts.join(' '));
}

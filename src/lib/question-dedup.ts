// =====================================================
// Question Deduplication Engine (v136)
// =====================================================
//
// Protects question banks from duplicate questions EVEN when they are
// rephrased or reformatted. Three independent layers:
//
//   Layer 1 — Fingerprint: SHA-256 of the normalized question text.
//             Catches identical questions after Arabic normalization
//             (diacritics, hamza variants, taa marbuta, tatweel, digits,
//             punctuation, casing, boilerplate prefixes).
//
//   Layer 2 — Similarity (no AI): weighted Jaccard token similarity +
//             character-trigram similarity, plus an answer-signature match.
//             Catches "the same idea in a different wording".
//
//   Layer 3 — Prompt-level avoidance: callers pass existing bank questions
//             into the AI generation prompt as forbidden ideas (handled in
//             the AI layer, not here).
//
// This module is deterministic, dependency-free (node:crypto only) and
// safe to run inside any API route within the Vercel time budget.

import { createHash } from 'crypto';

// -------------------------------------------------------
// Public input shape (works for both QuizQuestion and BankQuestion rows)
// -------------------------------------------------------

export interface DedupQuestionInput {
  type?: string | null;
  question: string;
  correctAnswer?: string | null;
  correct_answer?: string | null;
  options?: string[] | null;
  pairs?: { key: string; value: string }[] | null;
  /** Pre-computed fingerprint (bank rows store one). Computed on the fly when absent. */
  fingerprint?: string | null;
}

export interface DeduplicationResult<T> {
  /** Questions that passed all dedup layers (order preserved). */
  unique: T[];
  /** Questions rejected as duplicates (order preserved). */
  duplicates: T[];
}

// -------------------------------------------------------
// Text normalization (Arabic-first, Latin-aware)
// -------------------------------------------------------

/**
 * Aggressive normalization used for BOTH fingerprinting and similarity.
 * - strips Arabic diacritics (tashkeel) and tatweel
 * - unifies alef/hamza variants, taa marbuta, alef maqsura
 * - converts Arabic-Indic digits to Western digits
 * - lowercases, strips punctuation/symbols, collapses whitespace
 */
export function normalizeQuestionText(raw: string): string {
  if (!raw) return '';
  let s = raw
    .toLowerCase()
    // Arabic diacritics (harakat) + superscript alef + tatweel
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
    // Alef & hamza variants → plain alef
    .replace(/[\u0622\u0623\u0625\u0627]/g, '\u0627')
    // Taa marbuta → haa
    .replace(/\u0629/g, '\u0647')
    // Alef maqsura → yaa
    .replace(/\u0649/g, '\u064A')
    // Waw-hamza → waw, Yaa-hamza → yaa
    .replace(/\u0624/g, '\u0648')
    .replace(/\u0626/g, '\u064A')
    // Arabic-Indic + Extended Arabic-Indic digits → Western
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06F0))
    // Latin smart quotes/dashes → plain
    .replace(/[\u2018\u2019\u02BB]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-');

  // Keep only letters (any script), digits, and spaces
  s = s.replace(/[^\p{L}\p{N}\s]/gu, ' ');

  return s
    .replace(/\s+/g, ' ')
    .trim();
}

/** Boilerplate prefixes that carry no meaning — removed before fingerprinting. */
const QUESTION_PREFIXES_AR = [
  'اختر الاجابة الصحيحة',
  'اختر الاجابه الصحيحه',
  'اختر الاجابة',
  'اختر الاجابه',
  'اختر',
  'ضع علامة',
  'ضع علامه',
  'اجب عن',
  'السؤال',
  'س',
];

function stripBoilerplate(normalized: string): string {
  let s = normalized;
  for (const p of QUESTION_PREFIXES_AR) {
    const np = normalizeQuestionText(p);
    if (np && s.startsWith(np + ' ')) {
      s = s.slice(np.length + 1);
      break;
    }
  }
  // Trailing question mark already removed by normalization; collapse again
  return s.replace(/\s+/g, ' ').trim();
}

// -------------------------------------------------------
// Layer 1 — Fingerprint
// -------------------------------------------------------

/**
 * Stable fingerprint of a question: SHA-256 (shortened) of the fully
 * normalized, boilerplate-stripped question TEXT.
 * Answer/options are intentionally NOT part of the fingerprint — the same
 * question text with a different answer is still a duplicate question.
 */
export function questionFingerprint(q: DedupQuestionInput): string {
  if (q.fingerprint) return q.fingerprint;
  const normalized = stripBoilerplate(normalizeQuestionText(q.question || ''));
  if (!normalized) return '';
  return createHash('sha256').update(normalized, 'utf8').digest('hex').substring(0, 40);
}

// -------------------------------------------------------
// Layer 2 — Similarity
// -------------------------------------------------------

/** Minimal, safe stopword list (pronouns/prepositions only — never domain words). */
const STOPWORDS = new Set([
  // Arabic
  'من', 'في', 'على', 'الي', 'عن', 'ما', 'هو', 'هي', 'هذا', 'هذه', 'ذلك',
  'التي', 'الذي', 'ان', 'او', 'بين', 'عند', 'كل', 'مع', 'كان', 'كانت',
  'يكون', 'تكون', 'لدي', 'لا', 'لم', 'ماذا', 'كيف', 'اين', 'هناك', 'هنا',
  'ثم', 'قد', 'حتي', 'الي', 'علي',
  // English
  'the', 'a', 'an', 'of', 'in', 'on', 'at', 'to', 'is', 'are', 'was',
  'were', 'what', 'which', 'who', 'how', 'define', 'does', 'do', 'did',
]);

/** Tokenize normalized text into a meaningful token set (stopwords + "ال" prefix removed). */
function tokenSet(normalized: string): Set<string> {
  const out = new Set<string>();
  if (!normalized) return out;
  for (let tok of normalized.split(' ')) {
    if (tok.length < 2) continue;
    // Strip Arabic definite article
    if (tok.length > 3 && tok.startsWith('\u0627\u0644')) {
      tok = tok.slice(2);
    }
    // Strip leading waw conjunction
    if (tok.length > 3 && tok.startsWith('\u0648')) {
      tok = tok.slice(1);
    }
    if (!tok || STOPWORDS.has(tok)) continue;
    out.add(tok);
  }
  return out;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

/** Character trigram set over the normalized text with spaces removed. */
function trigramSet(normalized: string): Set<string> {
  const s = normalized.replace(/ /g, '');
  const out = new Set<string>();
  if (s.length < 3) {
    if (s) out.add(s);
    return out;
  }
  for (let i = 0; i <= s.length - 3; i++) out.add(s.substring(i, i + 3));
  return out;
}

function trigramSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

/** Normalized answer signature — equal answers across formats are a strong duplicate signal. */
function answerSignature(q: DedupQuestionInput): string {
  const ans = (q.correctAnswer ?? q.correct_answer ?? '').toString().trim();
  if (ans) return normalizeQuestionText(ans);
  if (q.pairs && Array.isArray(q.pairs) && q.pairs.length > 0) {
    // Matching: sorted normalized keys define the question's answer surface
    return q.pairs
      .map((p) => normalizeQuestionText(p.key || ''))
      .filter(Boolean)
      .sort()
      .join('|');
  }
  return '';
}

/** Precomputed comparison profile for one question. */
interface QuestionProfile {
  fingerprint: string;
  tokens: Set<string>;
  trigrams: Set<string>;
  answer: string;
}

function buildProfile(q: DedupQuestionInput): QuestionProfile {
  const normalized = stripBoilerplate(normalizeQuestionText(q.question || ''));
  return {
    fingerprint: questionFingerprint(q),
    tokens: tokenSet(normalized),
    trigrams: trigramSet(normalized),
    answer: answerSignature(q),
  };
}

// Thresholds (tuned for Arabic educational questions — see tests)
export const DUPLICATE_SIMILARITY_THRESHOLD = 0.82;
export const DUPLICATE_ANSWER_BOOST_THRESHOLD = 0.60;

/** True when two questions are near-identical or the same idea reworded. */
export function questionsSimilar(a: QuestionProfile, b: QuestionProfile): boolean {
  // Layer 1 fast path
  if (a.fingerprint && a.fingerprint === b.fingerprint) return true;

  // Layer 2: weighted lexical similarity
  const lex = 0.5 * jaccard(a.tokens, b.tokens) + 0.5 * trigramSimilarity(a.trigrams, b.trigrams);
  if (lex >= DUPLICATE_SIMILARITY_THRESHOLD) return true;

  // Same answer + moderately similar wording → same question reworded
  if (a.answer && a.answer === b.answer && lex >= DUPLICATE_ANSWER_BOOST_THRESHOLD) return true;

  return false;
}

// -------------------------------------------------------
// Public API
// -------------------------------------------------------

/**
 * Filter incoming questions against an existing set (and against each other).
 * Order of `unique` follows the incoming order; the first occurrence wins.
 */
export function filterDuplicateQuestions<T extends DedupQuestionInput>(
  incoming: T[],
  existing: DedupQuestionInput[],
): DeduplicationResult<T> {
  const existingProfiles = (existing || [])
    .map((q) => ({ src: q, profile: buildProfile(q) }))
    .filter((e) => e.profile.fingerprint); // skip empty questions

  const seenFingerprints = new Set(existingProfiles.map((e) => e.profile.fingerprint));
  const seenProfiles = existingProfiles.map((e) => e.profile);

  const unique: T[] = [];
  const duplicates: T[] = [];

  for (const q of incoming || []) {
    const profile = buildProfile(q);
    if (!profile.fingerprint) {
      // Empty/unparseable question text — do not silently drop it from
      // non-dedup callers; treat as unique so validation elsewhere handles it.
      unique.push(q);
      continue;
    }

    // Exact fingerprint hit (against existing OR previously accepted incoming)
    if (seenFingerprints.has(profile.fingerprint)) {
      duplicates.push(q);
      continue;
    }

    // Similarity scan (existing + already-accepted incoming)
    let isDup = false;
    for (const p of seenProfiles) {
      if (questionsSimilar(profile, p)) {
        isDup = true;
        break;
      }
    }

    if (isDup) {
      duplicates.push(q);
    } else {
      unique.push(q);
      seenFingerprints.add(profile.fingerprint);
      seenProfiles.push(profile);
    }
  }

  return { unique, duplicates };
}

/** Count how many of `incoming` are duplicates of `existing` (convenience wrapper). */
export function countDuplicates<T extends DedupQuestionInput>(incoming: T[], existing: DedupQuestionInput[]): number {
  return filterDuplicateQuestions(incoming, existing).duplicates.length;
}

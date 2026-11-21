// =====================================================
// v136-fix — Difficulty strategy helpers (pure, testable)
//
// Extracted from provider-manager.ts and fixed so mixed mode can never
// silently drop questions or contradict the requested question count:
//
//  1. sanitizeMixCounts scales any teacher-supplied mix to sum EXACTLY to
//     the requested question total (the questionTypes sum), instead of
//     overriding it. The question count the user asked for always wins.
//  2. applyDifficultyStrategy no longer trims overflow questions. It keeps
//     every generated question and rebalances difficulty tags onto the
//     per-level quotas, so the delivered quiz keeps both the requested
//     total and the requested per-type distribution.
// =====================================================

import type { QuizDifficultyMode, QuizMixCounts, QuizQuestion } from './types';

export const VALID_DIFFICULTY_LEVELS: readonly string[] = ['easy', 'medium', 'hard', 'very_hard'];
export const VALID_DIFFICULTY_MODES: readonly string[] = ['easy', 'medium', 'hard', 'very_hard', 'mixed'];

type Level = 'easy' | 'medium' | 'hard' | 'very_hard';
const LEVELS: readonly Level[] = ['easy', 'medium', 'hard', 'very_hard'];

const clampCount = (n: unknown): number =>
  typeof n === 'number' && Number.isFinite(n) ? Math.max(0, Math.min(30, Math.floor(n))) : 0;

/**
 * Scale a weight vector to sum exactly to `total` (largest-remainder rounding,
 * ties broken in level order). Deterministic.
 */
function scaleToTotal(weights: number[], total: number): number[] {
  const wSum = weights.reduce((a, b) => a + b, 0);
  if (wSum <= 0 || total <= 0) return weights.map(() => 0);
  const raw = weights.map((w) => (w / wSum) * total);
  const result = raw.map(Math.floor);
  let remainder = total - result.reduce((a, b) => a + b, 0);
  const order = raw
    .map((r, i) => ({ frac: r - result[i], idx: i }))
    .sort((a, b) => b.frac - a.frac || a.idx - b.idx);
  for (let k = 0; k < order.length && remainder > 0; k++, remainder--) {
    result[order[k].idx]++;
  }
  return result;
}

/**
 * Normalize a mix-counts request so it sums EXACTLY to fallbackTotal (the
 * requested question count). v136-fix: previously a teacher-supplied mix with
 * a different sum silently replaced the requested total; now the requested
 * total always wins and the mix is proportionally scaled to fit it.
 * With no usable mix, falls back to a 25/35/25/15 split of fallbackTotal.
 */
export function sanitizeMixCounts(raw: QuizMixCounts | undefined, fallbackTotal: number): Required<QuizMixCounts> {
  const counts = [clampCount(raw?.easy), clampCount(raw?.medium), clampCount(raw?.hard), clampCount(raw?.very_hard)];
  const suppliedTotal = counts.reduce((a, b) => a + b, 0);

  const target = Math.max(0, Math.floor(fallbackTotal));
  let scaled: number[];
  if (suppliedTotal > 0 && target > 0) {
    scaled = scaleToTotal(counts, target);
  } else if (target > 0) {
    // Default proportional distribution: 25/35/25/15
    scaled = scaleToTotal([25, 35, 25, 15], target);
    // At least 1 per level when the total allows it (4+ questions)
    if (target >= LEVELS.length) {
      for (let i = 0; i < LEVELS.length; i++) {
        if (scaled[i] === 0) {
          const donor = scaled.indexOf(Math.max(...scaled));
          if (scaled[donor] > 1) {
            scaled[donor]--;
            scaled[i]++;
          }
        }
      }
    }
  } else {
    // No requested total to anchor to (all question types are 0): keep the
    // supplied mix as-is so an explicit mix still means something.
    scaled = counts;
  }

  return { easy: scaled[0], medium: scaled[1], hard: scaled[2], very_hard: scaled[3] };
}

/**
 * Deterministically force/repair the difficulty tag on every question.
 *
 * v136-fix: mixed mode previously TRIMMED questions past each level's quota,
 * silently shrinking the quiz and breaking the requested type distribution.
 * Now every question is kept: tags are sanitized, then any level's overflow
 * is RE-TAGGED onto under-filled levels so the per-level counts match the
 * quotas without losing a single question. Questions are only dropped when
 * the AI returned MORE than the requested total, and then from over-quota
 * levels first (logged, never silent).
 */
export function applyDifficultyStrategy(
  questions: QuizQuestion[],
  difficulty: QuizDifficultyMode,
  mixCounts: Required<QuizMixCounts>,
): QuizQuestion[] {
  if (difficulty !== 'mixed') {
    // Single level: the level is a hard requirement — override whatever the AI returned
    for (const q of questions) q.difficulty = difficulty as QuizQuestion['difficulty'];
    return questions;
  }

  const quotaTotal = LEVELS.reduce((sum, lv) => sum + mixCounts[lv], 0);

  // Sanitize invalid/missing tags to 'medium' (as before).
  for (const q of questions) {
    q.difficulty = (
      q.difficulty && VALID_DIFFICULTY_LEVELS.includes(q.difficulty) ? q.difficulty : 'medium'
    ) as QuizQuestion['difficulty'];
  }

  // Only when the AI over-produced past the requested total do we drop the
  // extra questions, taking them from over-quota levels first, then the tail.
  let kept = questions;
  if (quotaTotal > 0 && questions.length > quotaTotal) {
    const taken: Record<Level, number> = { easy: 0, medium: 0, hard: 0, very_hard: 0 };
    kept = [];
    const overflow: QuizQuestion[] = [];
    for (const q of questions) {
      const lv = q.difficulty as Level;
      if (taken[lv] < mixCounts[lv]) {
        taken[lv]++;
        kept.push(q);
      } else {
        overflow.push(q);
      }
    }
    // Fill any still-open quota from the overflow before dropping anything.
    for (const q of overflow) {
      if (kept.length >= quotaTotal) break;
      kept.push(q);
    }
    console.warn(
      `[Quiz] Mixed-mode overproduction: AI returned ${questions.length} questions for ${quotaTotal} requested — kept the first ${kept.length} (per-level quotas first)`,
    );
  }

  // Re-tag (never delete) to satisfy the per-level quotas: move overflow tags
  // from over-quota levels onto under-quota levels.
  const countOf = () => {
    const c: Record<Level, number> = { easy: 0, medium: 0, hard: 0, very_hard: 0 };
    for (const q of kept) c[q.difficulty as Level]++;
    return c;
  };
  const counts = countOf();
  for (const q of kept) {
    const lv = q.difficulty as Level;
    if (counts[lv] <= mixCounts[lv]) continue;
    // This level is over quota: find an under-quota level to receive the tag.
    const target = LEVELS.find((other) => counts[other] < mixCounts[other]);
    if (!target) break; // every level at quota
    counts[lv]--;
    counts[target]++;
    q.difficulty = target;
  }

  const delivered = countOf();
  const shortfall = quotaTotal - kept.length;
  if (shortfall > 0) {
    console.warn(
      `[Quiz] Mixed-mode shortfall: AI returned ${kept.length} questions for ${quotaTotal} requested ` +
      `(requested ${JSON.stringify(mixCounts)}, delivered ${JSON.stringify(delivered)})`,
    );
  }
  return kept;
}

/**
 * v136-fix — Enforce the requested per-type question counts (deterministic,
 * no AI). The model sometimes returns more questions of a type than
 * requested; in mixed mode the old code applied NO type trimming at all, so
 * the AI effectively picked the type mix itself. Now the per-type overflow
 * is trimmed (order preserved) in every mode, so the delivered quiz can
 * never exceed the type distribution the user picked. Under-production is
 * kept as-is and logged; fabricating questions would be worse.
 */
export function enforceQuestionTypeCounts(
  questions: QuizQuestion[],
  requested: { mcq: number; boolean: number; completion: number; matching: number },
): QuizQuestion[] {
  const counters = { mcq: 0, boolean: 0, completion: 0, matching: 0 };
  const kept: QuizQuestion[] = [];
  let dropped = 0;
  for (const q of questions) {
    const t = q.type as keyof typeof counters;
    const max = requested[t] ?? 0;
    if (max > 0 && counters[t] < max) {
      counters[t]++;
      kept.push(q);
    } else {
      dropped++;
    }
  }
  if (dropped > 0) {
    console.warn(
      `[Quiz] Type-count enforcement: dropped ${dropped} over-produced question(s) beyond the requested per-type counts ${JSON.stringify(requested)}`,
    );
  }
  const shortfall = (Object.keys(requested) as Array<keyof typeof counters>)
    .filter((t) => requested[t] > counters[t])
    .map((t) => `${t}: ${counters[t]}/${requested[t]}`);
  if (shortfall.length > 0) {
    console.warn(`[Quiz] Type-count shortfall (AI under-produced): ${shortfall.join(', ')}`);
  }
  return kept;
}

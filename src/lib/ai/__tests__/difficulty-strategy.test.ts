import { describe, expect, test } from 'bun:test';
import {
  sanitizeMixCounts,
  applyDifficultyStrategy,
  enforceQuestionTypeCounts,
  VALID_DIFFICULTY_LEVELS,
  VALID_DIFFICULTY_MODES,
} from '../difficulty-strategy';
import type { QuizQuestion } from '../types';

const q = (difficulty?: string): QuizQuestion => ({
  type: 'mcq',
  question: 'سؤال تجريبي',
  options: ['أ', 'ب', 'ج', 'د'],
  correctAnswer: 'أ',
  ...(difficulty ? { difficulty: difficulty as QuizQuestion['difficulty'] } : {}),
});

const sum = (m: { easy: number; medium: number; hard: number; very_hard: number }) =>
  m.easy + m.medium + m.hard + m.very_hard;

const countByLevel = (qs: QuizQuestion[]) => {
  const c: Record<string, number> = { easy: 0, medium: 0, hard: 0, very_hard: 0 };
  for (const x of qs) c[x.difficulty as string]++;
  return c;
};

describe('sanitizeMixCounts', () => {
  test('scales a supplied mix to sum EXACTLY to the requested total (the 8-vs-9 regression)', () => {
    // Teacher UI default mix totals 8 while the question types total 9.
    // v136 bug: the mix replaced the requested total. Fix: mix scales to it.
    const m = sanitizeMixCounts({ easy: 2, medium: 3, hard: 2, very_hard: 1 }, 9);
    expect(sum(m)).toBe(9);
    // Proportions preserved as closely as rounding allows
    expect(m.medium).toBeGreaterThanOrEqual(m.easy);
    expect(m.medium).toBeGreaterThanOrEqual(m.hard);
    expect(m.very_hard).toBeLessThanOrEqual(m.easy);
  });

  test('a matching-sum mix passes through unchanged', () => {
    const m = sanitizeMixCounts({ easy: 2, medium: 3, hard: 2, very_hard: 1 }, 8);
    expect(m).toEqual({ easy: 2, medium: 3, hard: 2, very_hard: 1 });
  });

  test('default split (no mix supplied) sums to the requested total with 1+ per level', () => {
    const m = sanitizeMixCounts(undefined, 10);
    expect(sum(m)).toBe(10);
    expect(m.easy).toBeGreaterThanOrEqual(1);
    expect(m.medium).toBeGreaterThanOrEqual(1);
    expect(m.hard).toBeGreaterThanOrEqual(1);
    expect(m.very_hard).toBeGreaterThanOrEqual(1);
  });

  test('clamps garbage input and still honors the total', () => {
    const m = sanitizeMixCounts({ easy: 999, medium: -5, hard: 1.9, very_hard: Number.NaN } as never, 12);
    expect(sum(m)).toBe(12);
  });

  test('zero requested total keeps the supplied mix as-is (no anchor)', () => {
    const m = sanitizeMixCounts({ easy: 1, medium: 1, hard: 1, very_hard: 1 }, 0);
    expect(sum(m)).toBe(4);
  });
});

describe('applyDifficultyStrategy — single level', () => {
  test('forces the requested level on every question and drops nothing', () => {
    const qs = [q('easy'), q('hard'), q()];
    const out = applyDifficultyStrategy(qs, 'very_hard', { easy: 0, medium: 0, hard: 0, very_hard: 0 });
    expect(out.length).toBe(3);
    expect(out.every((x) => x.difficulty === 'very_hard')).toBe(true);
  });
});

describe('applyDifficultyStrategy — mixed', () => {
  const mix = { easy: 2, medium: 3, hard: 2, very_hard: 1 };

  test('NEVER drops questions when the AI returns the requested total (core v136 regression)', () => {
    // AI over-tags 'medium' (the old code deleted 2 of these 8 questions).
    const qs = [q('medium'), q('medium'), q('medium'), q('medium'), q('medium'), q('easy'), q('hard'), q('very_hard')];
    const out = applyDifficultyStrategy(qs, 'mixed', mix);
    expect(out.length).toBe(8);
    expect(countByLevel(out)).toEqual(mix);
  });

  test('missing/invalid tags become medium, then rebalance to quotas without loss', () => {
    const qs = [q(), q(), q('not-a-level' as never), q('easy'), q('easy'), q('hard'), q('hard'), q('very_hard')];
    const out = applyDifficultyStrategy(qs, 'mixed', mix);
    expect(out.length).toBe(8);
    expect(countByLevel(out)).toEqual(mix);
    for (const x of out) expect(VALID_DIFFICULTY_LEVELS).toContain(x.difficulty as string);
  });

  test('exact AI tags pass through unchanged', () => {
    const qs = [q('easy'), q('easy'), q('medium'), q('medium'), q('medium'), q('hard'), q('hard'), q('very_hard')];
    const out = applyDifficultyStrategy(qs, 'mixed', mix);
    expect(out.length).toBe(8);
    expect(countByLevel(out)).toEqual(mix);
  });

  test('under-production keeps everything (no fabrication, no crash)', () => {
    const qs = [q('easy'), q('medium'), q('hard')];
    const out = applyDifficultyStrategy(qs, 'mixed', mix);
    expect(out.length).toBe(3);
  });

  test('over-production trims only the surplus past the requested total', () => {
    const qs = [q('easy'), q('easy'), q('medium'), q('medium'), q('medium'), q('hard'), q('hard'), q('very_hard'), q('medium'), q('medium')];
    const out = applyDifficultyStrategy(qs, 'mixed', mix);
    expect(out.length).toBe(8);
    expect(countByLevel(out)).toEqual(mix);
  });
});

describe('mode constants', () => {
  test('levels and modes are stable', () => {
    expect(VALID_DIFFICULTY_LEVELS).toEqual(['easy', 'medium', 'hard', 'very_hard']);
    expect(VALID_DIFFICULTY_MODES).toContain('mixed');
  });
});

const typedQ = (type: QuizQuestion['type'], tag = ''): QuizQuestion => ({
  type,
  question: `q-${type}-${tag}`,
  ...(type === 'mcq' ? { options: ['أ', 'ب'], correctAnswer: 'أ' } : {}),
});

describe('enforceQuestionTypeCounts — the AI cannot pick types on its own', () => {
  const req = { mcq: 3, boolean: 2, completion: 2, matching: 1 };

  test('over-produced type is trimmed to the exact requested count (mixed-mode regression)', () => {
    // AI returned 6 mcq although 3 were requested: the old mixed mode kept all 6.
    const qs = [typedQ('mcq','1'), typedQ('boolean','1'), typedQ('mcq','2'), typedQ('mcq','3'),
                typedQ('mcq','4'), typedQ('mcq','5'), typedQ('mcq','6'), typedQ('completion','1')];
    const out = enforceQuestionTypeCounts(qs, req);
    expect(out.filter((x) => x.type === 'mcq').length).toBe(3);
    expect(out.filter((x) => x.type === 'boolean').length).toBe(1);
  });

  test('no type can ever exceed its requested count, order preserved', () => {
    const qs = [typedQ('mcq','1'), typedQ('mcq','2'), typedQ('mcq','3'), typedQ('mcq','4'),
                typedQ('boolean','1'), typedQ('boolean','2'), typedQ('boolean','3'),
                typedQ('completion','1'), typedQ('completion','2'), typedQ('completion','3'),
                typedQ('matching','1'), typedQ('matching','2')];
    const out = enforceQuestionTypeCounts(qs, req);
    expect(out.length).toBe(8);
    expect(out.filter((x) => x.type === 'mcq').length).toBe(3);
    expect(out.filter((x) => x.type === 'boolean').length).toBe(2);
    expect(out.filter((x) => x.type === 'completion').length).toBe(2);
    expect(out.filter((x) => x.type === 'matching').length).toBe(1);
    expect(out[0].question).toBe('q-mcq-1');
  });

  test('under-production is kept as-is (nothing fabricated)', () => {
    const qs = [typedQ('mcq','1'), typedQ('boolean','1')];
    const out = enforceQuestionTypeCounts(qs, req);
    expect(out.length).toBe(2);
  });

  test('a type requested as 0 is fully excluded', () => {
    const qs = [typedQ('mcq','1'), typedQ('matching','1'), typedQ('matching','2')];
    const out = enforceQuestionTypeCounts(qs, { mcq: 1, boolean: 0, completion: 0, matching: 0 });
    expect(out.length).toBe(1);
    expect(out[0].type).toBe('mcq');
  });
});

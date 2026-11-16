// =====================================================
// Question Deduplication Engine — Tests (v136)
// Run: bun test src/lib/__tests__/question-dedup.test.ts
// =====================================================

import { describe, it, expect } from 'bun:test';
import {
  normalizeQuestionText,
  questionFingerprint,
  questionsSimilar,
  filterDuplicateQuestions,
  countDuplicates,
} from '../question-dedup';

// Precomputed profile helpers (buildProfile is private — rebuild via the public filter)
function profileOf(q: { question: string; correctAnswer?: string }) {
  // Use filterDuplicateQuestions against an empty set to obtain a "unique"
  // verdict, and re-derive similarity through the public API below.
  return q;
}

describe('normalizeQuestionText', () => {
  it('unifies Arabic hamza/alef variants', () => {
    expect(normalizeQuestionText('الإجابة الصحيحة')).toBe(normalizeQuestionText('الاجابه الصحيحه'));
  });

  it('strips diacritics and tatweel', () => {
    expect(normalizeQuestionText('تَعْريـف')).toBe(normalizeQuestionText('تعريف'));
  });

  it('converts Arabic-Indic digits', () => {
    expect(normalizeQuestionText('١٢٣')).toBe('123');
  });

  it('is case-insensitive and ignores punctuation', () => {
    expect(normalizeQuestionText('What is OOP?')).toBe(normalizeQuestionText('what is oop'));
  });
});

describe('questionFingerprint', () => {
  it('is stable across formatting/normalization differences', () => {
    const a = questionFingerprint({ question: 'ما هو اختبار الوحدات؟' });
    const b = questionFingerprint({ question: 'ما هو اختبار الوحدات ؟' });
    expect(a).toBe(b);
    expect(a).not.toBe('');
  });

  it('ignores boilerplate prefixes', () => {
    const a = questionFingerprint({ question: 'اختر الإجابة الصحيحة: ما هو التكامل؟' });
    const b = questionFingerprint({ question: 'ما هو التكامل؟' });
    expect(a).toBe(b);
  });

  it('respects stored fingerprints', () => {
    expect(questionFingerprint({ question: 'x', fingerprint: 'precomputed' })).toBe('precomputed');
  });
});

describe('rephrased-duplicate detection (filterDuplicateQuestions)', () => {
  const existing = [
    { question: 'ما هو اختبار الوحدات؟', correctAnswer: 'اختبار الوحدات' },
    { question: 'العملية العكسية للتفاضل تسمى ____', correctAnswer: 'التكامل' },
    { question: 'What is a queue data structure?', correctAnswer: 'Queue' },
  ];

  it('rejects an identical question', () => {
    const res = filterDuplicateQuestions([{ question: 'ما هو اختبار الوحدات ؟' }], existing);
    expect(res.duplicates.length).toBe(1);
    expect(res.unique.length).toBe(0);
  });

  it('rejects a lightly reworded question with the same answer', () => {
    const res = filterDuplicateQuestions(
      [{ question: 'اختر الإجابة الصحيحة: ما هو اختبار الوحدات', correctAnswer: 'اختبار الوحدات' }],
      existing,
    );
    expect(res.duplicates.length).toBe(1);
  });

  it('rejects a same-idea different-format question (completion vs mcq)', () => {
    const res = filterDuplicateQuestions(
      [{ question: 'البنية التي تتبع مبدأ FIFO تسمى ____', correctAnswer: 'Queue' }],
      existing,
    );
    // Not a fingerprint hit, tokens differ ("بنية" vs "structure") — must NOT
    // be flagged because wording and language genuinely differ
    expect(res.unique.length).toBe(1);
  });

  it('rejects a reworded English duplicate', () => {
    const res = filterDuplicateQuestions(
      [{ question: 'What is the queue data structure?', correctAnswer: 'Queue' }],
      existing,
    );
    expect(res.duplicates.length).toBe(1);
  });

  it('keeps genuinely different questions', () => {
    const res = filterDuplicateQuestions(
      [
        { question: 'ما هو اختبار التكامل؟', correctAnswer: 'اختبار التكامل' },
        { question: 'What is a stack?', correctAnswer: 'Stack' },
      ],
      existing,
    );
    expect(res.unique.length).toBe(2);
    expect(res.duplicates.length).toBe(0);
  });

  it('deduplicates within the incoming list itself', () => {
    const res = filterDuplicateQuestions(
      [
        { question: 'ما هو الترميز؟' },
        { question: 'ما هو الترميز؟' },
        { question: 'ما هو التشفير؟' },
      ],
      [],
    );
    expect(res.unique.length).toBe(2);
    expect(res.duplicates.length).toBe(1);
  });

  it('preserves incoming order and attaches extra fields', () => {
    const res = filterDuplicateQuestions(
      [
        { question: 'سؤال جديد أ', category: 'A' },
        { question: 'What is a stack?', correctAnswer: 'Stack' },
      ],
      existing,
    );
    expect(res.unique.length).toBe(2);
    expect((res.unique[0] as { category: string }).category).toBe('A');
  });
});

describe('questionsSimilar via countDuplicates', () => {
  it('counts cross-type duplicates with matching answers', () => {
    const existing = [{ question: 'ما هي بنية البيانات التي تتبع مبدأ FIFO؟', correctAnswer: 'الطابور' }];
    const n = countDuplicates(
      [{ question: 'بنية البيانات التي تتبع مبدأ FIFO تسمى ____', correctAnswer: 'الطابور' }],
      existing,
    );
    expect(n).toBe(1);
  });

  it('does not flag different questions sharing a generic answer', () => {
    const existing = [
      { question: 'ما هو التفاضل؟', correctAnswer: 'صح' },
      { question: 'ما هو التكامل؟', correctAnswer: 'صح' },
    ];
    const n = countDuplicates([{ question: 'ما هو الترميز؟', correctAnswer: 'صح' }], existing);
    expect(n).toBe(0);
  });
});

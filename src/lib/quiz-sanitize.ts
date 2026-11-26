import type { QuizQuestion } from '@/lib/types';

/**
 * Removes everything that gives away the answers before the student has answered:
 * correctAnswer is dropped, and matching pairs keep their keys and values but are mis-paired
 * (values rotated by one), so the pairing is not readable from the payload.
 */
export function sanitizeQuestions(questions: QuizQuestion[]): QuizQuestion[] {
  return questions.map((q) => {
    const { correctAnswer: _drop, ...rest } = q as QuizQuestion & Record<string, unknown>;
    void _drop;
    const out = { ...rest } as QuizQuestion;
    if (q.type === 'matching' && Array.isArray(q.pairs) && q.pairs.length > 1) {
      const values = q.pairs.map((p) => p.value);
      out.pairs = q.pairs.map((p, i) => ({ key: p.key, value: values[(i + 1) % values.length] }));
    }
    return out;
  });
}

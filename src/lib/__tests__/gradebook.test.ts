import { describe, test as it, expect } from 'bun:test';
import { computeTotals, letterGrade, type GradeItem } from '../gradebook';

const item = (o: Partial<GradeItem>): GradeItem => ({ type: 'assignment', id: 'x', title: 't', date: null, score: null, max: 100, status: 'graded', ...o });

describe('gradebook', () => {
  it('sums only graded visible items', () => {
    const r = computeTotals([
      item({ score: 8, max: 10 }),
      item({ score: 45, max: 50 }),
      item({ status: 'submitted' }),
      item({ status: 'missing' }),
      item({ status: 'hidden', score: null }),
      item({ type: 'quiz', status: 'not_taken', max: 0 }),
    ]);
    expect(r.earned).toBe(53);
    expect(r.possible).toBe(60);
    expect(r.percent).toBe(88.3);
    expect(r.letter).toBe('B');
    expect(r.gradedCount).toBe(2);
  });
  it('returns null when nothing is graded', () => {
    const r = computeTotals([item({ status: 'submitted' })]);
    expect(r.percent).toBeNull();
    expect(r.letter).toBeNull();
  });
  it('letter boundaries', () => {
    expect([90, 89.9, 80, 70, 60, 59.9].map(letterGrade)).toEqual(['A', 'B', 'B', 'C', 'D', 'F']);
  });
});

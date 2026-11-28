import { describe, it, expect } from 'bun:test';
import { deadlineOf, calculateAssignmentQuality } from '../performance-calculator';

describe('deadlineOf', () => {
  it('treats a date-only due date as end of that day', () => {
    const d = deadlineOf('2026-11-25');
    expect(d.getDate()).toBe(25);
    expect(d.getHours()).toBe(23);
  });
  it('keeps full timestamps unchanged', () => {
    expect(deadlineOf('2026-11-25T10:00:00Z').toISOString()).toBe('2026-11-25T10:00:00.000Z');
  });
  it('same-day submission is not a missed deadline', () => {
    const r = calculateAssignmentQuality({
      studentId: 's',
      assignments: [{ id: 'a', max_score: 100, due_date: '2026-11-25' }],
      submissions: [{ assignment_id: 'a', student_id: 's', status: 'graded', score: 65, submitted_at: '2026-11-25T12:20:00' }],
    });
    expect(r.missedDeadlines).toBe(0);
  });
});

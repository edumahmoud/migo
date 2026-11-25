export type GradeItemType = 'assignment' | 'quiz';
export type GradeItemStatus = 'graded' | 'submitted' | 'missing' | 'not_taken' | 'hidden';

export interface GradeItem {
  type: GradeItemType;
  id: string;
  title: string;
  /** ISO date used for sorting (due date, submit date or attempt date) */
  date: string | null;
  score: number | null;
  max: number;
  status: GradeItemStatus;
  feedback?: string | null;
}

export interface CourseGrades {
  subjectId: string;
  name: string;
  color: string | null;
  items: GradeItem[];
  earned: number;
  possible: number;
  /** null when nothing is graded yet */
  percent: number | null;
  letter: string | null;
  gradedCount: number;
  totalCount: number;
  quizAvg: number | null;
  assignmentAvg: number | null;
  quizCount: number;
  assignmentCount: number;
}

export function letterGrade(percent: number): string {
  if (percent >= 90) return 'A';
  if (percent >= 80) return 'B';
  if (percent >= 70) return 'C';
  if (percent >= 60) return 'D';
  return 'F';
}

/** Points-based course total (Canvas/Moodle "natural" aggregation): only graded, visible items count. */
export function computeTotals(items: GradeItem[]): { earned: number; possible: number; percent: number | null; letter: string | null; gradedCount: number } {
  let earned = 0;
  let possible = 0;
  let gradedCount = 0;
  for (const it of items) {
    if (it.status === 'graded' && it.score !== null && it.max > 0) {
      earned += it.score;
      possible += it.max;
      gradedCount += 1;
    }
  }
  const percent = possible > 0 ? Math.round((earned / possible) * 1000) / 10 : null;
  return { earned, possible, percent, letter: percent === null ? null : letterGrade(percent), gradedCount };
}

/** Percentage of points earned over the graded items of one type (null when none graded). */
export function typeAverage(items: GradeItem[], type: GradeItemType): number | null {
  return computeTotals(items.filter((i) => i.type === type)).percent;
}

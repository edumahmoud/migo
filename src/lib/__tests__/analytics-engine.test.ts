// =====================================================
// Analytics Engine — Comprehensive Unit Tests
// Tests all calculation functions from performance-calculator.ts
// using bun:test format.
// =====================================================

import { describe, test, expect } from 'bun:test';
import {
  calculateExamPerformance,
  calculateOverallPerformance,
  calculateAttendanceScore,
  calculateAssignmentCompliance,
  calculateAssignmentQuality,
  calculateDisciplineScore,
  calculateGrowthIndex,
  calculateRiskLevel,
  calculatePercentile,
  getPercentileLabel,
  computeCohortAnalytics,
  type StudentPerformanceMetrics,
} from '../performance-calculator';

import {
  ATTENDANCE_POINTS,
  PERFORMANCE_WEIGHTS,
  RISK_THRESHOLDS,
  GROWTH_THRESHOLDS,
  RANKING_BANDS,
  formatGrowthIndex,
  formatGrowthPercentage,
} from '../analytics-config';

// -------------------------------------------------------
// Helper: build a minimal StudentPerformanceMetrics object
// -------------------------------------------------------
function makeMetrics(overrides: Partial<StudentPerformanceMetrics> = {}): StudentPerformanceMetrics {
  return {
    examPerformance: 80,
    attendanceScore: 90,
    assignmentCompliance: 85,
    assignmentQuality: 75,
    overallPerformance: 80,
    performanceLevel: 'good',
    effortScore: 87.5,
    resultScore: 80,
    efficiency: 91.43,
    efficiencyLevel: 'high',
    disciplineScore: 85,
    growthIndex: 1.05,
    growthTrend: 'stable',
    riskLevel: 'healthy',
    riskReasons: [],
    totalEarnedMarks: 160,
    totalPossibleMarks: 200,
    attendedSessions: 9,
    totalSessions: 10,
    completedAssignments: 8,
    totalAssignments: 10,
    totalEarnedPoints: 150,
    totalPossiblePoints: 200,
    lateCount: 1,
    onTimeCount: 8,
    missedDeadlines: 1,
    ...overrides,
  };
}

// =====================================================
// 1. calculateExamPerformance
// =====================================================
describe('calculateExamPerformance', () => {
  test('normal case with mixed scores', () => {
    const scores = [
      { score: 80, total: 100 },
      { score: 45, total: 50 },
      { score: 18, total: 20 },
    ];
    const result = calculateExamPerformance(scores);
    // totalEarned = 80 + 45 + 18 = 143
    // totalPossible = 100 + 50 + 20 = 170
    // value = (143 / 170) * 100 ≈ 84.12
    expect(result.totalEarned).toBe(143);
    expect(result.totalPossible).toBe(170);
    expect(result.value).toBeCloseTo(84.1176, 3);
  });

  test('empty scores array returns 0', () => {
    const result = calculateExamPerformance([]);
    expect(result.value).toBe(0);
    expect(result.totalEarned).toBe(0);
    expect(result.totalPossible).toBe(0);
  });

  test('scores with 0 total returns 0 value', () => {
    const scores = [
      { score: 5, total: 0 },
      { score: 10, total: 0 },
    ];
    const result = calculateExamPerformance(scores);
    expect(result.value).toBe(0);
    expect(result.totalEarned).toBe(15);
    expect(result.totalPossible).toBe(0);
  });

  test('perfect scores', () => {
    const scores = [
      { score: 100, total: 100 },
      { score: 50, total: 50 },
    ];
    const result = calculateExamPerformance(scores);
    expect(result.value).toBe(100);
    expect(result.totalEarned).toBe(150);
    expect(result.totalPossible).toBe(150);
  });

  test('zero scores but non-zero totals', () => {
    const scores = [
      { score: 0, total: 100 },
      { score: 0, total: 50 },
    ];
    const result = calculateExamPerformance(scores);
    expect(result.value).toBe(0);
    expect(result.totalEarned).toBe(0);
    expect(result.totalPossible).toBe(150);
  });

  test('single score entry', () => {
    const result = calculateExamPerformance([{ score: 75, total: 100 }]);
    expect(result.value).toBe(75);
    expect(result.totalEarned).toBe(75);
    expect(result.totalPossible).toBe(100);
  });

  test('large exam weighted more than small quiz', () => {
    // A major exam (score: 90/100) and a small quiz (score: 20/20)
    // Should give 110/120 ≈ 91.67%, NOT average of 90% and 100% = 95%
    const result = calculateExamPerformance([
      { score: 90, total: 100 },
      { score: 20, total: 20 },
    ]);
    expect(result.value).toBeCloseTo(91.6667, 3);
    expect(result.value).toBeLessThan(95); // not a simple average
  });
});

// =====================================================
// 2. calculateOverallPerformance
// =====================================================
describe('calculateOverallPerformance', () => {
  test('all 4 components present — uses full weights', () => {
    const result = calculateOverallPerformance({
      examPerformance: 80,
      attendanceScore: 90,
      assignmentCompliance: 70,
      assignmentQuality: 60,
    });
    // Weighted: (80*35 + 90*20 + 70*15 + 60*30) / 100
    // = (2800 + 1800 + 1050 + 1800) / 100 = 7450 / 100 = 74.5
    expect(result).toBeCloseTo(74.5, 3);
  });

  test('only some components present — auto-normalizes weights', () => {
    const result = calculateOverallPerformance({
      examPerformance: 80,
      attendanceScore: 100,
    });
    // Total weight = 35 + 20 = 55
    // (80*35 + 100*20) / 55 = (2800 + 2000) / 55 ≈ 87.27
    expect(result).toBeCloseTo(87.2727, 3);
  });

  test('no components returns 0', () => {
    const result = calculateOverallPerformance({});
    expect(result).toBe(0);
  });

  test('single component — weight is irrelevant (auto-normalized to 100%)', () => {
    const result = calculateOverallPerformance({
      examPerformance: 75,
    });
    // Only examPerformance with weight 35 → total weight = 35
    // (75 * 35) / 35 = 75
    expect(result).toBe(75);
  });

  test('all components have same value — result equals that value', () => {
    const result = calculateOverallPerformance({
      examPerformance: 85,
      attendanceScore: 85,
      assignmentCompliance: 85,
      assignmentQuality: 85,
    });
    expect(result).toBeCloseTo(85, 5);
  });

  test('component with 0 value is still included in weight calculation', () => {
    const result = calculateOverallPerformance({
      examPerformance: 100,
      assignmentQuality: 0,
    });
    // Total weight = 35 + 30 = 65
    // (100*35 + 0*30) / 65 = 3500 / 65 ≈ 53.85
    expect(result).toBeCloseTo(53.8462, 3);
  });

  test('undefined components are excluded, not treated as 0', () => {
    const withUndefined = calculateOverallPerformance({
      examPerformance: 80,
      attendanceScore: undefined,
      assignmentCompliance: 80,
      assignmentQuality: undefined,
    });
    // Only examPerformance(35) + assignmentCompliance(15) = 50
    // (80*35 + 80*15) / 50 = (2800 + 1200) / 50 = 80
    expect(withUndefined).toBe(80);
  });
});

// =====================================================
// 3. calculateAttendanceScore
// =====================================================
describe('calculateAttendanceScore', () => {
  const sessions = [
    { id: 's1' },
    { id: 's2' },
    { id: 's3' },
    { id: 's4' },
    { id: 's5' },
  ];

  test('all present — perfect score', () => {
    const records = sessions.map(s => ({
      session_id: s.id,
      student_id: 'stu1',
      attendance_status: 'present' as const,
    }));
    const result = calculateAttendanceScore({ sessions, records, studentId: 'stu1' });
    // 5 sessions * 100 points each / 500 max = 100%
    expect(result.value).toBe(100);
    expect(result.attended).toBe(5);
    expect(result.total).toBe(5);
    expect(result.onTimeCount).toBe(5);
    expect(result.lateCount).toBe(0);
  });

  test('mixed present/late/partial/absent', () => {
    const records = [
      { session_id: 's1', student_id: 'stu1', attendance_status: 'present' as const },   // 100 pts
      { session_id: 's2', student_id: 'stu1', attendance_status: 'late' as const },      // 75 pts
      { session_id: 's3', student_id: 'stu1', attendance_status: 'partial' as const },   // 50 pts
      { session_id: 's4', student_id: 'stu1', attendance_status: 'absent' as const },    // 0 pts
      // s5: no record → treated as absent (0 pts)
    ];
    const result = calculateAttendanceScore({ sessions, records, studentId: 'stu1' });
    // totalPoints = 100 + 75 + 50 + 0 + 0 = 225
    // maxPoints = 5 * 100 = 500
    // value = (225 / 500) * 100 = 45
    expect(result.value).toBe(45);
    expect(result.attended).toBe(4); // only records with student_id match
    expect(result.onTimeCount).toBe(1);
    expect(result.lateCount).toBe(1);
  });

  test('no sessions returns 0', () => {
    const result = calculateAttendanceScore({
      sessions: [],
      records: [],
      studentId: 'stu1',
    });
    expect(result.value).toBe(0);
    expect(result.attended).toBe(0);
    expect(result.total).toBe(0);
  });

  test('no records for student — all absent', () => {
    const records = [
      { session_id: 's1', student_id: 'other_student', attendance_status: 'present' as const },
    ];
    const result = calculateAttendanceScore({ sessions, records, studentId: 'stu1' });
    // No records for stu1 → all sessions = absent (0 pts)
    expect(result.value).toBe(0);
    expect(result.attended).toBe(0);
    expect(result.onTimeCount).toBe(0);
    expect(result.lateCount).toBe(0);
  });

  test('all late — 75% score', () => {
    const records = sessions.map(s => ({
      session_id: s.id,
      student_id: 'stu1',
      attendance_status: 'late' as const,
    }));
    const result = calculateAttendanceScore({ sessions, records, studentId: 'stu1' });
    // 5 * 75 = 375 / 500 = 75%
    expect(result.value).toBe(75);
    expect(result.lateCount).toBe(5);
    expect(result.onTimeCount).toBe(0);
  });

  test('all partial — 50% score', () => {
    const records = sessions.map(s => ({
      session_id: s.id,
      student_id: 'stu1',
      attendance_status: 'partial' as const,
    }));
    const result = calculateAttendanceScore({ sessions, records, studentId: 'stu1' });
    // 5 * 50 = 250 / 500 = 50%
    expect(result.value).toBe(50);
  });

  test('absent records still count as attended in the attended count', () => {
    const records = [
      { session_id: 's1', student_id: 'stu1', attendance_status: 'absent' as const },
    ];
    const result = calculateAttendanceScore({ sessions: [{ id: 's1' }], records, studentId: 'stu1' });
    // 'attended' = studentRecords.length = 1 (record exists, even if absent)
    expect(result.attended).toBe(1);
    expect(result.value).toBe(0);
  });

  test('record without attendance_status defaults to present', () => {
    const records = [
      { session_id: 's1', student_id: 'stu1' }, // no attendance_status → defaults to 'present'
    ];
    const result = calculateAttendanceScore({ sessions: [{ id: 's1' }], records, studentId: 'stu1' });
    expect(result.value).toBe(100);
    expect(result.onTimeCount).toBe(1);
  });
});

// =====================================================
// 4. calculateAssignmentCompliance
// =====================================================
describe('calculateAssignmentCompliance', () => {
  // Helper: create assignments with given IDs and due_dates
  const makeAssignments = (specs: Array<{ id: string; due?: string }>) =>
    specs.map(s => ({ id: s.id, due_date: s.due }));

  test('normal case — some submitted, some not (all due)', () => {
    const assignments = makeAssignments([
      { id: 'a1', due: '2024-01-01T00:00:00Z' },
      { id: 'a2', due: '2024-01-02T00:00:00Z' },
      { id: 'a3', due: '2024-01-03T00:00:00Z' },
      { id: 'a4', due: '2024-01-04T00:00:00Z' },
      { id: 'a5', due: '2024-01-05T00:00:00Z' },
    ]);
    const submissions = [
      { assignment_id: 'a1', student_id: 'stu1', status: 'graded' },
      { assignment_id: 'a2', student_id: 'stu1', status: 'submitted' },
      { assignment_id: 'a3', student_id: 'stu1', status: 'draft' },       // not counted
      { assignment_id: 'a1', student_id: 'other', status: 'graded' },   // different student
    ];
    const result = calculateAssignmentCompliance({
      submissions,
      assignments,
      studentId: 'stu1',
    });
    // completed = 2 (graded + submitted), total = 5 (all due)
    // value = (2 / 5) * 100 = 40
    expect(result.value).toBe(40);
    expect(result.completed).toBe(2);
    expect(result.total).toBe(5);
  });

  test('no assignments returns 0 with total=0', () => {
    const result = calculateAssignmentCompliance({
      submissions: [],
      assignments: [],
      studentId: 'stu1',
    });
    expect(result.value).toBe(0);
    expect(result.completed).toBe(0);
    expect(result.total).toBe(0);
  });

  test('all submitted — 100%', () => {
    const assignments = makeAssignments([
      { id: 'a1', due: '2024-01-01T00:00:00Z' },
      { id: 'a2', due: '2024-01-02T00:00:00Z' },
      { id: 'a3', due: '2024-01-03T00:00:00Z' },
    ]);
    const submissions = [
      { assignment_id: 'a1', student_id: 'stu1', status: 'graded' },
      { assignment_id: 'a2', student_id: 'stu1', status: 'submitted' },
      { assignment_id: 'a3', student_id: 'stu1', status: 'graded' },
    ];
    const result = calculateAssignmentCompliance({
      submissions,
      assignments,
      studentId: 'stu1',
    });
    expect(result.value).toBeCloseTo(100, 5);
    expect(result.completed).toBe(3);
  });

  test('none submitted — 0%', () => {
    const assignments = makeAssignments([
      { id: 'a1', due: '2024-01-01T00:00:00Z' },
      { id: 'a2', due: '2024-01-02T00:00:00Z' },
      { id: 'a3', due: '2024-01-03T00:00:00Z' },
      { id: 'a4', due: '2024-01-04T00:00:00Z' },
    ]);
    const submissions = [
      { assignment_id: 'a1', student_id: 'stu1', status: 'draft' },
      { assignment_id: 'a2', student_id: 'stu1', status: 'missing' },
    ];
    const result = calculateAssignmentCompliance({
      submissions,
      assignments,
      studentId: 'stu1',
    });
    expect(result.value).toBe(0);
    expect(result.completed).toBe(0);
  });

  test('submissions from other students are ignored', () => {
    const assignments = makeAssignments([
      { id: 'a1', due: '2024-01-01T00:00:00Z' },
      { id: 'a2', due: '2024-01-02T00:00:00Z' },
    ]);
    const submissions = [
      { assignment_id: 'a1', student_id: 'other', status: 'graded' },
      { assignment_id: 'a2', student_id: 'other', status: 'submitted' },
    ];
    const result = calculateAssignmentCompliance({
      submissions,
      assignments,
      studentId: 'stu1',
    });
    expect(result.value).toBe(0);
    expect(result.completed).toBe(0);
  });

  // ── NEW: Future assignments excluded ──
  test('future assignments excluded from denominator', () => {
    const future = new Date(Date.now() + 86400000).toISOString(); // tomorrow
    const assignments = makeAssignments([
      { id: 'a1', due: '2024-01-01T00:00:00Z' },  // past due
      { id: 'a2', due: future },                    // future — excluded
    ]);
    const submissions = [
      { assignment_id: 'a1', student_id: 'stu1', status: 'graded' },
    ];
    const result = calculateAssignmentCompliance({
      submissions,
      assignments,
      studentId: 'stu1',
    });
    // total = 1 (only a1 is due), completed = 1 → 100%
    expect(result.total).toBe(1);
    expect(result.completed).toBe(1);
    expect(result.value).toBe(100);
  });

  // ── FIX: due_date = null means "no deadline" (excluded from calculations) ──
  // Per project workflow (assignments-tab.tsx): "No due date = active, never expired".
  // Previously the calculator treated null as "due immediately", which unfairly
  // penalised students for optional/practice assignments. Now null assignments
  // are excluded from the denominator entirely.
  test('due_date null excluded from compliance (no deadline = not counted)', () => {
    const assignments = [
      { id: 'a1', due_date: undefined },
      { id: 'a2', due_date: undefined },
    ];
    const submissions = [
      { assignment_id: 'a1', student_id: 'stu1', status: 'graded' },
    ];
    const result = calculateAssignmentCompliance({
      submissions,
      assignments,
      studentId: 'stu1',
    });
    // No assignments have deadlines → total = 0 → compliance undefined (signalled via total=0).
    expect(result.total).toBe(0);
    expect(result.completed).toBe(0);
    expect(result.value).toBe(0);
  });

  // ── NEW: mixed null + past due assignments ──
  test('mixed null and past-due assignments — only past-due counted', () => {
    const assignments = [
      { id: 'a1', due_date: '2024-01-01T00:00:00Z' },  // past due
      { id: 'a2', due_date: undefined },                 // no deadline — excluded
    ];
    const submissions = [
      { assignment_id: 'a1', student_id: 'stu1', status: 'graded' },
    ];
    const result = calculateAssignmentCompliance({
      submissions,
      assignments,
      studentId: 'stu1',
    });
    expect(result.total).toBe(1);  // only a1
    expect(result.completed).toBe(1);
    expect(result.value).toBe(100);
  });

  // ── NEW: returned counts as submitted ──
  test('returned status counts as submitted', () => {
    const assignments = makeAssignments([
      { id: 'a1', due: '2024-01-01T00:00:00Z' },
      { id: 'a2', due: '2024-01-02T00:00:00Z' },
    ]);
    const submissions = [
      { assignment_id: 'a1', student_id: 'stu1', status: 'returned' },
    ];
    const result = calculateAssignmentCompliance({
      submissions,
      assignments,
      studentId: 'stu1',
    });
    expect(result.completed).toBe(1);
    expect(result.value).toBe(50);
  });

  // ── NEW: all future assignments → total=0 ──
  test('all future assignments → total=0', () => {
    const future = new Date(Date.now() + 86400000).toISOString();
    const assignments = makeAssignments([
      { id: 'a1', due: future },
      { id: 'a2', due: future },
    ]);
    const result = calculateAssignmentCompliance({
      submissions: [],
      assignments,
      studentId: 'stu1',
    });
    expect(result.total).toBe(0);
    expect(result.value).toBe(0);
  });
});

// =====================================================
// 5. calculateAssignmentQuality
// =====================================================
describe('calculateAssignmentQuality', () => {
  const assignments = [
    { id: 'a1', max_score: 100, due_date: '2024-01-15T23:59:00Z' },
    { id: 'a2', max_score: 50, due_date: '2024-01-20T23:59:00Z' },
    { id: 'a3', max_score: 25, due_date: undefined },
  ];

  test('normal case — mixed scores', () => {
    const submissions = [
      { assignment_id: 'a1', score: 80, status: 'graded', student_id: 'stu1', submitted_at: '2024-01-14T10:00:00Z' },
      { assignment_id: 'a2', score: 40, status: 'graded', student_id: 'stu1', submitted_at: '2024-01-19T10:00:00Z' },
      { assignment_id: 'a3', score: 20, status: 'graded', student_id: 'stu1', submitted_at: '2024-01-25T10:00:00Z' },
    ];
    const result = calculateAssignmentQuality({ submissions, assignments, studentId: 'stu1' });
    // a3 has no due_date → excluded entirely. Only a1 + a2 count.
    // totalEarned = 80 + 40 = 120
    // totalPossible = 100 + 50 = 150
    // value = (120 / 150) * 100 = 80
    expect(result.value).toBeCloseTo(80, 3);
    expect(result.totalEarned).toBe(120);
    expect(result.totalPossible).toBe(150);
    expect(result.missedDeadlines).toBe(0);
  });

  test('no assignments returns 0', () => {
    const result = calculateAssignmentQuality({
      submissions: [],
      assignments: [],
      studentId: 'stu1',
    });
    expect(result.value).toBe(0);
    expect(result.totalEarned).toBe(0);
    expect(result.totalPossible).toBe(0);
    expect(result.missedDeadlines).toBe(0);
  });

  test('missed deadlines — submitted after due date', () => {
    const submissions = [
      // a1: submitted late
      { assignment_id: 'a1', score: 70, status: 'graded', student_id: 'stu1', submitted_at: '2024-01-16T10:00:00Z' },
      // a2: on time
      { assignment_id: 'a2', score: 45, status: 'graded', student_id: 'stu1', submitted_at: '2024-01-19T10:00:00Z' },
      // a3: no due_date → excluded entirely (no missed-deadline check)
      { assignment_id: 'a3', score: 20, status: 'graded', student_id: 'stu1', submitted_at: '2024-01-25T10:00:00Z' },
    ];
    const result = calculateAssignmentQuality({ submissions, assignments, studentId: 'stu1' });
    // a3 excluded → only a1 + a2 counted.
    expect(result.missedDeadlines).toBe(1); // only a1 was late
    expect(result.totalEarned).toBe(115);   // 70 + 45
    expect(result.totalPossible).toBe(150); // 100 + 50
  });

  test('late submissions — past deadline but still graded', () => {
    const submissions = [
      { assignment_id: 'a1', score: 90, status: 'graded', student_id: 'stu1', submitted_at: '2024-01-20T10:00:00Z' },
      { assignment_id: 'a2', score: 50, status: 'submitted', student_id: 'stu1', submitted_at: '2024-01-25T10:00:00Z' },
    ];
    const result = calculateAssignmentQuality({ submissions, assignments, studentId: 'stu1' });
    // a1: late (submitted 20th, due 15th) — graded, contributes to quality
    // a2: late (submitted 25th, due 20th) — submitted but ungraded, does NOT contribute to quality
    // a3: no due_date → excluded entirely (not counted as missed, not in possible)
    expect(result.missedDeadlines).toBe(2); // a1 late, a2 late
    expect(result.totalEarned).toBe(90);    // only a1's graded score
    expect(result.totalPossible).toBe(100); // only a1, NOT a2 (ungraded) or a3 (no deadline)
  });

  test('unsubmitted assignment with past due_date counts as missed deadline', () => {
    // Use assignments with past due dates and no submissions
    const pastAssignments = [
      { id: 'a1', max_score: 100, due_date: '2020-01-15T23:59:00Z' },
    ];
    const result = calculateAssignmentQuality({
      submissions: [],
      assignments: pastAssignments,
      studentId: 'stu1',
    });
    // No submission for a1 → else branch → due_date is past → missedDeadlines++
    expect(result.missedDeadlines).toBe(1);
    expect(result.totalPossible).toBe(100);
    expect(result.totalEarned).toBe(0);
    expect(result.value).toBe(0);
  });

  // FIX: null score on graded submission is now excluded (not treated as 0)
  test('null score on graded submission excluded from quality', () => {
    const submissions = [
      { assignment_id: 'a1', score: null, status: 'graded', student_id: 'stu1', submitted_at: '2024-01-14T10:00:00Z' },
    ];
    const result = calculateAssignmentQuality({ submissions, assignments, studentId: 'stu1' });
    // a1: graded but score is null → excluded from quality (not earned=0, not in possible)
    // a2: no submission → missed + possible
    // a3: no due_date → excluded entirely
    expect(result.totalEarned).toBe(0);
    expect(result.totalPossible).toBe(50); // only a2, NOT a1 (null) or a3 (no deadline)
  });

  test('draft status submissions are not counted', () => {
    const submissions = [
      { assignment_id: 'a1', score: 80, status: 'draft', student_id: 'stu1', submitted_at: '2024-01-14T10:00:00Z' },
    ];
    const result = calculateAssignmentQuality({ submissions, assignments, studentId: 'stu1' });
    // a1: draft → goes to else branch (not graded/submitted)
    // a3: no due_date → excluded
    expect(result.totalEarned).toBe(0);
    // totalPossible counts only a1 + a2 (a3 excluded due to no due_date)
    expect(result.totalPossible).toBe(150);
  });

  // ── NEW: submitted but ungraded excluded from quality ──
  test('submitted but ungraded excluded from quality numerator and denominator', () => {
    const pastAssignments = [
      { id: 'a1', max_score: 100, due_date: '2024-01-15T23:59:00Z' },
      { id: 'a2', max_score: 50, due_date: '2024-01-20T23:59:00Z' },
    ];
    const submissions = [
      { assignment_id: 'a1', score: 80, status: 'graded', student_id: 'stu1', submitted_at: '2024-01-14T10:00:00Z' },
      { assignment_id: 'a2', score: null, status: 'submitted', student_id: 'stu1', submitted_at: '2024-01-19T10:00:00Z' },
    ];
    const result = calculateAssignmentQuality({ submissions, assignments: pastAssignments, studentId: 'stu1' });
    // a1: graded → earned=80, possible=100
    // a2: submitted but ungraded → excluded from both earned and possible
    expect(result.totalEarned).toBe(80);
    expect(result.totalPossible).toBe(100); // only a1, NOT a2
    expect(result.value).toBe(80);
  });

  // ── NEW: returned excluded from quality ──
  test('returned status excluded from quality', () => {
    const pastAssignments = [
      { id: 'a1', max_score: 100, due_date: '2024-01-15T23:59:00Z' },
      { id: 'a2', max_score: 50, due_date: '2024-01-20T23:59:00Z' },
    ];
    const submissions = [
      { assignment_id: 'a1', score: 80, status: 'graded', student_id: 'stu1', submitted_at: '2024-01-14T10:00:00Z' },
      { assignment_id: 'a2', score: 40, status: 'returned', student_id: 'stu1', submitted_at: '2024-01-19T10:00:00Z' },
    ];
    const result = calculateAssignmentQuality({ submissions, assignments: pastAssignments, studentId: 'stu1' });
    // a1: graded → earned=80, possible=100
    // a2: returned → excluded from quality (no graded score)
    expect(result.totalEarned).toBe(80);
    expect(result.totalPossible).toBe(100); // only a1
    expect(result.value).toBe(80);
  });

  // ── NEW: graded with score=0 is a genuine zero ──
  test('graded with score 0 is genuine zero (not excluded)', () => {
    const pastAssignments = [
      { id: 'a1', max_score: 100, due_date: '2024-01-15T23:59:00Z' },
    ];
    const submissions = [
      { assignment_id: 'a1', score: 0, status: 'graded', student_id: 'stu1', submitted_at: '2024-01-14T10:00:00Z' },
    ];
    const result = calculateAssignmentQuality({ submissions, assignments: pastAssignments, studentId: 'stu1' });
    expect(result.totalEarned).toBe(0);
    expect(result.totalPossible).toBe(100);
    expect(result.value).toBe(0); // genuine zero, not missing data
  });

  // ── NEW: future assignments excluded from quality ──
  test('future assignments excluded from quality', () => {
    const future = new Date(Date.now() + 86400000).toISOString();
    const mixedAssignments = [
      { id: 'a1', max_score: 100, due_date: '2024-01-15T23:59:00Z' },  // past
      { id: 'a2', max_score: 50, due_date: future },                     // future
    ];
    const submissions = [
      { assignment_id: 'a1', score: 80, status: 'graded', student_id: 'stu1', submitted_at: '2024-01-14T10:00:00Z' },
    ];
    const result = calculateAssignmentQuality({ submissions, assignments: mixedAssignments, studentId: 'stu1' });
    // a1: graded → earned=80, possible=100
    // a2: future → excluded entirely
    expect(result.totalEarned).toBe(80);
    expect(result.totalPossible).toBe(100);
    expect(result.value).toBe(80);
  });

  // ── NEW: no due assignments → value=0, totalPossible=0 ──
  test('no due assignments → totalPossible=0', () => {
    const future = new Date(Date.now() + 86400000).toISOString();
    const allFuture = [
      { id: 'a1', max_score: 100, due_date: future },
    ];
    const result = calculateAssignmentQuality({ submissions: [], assignments: allFuture, studentId: 'stu1' });
    expect(result.totalPossible).toBe(0);
    expect(result.totalEarned).toBe(0);
    expect(result.value).toBe(0);
  });
});

// =====================================================
// 6. calculateDisciplineScore
// =====================================================
describe('calculateDisciplineScore', () => {
  test('perfect discipline — all on time, no lates, no missed deadlines', () => {
    const result = calculateDisciplineScore({
      attendanceScore: 100,
      lateCount: 0,
      totalSessions: 10,
      onTimeSubmissions: 5,
      totalAssignments: 5,
      missedDeadlines: 0,
    });
    // attendanceComponent = 100 - 0 = 100
    // onTimeRate = (5/5)*100 = 100
    // deadlineRespect = max(0, 100 - 0) = 100
    // discipline = 100*0.4 + 100*0.4 + 100*0.2 = 40 + 40 + 20 = 100
    expect(result).toBe(100);
  });

  test('poor discipline — late arrivals and missed deadlines', () => {
    const result = calculateDisciplineScore({
      attendanceScore: 60,
      lateCount: 4,
      totalSessions: 10,
      onTimeSubmissions: 2,
      totalAssignments: 5,
      missedDeadlines: 3,
    });
    // latePenalty = (4/10) * 20 = 8
    // attendanceComponent = max(0, 60 - 8) = 52
    // onTimeRate = (2/5)*100 = 40
    // deadlineRespect = max(0, 100 - (3/5)*100) = max(0, 100-60) = 40
    // discipline = 52*0.4 + 40*0.4 + 40*0.2 = 20.8 + 16 + 8 = 44.8
    expect(result).toBeCloseTo(44.8, 3);
  });

  test('no sessions and no assignments — defaults to 100', () => {
    const result = calculateDisciplineScore({
      attendanceScore: 100,
      lateCount: 0,
      totalSessions: 0,
      onTimeSubmissions: 0,
      totalAssignments: 0,
      missedDeadlines: 0,
    });
    // latePenalty = 0 (totalSessions is 0)
    // attendanceComponent = 100 - 0 = 100
    // onTimeRate = 100 (default when no assignments)
    // deadlineRespect = 100 (default when no assignments)
    // discipline = 100*0.4 + 100*0.4 + 100*0.2 = 100
    expect(result).toBe(100);
  });

  test('late penalty capped at 0 for attendance component', () => {
    const result = calculateDisciplineScore({
      attendanceScore: 10,
      lateCount: 10,
      totalSessions: 10,
      onTimeSubmissions: 5,
      totalAssignments: 5,
      missedDeadlines: 0,
    });
    // latePenalty = (10/10) * 20 = 20
    // attendanceComponent = max(0, 10 - 20) = 0 (not negative)
    // onTimeRate = (5/5)*100 = 100
    // deadlineRespect = 100
    // discipline = 0*0.4 + 100*0.4 + 100*0.2 = 0 + 40 + 20 = 60
    expect(result).toBeCloseTo(60, 3);
  });

  test('only late arrivals affect discipline', () => {
    const result = calculateDisciplineScore({
      attendanceScore: 80,
      lateCount: 5,
      totalSessions: 10,
      onTimeSubmissions: 5,
      totalAssignments: 5,
      missedDeadlines: 0,
    });
    // latePenalty = (5/10) * 20 = 10
    // attendanceComponent = 80 - 10 = 70
    // onTimeRate = 100
    // deadlineRespect = 100
    // discipline = 70*0.4 + 100*0.4 + 100*0.2 = 28 + 40 + 20 = 88
    expect(result).toBeCloseTo(88, 3);
  });

  test('only missed deadlines affect discipline', () => {
    const result = calculateDisciplineScore({
      attendanceScore: 100,
      lateCount: 0,
      totalSessions: 10,
      onTimeSubmissions: 5,
      totalAssignments: 5,
      missedDeadlines: 5,
    });
    // attendanceComponent = 100
    // onTimeRate = 100
    // deadlineRespect = max(0, 100 - (5/5)*100) = 0
    // discipline = 100*0.4 + 100*0.4 + 0*0.2 = 40 + 40 + 0 = 80
    expect(result).toBeCloseTo(80, 3);
  });

  test('all deadlines missed reduces discipline significantly', () => {
    const result = calculateDisciplineScore({
      attendanceScore: 50,
      lateCount: 3,
      totalSessions: 10,
      onTimeSubmissions: 0,
      totalAssignments: 5,
      missedDeadlines: 5,
    });
    // latePenalty = (3/10)*20 = 6
    // attendanceComponent = max(0, 50-6) = 44
    // onTimeRate = (0/5)*100 = 0
    // deadlineRespect = max(0, 100-100) = 0
    // discipline = 44*0.4 + 0*0.4 + 0*0.2 = 17.6
    expect(result).toBeCloseTo(17.6, 3);
  });
});

// =====================================================
// 7. calculateGrowthIndex
// =====================================================
describe('calculateGrowthIndex', () => {
  test('improving trend', () => {
    const scores = [
      { completed_at: '2024-01-01T00:00:00Z', score: 40, total: 100 },
      { completed_at: '2024-02-01T00:00:00Z', score: 60, total: 100 },
      { completed_at: '2024-03-01T00:00:00Z', score: 80, total: 100 },
      { completed_at: '2024-04-01T00:00:00Z', score: 90, total: 100 },
      { completed_at: '2024-05-01T00:00:00Z', score: 95, total: 100 },
      { completed_at: '2024-06-01T00:00:00Z', score: 100, total: 100 },
    ];
    const result = calculateGrowthIndex(scores);
    // 6 scores, third = max(1, floor(6/3)) = 2
    // earliest: first 2 → avg(40%, 60%) = 50%
    // recent: last 2 → avg(95%, 100%) = 97.5%
    // index = 97.5 / 50 = 1.95 → improving (>= 1.1)
    expect(result.index).toBeCloseTo(1.95, 2);
    expect(result.trend).toBe('improving');
    expect(result.earliestAvg).toBeCloseTo(50, 3);
    expect(result.recentAvg).toBeCloseTo(97.5, 3);
    expect(result.improvementPercentage).toBeCloseTo(95, 1);
  });

  test('stable trend', () => {
    const scores = [
      { completed_at: '2024-01-01T00:00:00Z', score: 70, total: 100 },
      { completed_at: '2024-02-01T00:00:00Z', score: 75, total: 100 },
      { completed_at: '2024-03-01T00:00:00Z', score: 72, total: 100 },
    ];
    const result = calculateGrowthIndex(scores);
    // 3 scores, third = max(1, floor(3/3)) = 1
    // earliest: [70%] → 70%
    // recent: [72%] → 72%
    // index = 72 / 70 ≈ 1.0286 → stable (>= 0.9 and < 1.1)
    expect(result.index).toBeCloseTo(1.0286, 3);
    expect(result.trend).toBe('stable');
  });

  test('declining trend', () => {
    const scores = [
      { completed_at: '2024-01-01T00:00:00Z', score: 90, total: 100 },
      { completed_at: '2024-02-01T00:00:00Z', score: 80, total: 100 },
      { completed_at: '2024-03-01T00:00:00Z', score: 60, total: 100 },
    ];
    const result = calculateGrowthIndex(scores);
    // third = 1
    // earliest: [90%] = 90%
    // recent: [60%] = 60%
    // index = 60/90 ≈ 0.667 → declining (< 0.9)
    expect(result.index).toBeCloseTo(0.6667, 3);
    expect(result.trend).toBe('declining');
  });

  test('less than 2 scores returns stable', () => {
    const result0 = calculateGrowthIndex([]);
    expect(result0.index).toBe(1);
    expect(result0.trend).toBe('stable');
    expect(result0.recentAvg).toBe(0);
    expect(result0.earliestAvg).toBe(0);
    expect(result0.improvementPercentage).toBe(0);

    const result1 = calculateGrowthIndex([
      { completed_at: '2024-01-01T00:00:00Z', score: 80, total: 100 },
    ]);
    expect(result1.index).toBe(1);
    expect(result1.trend).toBe('stable');
  });

  test('edge case with 0 earliest avg but positive recent avg — absolute improvement', () => {
    const scores = [
      { completed_at: '2024-01-01T00:00:00Z', score: 0, total: 100 },
      { completed_at: '2024-02-01T00:00:00Z', score: 0, total: 100 },
      { completed_at: '2024-03-01T00:00:00Z', score: 50, total: 100 },
    ];
    const result = calculateGrowthIndex(scores);
    // third = 1
    // earliest: [0%] = 0
    // recent: [50%] = 50
    // earliestAvg = 0, recentAvg > 0 → ratio undefined (div by zero).
    // FIX: index = null, improvementPercentage = null, trend = 'improving'.
    // UI should render "تحسن مطلق" with point difference (recentAvg - earliestAvg = 50).
    expect(result.index).toBeNull();
    expect(result.trend).toBe('improving');
    expect(result.improvementPercentage).toBeNull();
    expect(result.recentAvg).toBe(50);
    expect(result.earliestAvg).toBe(0);
  });

  test('edge case with 0 earliest avg and 0 recent avg', () => {
    const scores = [
      { completed_at: '2024-01-01T00:00:00Z', score: 0, total: 100 },
      { completed_at: '2024-02-01T00:00:00Z', score: 0, total: 100 },
      { completed_at: '2024-03-01T00:00:00Z', score: 0, total: 100 },
    ];
    const result = calculateGrowthIndex(scores);
    // earliestAvg = 0, recentAvg = 0 → no change. index = 1 (conventional).
    expect(result.index).toBe(1);
    expect(result.trend).toBe('stable');
  });

  test('scores are sorted by completed_at before analysis', () => {
    const scores = [
      { completed_at: '2024-06-01T00:00:00Z', score: 95, total: 100 },
      { completed_at: '2024-01-01T00:00:00Z', score: 40, total: 100 },
      { completed_at: '2024-03-01T00:00:00Z', score: 60, total: 100 },
    ];
    const result = calculateGrowthIndex(scores);
    // After sorting: Jan(40%), Mar(60%), Jun(95%)
    // third = 1
    // earliest: [40%] = 40
    // recent: [95%] = 95
    // index = 95/40 = 2.375 → improving
    expect(result.index).toBeCloseTo(2.375, 3);
    expect(result.trend).toBe('improving');
  });

  test('exactly 2 scores — one earliest, one recent', () => {
    const scores = [
      { completed_at: '2024-01-01T00:00:00Z', score: 50, total: 100 },
      { completed_at: '2024-02-01T00:00:00Z', score: 80, total: 100 },
    ];
    const result = calculateGrowthIndex(scores);
    // third = max(1, floor(2/3)) = 1
    // earliest: [50%] = 50
    // recent: [80%] = 80
    // index = 80/50 = 1.6 → improving
    expect(result.index).toBeCloseTo(1.6, 3);
    expect(result.trend).toBe('improving');
  });

  test('score with 0 total is handled gracefully', () => {
    const scores = [
      { completed_at: '2024-01-01T00:00:00Z', score: 0, total: 0 },
      { completed_at: '2024-02-01T00:00:00Z', score: 80, total: 100 },
      { completed_at: '2024-03-01T00:00:00Z', score: 90, total: 100 },
    ];
    const result = calculateGrowthIndex(scores);
    // third = 1
    // earliest: [0/0 → 0%] = 0
    // recent: [90%] = 90
    // earliestAvg = 0, recentAvg > 0 → ratio undefined. index = null.
    expect(result.index).toBeNull();
    expect(result.trend).toBe('improving');
  });

  // ── NEW: Verify NO Infinity / NaN leaks into the result ──
  test('zero-baseline improvement never returns Infinity or NaN', () => {
    const scores = [
      { completed_at: '2024-01-01T00:00:00Z', score: 0, total: 100 },
      { completed_at: '2024-02-01T00:00:00Z', score: 0, total: 100 },
      { completed_at: '2024-03-01T00:00:00Z', score: 100, total: 100 },
    ];
    const result = calculateGrowthIndex(scores);
    expect(Number.isFinite(result.index as number)).toBe(false); // null is not finite
    expect(result.index).toBeNull();                              // but it's null, not Infinity
    expect(result.improvementPercentage).toBeNull();
    // No "Infinity" string would be produced by .toFixed():
    expect(String(result.index)).toBe('null');
    expect(String(result.improvementPercentage)).toBe('null');
  });

  // ── NEW: improvementPercentage is null when baseline is 0 ──
  test('improvementPercentage is null when baseline is 0 (not 0, not 100, not Infinity)', () => {
    const scores = [
      { completed_at: '2024-01-01T00:00:00Z', score: 0, total: 100 },
      { completed_at: '2024-02-01T00:00:00Z', score: 0, total: 100 },
      { completed_at: '2024-03-01T00:00:00Z', score: 30, total: 100 },
    ];
    const result = calculateGrowthIndex(scores);
    expect(result.improvementPercentage).toBeNull();
    expect(result.index).toBeNull();
    expect(result.trend).toBe('improving');
    // The UI can use recentAvg - earliestAvg = 30 as the absolute point gain.
    expect(result.recentAvg - result.earliestAvg).toBe(30);
  });

  // ── NEW: large recent value with zero baseline still null ──
  test('large recent value with zero baseline still returns null (no Infinity)', () => {
    const scores = [
      { completed_at: '2024-01-01T00:00:00Z', score: 0, total: 100 },
      { completed_at: '2024-02-01T00:00:00Z', score: 0, total: 100 },
      { completed_at: '2024-03-01T00:00:00Z', score: 100, total: 100 },
      { completed_at: '2024-04-01T00:00:00Z', score: 100, total: 100 },
      { completed_at: '2024-05-01T00:00:00Z', score: 100, total: 100 },
      { completed_at: '2024-06-01T00:00:00Z', score: 100, total: 100 },
    ];
    const result = calculateGrowthIndex(scores);
    expect(result.index).toBeNull();
    expect(result.improvementPercentage).toBeNull();
    expect(result.trend).toBe('improving');
  });

  // ── NEW: normal ratio path still works (no regression) ──
  test('normal ratio path returns finite index and percentage', () => {
    const scores = [
      { completed_at: '2024-01-01T00:00:00Z', score: 50, total: 100 },
      { completed_at: '2024-02-01T00:00:00Z', score: 50, total: 100 },
      { completed_at: '2024-03-01T00:00:00Z', score: 75, total: 100 },
    ];
    const result = calculateGrowthIndex(scores);
    expect(result.index).toBe(1.5);
    expect(result.improvementPercentage).toBe(50);
    expect(result.trend).toBe('improving');
    expect(Number.isFinite(result.index as number)).toBe(true);
  });
});

// =====================================================
// 7b. formatGrowthIndex / formatGrowthPercentage (UI display helpers)
// These helpers prevent "Infinity" from leaking into the UI when
// `calculateGrowthIndex` returns null for the zero-baseline case.
// =====================================================
describe('formatGrowthIndex', () => {
  test('null index with improving trend → "تحسن مطلق" (ar)', () => {
    expect(formatGrowthIndex(null, 'improving', 2, 'ar')).toBe('تحسن مطلق');
  });

  test('null index with improving trend → "Absolute" (en)', () => {
    expect(formatGrowthIndex(null, 'improving', 2, 'en')).toBe('Absolute');
  });

  test('null index with stable trend → "—" (no fabricated value)', () => {
    expect(formatGrowthIndex(null, 'stable', 2, 'en')).toBe('—');
    expect(formatGrowthIndex(null, 'stable', 2, 'ar')).toBe('—');
  });

  test('null index with declining trend → "—" (no fabricated value)', () => {
    expect(formatGrowthIndex(null, 'declining', 2, 'en')).toBe('—');
  });

  test('numeric index → toFixed(digits)', () => {
    expect(formatGrowthIndex(1.5, 'improving', 2, 'en')).toBe('1.50');
    expect(formatGrowthIndex(1.5, 'improving', 1, 'en')).toBe('1.5');
    expect(formatGrowthIndex(0.95, 'stable', 2, 'en')).toBe('0.95');
  });

  test('default digits = 2, default locale = en', () => {
    expect(formatGrowthIndex(1.234, 'improving')).toBe('1.23');
    expect(formatGrowthIndex(null, 'improving')).toBe('Absolute');
  });

  test('never returns "Infinity" string', () => {
    // This is the core regression test: even if some upstream code passed
    // Infinity by mistake, the helper would just call .toFixed on it.
    // But since calculateGrowthIndex now returns null instead of Infinity,
    // the realistic path is null → "تحسن مطلق" / "Absolute".
    expect(formatGrowthIndex(null, 'improving', 2, 'en')).not.toBe('Infinity');
    expect(formatGrowthIndex(null, 'improving', 2, 'ar')).not.toBe('Infinity');
    expect(formatGrowthIndex(null, 'stable', 2, 'en')).not.toBe('Infinity');
  });
});

describe('formatGrowthPercentage', () => {
  test('null index with improving trend → "تحسن مطلق" (ar)', () => {
    expect(formatGrowthPercentage(null, 'improving', 'ar')).toBe('تحسن مطلق');
  });

  test('null index with improving trend → "Absolute" (en)', () => {
    expect(formatGrowthPercentage(null, 'improving', 'en')).toBe('Absolute');
  });

  test('null index with stable trend → "—" (no fabricated value)', () => {
    expect(formatGrowthPercentage(null, 'stable', 'en')).toBe('—');
  });

  test('numeric index → percentage with arrow', () => {
    // index = 1.5 → 50% improving ↑
    expect(formatGrowthPercentage(1.5, 'improving', 'en')).toBe('50% ↑');
    // index = 0.8 → 20% declining ↓
    expect(formatGrowthPercentage(0.8, 'declining', 'en')).toBe('20% ↓');
    // index = 1.0 → 0% stable →
    expect(formatGrowthPercentage(1.0, 'stable', 'en')).toBe('0% →');
  });

  test('never returns "Infinity%" string', () => {
    expect(formatGrowthPercentage(null, 'improving', 'en')).not.toBe('Infinity%');
    expect(formatGrowthPercentage(null, 'improving', 'ar')).not.toBe('Infinity%');
  });
});

// =====================================================
// 7c. CSV / export safety: growthIndex never produces "Infinity"
// Simulates what teacher-dashboard CSV export does when growthIndex is null.
// =====================================================
describe('CSV export safety with null growthIndex', () => {
  test('null growthIndex produces "N/A" (en) / "تحسن مطلق" (ar), never "Infinity"', () => {
    const metrics = { growthIndex: null as number | null, growthTrend: 'improving' as const };
    const enCsvValue = metrics.growthIndex !== null
      ? metrics.growthIndex.toFixed(2)
      : 'N/A';
    const arCsvValue = metrics.growthIndex !== null
      ? metrics.growthIndex.toFixed(2)
      : 'تحسن مطلق';
    expect(enCsvValue).toBe('N/A');
    expect(arCsvValue).toBe('تحسن مطلق');
    expect(enCsvValue).not.toBe('Infinity');
    expect(arCsvValue).not.toBe('Infinity');
  });

  test('numeric growthIndex produces numeric string', () => {
    const metrics = { growthIndex: 1.5, growthTrend: 'improving' as const };
    const csvValue = metrics.growthIndex !== null
      ? metrics.growthIndex.toFixed(2)
      : 'N/A';
    expect(csvValue).toBe('1.50');
  });
});

// =====================================================
// 8. calculateRiskLevel
// =====================================================
describe('calculateRiskLevel', () => {
  test('healthy student — good attendance and performance', () => {
    const result = calculateRiskLevel({
      attendanceScore: 95,
      overallPerformance: 85,
      missedLastThreeAssignments: false,
      growthTrend: 'stable',
      daysSinceLastActivity: null,
    });
    expect(result.level).toBe('healthy');
    expect(result.reasons).toEqual([]);
    expect(result.score).toBe(0);
  });

  test('at-risk student — low attendance + low performance', () => {
    const result = calculateRiskLevel({
      attendanceScore: 40,  // < 50 → critical +3
      overallPerformance: 50, // < 60 → critical +3
      missedLastThreeAssignments: false,
      growthTrend: 'declining', // +2
      daysSinceLastActivity: null,
    });
    // score = 3 + 3 + 2 = 8 ≥ 6 → atRisk
    expect(result.level).toBe('atRisk');
    expect(result.reasons).toContain('attendanceBelow50');
    expect(result.reasons).toContain('performanceBelow60');
    expect(result.reasons).toContain('decliningTrend');
    expect(result.score).toBe(8);
  });

  test('monitor level — single warning trigger', () => {
    const result = calculateRiskLevel({
      attendanceScore: 65,  // < 70 → warning +1
      overallPerformance: 85,
      missedLastThreeAssignments: false,
      growthTrend: 'stable',
      daysSinceLastActivity: null,
    });
    // score = 1 ≥ 2? No. Score = 1 → healthy actually
    // Wait: monitor threshold is >= 2. Score is 1. So it's healthy.
    expect(result.level).toBe('healthy');
    expect(result.score).toBe(1);
    expect(result.reasons).toContain('attendanceBelow70');
  });

  test('concern level — multiple warning triggers', () => {
    const result = calculateRiskLevel({
      attendanceScore: 65,  // < 70 → warning +1
      overallPerformance: 65, // < 70 → warning +1
      missedLastThreeAssignments: true, // +2
      growthTrend: 'stable',
      daysSinceLastActivity: null,
    });
    // score = 1 + 1 + 2 = 4 → concern
    expect(result.level).toBe('concern');
    expect(result.score).toBe(4);
    expect(result.reasons).toContain('attendanceBelow70');
    expect(result.reasons).toContain('performanceBelow70');
    expect(result.reasons).toContain('missedLast3Assignments');
  });

  test('monitor level — score at exactly 2', () => {
    const result = calculateRiskLevel({
      attendanceScore: 65,  // < 70 → +1
      overallPerformance: 65, // < 70 → +1
      missedLastThreeAssignments: false,
      growthTrend: 'stable',
      daysSinceLastActivity: null,
    });
    // score = 1 + 1 = 2 → monitor
    expect(result.level).toBe('monitor');
    expect(result.score).toBe(2);
  });

  test('inactivity trigger adds to risk score', () => {
    const result = calculateRiskLevel({
      attendanceScore: 80,
      overallPerformance: 80,
      missedLastThreeAssignments: false,
      growthTrend: 'stable',
      daysSinceLastActivity: 20, // > 14 → +2
    });
    // score = 2 → monitor
    expect(result.level).toBe('monitor');
    expect(result.reasons).toContain('inactivity');
    expect(result.score).toBe(2);
  });

  test('custom inactivityThreshold overrides default', () => {
    const result = calculateRiskLevel({
      attendanceScore: 80,
      overallPerformance: 80,
      missedLastThreeAssignments: false,
      growthTrend: 'stable',
      daysSinceLastActivity: 10,
      inactivityThreshold: 7, // 10 > 7 → inactivity
    });
    expect(result.reasons).toContain('inactivity');
    expect(result.score).toBe(2);
  });

  test('null daysSinceLastActivity does not trigger inactivity', () => {
    const result = calculateRiskLevel({
      attendanceScore: 90,
      overallPerformance: 90,
      missedLastThreeAssignments: false,
      growthTrend: 'stable',
      daysSinceLastActivity: null,
    });
    expect(result.reasons).not.toContain('inactivity');
    expect(result.level).toBe('healthy');
  });

  test('atRisk with all risk factors', () => {
    const result = calculateRiskLevel({
      attendanceScore: 30,  // < 50 → +3
      overallPerformance: 40, // < 60 → +3
      missedLastThreeAssignments: true, // +2
      growthTrend: 'declining', // +2
      daysSinceLastActivity: 30, // > 14 → +2
    });
    // score = 3 + 3 + 2 + 2 + 2 = 12 → atRisk
    expect(result.level).toBe('atRisk');
    expect(result.score).toBe(12);
    expect(result.reasons.length).toBe(5);
  });

  test('attendance exactly at threshold boundary — no warning', () => {
    const result = calculateRiskLevel({
      attendanceScore: 70, // exactly 70 → NOT < 70, no warning
      overallPerformance: 70, // exactly 70 → NOT < 70, no warning
      missedLastThreeAssignments: false,
      growthTrend: 'stable',
      daysSinceLastActivity: null,
    });
    expect(result.level).toBe('healthy');
    expect(result.score).toBe(0);
  });
});

// =====================================================
// 9. calculatePercentile & getPercentileLabel
// =====================================================
describe('calculatePercentile', () => {
  test('top 5% — score higher than 95% of cohort', () => {
    const allScores = [50, 60, 70, 80, 90, 92, 94, 95, 96, 97];
    const percentile = calculatePercentile(97, allScores);
    // below = scores < 97 = 9 out of 10 → 90%
    expect(percentile).toBe(90);
  });

  test('top 10% — score in 90th+ percentile', () => {
    const allScores = [40, 50, 60, 70, 75, 80, 85, 90, 92, 95];
    const percentile = calculatePercentile(92, allScores);
    // below = 8 out of 10 → 80%
    expect(percentile).toBe(80);
  });

  test('top 25% — score in 75th+ percentile', () => {
    const allScores = [30, 40, 50, 60, 70, 75, 80, 85, 90, 95];
    const percentile = calculatePercentile(80, allScores);
    // below = 6 out of 10 → 60%
    expect(percentile).toBe(60);
  });

  test('below 50% — low score', () => {
    const allScores = [30, 40, 50, 60, 70, 75, 80, 85, 90, 95];
    const percentile = calculatePercentile(40, allScores);
    // below = 1 out of 10 → 10%
    expect(percentile).toBe(10);
  });

  test('empty array returns 0', () => {
    const percentile = calculatePercentile(80, []);
    expect(percentile).toBe(0);
  });

  test('lowest score in cohort', () => {
    const allScores = [30, 50, 70, 90];
    const percentile = calculatePercentile(30, allScores);
    // below = 0 out of 4 → 0%
    expect(percentile).toBe(0);
  });

  test('highest score in cohort', () => {
    const allScores = [30, 50, 70, 90];
    const percentile = calculatePercentile(90, allScores);
    // below = 3 out of 4 → 75%
    expect(percentile).toBe(75);
  });

  test('equal scores are not counted as "below"', () => {
    const allScores = [80, 80, 80, 80];
    const percentile = calculatePercentile(80, allScores);
    // below = 0 (no score is strictly < 80)
    expect(percentile).toBe(0);
  });

  test('single element array', () => {
    expect(calculatePercentile(50, [50])).toBe(0);
    expect(calculatePercentile(100, [50])).toBe(100);
  });
});

describe('getPercentileLabel', () => {
  test('top5 label — percentile >= 95', () => {
    expect(getPercentileLabel(95)).toBe('top5');
    expect(getPercentileLabel(99)).toBe('top5');
    expect(getPercentileLabel(100)).toBe('top5');
  });

  test('top10 label — percentile >= 90 and < 95', () => {
    expect(getPercentileLabel(90)).toBe('top10');
    expect(getPercentileLabel(94.99)).toBe('top10');
  });

  test('top25 label — percentile >= 75 and < 90', () => {
    expect(getPercentileLabel(75)).toBe('top25');
    expect(getPercentileLabel(89.99)).toBe('top25');
  });

  test('top50 label — percentile >= 50 and < 75', () => {
    expect(getPercentileLabel(50)).toBe('top50');
    expect(getPercentileLabel(74.99)).toBe('top50');
  });

  test('below50 label — percentile < 50', () => {
    expect(getPercentileLabel(0)).toBe('below50');
    expect(getPercentileLabel(49.99)).toBe('below50');
  });
});

// =====================================================
// 10. computeCohortAnalytics
// =====================================================
describe('computeCohortAnalytics', () => {
  test('empty array returns zeroed analytics', () => {
    const result = computeCohortAnalytics([]);
    expect(result.totalStudents).toBe(0);
    expect(result.avgPerformance).toBe(0);
    expect(result.avgAttendance).toBe(0);
    expect(result.avgDiscipline).toBe(0);
    expect(result.avgEfficiency).toBe(0);
    expect(result.performanceDistribution).toEqual({
      excellent: 0, veryGood: 0, good: 0, acceptable: 0, weak: 0,
    });
    expect(result.riskDistribution).toEqual({
      healthy: 0, monitor: 0, concern: 0, atRisk: 0,
    });
    expect(result.growthDistribution).toEqual({
      improving: 0, stable: 0, declining: 0,
    });
    expect(result.disciplineDistribution).toEqual({
      high: 0, medium: 0, low: 0,
    });
    expect(result.atRiskCount).toBe(0);
    expect(result.topPerformerCount).toBe(0);
  });

  test('normal distribution across levels', () => {
    const metrics: StudentPerformanceMetrics[] = [
      makeMetrics({ performanceLevel: 'excellent', overallPerformance: 95, attendanceScore: 95, disciplineScore: 95, efficiency: 90, riskLevel: 'healthy', growthTrend: 'improving' }),
      makeMetrics({ performanceLevel: 'veryGood', overallPerformance: 85, attendanceScore: 85, disciplineScore: 85, efficiency: 80, riskLevel: 'healthy', growthTrend: 'stable' }),
      makeMetrics({ performanceLevel: 'good', overallPerformance: 75, attendanceScore: 75, disciplineScore: 75, efficiency: 60, riskLevel: 'monitor', growthTrend: 'stable' }),
      makeMetrics({ performanceLevel: 'acceptable', overallPerformance: 65, attendanceScore: 65, disciplineScore: 55, efficiency: 40, riskLevel: 'concern', growthTrend: 'declining' }),
      makeMetrics({ performanceLevel: 'weak', overallPerformance: 40, attendanceScore: 40, disciplineScore: 30, efficiency: 20, riskLevel: 'atRisk', growthTrend: 'declining' }),
    ];
    const result = computeCohortAnalytics(metrics);

    expect(result.totalStudents).toBe(5);
    expect(result.avgPerformance).toBeCloseTo((95 + 85 + 75 + 65 + 40) / 5, 3);
    expect(result.avgAttendance).toBeCloseTo((95 + 85 + 75 + 65 + 40) / 5, 3);
    expect(result.avgDiscipline).toBeCloseTo((95 + 85 + 75 + 55 + 30) / 5, 3);

    expect(result.performanceDistribution.excellent).toBe(1);
    expect(result.performanceDistribution.veryGood).toBe(1);
    expect(result.performanceDistribution.good).toBe(1);
    expect(result.performanceDistribution.acceptable).toBe(1);
    expect(result.performanceDistribution.weak).toBe(1);

    expect(result.riskDistribution.healthy).toBe(2);
    expect(result.riskDistribution.monitor).toBe(1);
    expect(result.riskDistribution.concern).toBe(1);
    expect(result.riskDistribution.atRisk).toBe(1);

    expect(result.growthDistribution.improving).toBe(1);
    expect(result.growthDistribution.stable).toBe(2);
    expect(result.growthDistribution.declining).toBe(2);

    // discipline: high(>=80) = 2, medium(>=60 && <80) = 1, low(<60) = 2
    expect(result.disciplineDistribution.high).toBe(2);
    expect(result.disciplineDistribution.medium).toBe(1);
    expect(result.disciplineDistribution.low).toBe(2);

    // atRiskCount = atRisk + concern = 1 + 1 = 2
    expect(result.atRiskCount).toBe(2);
    // topPerformerCount = excellent = 1
    expect(result.topPerformerCount).toBe(1);
  });

  test('all same level — all excellent', () => {
    const metrics: StudentPerformanceMetrics[] = [
      makeMetrics({ performanceLevel: 'excellent', overallPerformance: 92, attendanceScore: 95, disciplineScore: 90, efficiency: 88, riskLevel: 'healthy', growthTrend: 'stable' }),
      makeMetrics({ performanceLevel: 'excellent', overallPerformance: 95, attendanceScore: 98, disciplineScore: 92, efficiency: 92, riskLevel: 'healthy', growthTrend: 'improving' }),
      makeMetrics({ performanceLevel: 'excellent', overallPerformance: 91, attendanceScore: 93, disciplineScore: 88, efficiency: 85, riskLevel: 'healthy', growthTrend: 'stable' }),
    ];
    const result = computeCohortAnalytics(metrics);

    expect(result.totalStudents).toBe(3);
    expect(result.performanceDistribution.excellent).toBe(3);
    expect(result.performanceDistribution.veryGood).toBe(0);
    expect(result.performanceDistribution.good).toBe(0);
    expect(result.performanceDistribution.acceptable).toBe(0);
    expect(result.performanceDistribution.weak).toBe(0);

    expect(result.topPerformerCount).toBe(3);
    expect(result.atRiskCount).toBe(0);
    expect(result.riskDistribution.healthy).toBe(3);
  });

  test('all same level — all weak', () => {
    const metrics: StudentPerformanceMetrics[] = [
      makeMetrics({ performanceLevel: 'weak', overallPerformance: 30, attendanceScore: 30, disciplineScore: 20, efficiency: 10, riskLevel: 'atRisk', growthTrend: 'declining' }),
      makeMetrics({ performanceLevel: 'weak', overallPerformance: 40, attendanceScore: 45, disciplineScore: 25, efficiency: 15, riskLevel: 'concern', growthTrend: 'declining' }),
    ];
    const result = computeCohortAnalytics(metrics);

    expect(result.performanceDistribution.weak).toBe(2);
    expect(result.topPerformerCount).toBe(0);
    expect(result.atRiskCount).toBe(2); // atRisk + concern
    expect(result.disciplineDistribution.low).toBe(2); // both < 60
    expect(result.growthDistribution.declining).toBe(2);
  });

  test('discipline distribution boundary — exactly 80 is high, exactly 60 is medium', () => {
    const metrics: StudentPerformanceMetrics[] = [
      makeMetrics({ disciplineScore: 80 }),   // high (>=80)
      makeMetrics({ disciplineScore: 79.99 }), // medium (>=60 && <80)
      makeMetrics({ disciplineScore: 60 }),   // medium (>=60 && <80)
      makeMetrics({ disciplineScore: 59.99 }), // low (<60)
    ];
    const result = computeCohortAnalytics(metrics);
    expect(result.disciplineDistribution.high).toBe(1);
    expect(result.disciplineDistribution.medium).toBe(2);
    expect(result.disciplineDistribution.low).toBe(1);
  });

  test('single student cohort', () => {
    const metrics = [makeMetrics({
      performanceLevel: 'good',
      overallPerformance: 75,
      attendanceScore: 80,
      disciplineScore: 70,
      efficiency: 65,
      riskLevel: 'monitor',
      growthTrend: 'stable',
    })];
    const result = computeCohortAnalytics(metrics);

    expect(result.totalStudents).toBe(1);
    expect(result.avgPerformance).toBe(75);
    expect(result.avgAttendance).toBe(80);
    expect(result.avgDiscipline).toBe(70);
    expect(result.avgEfficiency).toBe(65);
    expect(result.performanceDistribution.good).toBe(1);
    expect(result.riskDistribution.monitor).toBe(1);
    expect(result.growthDistribution.stable).toBe(1);
    expect(result.disciplineDistribution.medium).toBe(1); // 70 >= 60 && < 80
    expect(result.atRiskCount).toBe(0); // monitor is not atRisk or concern
    expect(result.topPerformerCount).toBe(0); // not excellent
  });

  test('atRiskCount includes both atRisk and concern levels', () => {
    const metrics: StudentPerformanceMetrics[] = [
      makeMetrics({ riskLevel: 'atRisk' }),
      makeMetrics({ riskLevel: 'concern' }),
      makeMetrics({ riskLevel: 'monitor' }),
      makeMetrics({ riskLevel: 'healthy' }),
    ];
    const result = computeCohortAnalytics(metrics);
    expect(result.atRiskCount).toBe(2); // atRisk + concern
  });
});

// =====================================================
// Performance Calculator Engine
// Comprehensive student performance analytics
// All formulas are centralized here for consistency
// across teacher view, student view, and profile modal.
//
// IMPORTANT: All weights, thresholds, and classification
// ranges come from analytics-config.ts. No hardcoded
// values in this file.
// =====================================================

import type { AttendanceStatus } from './types';
import {
  ATTENDANCE_POINTS,
  PERFORMANCE_WEIGHTS,
  PERFORMANCE_CLASSIFICATION,
  EFFICIENCY_THRESHOLDS,
  RISK_THRESHOLDS,
  RISK_DATA_SUFFICIENCY,
  GROWTH_THRESHOLDS,
  DISCIPLINE_WEIGHTS,
  DISCIPLINE_PENALTIES,
  RANKING_BANDS,
  EFFICIENCY_WEIGHTS,
  GROWTH_CALCULATION,
  ACHIEVEMENT_THRESHOLDS,
  // Re-export types and UI configs for backward compatibility
  PERFORMANCE_LEVELS,
  EFFICIENCY_LEVELS,
  RISK_LEVELS,
  GROWTH_TRENDS,
  type PerformanceLevel,
  type PerformanceLevelConfig,
  type EfficiencyLevel,
  type EfficiencyLevelConfig,
  type RiskLevel,
  type RiskLevelConfig,
  type GrowthTrend,
  type GrowthTrendConfig,
  // Import growth display helpers so they can be re-exported below.
  formatGrowthIndex,
  formatGrowthPercentage,
  // Phase 2A: import risk data-sufficiency config + suggested actions for re-export
  RISK_ACTIONS,
  type RiskSuggestedAction,
} from './analytics-config';

// =====================================================
// RE-EXPORTS for backward compatibility
// Components that import from performance-calculator
// must NOT break. All types and configs are re-exported.
// =====================================================
export {
  ATTENDANCE_POINTS,
  PERFORMANCE_WEIGHTS as DEFAULT_WEIGHTS,
  PERFORMANCE_LEVELS,
  EFFICIENCY_LEVELS,
  RISK_LEVELS,
  GROWTH_TRENDS,
  PERFORMANCE_CLASSIFICATION,
  RISK_THRESHOLDS,
  GROWTH_THRESHOLDS,
  DISCIPLINE_WEIGHTS,
  RANKING_BANDS,
  type PerformanceLevel,
  type PerformanceLevelConfig,
  type EfficiencyLevel,
  type EfficiencyLevelConfig,
  type RiskLevel,
  type RiskLevelConfig,
  type GrowthTrend,
  type GrowthTrendConfig,
  // Re-export growth display helpers (handle null growthIndex)
  formatGrowthIndex,
  formatGrowthPercentage,
  // Phase 2A: re-export risk data-sufficiency config + suggested actions
  RISK_DATA_SUFFICIENCY,
  RISK_ACTIONS,
  type RiskSuggestedAction,
};

// -------------------------------------------------------
// Performance Level Classification
// Uses centralized config thresholds
// -------------------------------------------------------
export function getPerformanceLevel(overallPct: number): PerformanceLevel {
  if (overallPct >= PERFORMANCE_CLASSIFICATION.excellent.min) return 'excellent';
  if (overallPct >= PERFORMANCE_CLASSIFICATION.veryGood.min) return 'veryGood';
  if (overallPct >= PERFORMANCE_CLASSIFICATION.good.min) return 'good';
  if (overallPct >= PERFORMANCE_CLASSIFICATION.acceptable.min) return 'acceptable';
  return 'weak';
}

export function getPerformanceLevelConfig(level: PerformanceLevel): PerformanceLevelConfig {
  return PERFORMANCE_LEVELS.find(l => l.key === level) || PERFORMANCE_LEVELS[4];
}

// -------------------------------------------------------
// Efficiency Level Classification
// Uses centralized config thresholds
// -------------------------------------------------------
export function getEfficiencyLevel(efficiency: number, effortScore: number): EfficiencyLevel {
  if (effortScore < EFFICIENCY_THRESHOLDS.insufficientEffort) return 'insufficient';
  if (efficiency >= EFFICIENCY_THRESHOLDS.high) return 'high';
  if (efficiency >= EFFICIENCY_THRESHOLDS.medium) return 'medium';
  return 'low';
}

export function getEfficiencyLevelConfig(level: EfficiencyLevel): EfficiencyLevelConfig {
  return EFFICIENCY_LEVELS.find(l => l.key === level) || EFFICIENCY_LEVELS[3];
}

// -------------------------------------------------------
// Risk Level Classification
// Uses centralized config thresholds
// -------------------------------------------------------
export function getRiskLevelConfig(level: RiskLevel): RiskLevelConfig {
  return RISK_LEVELS.find(l => l.key === level) || RISK_LEVELS[0];
}

// -------------------------------------------------------
// Growth Trend Classification
// Uses centralized config thresholds
// -------------------------------------------------------
export function getGrowthTrendConfig(trend: GrowthTrend): GrowthTrendConfig {
  return GROWTH_TRENDS.find(t => t.key === trend) || GROWTH_TRENDS[1];
}

// -------------------------------------------------------
// Comprehensive Student Performance Metrics
// -------------------------------------------------------

/** Structured evidence for a single risk indicator.
 *  Phase 2A: gives teachers numeric context instead of bare reason strings. */
export interface RiskEvidence {
  /** Reason key, e.g. 'attendanceBelow50'. Matches entries in `riskReasons`. */
  key: string;
  /** Actual numeric value observed (e.g. 35 for 35% attendance). Null when not applicable. */
  value: number | null;
  /** Threshold that triggers this reason (e.g. 50 for attendanceBelow50). */
  threshold: number;
  /** Sample size used to compute `value` (e.g. 8 attendance sessions). */
  sampleSize: number;
  /** Minimum sample size required for this indicator to be considered 'sufficient'. */
  requiredSampleSize: number;
  /** Whether the underlying data is sufficient to trust this indicator. */
  dataSufficiency: 'sufficient' | 'insufficient';
  /** Whether the reason actually triggered (added to riskScore and riskReasons). */
  triggered: boolean;
}

export interface StudentPerformanceMetrics {
  // ── Core Metrics ──
  examPerformance: number;
  attendanceScore: number;
  assignmentCompliance: number;
  assignmentQuality: number;

  // ── Composite ──
  overallPerformance: number;
  performanceLevel: PerformanceLevel;

  // ── Efficiency ──
  effortScore: number;
  resultScore: number;
  efficiency: number;
  efficiencyLevel: EfficiencyLevel;

  // ── Discipline ──
  disciplineScore: number;

  // ── Growth ──
  growthIndex: number | null;
  growthTrend: GrowthTrend;

  // ── Risk ──
  riskLevel: RiskLevel;
  riskReasons: string[];
  /** Phase 2A: structured per-reason evidence (triggered + insufficient indicators). */
  riskEvidence: RiskEvidence[];
  /** Phase 2A: overall data sufficiency flag.
   *  'insufficient' when at least one indicator would have triggered but
   *  lacked sufficient sample size. UI should show "بيانات غير كافية"
   *  instead of "سليم" in that case. */
  riskDataSufficiency: 'sufficient' | 'insufficient';

  // ── Raw data for UI display ──
  totalEarnedMarks: number;
  totalPossibleMarks: number;
  attendedSessions: number;
  totalSessions: number;
  completedAssignments: number;
  totalAssignments: number;
  totalEarnedPoints: number;
  totalPossiblePoints: number;
  lateCount: number;
  onTimeCount: number;
  missedDeadlines: number;
}

// -------------------------------------------------------
// Calculation: Exam Performance (Weighted)
// Uses total marks instead of averaging percentages.
// This prevents small quizzes from having equal weight
// with major exams.
// -------------------------------------------------------
export function calculateExamPerformance(
  scores: Array<{ score: number; total: number }>
): { value: number; totalEarned: number; totalPossible: number } {
  if (!scores || scores.length === 0) {
    return { value: 0, totalEarned: 0, totalPossible: 0 };
  }
  const totalEarned = scores.reduce((sum, s) => sum + (s.score || 0), 0);
  const totalPossible = scores.reduce((sum, s) => sum + (s.total || 0), 0);
  const value = totalPossible > 0 ? (totalEarned / totalPossible) * 100 : 0;
  // Clamp to [0, 100] to guard against corrupted data (negative scores, etc.)
  return { value: Math.max(0, Math.min(100, value)), totalEarned, totalPossible };
}

// -------------------------------------------------------
// Calculation: Attendance Score (Points-Based)
// Uses centralized ATTENDANCE_POINTS config.
// -------------------------------------------------------
export function calculateAttendanceScore(params: {
  sessions: Array<{ id: string }>;
  records: Array<{ session_id: string; student_id: string; attendance_status?: AttendanceStatus }>;
  studentId: string;
}): { value: number; attended: number; total: number; lateCount: number; onTimeCount: number } {
  const { sessions, records, studentId } = params;
  const studentRecords = records.filter(r => r.student_id === studentId);
  const recordMap = new Map(studentRecords.map(r => [r.session_id, r.attendance_status || 'present']));

  let totalPoints = 0;
  let lateCount = 0;
  let onTimeCount = 0;
  const maxPoints = sessions.length * 100;

  sessions.forEach(session => {
    const status = recordMap.get(session.id);
    if (status) {
      const points = ATTENDANCE_POINTS[status] ?? 0;
      totalPoints += points;
      if (status === 'present') onTimeCount++;
      if (status === 'late') lateCount++;
    }
    // No record = absent = 0 points (already default)
  });

  const attended = studentRecords.length;
  const value = maxPoints > 0 ? (totalPoints / maxPoints) * 100 : 0;
  // Clamp to [0, 100] to guard against corrupted data
  return { value: Math.max(0, Math.min(100, value)), attended, total: sessions.length, lateCount, onTimeCount };
}

// -------------------------------------------------------
// Calculation: Assignment Compliance
// Measures commitment: did the student submit?
// FIX: Exclude future assignments (due_date > now) from the denominator.
// FIX: Count 'returned' as submitted (student did submit, then it was returned).
// FIX: due_date = null/undefined → assignment has no deadline, so it is
//      excluded from compliance calculations entirely (per project workflow:
//      assignments-tab.tsx treats null as "no due date = active, never expired").
//      Previously the calculator treated null as "due immediately", which
//      unfairly penalised students for optional/practice assignments.
// FIX: When no due assignments exist, return value 0 but signal via total=0
//      so computeAllMetrics can pass undefined to calculateOverallPerformance.
// -------------------------------------------------------
export function calculateAssignmentCompliance(params: {
  submissions: Array<{ assignment_id: string; status: string; student_id: string }>;
  assignments: Array<{ id: string; due_date?: string }>;
  studentId: string;
}): { value: number; completed: number; total: number } {
  const { submissions, assignments, studentId } = params;
  const now = new Date();

  // Only count assignments that have a deadline AND whose deadline has passed.
  // Assignments with no due_date are excluded (optional / practice).
  const dueAssignments = assignments.filter(a =>
    a.due_date && new Date(a.due_date) <= now
  );
  const dueAssignmentIds = new Set(dueAssignments.map(a => a.id));

  const completed = submissions.filter(
    s => s.student_id === studentId &&
         dueAssignmentIds.has(s.assignment_id) &&
         (s.status === 'graded' || s.status === 'submitted' || s.status === 'returned')
  ).length;
  const total = dueAssignments.length;
  const value = total > 0 ? (completed / total) * 100 : 0;
  return { value: Math.max(0, Math.min(100, value)), completed, total };
}

// -------------------------------------------------------
// Calculation: Assignment Quality
// Measures academic quality: what score did they earn?
// FIX: Exclude future assignments from denominator.
// FIX: Exclude 'submitted' (ungraded) from BOTH numerator and denominator —
//      a null grade must not be treated as zero.
// FIX: Exclude 'returned' from BOTH numerator and denominator —
//      returned means the submission was sent back; no graded score exists.
// FIX: Only 'graded' submissions with non-null score contribute to quality.
// FIX: due_date = null → assignment has no deadline (excluded from quality
//      entirely), per project workflow (see compliance comment above).
// FIX: Only count missedDeadline for assignments that have a deadline, are
//      past due, AND have no submission.
// NOTE: Date comparison uses the raw timestamp directly. If the production
//      `assignments.due_date` column is still DATE (not TIMESTAMPTZ), a
//      date-only value like "2024-01-15" is parsed as midnight UTC, which
//      may cause same-day submissions to appear late in timezones behind UTC.
//      The project provides `/api/migrate/assignments-due-date` to convert
//      the column to TIMESTAMPTZ; this calculator intentionally does NOT
//      apply end-of-day heuristics because (a) it would diverge from the
//      raw timestamp semantics, and (b) the migration is the project's
//      chosen fix. See BLOCKER note in worklog.
// -------------------------------------------------------
export function calculateAssignmentQuality(params: {
  submissions: Array<{ assignment_id: string; score: number | null; status: string; student_id: string; submitted_at: string }>;
  assignments: Array<{ id: string; max_score: number; due_date?: string }>;
  studentId: string;
}): { value: number; totalEarned: number; totalPossible: number; missedDeadlines: number } {
  const { submissions, assignments, studentId } = params;
  const studentSubs = submissions.filter(s => s.student_id === studentId);
  const now = new Date();
  let totalEarned = 0;
  let totalPossible = 0;
  let missedDeadlines = 0;

  // Only process assignments that have a deadline AND whose deadline has passed.
  // Assignments with no due_date are excluded (optional / practice).
  const dueAssignments = assignments.filter(a =>
    a.due_date && new Date(a.due_date) <= now
  );

  dueAssignments.forEach(assignment => {
    const sub = studentSubs.find(s => s.assignment_id === assignment.id);

    if (sub && sub.status === 'graded' && sub.score !== null) {
      // Graded with a valid score → contributes to quality
      totalEarned += sub.score;
      totalPossible += assignment.max_score || 0;
      if (assignment.due_date && sub.submitted_at) {
        if (new Date(sub.submitted_at) > new Date(assignment.due_date)) {
          missedDeadlines++;
        }
      }
    } else if (sub && (sub.status === 'submitted' || sub.status === 'returned' ||
               (sub.status === 'graded' && sub.score === null))) {
      // Submitted but ungraded, returned, or graded-with-null-score →
      // does NOT contribute to quality (no valid graded score).
      // Also does NOT count as missed deadline since student did submit.
      if (assignment.due_date && sub.submitted_at) {
        if (new Date(sub.submitted_at) > new Date(assignment.due_date)) {
          missedDeadlines++;
        }
      }
    } else {
      // No submission for a due assignment → counts as missed + zero earned
      totalPossible += assignment.max_score || 0;
      // Only count as missed deadline if due_date has passed
      // (already filtered to due assignments, so this is correct)
      missedDeadlines++;
    }
  });

  const value = totalPossible > 0 ? (totalEarned / totalPossible) * 100 : 0;
  return { value: Math.max(0, Math.min(100, value)), totalEarned, totalPossible, missedDeadlines };
}

// -------------------------------------------------------
// Calculation: Overall Performance
// Uses centralized PERFORMANCE_WEIGHTS.
// Auto-normalize when a component has no data.
// -------------------------------------------------------
export function calculateOverallPerformance(components: {
  examPerformance?: number;
  attendanceScore?: number;
  assignmentCompliance?: number;
  assignmentQuality?: number;
}): number {
  const parts: { value: number; weight: number }[] = [];
  if (components.examPerformance !== undefined) parts.push({ value: components.examPerformance, weight: PERFORMANCE_WEIGHTS.examPerformance });
  if (components.attendanceScore !== undefined) parts.push({ value: components.attendanceScore, weight: PERFORMANCE_WEIGHTS.attendanceScore });
  if (components.assignmentCompliance !== undefined) parts.push({ value: components.assignmentCompliance, weight: PERFORMANCE_WEIGHTS.assignmentCompliance });
  if (components.assignmentQuality !== undefined) parts.push({ value: components.assignmentQuality, weight: PERFORMANCE_WEIGHTS.assignmentQuality });
  if (parts.length === 0) return 0;
  const totalWeight = parts.reduce((sum, c) => sum + c.weight, 0);
  if (totalWeight === 0) return 0;
  const result = parts.reduce((sum, c) => sum + (c.value * c.weight), 0) / totalWeight;
  // Clamp to [0, 100] to guard against out-of-range component values
  return Math.max(0, Math.min(100, result));
}

// -------------------------------------------------------
// Calculation: Efficiency
// Uses centralized EFFICIENCY_WEIGHTS and EFFICIENCY_THRESHOLDS.
// -------------------------------------------------------
export function calculateEfficiency(params: {
  attendanceScore: number;
  assignmentCompliance: number;
  overallPerformance: number;
}): { effortScore: number; resultScore: number; efficiency: number; efficiencyLevel: EfficiencyLevel } {
  const effortScore = (params.attendanceScore * EFFICIENCY_WEIGHTS.attendanceContribution) + (params.assignmentCompliance * EFFICIENCY_WEIGHTS.complianceContribution);
  const resultScore = params.overallPerformance;
  // Guard: if effort is 0 or negative, efficiency is 0 (insufficient data)
  const efficiency = effortScore >= EFFICIENCY_THRESHOLDS.insufficientEffort
    ? Math.min(Math.max(0, (resultScore / effortScore) * 100), 100)
    : 0;
  const efficiencyLevel = getEfficiencyLevel(efficiency, effortScore);
  return { effortScore, resultScore, efficiency, efficiencyLevel };
}

// -------------------------------------------------------
// Calculation: Discipline Score (0-100)
// Uses centralized DISCIPLINE_WEIGHTS and DISCIPLINE_PENALTIES.
// -------------------------------------------------------
export function calculateDisciplineScore(params: {
  attendanceScore: number;
  lateCount: number;
  totalSessions: number;
  onTimeSubmissions: number;
  totalAssignments: number;
  missedDeadlines: number;
}): number {
  const { attendanceScore, lateCount, totalSessions, onTimeSubmissions, totalAssignments, missedDeadlines } = params;

  // Component 1: Attendance consistency — penalized by late arrivals
  const latePenalty = totalSessions > 0 ? (lateCount / totalSessions) * DISCIPLINE_PENALTIES.lateArrivalMaxPenalty : 0;
  const attendanceComponent = Math.max(0, attendanceScore - latePenalty);

  // Component 2: On-time submission rate
  const onTimeRate = totalAssignments > 0 ? (onTimeSubmissions / totalAssignments) * 100 : 100;

  // Component 3: Deadline respect
  const deadlineRespect = totalAssignments > 0
    ? Math.max(0, 100 - (missedDeadlines / totalAssignments) * 100)
    : 100;

  const raw = (attendanceComponent * DISCIPLINE_WEIGHTS.attendanceConsistency)
    + (onTimeRate * DISCIPLINE_WEIGHTS.onTimeSubmissions)
    + (deadlineRespect * DISCIPLINE_WEIGHTS.deadlineRespect);
  // Clamp to [0, 100] to guard against edge cases
  return Math.max(0, Math.min(100, raw));
}

// -------------------------------------------------------
// Calculation: Growth Index
// Uses centralized GROWTH_THRESHOLDS and GROWTH_CALCULATION.
// -------------------------------------------------------
export function calculateGrowthIndex(
  scores: Array<{ completed_at: string; score: number; total: number }>
): { index: number | null; trend: GrowthTrend; recentAvg: number; earliestAvg: number; improvementPercentage: number | null } {
  if (scores.length < 2) {
    return { index: 1, trend: 'stable', recentAvg: 0, earliestAvg: 0, improvementPercentage: 0 };
  }

  const sorted = [...scores].sort((a, b) =>
    new Date(a.completed_at).getTime() - new Date(b.completed_at).getTime()
  );

  const third = Math.max(1, Math.floor(sorted.length / GROWTH_CALCULATION.thirdFraction));
  const earliest = sorted.slice(0, third);
  const recent = sorted.slice(-third);

  const earliestAvg = earliest.reduce((sum, s) => sum + (s.total > 0 ? (s.score / s.total) * 100 : 0), 0) / earliest.length;
  const recentAvg = recent.reduce((sum, s) => sum + (s.total > 0 ? (s.score / s.total) * 100 : 0), 0) / recent.length;

  // FIX: When earliestAvg is 0, ratio-based growth is mathematically undefined
  // (division by zero) and any numeric value would be misleading. We expose
  // null for `index` and `improvementPercentage` so the UI can render
  // "تحسن مطلق / Absolute improvement" with the actual point difference
  // (recentAvg - earliestAvg) instead of "Infinity" or a fabricated ratio.
  // The `trend` is still derived from the actual change, so risk detection
  // and other downstream consumers continue to work.
  let index: number | null;
  let improvementPercentage: number | null;

  if (earliestAvg > 0) {
    // Normal case: ratio-based growth is well-defined.
    index = recentAvg / earliestAvg;
    improvementPercentage = ((recentAvg - earliestAvg) / earliestAvg) * 100;
  } else if (recentAvg > 0) {
    // Zero baseline with absolute improvement: signal via null + trend.
    // UI should display "تحسن مطلق" + the point difference (recentAvg).
    index = null;
    improvementPercentage = null;
  } else {
    // Both zero: no change, no ratio — but index=1 is well-defined here
    // (0/0 is conventionally 1 in this library's "no change" sense).
    index = 1;
    improvementPercentage = 0;
  }

  // Derive trend from the actual data, including the null-index case.
  let trend: GrowthTrend;
  if (index === null) {
    // Absolute improvement from zero baseline.
    trend = 'improving';
  } else if (index >= GROWTH_THRESHOLDS.improving) {
    trend = 'improving';
  } else if (index >= GROWTH_THRESHOLDS.stable) {
    trend = 'stable';
  } else {
    trend = 'declining';
  }

  return { index, trend, recentAvg, earliestAvg, improvementPercentage };
}

// -------------------------------------------------------
// Calculation: Risk Detection
// Uses centralized RISK_THRESHOLDS.
//
// Phase 2A additions:
// - `evidence`: structured per-reason evidence with value/threshold/sampleSize.
// - `dataSufficiency`: overall flag — 'insufficient' when any indicator
//   would have triggered but lacked sufficient sample size.
// - Insufficient indicators do NOT contribute to risk score (prevents
//   false alarms for new students with no history).
//
// Backward compatibility:
// - `reasons: string[]` is preserved (only contains TRIGGERED + sufficient reasons).
// - `level` and `score` semantics unchanged when data is sufficient.
// - New sample-size params are OPTIONAL with safe defaults so existing
//   callers (including unit tests) continue to work.
// -------------------------------------------------------
export function calculateRiskLevel(params: {
  attendanceScore: number;
  overallPerformance: number;
  missedLastThreeAssignments: boolean;
  growthTrend: GrowthTrend;
  daysSinceLastActivity: number | null;
  inactivityThreshold?: number;
  // ── Phase 2A: sample-size context for data-sufficiency checks ──
  /** Number of attendance sessions used to compute `attendanceScore`.
   *  When below RISK_DATA_SUFFICIENCY.attendanceMinSessions, attendance
   *  indicators are marked 'insufficient' and do NOT contribute to score. */
  attendanceTotal?: number;
  /** Number of weighted components used to compute `overallPerformance`
   *  (exam/attendance/compliance/quality that had data). When 0,
   *  performance indicators are marked 'insufficient'. */
  performancePartsCount?: number;
  /** Number of scores used to compute `growthTrend`. When below
   *  RISK_DATA_SUFFICIENCY.growthMinScores, declining trend indicator
   *  is marked 'insufficient'. */
  scoresCount?: number;
  /** Number of due assignments checked for the missed-streak. When below
   *  RISK_DATA_SUFFICIENCY.missedStreakMinAssignments, the streak check
   *  is implicitly insufficient (caller should already pass
   *  `missedLastThreeAssignments = false` in that case, but we guard anyway). */
  dueAssignmentsCount?: number;
}): { level: RiskLevel; reasons: string[]; score: number; evidence: RiskEvidence[]; dataSufficiency: 'sufficient' | 'insufficient' } {
  const reasons: string[] = [];
  const evidence: RiskEvidence[] = [];
  let score = 0;
  let hasInsufficient = false;

  // Default sample sizes: assume sufficient when not provided (backward compat
  // for existing callers and unit tests that don't pass these params).
  const attendanceTotal = params.attendanceTotal ?? RISK_DATA_SUFFICIENCY.attendanceMinSessions;
  const performanceParts = params.performancePartsCount ?? RISK_DATA_SUFFICIENCY.performanceMinComponents;
  const scoresCount = params.scoresCount ?? RISK_DATA_SUFFICIENCY.growthMinScores;
  const dueAssignmentsCount = params.dueAssignmentsCount ?? RISK_DATA_SUFFICIENCY.missedStreakMinAssignments;

  // ── 1. Attendance indicators ──
  // Determine which attendance threshold would trigger
  const attendanceWouldTriggerCritical = params.attendanceScore < RISK_THRESHOLDS.attendanceCritical;
  const attendanceWouldTriggerWarning = !attendanceWouldTriggerCritical && params.attendanceScore < RISK_THRESHOLDS.attendanceWarning;
  const attendanceSufficient = attendanceTotal >= RISK_DATA_SUFFICIENCY.attendanceMinSessions;

  if (attendanceWouldTriggerCritical) {
    if (attendanceSufficient) {
      reasons.push('attendanceBelow50');
      score += RISK_THRESHOLDS.criticalContribution;
      evidence.push({
        key: 'attendanceBelow50',
        value: params.attendanceScore,
        threshold: RISK_THRESHOLDS.attendanceCritical,
        sampleSize: attendanceTotal,
        requiredSampleSize: RISK_DATA_SUFFICIENCY.attendanceMinSessions,
        dataSufficiency: 'sufficient',
        triggered: true,
      });
    } else {
      hasInsufficient = true;
      evidence.push({
        key: 'attendanceBelow50',
        value: params.attendanceScore,
        threshold: RISK_THRESHOLDS.attendanceCritical,
        sampleSize: attendanceTotal,
        requiredSampleSize: RISK_DATA_SUFFICIENCY.attendanceMinSessions,
        dataSufficiency: 'insufficient',
        triggered: false,
      });
    }
  } else if (attendanceWouldTriggerWarning) {
    if (attendanceSufficient) {
      reasons.push('attendanceBelow70');
      score += RISK_THRESHOLDS.warningContribution;
      evidence.push({
        key: 'attendanceBelow70',
        value: params.attendanceScore,
        threshold: RISK_THRESHOLDS.attendanceWarning,
        sampleSize: attendanceTotal,
        requiredSampleSize: RISK_DATA_SUFFICIENCY.attendanceMinSessions,
        dataSufficiency: 'sufficient',
        triggered: true,
      });
    } else {
      hasInsufficient = true;
      evidence.push({
        key: 'attendanceBelow70',
        value: params.attendanceScore,
        threshold: RISK_THRESHOLDS.attendanceWarning,
        sampleSize: attendanceTotal,
        requiredSampleSize: RISK_DATA_SUFFICIENCY.attendanceMinSessions,
        dataSufficiency: 'insufficient',
        triggered: false,
      });
    }
  }

  // ── 2. Performance indicators ──
  const perfWouldTriggerCritical = params.overallPerformance < RISK_THRESHOLDS.performanceCritical;
  const perfWouldTriggerWarning = !perfWouldTriggerCritical && params.overallPerformance < RISK_THRESHOLDS.performanceWarning;
  const perfSufficient = performanceParts >= RISK_DATA_SUFFICIENCY.performanceMinComponents;

  if (perfWouldTriggerCritical) {
    if (perfSufficient) {
      reasons.push('performanceBelow60');
      score += RISK_THRESHOLDS.criticalContribution;
      evidence.push({
        key: 'performanceBelow60',
        value: params.overallPerformance,
        threshold: RISK_THRESHOLDS.performanceCritical,
        sampleSize: performanceParts,
        requiredSampleSize: RISK_DATA_SUFFICIENCY.performanceMinComponents,
        dataSufficiency: 'sufficient',
        triggered: true,
      });
    } else {
      hasInsufficient = true;
      evidence.push({
        key: 'performanceBelow60',
        value: params.overallPerformance,
        threshold: RISK_THRESHOLDS.performanceCritical,
        sampleSize: performanceParts,
        requiredSampleSize: RISK_DATA_SUFFICIENCY.performanceMinComponents,
        dataSufficiency: 'insufficient',
        triggered: false,
      });
    }
  } else if (perfWouldTriggerWarning) {
    if (perfSufficient) {
      reasons.push('performanceBelow70');
      score += RISK_THRESHOLDS.warningContribution;
      evidence.push({
        key: 'performanceBelow70',
        value: params.overallPerformance,
        threshold: RISK_THRESHOLDS.performanceWarning,
        sampleSize: performanceParts,
        requiredSampleSize: RISK_DATA_SUFFICIENCY.performanceMinComponents,
        dataSufficiency: 'sufficient',
        triggered: true,
      });
    } else {
      hasInsufficient = true;
      evidence.push({
        key: 'performanceBelow70',
        value: params.overallPerformance,
        threshold: RISK_THRESHOLDS.performanceWarning,
        sampleSize: performanceParts,
        requiredSampleSize: RISK_DATA_SUFFICIENCY.performanceMinComponents,
        dataSufficiency: 'insufficient',
        triggered: false,
      });
    }
  }

  // ── 3. Missed last 3 assignments ──
  // The caller should already pass `missedLastThreeAssignments = false` when
  // there are fewer than 3 due assignments (computeAllMetrics enforces this).
  // But we double-guard: if dueAssignmentsCount < required, treat as insufficient.
  const missed3Sufficient = dueAssignmentsCount >= RISK_DATA_SUFFICIENCY.missedStreakMinAssignments;
  if (params.missedLastThreeAssignments) {
    if (missed3Sufficient) {
      reasons.push('missedLast3Assignments');
      score += RISK_THRESHOLDS.missedAssignmentContribution;
      evidence.push({
        key: 'missedLast3Assignments',
        value: null,  // boolean indicator, no scalar value
        threshold: RISK_DATA_SUFFICIENCY.missedStreakMinAssignments,
        sampleSize: dueAssignmentsCount,
        requiredSampleSize: RISK_DATA_SUFFICIENCY.missedStreakMinAssignments,
        dataSufficiency: 'sufficient',
        triggered: true,
      });
    } else {
      hasInsufficient = true;
      evidence.push({
        key: 'missedLast3Assignments',
        value: null,
        threshold: RISK_DATA_SUFFICIENCY.missedStreakMinAssignments,
        sampleSize: dueAssignmentsCount,
        requiredSampleSize: RISK_DATA_SUFFICIENCY.missedStreakMinAssignments,
        dataSufficiency: 'insufficient',
        triggered: false,
      });
    }
  }

  // ── 4. Declining growth trend ──
  // growthTrend is already 'stable' when scoresCount < 2 (enforced by
  // calculateGrowthIndex), so decliningTrend cannot fire with insufficient
  // data. We still record evidence for transparency when scoresCount is low.
  const growthSufficient = scoresCount >= RISK_DATA_SUFFICIENCY.growthMinScores;
  if (params.growthTrend === 'declining') {
    // decliningTrend can only be set when growthSufficient (calculateGrowthIndex
    // returns 'stable' for < 2 scores), so this branch is always sufficient.
    reasons.push('decliningTrend');
    score += RISK_THRESHOLDS.decliningTrendContribution;
    evidence.push({
      key: 'decliningTrend',
      value: null,  // trend is categorical, no scalar value
      threshold: RISK_DATA_SUFFICIENCY.growthMinScores,
      sampleSize: scoresCount,
      requiredSampleSize: RISK_DATA_SUFFICIENCY.growthMinScores,
      dataSufficiency: 'sufficient',
      triggered: true,
    });
  }

  // ── 5. Inactivity ──
  // daysSinceLastActivity === null means no activity records exist.
  // In that case, the indicator does NOT fire (we cannot claim "inactive"
  // for a student who simply has no recorded activity yet).
  // This is the existing behavior; we preserve it and add evidence only
  // when the indicator actually fires.
  const threshold = params.inactivityThreshold ?? RISK_THRESHOLDS.inactivityDays;
  if (params.daysSinceLastActivity !== null && params.daysSinceLastActivity > threshold) {
    reasons.push('inactivity');
    score += RISK_THRESHOLDS.inactivityContribution;
    evidence.push({
      key: 'inactivity',
      value: params.daysSinceLastActivity,
      threshold: threshold,
      sampleSize: 1,  // single calculation from latest activity date
      requiredSampleSize: 1,
      dataSufficiency: 'sufficient',
      triggered: true,
    });
  }

  let level: RiskLevel;
  if (score >= RISK_THRESHOLDS.atRisk) level = 'atRisk';
  else if (score >= RISK_THRESHOLDS.concern) level = 'concern';
  else if (score >= RISK_THRESHOLDS.monitor) level = 'monitor';
  else level = 'healthy';

  return {
    level,
    reasons,
    score,
    evidence,
    dataSufficiency: hasInsufficient ? 'insufficient' : 'sufficient',
  };
}

// -------------------------------------------------------
// Master Calculation: Compute All Metrics
// Single entry point for consistent results everywhere.
// -------------------------------------------------------
export function computeAllMetrics(params: {
  scores: Array<{ score: number; total: number; completed_at: string; student_id: string }>;
  attendanceSessions: Array<{ id: string }>;
  attendanceRecords: Array<{ session_id: string; student_id: string; attendance_status?: AttendanceStatus }>;
  submissions: Array<{ assignment_id: string; student_id: string; score: number | null; status: string; submitted_at: string }>;
  assignments: Array<{ id: string; max_score: number; due_date?: string }>;
  studentId: string;
}): StudentPerformanceMetrics {
  const { scores: allScores, attendanceSessions, attendanceRecords, submissions, assignments, studentId } = params;

  const studentScores = allScores.filter(s => s.student_id === studentId);

  // 1. Exam Performance
  const exam = calculateExamPerformance(studentScores);

  // 2. Attendance Score
  const attendance = calculateAttendanceScore({
    sessions: attendanceSessions,
    records: attendanceRecords,
    studentId,
  });

  // 3. Assignment Compliance
  const compliance = calculateAssignmentCompliance({
    submissions,
    assignments,
    studentId,
  });

  // 4. Assignment Quality
  const quality = calculateAssignmentQuality({
    submissions,
    assignments,
    studentId,
  });

  // 5. Overall Performance
  // FIX: Pass undefined when compliance.total === 0 (no due assignments)
  //      so the component is excluded from auto-normalization rather than
  //      being treated as zero performance.
  const hasDueAssignments = compliance.total > 0;
  const overallPerformanceInput = {
    examPerformance: studentScores.length > 0 ? exam.value : undefined,
    attendanceScore: attendanceSessions.length > 0 ? attendance.value : undefined,
    assignmentCompliance: hasDueAssignments ? compliance.value : undefined,
    assignmentQuality: hasDueAssignments ? quality.value : undefined,
  };
  const overallPerformance = calculateOverallPerformance(overallPerformanceInput);

  // Phase 2A: count how many weighted components contributed to overallPerformance.
  // Used by calculateRiskLevel to detect 'insufficient' performance data.
  const performancePartsCount = [
    overallPerformanceInput.examPerformance,
    overallPerformanceInput.attendanceScore,
    overallPerformanceInput.assignmentCompliance,
    overallPerformanceInput.assignmentQuality,
  ].filter(v => v !== undefined).length;

  const performanceLevel = getPerformanceLevel(overallPerformance);

  // 6. Efficiency
  const efficiency = calculateEfficiency({
    attendanceScore: attendance.value,
    assignmentCompliance: compliance.value,
    overallPerformance,
  });

  // 7. Discipline Score
  // FIX: Count 'returned' as submitted for on-time calculation.
  // FIX: Use only assignments with a past deadline for totalAssignments in
  //      discipline. Assignments with no due_date are excluded.
  const dueAssignmentsForDiscipline = assignments.filter(a =>
    a.due_date && new Date(a.due_date) <= new Date()
  );
  const onTimeSubmissions = submissions.filter(
    s => s.student_id === studentId &&
      (s.status === 'graded' || s.status === 'submitted' || s.status === 'returned') &&
      dueAssignmentsForDiscipline.some(a => a.id === s.assignment_id && (!a.due_date || !s.submitted_at || new Date(s.submitted_at) <= new Date(a.due_date)))
  ).length;

  const disciplineScore = calculateDisciplineScore({
    attendanceScore: attendance.value,
    lateCount: attendance.lateCount,
    totalSessions: attendance.total,
    onTimeSubmissions,
    totalAssignments: dueAssignmentsForDiscipline.length,
    missedDeadlines: quality.missedDeadlines,
  });

  // 8. Growth Index
  const growth = calculateGrowthIndex(studentScores);

  // 9. Risk Detection
  // FIX: Only check assignments with a past deadline for missed streak.
  //      Assignments with no due_date are excluded.
  const now = new Date();
  const dueAssignmentsForRisk = assignments.filter(a =>
    a.due_date && new Date(a.due_date) <= now
  );
  const recentAssignments = [...dueAssignmentsForRisk]
    .sort((a, b) => {
      const dateA = a.due_date || '';
      const dateB = b.due_date || '';
      return new Date(dateB).getTime() - new Date(dateA).getTime();
    })
    .slice(0, ACHIEVEMENT_THRESHOLDS.missedAssignmentCheck);
  const missedLastThree = recentAssignments.length === ACHIEVEMENT_THRESHOLDS.missedAssignmentCheck && recentAssignments.every(a =>
    !submissions.some(s => s.student_id === studentId && s.assignment_id === a.id && (s.status === 'graded' || s.status === 'submitted' || s.status === 'returned'))
  );

  const allDates = [
    ...studentScores.map(s => s.completed_at),
    ...submissions.filter(s => s.student_id === studentId).map(s => s.submitted_at),
  ].filter(Boolean);

  const latestActivity = allDates.length > 0
    ? Math.max(...allDates.map(d => new Date(d).getTime()))
    : null;
  const daysSinceLastActivity = latestActivity
    ? (Date.now() - latestActivity) / (1000 * 60 * 60 * 24)
    : null;

  const risk = calculateRiskLevel({
    attendanceScore: attendance.value,
    overallPerformance,
    missedLastThreeAssignments: missedLastThree,
    growthTrend: growth.trend,
    daysSinceLastActivity,
    // Phase 2A: pass sample-size context for data-sufficiency checks
    attendanceTotal: attendance.total,
    performancePartsCount,
    scoresCount: studentScores.length,
    dueAssignmentsCount: dueAssignmentsForRisk.length,
  });

  return {
    examPerformance: exam.value,
    attendanceScore: attendance.value,
    assignmentCompliance: compliance.value,
    assignmentQuality: quality.value,
    overallPerformance,
    performanceLevel,
    effortScore: efficiency.effortScore,
    resultScore: efficiency.resultScore,
    efficiency: efficiency.efficiency,
    efficiencyLevel: efficiency.efficiencyLevel,
    disciplineScore,
    growthIndex: growth.index,
    growthTrend: growth.trend,
    riskLevel: risk.level,
    riskReasons: risk.reasons,
    // Phase 2A: structured evidence + overall data sufficiency
    riskEvidence: risk.evidence,
    riskDataSufficiency: risk.dataSufficiency,
    totalEarnedMarks: exam.totalEarned,
    totalPossibleMarks: exam.totalPossible,
    attendedSessions: attendance.attended,
    totalSessions: attendance.total,
    completedAssignments: compliance.completed,
    totalAssignments: compliance.total,
    totalEarnedPoints: quality.totalEarned,
    totalPossiblePoints: quality.totalPossible,
    lateCount: attendance.lateCount,
    onTimeCount: attendance.onTimeCount,
    missedDeadlines: quality.missedDeadlines,
  };
}

// -------------------------------------------------------
// Student Ranking (Percentile-based)
// Uses centralized RANKING_BANDS.
// -------------------------------------------------------
export function calculatePercentile(studentScore: number, allScores: number[]): number {
  if (allScores.length === 0) return 0;
  const below = allScores.filter(s => s < studentScore).length;
  return (below / allScores.length) * 100;
}

export function getPercentileLabel(percentile: number): string {
  if (percentile >= RANKING_BANDS.top5) return 'top5';
  if (percentile >= RANKING_BANDS.top10) return 'top10';
  if (percentile >= RANKING_BANDS.top25) return 'top25';
  if (percentile >= RANKING_BANDS.top50) return 'top50';
  return 'below50';
}

// -------------------------------------------------------
// Per-Subject Performance Calculation
// CENTRALIZED: Use this instead of duplicating logic
// in UI components. Both teacher-student-tracking and
// student-tracking sections should call this function.
// -------------------------------------------------------
export interface SubjectPerformanceData {
  subjectId: string;
  subjectName: string;
  examPerformance: number;
  attendanceScore: number;
  assignmentCompliance: number;
  assignmentQuality: number;
  overallPerformance: number;
  growthTrend: GrowthTrend;
  riskLevel: RiskLevel;
  /** Phase 2A: structured per-reason evidence (subject-level). */
  riskEvidence: RiskEvidence[];
  /** Phase 2A: overall data sufficiency flag (subject-level). */
  riskDataSufficiency: 'sufficient' | 'insufficient';
  quizCount: number;
  totalSessions: number;
  attendedSessions: number;
  assignmentCount: number;
  completedAssignments: number;
}

export interface SubjectPerformanceInput {
  subjectId: string;
  subjectName: string;
  studentScores: Array<{ score: number; total: number; completed_at: string }>;
  attendanceSessions: Array<{ id: string }>;
  attendanceRecords: Array<{ session_id: string; student_id: string; attendance_status?: AttendanceStatus }>;
  studentId: string;
  assignments: Array<{ id: string; max_score: number; due_date?: string }>;
  submissions: Array<{ assignment_id: string; student_id: string; score: number | null; status: string; submitted_at: string }>;
}

export function computeSubjectPerformance(input: SubjectPerformanceInput): SubjectPerformanceData {
  const { subjectId, subjectName, studentScores, attendanceSessions, attendanceRecords, studentId, assignments, submissions } = input;

  // Exam Performance
  const exam = calculateExamPerformance(studentScores);

  // Attendance Score
  const attendance = calculateAttendanceScore({
    sessions: attendanceSessions,
    records: attendanceRecords,
    studentId,
  });

  // Assignment Compliance — uses shared function for consistency (includes clamping)
  const compliance = calculateAssignmentCompliance({
    submissions,
    assignments,
    studentId,
  });

  // Assignment Quality
  const quality = calculateAssignmentQuality({
    submissions,
    assignments,
    studentId,
  });

  // Overall (auto-normalize)
  // FIX: Pass undefined when no due assignments
  const hasDueAssignments = compliance.total > 0;
  const overallPerformanceInput = {
    examPerformance: studentScores.length > 0 ? exam.value : undefined,
    attendanceScore: attendanceSessions.length > 0 ? attendance.value : undefined,
    assignmentCompliance: hasDueAssignments ? compliance.value : undefined,
    assignmentQuality: hasDueAssignments ? quality.value : undefined,
  };
  const overallPerformance = calculateOverallPerformance(overallPerformanceInput);

  // Phase 2A: count weighted components for data-sufficiency check
  const performancePartsCount = [
    overallPerformanceInput.examPerformance,
    overallPerformanceInput.attendanceScore,
    overallPerformanceInput.assignmentCompliance,
    overallPerformanceInput.assignmentQuality,
  ].filter(v => v !== undefined).length;

  // Growth
  const growth = calculateGrowthIndex(studentScores);

  // Risk (simplified for subject level — missedLast3=false, daysSinceLastActivity=null)
  const risk = calculateRiskLevel({
    attendanceScore: attendance.value,
    overallPerformance,
    missedLastThreeAssignments: false,
    growthTrend: growth.trend,
    daysSinceLastActivity: null,
    // Phase 2A: pass sample-size context
    attendanceTotal: attendance.total,
    performancePartsCount,
    scoresCount: studentScores.length,
    dueAssignmentsCount: 0,  // subject-level view doesn't assess missed-streak
  });

  return {
    subjectId,
    subjectName,
    examPerformance: exam.value,
    attendanceScore: attendance.value,
    assignmentCompliance: compliance.value,
    assignmentQuality: quality.value,
    overallPerformance,
    growthTrend: growth.trend,
    riskLevel: risk.level,
    // Phase 2A: structured evidence + data sufficiency (subject-level)
    riskEvidence: risk.evidence,
    riskDataSufficiency: risk.dataSufficiency,
    quizCount: studentScores.length,
    totalSessions: attendanceSessions.length,
    attendedSessions: attendance.attended,
    assignmentCount: assignments.length,
    completedAssignments: compliance.completed,
  };
}

// -------------------------------------------------------
// Activity Timeline Event Types
// -------------------------------------------------------
export type ActivityType = 'quiz' | 'attendance' | 'assignment' | 'grading' | 'risk' | 'achievement' | 'feedback';

export interface ActivityEvent {
  date: string;
  type: ActivityType;
  title: string;
  detail: string;
  importance?: 'high' | 'medium' | 'low';
}

// -------------------------------------------------------
// Cohort Analytics Engine
// Reusable distribution calculations for teacher dashboards.
// No UI component should compute distributions independently.
// -------------------------------------------------------
export interface CohortPerformanceDistribution {
  excellent: number;
  veryGood: number;
  good: number;
  acceptable: number;
  weak: number;
}

export interface CohortRiskDistribution {
  healthy: number;
  monitor: number;
  concern: number;
  atRisk: number;
}

export interface CohortGrowthDistribution {
  improving: number;
  stable: number;
  declining: number;
}

export interface CohortDisciplineDistribution {
  high: number;    // >= 80
  medium: number;  // >= 60
  low: number;     // < 60
}

export interface CohortAnalytics {
  totalStudents: number;
  avgPerformance: number;
  avgAttendance: number;
  avgDiscipline: number;
  avgEfficiency: number;
  performanceDistribution: CohortPerformanceDistribution;
  riskDistribution: CohortRiskDistribution;
  growthDistribution: CohortGrowthDistribution;
  disciplineDistribution: CohortDisciplineDistribution;
  atRiskCount: number;
  topPerformerCount: number;
}

export function computeCohortAnalytics(
  allMetrics: StudentPerformanceMetrics[]
): CohortAnalytics {
  const totalStudents = allMetrics.length;
  if (totalStudents === 0) {
    return {
      totalStudents: 0,
      avgPerformance: 0,
      avgAttendance: 0,
      avgDiscipline: 0,
      avgEfficiency: 0,
      performanceDistribution: { excellent: 0, veryGood: 0, good: 0, acceptable: 0, weak: 0 },
      riskDistribution: { healthy: 0, monitor: 0, concern: 0, atRisk: 0 },
      growthDistribution: { improving: 0, stable: 0, declining: 0 },
      disciplineDistribution: { high: 0, medium: 0, low: 0 },
      atRiskCount: 0,
      topPerformerCount: 0,
    };
  }

  // Single-pass computation for O(n) scalability (safe for 1000+ students)
  let sumPerformance = 0;
  let sumAttendance = 0;
  let sumDiscipline = 0;
  let sumEfficiency = 0;
  let countPerformance = 0;  // Phase 2A: only count students with sufficient data
  let countAttendance = 0;
  let countDiscipline = 0;
  let countEfficiency = 0;
  const perfDist: CohortPerformanceDistribution = { excellent: 0, veryGood: 0, good: 0, acceptable: 0, weak: 0 };
  const riskDist: CohortRiskDistribution = { healthy: 0, monitor: 0, concern: 0, atRisk: 0 };
  const growthDist: CohortGrowthDistribution = { improving: 0, stable: 0, declining: 0 };
  const discDist: CohortDisciplineDistribution = { high: 0, medium: 0, low: 0 };
  let atRiskCount = 0;
  let topPerformerCount = 0;

  for (const m of allMetrics) {
    // Phase 2A: students with insufficient data are excluded from averages
    // and performance/distribution buckets so they don't drag down cohort
    // stats with their zero-default scores. They are still counted in
    // totalStudents and riskDistribution (as 'healthy' to avoid false alarms).
    const hasSufficientData = m.riskDataSufficiency === 'sufficient';

    if (hasSufficientData) {
      sumPerformance += m.overallPerformance;
      countPerformance++;
      sumAttendance += m.attendanceScore;
      countAttendance++;
      sumDiscipline += m.disciplineScore;
      countDiscipline++;
      sumEfficiency += m.efficiency;
      countEfficiency++;

      // Performance distribution — only for students with sufficient data
      perfDist[m.performanceLevel]++;

      // Top performer — only for students with sufficient data
      if (m.performanceLevel === 'excellent') topPerformerCount++;

      // Discipline distribution — only for students with sufficient data
      if (m.disciplineScore >= 80) discDist.high++;
      else if (m.disciplineScore >= 60) discDist.medium++;
      else discDist.low++;
    }

    // Risk distribution: only count students with sufficient data.
    // Insufficient-data students are NOT counted as 'healthy' to avoid
    // inflating the healthy bucket with students who simply have no
    // history yet. Their riskLevel is 'healthy' but it's not a genuine
    // assessment — it's an artifact of zero-scored indicators.
    // The pie chart normalizes its own totals, so sum(riskDistribution)
    // may be less than totalStudents when insufficient students exist.
    if (hasSufficientData) {
      riskDist[m.riskLevel]++;
      if (m.riskLevel === 'atRisk' || m.riskLevel === 'concern') atRiskCount++;
    }

    // Growth distribution: include all (growth 'stable' for insufficient is OK)
    growthDist[m.growthTrend]++;
  }

  return {
    totalStudents,
    // Phase 2A: averages exclude insufficient-data students to avoid
    // false low-cohort averages caused by new students with 0 scores.
    avgPerformance: countPerformance > 0 ? sumPerformance / countPerformance : 0,
    avgAttendance: countAttendance > 0 ? sumAttendance / countAttendance : 0,
    avgDiscipline: countDiscipline > 0 ? sumDiscipline / countDiscipline : 0,
    avgEfficiency: countEfficiency > 0 ? sumEfficiency / countEfficiency : 0,
    performanceDistribution: perfDist,
    riskDistribution: riskDist,
    growthDistribution: growthDist,
    disciplineDistribution: discDist,
    atRiskCount,
    topPerformerCount,
  };
}

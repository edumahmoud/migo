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
  growthIndex: number;
  growthTrend: GrowthTrend;

  // ── Risk ──
  riskLevel: RiskLevel;
  riskReasons: string[];

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
// -------------------------------------------------------
export function calculateAssignmentCompliance(params: {
  submissions: Array<{ status: string; student_id: string }>;
  totalAssignments: number;
  studentId: string;
}): { value: number; completed: number; total: number } {
  const { submissions, studentId } = params;
  const completed = submissions.filter(
    s => s.student_id === studentId && (s.status === 'graded' || s.status === 'submitted')
  ).length;
  const value = params.totalAssignments > 0 ? (completed / params.totalAssignments) * 100 : 0;
  return { value: Math.max(0, Math.min(100, value)), completed, total: params.totalAssignments };
}

// -------------------------------------------------------
// Calculation: Assignment Quality
// Measures academic quality: what score did they earn?
// -------------------------------------------------------
export function calculateAssignmentQuality(params: {
  submissions: Array<{ assignment_id: string; score: number | null; status: string; student_id: string; submitted_at: string }>;
  assignments: Array<{ id: string; max_score: number; due_date?: string }>;
  studentId: string;
}): { value: number; totalEarned: number; totalPossible: number; missedDeadlines: number } {
  const { submissions, assignments, studentId } = params;
  const studentSubs = submissions.filter(s => s.student_id === studentId);
  let totalEarned = 0;
  let totalPossible = 0;
  let missedDeadlines = 0;

  assignments.forEach(assignment => {
    const sub = studentSubs.find(s => s.assignment_id === assignment.id);
    if (sub && (sub.status === 'graded' || sub.status === 'submitted')) {
      const earned = sub.score ?? 0;
      totalEarned += earned;
      totalPossible += assignment.max_score || 0;
      if (assignment.due_date && sub.submitted_at) {
        if (new Date(sub.submitted_at) > new Date(assignment.due_date)) {
          missedDeadlines++;
        }
      }
    } else {
      totalPossible += assignment.max_score || 0;
      if (assignment.due_date && new Date() > new Date(assignment.due_date)) {
        missedDeadlines++;
      }
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
): { index: number; trend: GrowthTrend; recentAvg: number; earliestAvg: number; improvementPercentage: number } {
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

  const index = earliestAvg > 0 ? recentAvg / earliestAvg : (recentAvg > 0 ? 2 : 1);
  const improvementPercentage = earliestAvg > 0 ? ((recentAvg - earliestAvg) / earliestAvg) * 100 : 0;

  let trend: GrowthTrend;
  if (index >= GROWTH_THRESHOLDS.improving) trend = 'improving';
  else if (index >= GROWTH_THRESHOLDS.stable) trend = 'stable';
  else trend = 'declining';

  return { index, trend, recentAvg, earliestAvg, improvementPercentage };
}

// -------------------------------------------------------
// Calculation: Risk Detection
// Uses centralized RISK_THRESHOLDS.
// -------------------------------------------------------
export function calculateRiskLevel(params: {
  attendanceScore: number;
  overallPerformance: number;
  missedLastThreeAssignments: boolean;
  growthTrend: GrowthTrend;
  daysSinceLastActivity: number | null;
  inactivityThreshold?: number;
}): { level: RiskLevel; reasons: string[]; score: number } {
  const reasons: string[] = [];
  let score = 0;

  if (params.attendanceScore < RISK_THRESHOLDS.attendanceCritical) {
    reasons.push('attendanceBelow50');
    score += RISK_THRESHOLDS.criticalContribution;
  } else if (params.attendanceScore < RISK_THRESHOLDS.attendanceWarning) {
    reasons.push('attendanceBelow70');
    score += RISK_THRESHOLDS.warningContribution;
  }

  if (params.overallPerformance < RISK_THRESHOLDS.performanceCritical) {
    reasons.push('performanceBelow60');
    score += RISK_THRESHOLDS.criticalContribution;
  } else if (params.overallPerformance < RISK_THRESHOLDS.performanceWarning) {
    reasons.push('performanceBelow70');
    score += RISK_THRESHOLDS.warningContribution;
  }

  if (params.missedLastThreeAssignments) {
    reasons.push('missedLast3Assignments');
    score += RISK_THRESHOLDS.missedAssignmentContribution;
  }

  if (params.growthTrend === 'declining') {
    reasons.push('decliningTrend');
    score += RISK_THRESHOLDS.decliningTrendContribution;
  }

  const threshold = params.inactivityThreshold ?? RISK_THRESHOLDS.inactivityDays;
  if (params.daysSinceLastActivity !== null && params.daysSinceLastActivity > threshold) {
    reasons.push('inactivity');
    score += RISK_THRESHOLDS.inactivityContribution;
  }

  let level: RiskLevel;
  if (score >= RISK_THRESHOLDS.atRisk) level = 'atRisk';
  else if (score >= RISK_THRESHOLDS.concern) level = 'concern';
  else if (score >= RISK_THRESHOLDS.monitor) level = 'monitor';
  else level = 'healthy';

  return { level, reasons, score };
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
    totalAssignments: assignments.length,
    studentId,
  });

  // 4. Assignment Quality
  const quality = calculateAssignmentQuality({
    submissions,
    assignments,
    studentId,
  });

  // 5. Overall Performance
  const overallPerformance = calculateOverallPerformance({
    examPerformance: studentScores.length > 0 ? exam.value : undefined,
    attendanceScore: attendanceSessions.length > 0 ? attendance.value : undefined,
    assignmentCompliance: assignments.length > 0 ? compliance.value : undefined,
    assignmentQuality: assignments.length > 0 ? quality.value : undefined,
  });

  const performanceLevel = getPerformanceLevel(overallPerformance);

  // 6. Efficiency
  const efficiency = calculateEfficiency({
    attendanceScore: attendance.value,
    assignmentCompliance: compliance.value,
    overallPerformance,
  });

  // 7. Discipline Score
  const onTimeSubmissions = submissions.filter(
    s => s.student_id === studentId &&
      (s.status === 'graded' || s.status === 'submitted') &&
      assignments.some(a => a.id === s.assignment_id && (!a.due_date || !s.submitted_at || new Date(s.submitted_at) <= new Date(a.due_date)))
  ).length;

  const disciplineScore = calculateDisciplineScore({
    attendanceScore: attendance.value,
    lateCount: attendance.lateCount,
    totalSessions: attendance.total,
    onTimeSubmissions,
    totalAssignments: assignments.length,
    missedDeadlines: quality.missedDeadlines,
  });

  // 8. Growth Index
  const growth = calculateGrowthIndex(studentScores);

  // 9. Risk Detection
  const recentAssignments = [...assignments]
    .sort((a, b) => {
      const dateA = a.due_date || '';
      const dateB = b.due_date || '';
      return new Date(dateB).getTime() - new Date(dateA).getTime();
    })
    .slice(0, ACHIEVEMENT_THRESHOLDS.missedAssignmentCheck);
  const missedLastThree = recentAssignments.length === ACHIEVEMENT_THRESHOLDS.missedAssignmentCheck && recentAssignments.every(a =>
    !submissions.some(s => s.student_id === studentId && s.assignment_id === a.id && (s.status === 'graded' || s.status === 'submitted'))
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

  // Assignment Compliance
  const studentSubmissions = submissions.filter(s => s.student_id === studentId);
  const completedAssignments = studentSubmissions.filter(s => s.status === 'graded' || s.status === 'submitted').length;
  const compliance = assignments.length > 0 ? (completedAssignments / assignments.length) * 100 : 0;

  // Assignment Quality
  const quality = calculateAssignmentQuality({
    submissions,
    assignments,
    studentId,
  });

  // Overall (auto-normalize)
  const overallPerformance = calculateOverallPerformance({
    examPerformance: studentScores.length > 0 ? exam.value : undefined,
    attendanceScore: attendanceSessions.length > 0 ? attendance.value : undefined,
    assignmentCompliance: assignments.length > 0 ? compliance : undefined,
    assignmentQuality: assignments.length > 0 ? quality.value : undefined,
  });

  // Growth
  const growth = calculateGrowthIndex(studentScores);

  // Risk (simplified for subject level)
  const risk = calculateRiskLevel({
    attendanceScore: attendance.value,
    overallPerformance,
    missedLastThreeAssignments: false,
    growthTrend: growth.trend,
    daysSinceLastActivity: null,
  });

  return {
    subjectId,
    subjectName,
    examPerformance: exam.value,
    attendanceScore: attendance.value,
    assignmentCompliance: compliance,
    assignmentQuality: quality.value,
    overallPerformance,
    growthTrend: growth.trend,
    riskLevel: risk.level,
    quizCount: studentScores.length,
    totalSessions: attendanceSessions.length,
    attendedSessions: attendance.attended,
    assignmentCount: assignments.length,
    completedAssignments,
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
  const perfDist: CohortPerformanceDistribution = { excellent: 0, veryGood: 0, good: 0, acceptable: 0, weak: 0 };
  const riskDist: CohortRiskDistribution = { healthy: 0, monitor: 0, concern: 0, atRisk: 0 };
  const growthDist: CohortGrowthDistribution = { improving: 0, stable: 0, declining: 0 };
  const discDist: CohortDisciplineDistribution = { high: 0, medium: 0, low: 0 };
  let atRiskCount = 0;
  let topPerformerCount = 0;

  for (const m of allMetrics) {
    sumPerformance += m.overallPerformance;
    sumAttendance += m.attendanceScore;
    sumDiscipline += m.disciplineScore;
    sumEfficiency += m.efficiency;

    // Performance distribution
    perfDist[m.performanceLevel]++;

    // Risk distribution
    riskDist[m.riskLevel]++;
    if (m.riskLevel === 'atRisk' || m.riskLevel === 'concern') atRiskCount++;

    // Growth distribution
    growthDist[m.growthTrend]++;

    // Discipline distribution
    if (m.disciplineScore >= 80) discDist.high++;
    else if (m.disciplineScore >= 60) discDist.medium++;
    else discDist.low++;

    // Top performer
    if (m.performanceLevel === 'excellent') topPerformerCount++;
  }

  return {
    totalStudents,
    avgPerformance: sumPerformance / totalStudents,
    avgAttendance: sumAttendance / totalStudents,
    avgDiscipline: sumDiscipline / totalStudents,
    avgEfficiency: sumEfficiency / totalStudents,
    performanceDistribution: perfDist,
    riskDistribution: riskDist,
    growthDistribution: growthDist,
    disciplineDistribution: discDist,
    atRiskCount,
    topPerformerCount,
  };
}

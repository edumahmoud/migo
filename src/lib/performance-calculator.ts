// =====================================================
// Performance Calculator Engine
// Comprehensive student performance analytics
// All formulas are centralized here for consistency
// across teacher view, student view, and profile modal.
// =====================================================

import type { AttendanceStatus } from './types';

// -------------------------------------------------------
// Attendance Status Point Values
// -------------------------------------------------------
export const ATTENDANCE_POINTS: Record<AttendanceStatus, number> = {
  present: 100,
  late: 75,
  partial: 50,
  absent: 0,
};

// -------------------------------------------------------
// Default Performance Weights
// -------------------------------------------------------
export const DEFAULT_WEIGHTS = {
  examPerformance: 35,
  attendanceScore: 20,
  assignmentCompliance: 15,
  assignmentQuality: 30,
} as const;

// -------------------------------------------------------
// Performance Level Types & Classification
// -------------------------------------------------------
export type PerformanceLevel = 'excellent' | 'veryGood' | 'good' | 'acceptable' | 'weak';

export interface PerformanceLevelConfig {
  key: PerformanceLevel;
  min: number;
  color: string;
  bgColor: string;
  ringColor: string;
  textColor: string;
  icon: string;
}

export const PERFORMANCE_LEVELS: PerformanceLevelConfig[] = [
  { key: 'excellent', min: 90, color: 'bg-emerald-500', bgColor: 'bg-emerald-50 dark:bg-emerald-900/20', ringColor: 'ring-emerald-100', textColor: 'text-emerald-700 dark:text-emerald-500', icon: '★' },
  { key: 'veryGood', min: 80, color: 'bg-sky-500', bgColor: 'bg-sky-50 dark:bg-sky-900/15', ringColor: 'ring-sky-100', textColor: 'text-sky-700 dark:text-sky-400', icon: '◆' },
  { key: 'good', min: 70, color: 'bg-teal-500', bgColor: 'bg-teal-50 dark:bg-teal-900/20', ringColor: 'ring-teal-100', textColor: 'text-teal-700 dark:text-teal-500', icon: '●' },
  { key: 'acceptable', min: 60, color: 'bg-amber-500', bgColor: 'bg-amber-50 dark:bg-amber-900/20', ringColor: 'ring-amber-100', textColor: 'text-amber-700 dark:text-amber-500', icon: '▲' },
  { key: 'weak', min: 0, color: 'bg-rose-500', bgColor: 'bg-rose-50 dark:bg-rose-900/20', ringColor: 'ring-rose-100', textColor: 'text-rose-700 dark:text-rose-500', icon: '▼' },
];

export function getPerformanceLevel(overallPct: number): PerformanceLevel {
  if (overallPct >= 90) return 'excellent';
  if (overallPct >= 80) return 'veryGood';
  if (overallPct >= 70) return 'good';
  if (overallPct >= 60) return 'acceptable';
  return 'weak';
}

export function getPerformanceLevelConfig(level: PerformanceLevel): PerformanceLevelConfig {
  return PERFORMANCE_LEVELS.find(l => l.key === level) || PERFORMANCE_LEVELS[4];
}

// -------------------------------------------------------
// Efficiency Level Types
// -------------------------------------------------------
export type EfficiencyLevel = 'high' | 'medium' | 'low' | 'insufficient';

export interface EfficiencyLevelConfig {
  key: EfficiencyLevel;
  color: string;
  bgColor: string;
  textColor: string;
  ringColor: string;
}

export const EFFICIENCY_LEVELS: EfficiencyLevelConfig[] = [
  { key: 'high', color: 'text-emerald-600 dark:text-emerald-500', bgColor: 'bg-emerald-50 dark:bg-emerald-900/20', textColor: 'text-emerald-700 dark:text-emerald-500', ringColor: 'stroke-emerald-500' },
  { key: 'medium', color: 'text-amber-600 dark:text-amber-500', bgColor: 'bg-amber-50 dark:bg-amber-900/20', textColor: 'text-amber-700 dark:text-amber-500', ringColor: 'stroke-amber-500' },
  { key: 'low', color: 'text-rose-600 dark:text-rose-500', bgColor: 'bg-rose-50 dark:bg-rose-900/20', textColor: 'text-rose-700 dark:text-rose-500', ringColor: 'stroke-rose-500' },
  { key: 'insufficient', color: 'text-gray-500 dark:text-gray-400', bgColor: 'bg-gray-50 dark:bg-gray-900/20', textColor: 'text-gray-600 dark:text-gray-400', ringColor: 'stroke-gray-400' },
];

export function getEfficiencyLevel(efficiency: number, effortScore: number): EfficiencyLevel {
  if (effortScore < 40) return 'insufficient';
  if (efficiency >= 80) return 'high';
  if (efficiency >= 50) return 'medium';
  return 'low';
}

export function getEfficiencyLevelConfig(level: EfficiencyLevel): EfficiencyLevelConfig {
  return EFFICIENCY_LEVELS.find(l => l.key === level) || EFFICIENCY_LEVELS[3];
}

// -------------------------------------------------------
// Risk Level Types & Classification
// -------------------------------------------------------
export type RiskLevel = 'healthy' | 'monitor' | 'concern' | 'atRisk';

export interface RiskLevelConfig {
  key: RiskLevel;
  color: string;
  bgColor: string;
  textColor: string;
  borderColor: string;
  dotColor: string;
}

export const RISK_LEVELS: RiskLevelConfig[] = [
  { key: 'healthy', color: 'bg-emerald-500', bgColor: 'bg-emerald-50 dark:bg-emerald-900/20', textColor: 'text-emerald-700 dark:text-emerald-500', borderColor: 'border-emerald-200 dark:border-emerald-900/60', dotColor: 'bg-emerald-400' },
  { key: 'monitor', color: 'bg-amber-500', bgColor: 'bg-amber-50 dark:bg-amber-900/20', textColor: 'text-amber-700 dark:text-amber-500', borderColor: 'border-amber-200 dark:border-amber-900/60', dotColor: 'bg-amber-400' },
  { key: 'concern', color: 'bg-orange-500', bgColor: 'bg-orange-50 dark:bg-orange-900/20', textColor: 'text-orange-700 dark:text-orange-500', borderColor: 'border-orange-200 dark:border-orange-900/60', dotColor: 'bg-orange-400' },
  { key: 'atRisk', color: 'bg-rose-500', bgColor: 'bg-rose-50 dark:bg-rose-900/20', textColor: 'text-rose-700 dark:text-rose-500', borderColor: 'border-rose-200 dark:border-rose-900/60', dotColor: 'bg-rose-400' },
];

export function getRiskLevelConfig(level: RiskLevel): RiskLevelConfig {
  return RISK_LEVELS.find(l => l.key === level) || RISK_LEVELS[0];
}

// -------------------------------------------------------
// Growth Trend Types
// -------------------------------------------------------
export type GrowthTrend = 'improving' | 'stable' | 'declining';

export interface GrowthTrendConfig {
  key: GrowthTrend;
  color: string;
  textColor: string;
  icon: string; // arrow direction
}

export const GROWTH_TRENDS: GrowthTrendConfig[] = [
  { key: 'improving', color: 'bg-emerald-500', textColor: 'text-emerald-600 dark:text-emerald-500', icon: '↑' },
  { key: 'stable', color: 'bg-sky-500', textColor: 'text-sky-600 dark:text-sky-500', icon: '→' },
  { key: 'declining', color: 'bg-rose-500', textColor: 'text-rose-600 dark:text-rose-500', icon: '↓' },
];

export function getGrowthTrendConfig(trend: GrowthTrend): GrowthTrendConfig {
  return GROWTH_TRENDS.find(t => t.key === trend) || GROWTH_TRENDS[1];
}

// -------------------------------------------------------
// Comprehensive Student Performance Metrics
// -------------------------------------------------------
export interface StudentPerformanceMetrics {
  // ── Core Metrics ──
  examPerformance: number;        // Weighted: total earned / total possible × 100
  attendanceScore: number;        // Points-based: sum(points) / max points × 100
  assignmentCompliance: number;   // Submissions completed / total × 100
  assignmentQuality: number;      // Points earned / points possible × 100

  // ── Composite ──
  overallPerformance: number;     // Weighted average of available components
  performanceLevel: PerformanceLevel;

  // ── Efficiency ──
  effortScore: number;
  resultScore: number;
  efficiency: number;
  efficiencyLevel: EfficiencyLevel;

  // ── Discipline ──
  disciplineScore: number;

  // ── Growth ──
  growthIndex: number;           // Ratio: recent avg / earliest avg
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
// Instead of averaging percentages, use total marks.
// This prevents small quizzes from having equal weight
// with major exams.
// -------------------------------------------------------
export function calculateExamPerformance(
  scores: Array<{ score: number; total: number }>
): { value: number; totalEarned: number; totalPossible: number } {
  const totalEarned = scores.reduce((sum, s) => sum + s.score, 0);
  const totalPossible = scores.reduce((sum, s) => sum + s.total, 0);
  const value = totalPossible > 0 ? (totalEarned / totalPossible) * 100 : 0;
  return { value, totalEarned, totalPossible };
}

// -------------------------------------------------------
// Calculation: Attendance Score (Points-Based)
// Each session gets points based on status:
// present=100, late=75, partial=50, absent=0
// Students without a record for a session are "absent" (0 pts).
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
      const points = ATTENDANCE_POINTS[status];
      totalPoints += points;
      if (status === 'present') onTimeCount++;
      if (status === 'late') lateCount++;
    }
    // No record = absent = 0 points (already default)
  });

  const attended = studentRecords.length;
  const value = maxPoints > 0 ? (totalPoints / maxPoints) * 100 : 0;

  return { value, attended, total: sessions.length, lateCount, onTimeCount };
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
  return { value, completed, total: params.totalAssignments };
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
      // Check if submitted after due date
      if (assignment.due_date && sub.submitted_at) {
        if (new Date(sub.submitted_at) > new Date(assignment.due_date)) {
          missedDeadlines++;
        }
      }
    } else {
      // Not submitted = 0 earned, but max_score still counts as possible
      totalPossible += assignment.max_score || 0;
      if (assignment.due_date && new Date() > new Date(assignment.due_date)) {
        missedDeadlines++;
      }
    }
  });

  const value = totalPossible > 0 ? (totalEarned / totalPossible) * 100 : 0;
  return { value, totalEarned, totalPossible, missedDeadlines };
}

// -------------------------------------------------------
// Calculation: Overall Performance
// Default weights: Exam=35%, Attendance=20%, Compliance=15%, Quality=30%
// Auto-normalize when a component has no data.
// -------------------------------------------------------
export function calculateOverallPerformance(components: {
  examPerformance?: number;
  attendanceScore?: number;
  assignmentCompliance?: number;
  assignmentQuality?: number;
}): number {
  const parts: { value: number; weight: number }[] = [];
  if (components.examPerformance !== undefined) parts.push({ value: components.examPerformance, weight: DEFAULT_WEIGHTS.examPerformance });
  if (components.attendanceScore !== undefined) parts.push({ value: components.attendanceScore, weight: DEFAULT_WEIGHTS.attendanceScore });
  if (components.assignmentCompliance !== undefined) parts.push({ value: components.assignmentCompliance, weight: DEFAULT_WEIGHTS.assignmentCompliance });
  if (components.assignmentQuality !== undefined) parts.push({ value: components.assignmentQuality, weight: DEFAULT_WEIGHTS.assignmentQuality });
  if (parts.length === 0) return 0;
  const totalWeight = parts.reduce((sum, c) => sum + c.weight, 0);
  return parts.reduce((sum, c) => sum + (c.value * c.weight), 0) / totalWeight;
}

// -------------------------------------------------------
// Calculation: Efficiency
// Redesigned to handle low-effort students properly.
// If effort < 40, show "Insufficient Data" instead of
// misleadingly high efficiency.
// -------------------------------------------------------
export function calculateEfficiency(params: {
  attendanceScore: number;
  assignmentCompliance: number;
  overallPerformance: number;
}): { effortScore: number; resultScore: number; efficiency: number; efficiencyLevel: EfficiencyLevel } {
  const effortScore = (params.attendanceScore * 0.5) + (params.assignmentCompliance * 0.5);
  const resultScore = params.overallPerformance;
  const efficiency = effortScore >= 40
    ? Math.min((resultScore / effortScore) * 100, 100)
    : 0;
  const efficiencyLevel = getEfficiencyLevel(efficiency, effortScore);
  return { effortScore, resultScore, efficiency, efficiencyLevel };
}

// -------------------------------------------------------
// Calculation: Discipline Score (0-100)
// Measures behavioral commitment separately from academics.
// Factors: attendance consistency, on-time submissions,
// late arrivals, missed deadlines.
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

  // Component 1: Attendance consistency (40%)
  // Penalized by late arrivals
  const latePenalty = totalSessions > 0 ? (lateCount / totalSessions) * 20 : 0; // max 20 point penalty
  const attendanceComponent = Math.max(0, attendanceScore - latePenalty);

  // Component 2: On-time submission rate (40%)
  const onTimeRate = totalAssignments > 0 ? (onTimeSubmissions / totalAssignments) * 100 : 100; // default 100 if no assignments

  // Component 3: Deadline respect (20%)
  const deadlineRespect = totalAssignments > 0
    ? Math.max(0, 100 - (missedDeadlines / totalAssignments) * 100)
    : 100; // default 100 if no assignments

  return (attendanceComponent * 0.4) + (onTimeRate * 0.4) + (deadlineRespect * 0.2);
}

// -------------------------------------------------------
// Calculation: Growth Index
// Compares recent assessments to earliest assessments.
// Returns ratio and trend classification.
// -------------------------------------------------------
export function calculateGrowthIndex(
  scores: Array<{ completed_at: string; score: number; total: number }>
): { index: number; trend: GrowthTrend; recentAvg: number; earliestAvg: number } {
  if (scores.length < 2) {
    return { index: 1, trend: 'stable', recentAvg: 0, earliestAvg: 0 };
  }

  // Sort by date ascending
  const sorted = [...scores].sort((a, b) =>
    new Date(a.completed_at).getTime() - new Date(b.completed_at).getTime()
  );

  // Split into earliest third and recent third
  const third = Math.max(1, Math.floor(sorted.length / 3));
  const earliest = sorted.slice(0, third);
  const recent = sorted.slice(-third);

  const earliestAvg = earliest.reduce((sum, s) => sum + (s.total > 0 ? (s.score / s.total) * 100 : 0), 0) / earliest.length;
  const recentAvg = recent.reduce((sum, s) => sum + (s.total > 0 ? (s.score / s.total) * 100 : 0), 0) / recent.length;

  const index = earliestAvg > 0 ? recentAvg / earliestAvg : (recentAvg > 0 ? 2 : 1);

  let trend: GrowthTrend;
  if (index >= 1.1) trend = 'improving';     // ≥10% improvement
  else if (index >= 0.9) trend = 'stable';    // Within ±10%
  else trend = 'declining';                    // >10% decline

  return { index, trend, recentAvg, earliestAvg };
}

// -------------------------------------------------------
// Calculation: Risk Detection
// Automated risk engine that triggers alerts.
// -------------------------------------------------------
export function calculateRiskLevel(params: {
  attendanceScore: number;
  overallPerformance: number;
  missedLastThreeAssignments: boolean;
  growthTrend: GrowthTrend;
  daysSinceLastActivity: number | null;
  inactivityThreshold?: number; // configurable, default 14 days
}): { level: RiskLevel; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0; // 0 = healthy, higher = more risk

  // Check attendance below 50%
  if (params.attendanceScore < 50) {
    reasons.push('attendanceBelow50');
    score += 3;
  } else if (params.attendanceScore < 70) {
    reasons.push('attendanceBelow70');
    score += 1;
  }

  // Check overall performance below 60%
  if (params.overallPerformance < 60) {
    reasons.push('performanceBelow60');
    score += 3;
  } else if (params.overallPerformance < 70) {
    reasons.push('performanceBelow70');
    score += 1;
  }

  // Missing last 3 assignments
  if (params.missedLastThreeAssignments) {
    reasons.push('missedLast3Assignments');
    score += 2;
  }

  // Continuous decline
  if (params.growthTrend === 'declining') {
    reasons.push('decliningTrend');
    score += 2;
  }

  // Inactivity check
  const threshold = params.inactivityThreshold ?? 14;
  if (params.daysSinceLastActivity !== null && params.daysSinceLastActivity > threshold) {
    reasons.push('inactivity');
    score += 2;
  }

  // Determine level
  let level: RiskLevel;
  if (score >= 6) level = 'atRisk';
  else if (score >= 4) level = 'concern';
  else if (score >= 2) level = 'monitor';
  else level = 'healthy';

  return { level, reasons };
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

  // Filter data for this student
  const studentScores = allScores.filter(s => s.student_id === studentId);

  // 1. Exam Performance (Weighted)
  const exam = calculateExamPerformance(studentScores);

  // 2. Attendance Score (Points-Based)
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
  // Check if student missed last 3 assignments
  const recentAssignments = [...assignments]
    .sort((a, b) => {
      const dateA = a.due_date || '';
      const dateB = b.due_date || '';
      return new Date(dateB).getTime() - new Date(dateA).getTime();
    })
    .slice(0, 3);
  const missedLastThree = recentAssignments.length === 3 && recentAssignments.every(a =>
    !submissions.some(s => s.student_id === studentId && s.assignment_id === a.id && (s.status === 'graded' || s.status === 'submitted'))
  );

  // Calculate days since last activity
  const allDates = [
    ...studentScores.map(s => s.completed_at),
    ...attendanceRecords.filter(r => r.student_id === studentId).map(() => ''),
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
// Avoids showing exact rank positions.
// -------------------------------------------------------
export function calculatePercentile(studentScore: number, allScores: number[]): number {
  if (allScores.length === 0) return 0;
  const below = allScores.filter(s => s < studentScore).length;
  return (below / allScores.length) * 100;
}

export function getPercentileLabel(percentile: number): string {
  if (percentile >= 95) return 'top5';
  if (percentile >= 90) return 'top10';
  if (percentile >= 75) return 'top25';
  if (percentile >= 50) return 'top50';
  return 'below50';
}

// -------------------------------------------------------
// Per-Subject Performance
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
  // Raw counts
  quizCount: number;
  totalSessions: number;
  attendedSessions: number;
  assignmentCount: number;
  completedAssignments: number;
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

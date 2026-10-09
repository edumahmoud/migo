// =====================================================
// Analytics Type Definitions
// Strongly typed models for all analytics data.
// No "any" types. No loose structures.
// =====================================================

import type {
  PerformanceLevel,
  EfficiencyLevel,
  RiskLevel,
  GrowthTrend,
} from './analytics-config';

// -------------------------------------------------------
// Core Metric Types
// -------------------------------------------------------

/** Exam performance: weighted total earned / total possible */
export interface ExamPerformanceResult {
  value: number;
  totalEarned: number;
  totalPossible: number;
}

/** Attendance score: points-based across sessions */
export interface AttendanceScoreResult {
  value: number;
  attended: number;
  total: number;
  lateCount: number;
  onTimeCount: number;
}

/** Assignment compliance: submission rate */
export interface AssignmentComplianceResult {
  value: number;
  completed: number;
  total: number;
}

/** Assignment quality: points earned / points possible */
export interface AssignmentQualityResult {
  value: number;
  totalEarned: number;
  totalPossible: number;
  missedDeadlines: number;
}

// -------------------------------------------------------
// Composite Metric Types
// -------------------------------------------------------

/** Performance metrics: the four pillars + overall + level */
export interface PerformanceMetrics {
  examPerformance: number;
  attendanceScore: number;
  assignmentCompliance: number;
  assignmentQuality: number;
  overallPerformance: number;
  performanceLevel: PerformanceLevel;
}

/** Efficiency metrics: effort vs results */
export interface EfficiencyMetrics {
  effortScore: number;
  resultScore: number;
  efficiency: number;
  efficiencyLevel: EfficiencyLevel;
}

/** Discipline metrics: behavioral commitment */
export interface DisciplineMetrics {
  disciplineScore: number;
  attendanceConsistency: number;
  onTimeSubmissionRate: number;
  deadlineRespectRate: number;
}

/** Growth metrics: trend over time.
 *  Note: `growthIndex` and `improvementPercentage` are `null` when the
 *  earliest average is 0 — ratio-based growth is undefined in that case.
 *  Consumers should render "تحسن مطلق / Absolute improvement" with the
 *  point difference (`recentAvg - earliestAvg`) instead of a numeric ratio. */
export interface GrowthMetrics {
  growthIndex: number | null;
  growthTrend: GrowthTrend;
  recentAvg: number;
  earliestAvg: number;
  improvementPercentage: number | null;
}

/** Risk evidence: structured per-reason evidence with numeric value,
 *  threshold, sample size, and data-sufficiency flag.
 *  Added in Phase 2A to give teachers actionable context instead of
 *  bare reason strings. */
export interface RiskEvidence {
  /** Reason key, e.g. 'attendanceBelow50'. Same keys as in `riskReasons`. */
  key: string;
  /** Actual numeric value observed (e.g. 35 for 35% attendance). Null when not applicable (e.g. missed3 is boolean). */
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

/** Risk metrics: early risk detection.
 *  Phase 2A additions:
 *  - `evidence`: structured per-reason evidence array (replaces bare strings for UI).
 *  - `dataSufficiency`: overall flag — 'insufficient' when ANY indicator lacks
 *    sufficient data. UI should display "بيانات غير كافية" instead of a
 *    misleading "healthy" label when this is 'insufficient' and riskScore is 0. */
export interface RiskMetrics {
  riskLevel: RiskLevel;
  riskScore: number;
  riskReasons: string[];
  /** Structured evidence per triggered OR insufficient indicator. */
  evidence: RiskEvidence[];
  /** Overall data sufficiency. 'insufficient' when at least one indicator
   *  would have triggered but lacked sufficient sample size. */
  dataSufficiency: 'sufficient' | 'insufficient';
}

/** Ranking metrics: percentile-based positioning */
export interface RankingMetrics {
  percentile: number;
  percentileLabel: string;
  courseRank?: number;
  cohortSize: number;
}

// -------------------------------------------------------
// Student Analytics (complete profile)
// -------------------------------------------------------

export interface StudentAnalytics {
  studentId: string;
  performance: PerformanceMetrics;
  efficiency: EfficiencyMetrics;
  discipline: DisciplineMetrics;
  growth: GrowthMetrics;
  risk: RiskMetrics;
  ranking: RankingMetrics;

  // Raw data counts
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
// Course Analytics (per-subject)
// -------------------------------------------------------

export interface CourseAnalytics {
  subjectId: string;
  subjectName: string;
  performance: PerformanceMetrics;
  growth: GrowthMetrics;
  risk: RiskMetrics;

  // Raw counts
  quizCount: number;
  totalSessions: number;
  attendedSessions: number;
  assignmentCount: number;
  completedAssignments: number;
}

// -------------------------------------------------------
// Cohort Analytics (group-level distributions)
// -------------------------------------------------------

export interface DistributionBucket {
  label: string;
  count: number;
  percentage: number;
}

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
  high: number;     // >= 80
  medium: number;   // >= 60
  low: number;      // < 60
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

// -------------------------------------------------------
// Historical Analytics (future-ready)
// -------------------------------------------------------

export interface HistoricalSnapshot {
  date: string;
  overallPerformance: number;
  examPerformance: number;
  attendanceScore: number;
  assignmentCompliance: number;
  assignmentQuality: number;
  disciplineScore: number;
  efficiency: number;
}

export interface HistoricalTrend {
  snapshots: HistoricalSnapshot[];
  currentTrend: GrowthTrend;
  changeFromPrevious: number;
}

// -------------------------------------------------------
// Activity Timeline
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
// Export Data Row
// -------------------------------------------------------

export interface AnalyticsExportRow {
  studentName: string;
  studentEmail: string;
  examPerformance: string;
  attendanceScore: string;
  assignmentCompliance: string;
  assignmentQuality: string;
  overallPerformance: string;
  classification: string;
  efficiency: string;
  efficiencyLevel: string;
  discipline: string;
  growthIndex: string;
  growthTrend: string;
  riskLevel: string;
  riskReasons: string;
  ranking: string;
}

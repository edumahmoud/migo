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

/** Growth metrics: trend over time */
export interface GrowthMetrics {
  growthIndex: number;
  growthTrend: GrowthTrend;
  recentAvg: number;
  earliestAvg: number;
  improvementPercentage: number;
}

/** Risk metrics: early risk detection */
export interface RiskMetrics {
  riskLevel: RiskLevel;
  riskScore: number;
  riskReasons: string[];
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

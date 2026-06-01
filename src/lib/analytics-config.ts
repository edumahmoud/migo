// =====================================================
// Analytics Configuration Layer
// Centralized configuration for ALL analytics constants.
// No analytics logic may use hardcoded values.
// Every weight, threshold, and classification range
// must reference this module.
// =====================================================

// -------------------------------------------------------
// Attendance Status Point Values
// -------------------------------------------------------
export const ATTENDANCE_POINTS: Record<string, number> = {
  present: 100,
  late: 75,
  partial: 50,
  absent: 0,
} as const;

// -------------------------------------------------------
// Performance Weights (must sum to 100)
// -------------------------------------------------------
export const PERFORMANCE_WEIGHTS = {
  examPerformance: 35,
  attendanceScore: 20,
  assignmentCompliance: 15,
  assignmentQuality: 30,
} as const;

// -------------------------------------------------------
// Performance Level Classification Ranges
// -------------------------------------------------------
export const PERFORMANCE_CLASSIFICATION = {
  excellent: { min: 90, label: 'excellent' },
  veryGood: { min: 80, label: 'veryGood' },
  good: { min: 70, label: 'good' },
  acceptable: { min: 60, label: 'acceptable' },
  weak: { min: 0, label: 'weak' },
} as const;

// -------------------------------------------------------
// Efficiency Thresholds
// -------------------------------------------------------
export const EFFICIENCY_THRESHOLDS = {
  insufficientEffort: 40, // Below this effort, show "Insufficient Data"
  high: 80,
  medium: 50,
  // below medium → low
} as const;

// -------------------------------------------------------
// Risk Assessment Thresholds
// -------------------------------------------------------
export const RISK_THRESHOLDS = {
  // Attendance triggers
  attendanceCritical: 50,    // below this → +3 risk score
  attendanceWarning: 70,     // below this → +1 risk score

  // Performance triggers
  performanceCritical: 60,   // below this → +3 risk score
  performanceWarning: 70,    // below this → +1 risk score

  // Risk score contributions
  criticalContribution: 3,
  warningContribution: 1,
  missedAssignmentContribution: 2,
  decliningTrendContribution: 2,
  inactivityContribution: 2,

  // Risk level thresholds
  atRisk: 6,       // score >= 6
  concern: 4,      // score >= 4
  monitor: 2,      // score >= 2
  // below 2 → healthy

  // Inactivity
  inactivityDays: 14,  // days since last activity
} as const;

// -------------------------------------------------------
// Growth / Trend Thresholds
// -------------------------------------------------------
export const GROWTH_THRESHOLDS = {
  improving: 1.1,    // ratio >= 1.1 → improving (10%+ growth)
  stable: 0.9,       // ratio >= 0.9 → stable (within ±10%)
  // below 0.9 → declining
} as const;

// -------------------------------------------------------
// Discipline Weights (must sum to 1.0)
// -------------------------------------------------------
export const DISCIPLINE_WEIGHTS = {
  attendanceConsistency: 0.4,
  onTimeSubmissions: 0.4,
  deadlineRespect: 0.2,
} as const;

// -------------------------------------------------------
// Discipline Penalty
// -------------------------------------------------------
export const DISCIPLINE_PENALTIES = {
  lateArrivalMaxPenalty: 20, // max point penalty from attendance score
} as const;

// -------------------------------------------------------
// Ranking / Percentile Bands
// -------------------------------------------------------
export const RANKING_BANDS = {
  top5: 95,     // percentile >= 95
  top10: 90,    // percentile >= 90
  top25: 75,    // percentile >= 75
  top50: 50,    // percentile >= 50
  // below 50 → below50
} as const;

// -------------------------------------------------------
// Efficiency Calculation Weights
// -------------------------------------------------------
export const EFFICIENCY_WEIGHTS = {
  attendanceContribution: 0.5,
  complianceContribution: 0.5,
} as const;

// -------------------------------------------------------
// Growth Calculation: Fraction of scores for earliest/recent
// -------------------------------------------------------
export const GROWTH_CALCULATION = {
  thirdFraction: 3, // divide scores into thirds
} as const;

// -------------------------------------------------------
// Achievement Thresholds
// -------------------------------------------------------
export const ACHIEVEMENT_THRESHOLDS = {
  topPerformerPerformance: 95,     // overallPerformance >= 95 with excellent level
  missedAssignmentCheck: 3,        // check last N assignments for miss streak
} as const;

// -------------------------------------------------------
// UI Display Configs (colors, icons — referenced by components)
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
  { key: 'excellent', min: PERFORMANCE_CLASSIFICATION.excellent.min, color: 'bg-emerald-500', bgColor: 'bg-emerald-50 dark:bg-emerald-900/20', ringColor: 'ring-emerald-100', textColor: 'text-emerald-700 dark:text-emerald-500', icon: '★' },
  { key: 'veryGood', min: PERFORMANCE_CLASSIFICATION.veryGood.min, color: 'bg-sky-500', bgColor: 'bg-sky-50 dark:bg-sky-900/15', ringColor: 'ring-sky-100', textColor: 'text-sky-700 dark:text-sky-400', icon: '◆' },
  { key: 'good', min: PERFORMANCE_CLASSIFICATION.good.min, color: 'bg-teal-500', bgColor: 'bg-teal-50 dark:bg-teal-900/20', ringColor: 'ring-teal-100', textColor: 'text-teal-700 dark:text-teal-500', icon: '●' },
  { key: 'acceptable', min: PERFORMANCE_CLASSIFICATION.acceptable.min, color: 'bg-amber-500', bgColor: 'bg-amber-50 dark:bg-amber-900/20', ringColor: 'ring-amber-100', textColor: 'text-amber-700 dark:text-amber-500', icon: '▲' },
  { key: 'weak', min: PERFORMANCE_CLASSIFICATION.weak.min, color: 'bg-rose-500', bgColor: 'bg-rose-50 dark:bg-rose-900/20', ringColor: 'ring-rose-100', textColor: 'text-rose-700 dark:text-rose-500', icon: '▼' },
];

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

export type GrowthTrend = 'improving' | 'stable' | 'declining';

export interface GrowthTrendConfig {
  key: GrowthTrend;
  color: string;
  textColor: string;
  icon: string;
}

export const GROWTH_TRENDS: GrowthTrendConfig[] = [
  { key: 'improving', color: 'bg-emerald-500', textColor: 'text-emerald-600 dark:text-emerald-500', icon: '↑' },
  { key: 'stable', color: 'bg-sky-500', textColor: 'text-sky-600 dark:text-sky-500', icon: '→' },
  { key: 'declining', color: 'bg-rose-500', textColor: 'text-rose-600 dark:text-rose-500', icon: '↓' },
];

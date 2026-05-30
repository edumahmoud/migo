# Analytics Engine Documentation

> Comprehensive technical reference for the student analytics system.
> Covers architecture, formulas, classification rules, and configuration.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Performance Weights & Formula](#2-performance-weights--formula)
3. [Classification Ranges](#3-classification-ranges)
4. [Efficiency Calculation](#4-efficiency-calculation)
5. [Discipline Score](#5-discipline-score)
6. [Growth Index](#6-growth-index)
7. [Risk Assessment Rules](#7-risk-assessment-rules)
8. [Ranking & Percentiles](#8-ranking--percentiles)
9. [Cohort Analytics](#9-cohort-analytics)
10. [Historical Analytics Architecture](#10-historical-analytics-architecture)
11. [Configuration Reference](#11-configuration-reference)

---

## 1. Architecture Overview

The analytics system is built on a three-layer architecture that enforces separation of concerns, type safety, and single-source-of-truth configuration.

### Layer 1: `analytics-config.ts` — Centralized Configuration

All constants, weights, thresholds, and classification ranges live in one module. **No analytics logic may use hardcoded values** — every weight, threshold, and range must reference this module. This design ensures that a single edit propagates consistently across teacher views, student views, and profile modals.

Contains:

- Attendance point values (`ATTENDANCE_POINTS`)
- Performance weights (`PERFORMANCE_WEIGHTS`)
- Classification ranges (`PERFORMANCE_CLASSIFICATION`)
- Efficiency thresholds (`EFFICIENCY_THRESHOLDS`)
- Risk thresholds (`RISK_THRESHOLDS`)
- Growth thresholds (`GROWTH_THRESHOLDS`)
- Discipline weights and penalties (`DISCIPLINE_WEIGHTS`, `DISCIPLINE_PENALTIES`)
- Ranking percentile bands (`RANKING_BANDS`)
- Efficiency calculation weights (`EFFICIENCY_WEIGHTS`)
- Growth calculation parameters (`GROWTH_CALCULATION`)
- Achievement thresholds (`ACHIEVEMENT_THRESHOLDS`)
- UI display configurations (`PERFORMANCE_LEVELS`, `EFFICIENCY_LEVELS`, `RISK_LEVELS`, `GROWTH_TRENDS`)

### Layer 2: `analytics-types.ts` — Strongly Typed Models

Defines all interfaces and type aliases used throughout the analytics pipeline. No `any` types, no loose structures. Types are grouped into:

| Category | Interfaces |
|---|---|
| **Core Metrics** | `ExamPerformanceResult`, `AttendanceScoreResult`, `AssignmentComplianceResult`, `AssignmentQualityResult` |
| **Composite Metrics** | `PerformanceMetrics`, `EfficiencyMetrics`, `DisciplineMetrics`, `GrowthMetrics`, `RiskMetrics`, `RankingMetrics` |
| **Student Profile** | `StudentAnalytics` (complete student analytics profile) |
| **Course Analytics** | `CourseAnalytics` (per-subject breakdown) |
| **Cohort Analytics** | `CohortAnalytics`, `CohortPerformanceDistribution`, `CohortRiskDistribution`, `CohortGrowthDistribution`, `CohortDisciplineDistribution` |
| **Historical** | `HistoricalSnapshot`, `HistoricalTrend` |
| **Activity** | `ActivityEvent`, `ActivityType` |
| **Export** | `AnalyticsExportRow` |

### Layer 3: `performance-calculator.ts` — Calculation Engine

Pure-function engine that transforms raw data into computed metrics. All formulas are centralized here for consistency across every consumer. No UI component should compute metrics independently.

Key functions:

| Function | Purpose |
|---|---|
| `calculateExamPerformance()` | Weighted exam score from total earned / total possible |
| `calculateAttendanceScore()` | Points-based attendance across sessions |
| `calculateAssignmentCompliance()` | Submission rate |
| `calculateAssignmentQuality()` | Points earned / points possible |
| `calculateOverallPerformance()` | Weighted composite with auto-normalization |
| `calculateEfficiency()` | Effort vs. result ratio |
| `calculateDisciplineScore()` | Behavioral commitment score (0–100) |
| `calculateGrowthIndex()` | Trend detection across scored items |
| `calculateRiskLevel()` | Multi-signal risk detection |
| `calculatePercentile()` | Percentile ranking among peers |
| `computeAllMetrics()` | Master calculation — single entry point |
| `computeSubjectPerformance()` | Per-subject performance calculation |
| `computeCohortAnalytics()` | Aggregated cohort distributions |

### Data Flow

```
Raw Data (scores, attendance records, submissions, assignments)
        │
        ▼
┌─────────────────────────────────┐
│   performance-calculator.ts     │
│   (computeAllMetrics)           │
│                                 │
│   1. Exam Performance           │
│   2. Attendance Score           │
│   3. Assignment Compliance      │
│   4. Assignment Quality         │
│   5. Overall Performance        │
│   6. Efficiency                 │
│   7. Discipline Score           │
│   8. Growth Index               │
│   9. Risk Detection             │
└─────────┬───────────────────────┘
          │
          ▼
┌─────────────────────────────────┐
│   Computed Metrics              │
│   (StudentPerformanceMetrics)   │
└─────────┬───────────────────────┘
          │
          ▼
┌─────────────────────────────────┐
│   UI Components                 │
│   (Teacher Dashboard,           │
│    Student Dashboard,           │
│    Profile Modal)               │
└─────────────────────────────────┘
```

---

## 2. Performance Weights & Formula

### Component Weights

The overall performance score is a weighted sum of four pillars. Weights **must sum to 100**:

| Component | Weight | Source |
|---|---|---|
| Exam Performance | 35% | `PERFORMANCE_WEIGHTS.examPerformance` |
| Attendance Score | 20% | `PERFORMANCE_WEIGHTS.attendanceScore` |
| Assignment Compliance | 15% | `PERFORMANCE_WEIGHTS.assignmentCompliance` |
| Assignment Quality | 30% | `PERFORMANCE_WEIGHTS.assignmentQuality` |

### Component Calculation Details

#### Exam Performance (35%)

```
value = (totalEarned / totalPossible) × 100
```

Uses total marks rather than averaging percentages. This prevents small quizzes from having equal weight with major exams — a 10/10 quiz and a 90/100 exam produce `100/110 = 90.9%`, not an average of `(100% + 90%) / 2 = 95%`.

#### Attendance Score (20%)

Points-based system mapped from `ATTENDANCE_POINTS`:

| Status | Points |
|---|---|
| `present` | 100 |
| `late` | 75 |
| `partial` | 50 |
| `absent` | 0 |
| No record | 0 (treated as absent) |

```
value = (totalPoints / maxPoints) × 100
maxPoints = sessions.length × 100
```

#### Assignment Compliance (15%)

Measures commitment — did the student submit?

```
completed = submissions with status "graded" OR "submitted"
value = (completed / totalAssignments) × 100
```

#### Assignment Quality (30%)

Measures academic quality — what score did the student earn?

```
value = (totalEarnedPoints / totalPossiblePoints) × 100
```

Unsubmitted or ungraded assignments contribute 0 earned points but still add to `totalPossible`, naturally penalizing non-submission.

### Overall Performance Formula

```typescript
overallPerformance = Σ(value_i × weight_i) / Σ(available_weight_i)
```

### Auto-Normalization

When a component has no data (e.g., a student has no exam scores), that component's weight is excluded from the denominator. The remaining components' weights are **not rescaled** — instead, the total available weight is used as the denominator.

Example: A student with no exam data:

```
overallPerformance = (attendance × 20 + compliance × 15 + quality × 30) / (20 + 15 + 30)
```

If no components have data, the result is `0`.

---

## 3. Classification Ranges

Overall performance is classified into five levels based on `PERFORMANCE_CLASSIFICATION`:

| Level | Minimum | Config Key | Color | Icon |
|---|---|---|---|---|
| **Excellent** | ≥ 90% | `excellent` | Emerald | ★ |
| **Very Good** | ≥ 80% | `veryGood` | Sky | ◆ |
| **Good** | ≥ 70% | `good` | Teal | ● |
| **Acceptable** | ≥ 60% | `acceptable` | Amber | ▲ |
| **Weak** | < 60% | `weak` | Rose | ▼ |

Classification is evaluated top-down — the first matching range wins:

```typescript
if (overallPct >= 90) return 'excellent';
if (overallPct >= 80) return 'veryGood';
if (overallPct >= 70) return 'good';
if (overallPct >= 60) return 'acceptable';
return 'weak';
```

---

## 4. Efficiency Calculation

Efficiency measures how effectively a student converts effort into results.

### Effort Score

```
effortScore = (attendanceScore × 0.5) + (assignmentCompliance × 0.5)
```

Weights come from `EFFICIENCY_WEIGHTS`:
- `attendanceContribution`: 0.5
- `complianceContribution`: 0.5

### Efficiency Value

```
if effortScore < 40:
    efficiency = 0  →  level = "Insufficient Data"
else:
    efficiency = min((resultScore / effortScore) × 100, 100)
```

Where `resultScore` equals `overallPerformance`.

The efficiency value is capped at 100 to prevent a student with low effort but moderate performance from showing an artificially high efficiency.

### Efficiency Levels

| Level | Threshold | Config |
|---|---|---|
| **High** | efficiency ≥ 80 | `EFFICIENCY_THRESHOLDS.high` |
| **Medium** | efficiency ≥ 50 | `EFFICIENCY_THRESHOLDS.medium` |
| **Low** | efficiency < 50 | (below medium threshold) |
| **Insufficient Data** | effortScore < 40 | `EFFICIENCY_THRESHOLDS.insufficientEffort` |

### Example

| Attendance | Compliance | Effort | Performance | Efficiency | Level |
|---|---|---|---|---|---|
| 90 | 80 | 85 | 88 | 103.5 → 100 | High |
| 70 | 60 | 65 | 75 | 115.4 → 100 | High |
| 50 | 40 | 45 | 30 | 66.7 | Medium |
| 30 | 20 | 25 | 50 | 0 | Insufficient Data |

---

## 5. Discipline Score

The discipline score (0–100) measures behavioral commitment through three components.

### Component Weights

Weights **must sum to 1.0** (from `DISCIPLINE_WEIGHTS`):

| Component | Weight |
|---|---|
| Attendance Consistency | 0.4 |
| On-Time Submissions | 0.4 |
| Deadline Respect | 0.2 |

### Component Calculations

#### 1. Attendance Consistency (40%)

The attendance score is penalized by late arrivals:

```
latePenalty = (lateCount / totalSessions) × lateArrivalMaxPenalty
attendanceComponent = max(0, attendanceScore - latePenalty)
```

`lateArrivalMaxPenalty` is 20 points (`DISCIPLINE_PENALTIES.lateArrivalMaxPenalty`). This means a student who is late for every session loses at most 20 points from their attendance component.

#### 2. On-Time Submissions (40%)

```
onTimeRate = (onTimeSubmissions / totalAssignments) × 100
```

If no assignments exist, defaults to 100 (no penalty for no assignments).

A submission is "on time" if it has status `graded` or `submitted` AND was submitted before the assignment's due date.

#### 3. Deadline Respect (20%)

```
deadlineRespect = max(0, 100 - (missedDeadlines / totalAssignments) × 100)
```

If no assignments exist, defaults to 100. Both unsubmitted past-due assignments and late submissions count as missed deadlines.

### Final Score

```
disciplineScore = (attendanceComponent × 0.4) + (onTimeRate × 0.4) + (deadlineRespect × 0.2)
```

### Discipline Distribution Bands

| Band | Range |
|---|---|
| High | ≥ 80 |
| Medium | ≥ 60 and < 80 |
| Low | < 60 |

---

## 6. Growth Index

The growth index measures a student's trajectory by comparing recent performance against earlier performance.

### Calculation Method

1. Sort all scored items by `completed_at` date (chronological order).
2. Divide the sorted list into thirds (`GROWTH_CALCULATION.thirdFraction = 3`).
3. Take the **earliest third** and the **recent third** (discard the middle).
4. Calculate the average percentage score for each third:

```
earliestAvg = mean(score_i / total_i × 100) for i in earliest third
recentAvg   = mean(score_i / total_i × 100) for i in recent third
```

5. Compute the growth index:

```
if earliestAvg > 0:
    growthIndex = recentAvg / earliestAvg
elif recentAvg > 0:
    growthIndex = 2  (special case: went from zero to non-zero)
else:
    growthIndex = 1  (no data for either period)
```

6. Compute improvement percentage:

```
improvementPercentage = ((recentAvg - earliestAvg) / earliestAvg) × 100
```

### Minimum Data Requirement

If fewer than 2 scored items exist, the function returns a default: `{ index: 1, trend: 'stable', recentAvg: 0, earliestAvg: 0, improvementPercentage: 0 }`.

### Trend Classification

| Trend | Condition | Meaning |
|---|---|---|
| **Improving** | index ≥ 1.1 | 10%+ growth over the period |
| **Stable** | index ≥ 0.9 | Within ±10% of earlier performance |
| **Declining** | index < 0.9 | More than 10% drop from earlier performance |

Configured via `GROWTH_THRESHOLDS`:
- `improving`: 1.1
- `stable`: 0.9

### Example

| Period | Scores | Average |
|---|---|---|
| Earliest (first third) | 60%, 70%, 50% | 60% |
| Recent (last third) | 75%, 80%, 85% | 80% |

```
growthIndex = 80 / 60 = 1.33 → Improving
improvementPercentage = ((80 - 60) / 60) × 100 = 33.3%
```

---

## 7. Risk Assessment Rules

The risk system uses a point-scoring approach across multiple signals. Each trigger adds a contribution to the total risk score, and the cumulative score determines the risk level.

### Risk Score Contributions

| Signal | Condition | Contribution | Config Key |
|---|---|---|---|
| Attendance critically low | attendance < 50% | +3 | `RISK_THRESHOLDS.attendanceCritical` → `criticalContribution` |
| Attendance below warning | attendance < 70% | +1 | `RISK_THRESHOLDS.attendanceWarning` → `warningContribution` |
| Performance critically low | performance < 60% | +3 | `RISK_THRESHOLDS.performanceCritical` → `criticalContribution` |
| Performance below warning | performance < 70% | +1 | `RISK_THRESHOLDS.performanceWarning` → `warningContribution` |
| Missed last 3 assignments | `missedLastThreeAssignments = true` | +2 | `RISK_THRESHOLDS.missedAssignmentContribution` |
| Declining trend | `growthTrend === 'declining'` | +2 | `RISK_THRESHOLDS.decliningTrendContribution` |
| Inactivity | days since last activity > 14 | +2 | `RISK_THRESHOLDS.inactivityContribution` |

> **Note:** Attendance and performance signals are mutually exclusive within each category. If attendance < 50%, the +3 critical contribution is applied (not +3 + 1). The check uses `if/else if`, so only the highest applicable trigger fires per category.

### Missed Last 3 Assignments Detection

The system sorts assignments by due date (most recent first), takes the top `ACHIEVEMENT_THRESHOLDS.missedAssignmentCheck` (3) assignments, and checks whether the student has no graded or submitted submission for any of them. The flag is `true` only if **all** of the most recent 3 assignments were missed.

### Inactivity Detection

The system considers all score completion dates and submission timestamps for the student. The most recent timestamp is compared against the current time. If the difference exceeds `RISK_THRESHOLDS.inactivityDays` (14 days), the inactivity signal triggers.

### Risk Level Thresholds

| Level | Score Range | Config Key |
|---|---|---|
| **At Risk** | score ≥ 6 | `RISK_THRESHOLDS.atRisk` |
| **Concern** | score ≥ 4 | `RISK_THRESHOLDS.concern` |
| **Monitor** | score ≥ 2 | `RISK_THRESHOLDS.monitor` |
| **Healthy** | score < 2 | (default) |

### Example Risk Calculations

| Attendance | Performance | Missed 3 | Declining | Inactive | Score | Level |
|---|---|---|---|---|---|---|
| 45% | 55% | Yes | Yes | Yes | 3+3+2+2+2 = 12 | At Risk |
| 65% | 65% | No | Yes | No | 1+1+2 = 4 | Concern |
| 85% | 75% | No | No | No | 0 | Healthy |
| 40% | 80% | No | No | No | 3 | Monitor |

---

## 8. Ranking & Percentiles

### Percentile Calculation

```typescript
function calculatePercentile(studentScore: number, allScores: number[]): number {
  const below = allScores.filter(s => s < studentScore).length;
  return (below / allScores.length) × 100;
}
```

The percentile represents the percentage of peers who scored below the student. A percentile of 90 means the student outperformed 90% of their cohort.

### Percentile Bands

| Label | Percentile Range | Config Key |
|---|---|---|
| **Top 5%** | ≥ 95th percentile | `RANKING_BANDS.top5` |
| **Top 10%** | ≥ 90th percentile | `RANKING_BANDS.top10` |
| **Top 25%** | ≥ 75th percentile | `RANKING_BANDS.top25` |
| **Top 50%** | ≥ 50th percentile | `RANKING_BANDS.top50` |
| **Below 50%** | < 50th percentile | (default) |

### Ranking Metadata

The `RankingMetrics` interface includes:
- `percentile`: numeric percentile value
- `percentileLabel`: one of the band labels above
- `courseRank`: optional absolute rank number
- `cohortSize`: total number of students in the comparison group

---

## 9. Cohort Analytics

Cohort analytics provide aggregated, group-level views for teacher dashboards. The `computeCohortAnalytics()` function takes an array of `StudentPerformanceMetrics` and produces:

### Averages

| Metric | Calculation |
|---|---|
| `avgPerformance` | Mean of `overallPerformance` across all students |
| `avgAttendance` | Mean of `attendanceScore` across all students |
| `avgDiscipline` | Mean of `disciplineScore` across all students |
| `avgEfficiency` | Mean of `efficiency` across all students |

### Distributions

**Performance Distribution** (`CohortPerformanceDistribution`):

Counts students in each performance level:
- `excellent`, `veryGood`, `good`, `acceptable`, `weak`

**Risk Distribution** (`CohortRiskDistribution`):

Counts students in each risk level:
- `healthy`, `monitor`, `concern`, `atRisk`

**Growth Distribution** (`CohortGrowthDistribution`):

Counts students in each growth trend:
- `improving`, `stable`, `declining`

**Discipline Distribution** (`CohortDisciplineDistribution`):

Counts students by discipline band:
- `high`: disciplineScore ≥ 80
- `medium`: disciplineScore ≥ 60 and < 80
- `low`: disciplineScore < 60

### Summary Counts

| Field | Definition |
|---|---|
| `totalStudents` | Total number of students in the cohort |
| `atRiskCount` | Students with risk level `atRisk` or `concern` |
| `topPerformerCount` | Students with performance level `excellent` |

### Empty Cohort Handling

When `allMetrics` is an empty array, all averages return `0` and all distributions return zeroed-out objects.

---

## 10. Historical Analytics Architecture

### Current State

The system currently supports **point-in-time** calculations. All `computeAllMetrics()` calls produce a snapshot of the current state based on the available raw data at the time of invocation. There is no persistence of historical metric values within the calculator itself.

### `HistoricalSnapshot` Interface

The `HistoricalSnapshot` interface is defined and ready for time-series data:

```typescript
interface HistoricalSnapshot {
  date: string;                  // ISO date of the snapshot
  overallPerformance: number;
  examPerformance: number;
  attendanceScore: number;
  assignmentCompliance: number;
  assignmentQuality: number;
  disciplineScore: number;
  efficiency: number;
}
```

### `HistoricalTrend` Interface

```typescript
interface HistoricalTrend {
  snapshots: HistoricalSnapshot[];
  currentTrend: GrowthTrend;
  changeFromPrevious: number;
}
```

### Future Roadmap

| Phase | Capability |
|---|---|
| **Phase 1** | Snapshot persistence — store `HistoricalSnapshot` on a schedule (daily/weekly) |
| **Phase 2** | Trend charts — visualize `snapshots[]` as line charts over time |
| **Phase 3** | Monthly comparisons — compare current month vs. previous month across all metrics |
| **Phase 4** | Predictive analytics — extrapolate `HistoricalTrend` to forecast future performance and risk escalation |

---

## 11. Configuration Reference

All configurable values live in `src/lib/analytics-config.ts`. Below is a complete reference.

### Attendance Points

| Constant | Value | Description |
|---|---|---|
| `ATTENDANCE_POINTS.present` | 100 | Full attendance points |
| `ATTENDANCE_POINTS.late` | 75 | Late arrival points |
| `ATTENDANCE_POINTS.partial` | 50 | Partial attendance points |
| `ATTENDANCE_POINTS.absent` | 0 | Absence points |

### Performance Weights

| Constant | Value | Description |
|---|---|---|
| `PERFORMANCE_WEIGHTS.examPerformance` | 35 | Exam performance weight |
| `PERFORMANCE_WEIGHTS.attendanceScore` | 20 | Attendance score weight |
| `PERFORMANCE_WEIGHTS.assignmentCompliance` | 15 | Assignment compliance weight |
| `PERFORMANCE_WEIGHTS.assignmentQuality` | 30 | Assignment quality weight |

> **Constraint:** These must sum to 100.

### Performance Classification

| Constant | Min Value | Label |
|---|---|---|
| `PERFORMANCE_CLASSIFICATION.excellent.min` | 90 | Excellent |
| `PERFORMANCE_CLASSIFICATION.veryGood.min` | 80 | Very Good |
| `PERFORMANCE_CLASSIFICATION.good.min` | 70 | Good |
| `PERFORMANCE_CLASSIFICATION.acceptable.min` | 60 | Acceptable |
| `PERFORMANCE_CLASSIFICATION.weak.min` | 0 | Weak |

### Efficiency Thresholds

| Constant | Value | Description |
|---|---|---|
| `EFFICIENCY_THRESHOLDS.insufficientEffort` | 40 | Below this effort, show "Insufficient Data" |
| `EFFICIENCY_THRESHOLDS.high` | 80 | High efficiency threshold |
| `EFFICIENCY_THRESHOLDS.medium` | 50 | Medium efficiency threshold |

### Efficiency Weights

| Constant | Value | Description |
|---|---|---|
| `EFFICIENCY_WEIGHTS.attendanceContribution` | 0.5 | Attendance weight in effort score |
| `EFFICIENCY_WEIGHTS.complianceContribution` | 0.5 | Compliance weight in effort score |

### Risk Thresholds

| Constant | Value | Description |
|---|---|---|
| `RISK_THRESHOLDS.attendanceCritical` | 50 | Attendance below this → +3 risk score |
| `RISK_THRESHOLDS.attendanceWarning` | 70 | Attendance below this → +1 risk score |
| `RISK_THRESHOLDS.performanceCritical` | 60 | Performance below this → +3 risk score |
| `RISK_THRESHOLDS.performanceWarning` | 70 | Performance below this → +1 risk score |
| `RISK_THRESHOLDS.criticalContribution` | 3 | Points added for critical triggers |
| `RISK_THRESHOLDS.warningContribution` | 1 | Points added for warning triggers |
| `RISK_THRESHOLDS.missedAssignmentContribution` | 2 | Points added for missed last 3 assignments |
| `RISK_THRESHOLDS.decliningTrendContribution` | 2 | Points added for declining growth trend |
| `RISK_THRESHOLDS.inactivityContribution` | 2 | Points added for inactivity |
| `RISK_THRESHOLDS.atRisk` | 6 | Risk score ≥ 6 → At Risk |
| `RISK_THRESHOLDS.concern` | 4 | Risk score ≥ 4 → Concern |
| `RISK_THRESHOLDS.monitor` | 2 | Risk score ≥ 2 → Monitor |
| `RISK_THRESHOLDS.inactivityDays` | 14 | Days of inactivity to trigger risk signal |

### Growth Thresholds

| Constant | Value | Description |
|---|---|---|
| `GROWTH_THRESHOLDS.improving` | 1.1 | Index ≥ 1.1 → Improving (10%+ growth) |
| `GROWTH_THRESHOLDS.stable` | 0.9 | Index ≥ 0.9 → Stable (within ±10%) |

### Growth Calculation

| Constant | Value | Description |
|---|---|---|
| `GROWTH_CALCULATION.thirdFraction` | 3 | Divide scores into thirds for comparison |

### Discipline Weights

| Constant | Value | Description |
|---|---|---|
| `DISCIPLINE_WEIGHTS.attendanceConsistency` | 0.4 | Attendance consistency weight |
| `DISCIPLINE_WEIGHTS.onTimeSubmissions` | 0.4 | On-time submission weight |
| `DISCIPLINE_WEIGHTS.deadlineRespect` | 0.2 | Deadline respect weight |

> **Constraint:** These must sum to 1.0.

### Discipline Penalties

| Constant | Value | Description |
|---|---|---|
| `DISCIPLINE_PENALTIES.lateArrivalMaxPenalty` | 20 | Maximum point penalty from attendance score for late arrivals |

### Ranking Bands

| Constant | Value | Description |
|---|---|---|
| `RANKING_BANDS.top5` | 95 | Percentile ≥ 95 → Top 5% |
| `RANKING_BANDS.top10` | 90 | Percentile ≥ 90 → Top 10% |
| `RANKING_BANDS.top25` | 75 | Percentile ≥ 75 → Top 25% |
| `RANKING_BANDS.top50` | 50 | Percentile ≥ 50 → Top 50% |

### Achievement Thresholds

| Constant | Value | Description |
|---|---|---|
| `ACHIEVEMENT_THRESHOLDS.topPerformerPerformance` | 95 | Overall performance threshold for top performer badge |
| `ACHIEVEMENT_THRESHOLDS.missedAssignmentCheck` | 3 | Number of recent assignments to check for miss streak |

### How to Adjust Weights and Thresholds

1. Open `src/lib/analytics-config.ts`.
2. Locate the relevant constant object.
3. Modify the value(s).
4. Verify any constraints (e.g., `PERFORMANCE_WEIGHTS` must sum to 100, `DISCIPLINE_WEIGHTS` must sum to 1.0).
5. The change propagates automatically to all consumers because:
   - `performance-calculator.ts` imports all values from `analytics-config.ts`.
   - UI components import display configs (colors, icons) from the same source.
   - No hardcoded copies exist elsewhere.

> **Warning:** After modifying weights, review classification ranges and thresholds to ensure they remain appropriate for the new scale. For example, increasing the attendance weight from 20 to 30 will shift overall scores upward for students with strong attendance, potentially changing risk profiles.

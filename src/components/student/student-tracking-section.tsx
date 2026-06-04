'use client';

import { useMemo, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Activity,
  CheckCircle2,
  XCircle,
  Clock,
  BookOpen,
  Award,
  TrendingUp,
  Calendar,
  FileText,
  ClipboardList,
  BarChart3,
  ShieldCheck,
  AlertTriangle,
  Zap,
  Target,
  ArrowUpRight,
  ArrowRight,
  ArrowDownRight,
  Filter,
  Info,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import type { Score, Submission, Assignment, Subject } from '@/lib/types';
import { useTranslations } from '@/i18n/use-translations';
import { useLocaleStore } from '@/i18n/locale-store';
import { supabase } from '@/lib/supabase';
import { useEffect } from 'react';
import {
  computeAllMetrics,
  computeSubjectPerformance,
  type StudentPerformanceMetrics,
  type PerformanceLevel,
  PERFORMANCE_LEVELS,
  getPerformanceLevel,
  getPerformanceLevelConfig,
  type EfficiencyLevel,
  EFFICIENCY_LEVELS,
  getEfficiencyLevelConfig,
  type RiskLevel,
  RISK_LEVELS,
  getRiskLevelConfig,
  type GrowthTrend,
  GROWTH_TRENDS,
  getGrowthTrendConfig,
  calculatePercentile,
  getPercentileLabel,
  DEFAULT_WEIGHTS,
  ATTENDANCE_POINTS,
  type SubjectPerformanceData,
} from '@/lib/performance-calculator';

// -------------------------------------------------------
// Props
// -------------------------------------------------------
interface StudentTrackingSectionProps {
  profileId: string;
  attendanceRecords: { id: string; session_id: string; student_id: string; checked_in_at: string; attendance_status?: 'present' | 'late' | 'partial' | 'absent' }[];
  attendanceSessions: { id: string; subject_id: string; status: string }[];
  quizzes: { id: string; title: string; subject_id?: string }[];
  scores: Score[];
  submissions: Submission[];
  assignments: Assignment[];
}

// -------------------------------------------------------
// Animation variants
// -------------------------------------------------------
const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.08 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.35, ease: 'easeOut' as const } },
};

// -------------------------------------------------------
// Helper: format date to Arabic-friendly string
// -------------------------------------------------------
function formatDate(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    return date.toLocaleDateString('ar-SA', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

function formatTime(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleTimeString('ar-SA', {
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

// -------------------------------------------------------
// Circular Progress Indicator
// -------------------------------------------------------
function CircularProgress({
  value,
  size = 100,
  strokeWidth = 8,
  label,
  gradientId = 'progressGradient',
  colorClass,
}: {
  value: number;
  size?: number;
  strokeWidth?: number;
  label: string;
  gradientId?: string;
  colorClass?: string;
}) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (value / 100) * circumference;

  return (
    <div className="relative flex flex-col items-center gap-1">
      <svg width={size} height={size} className="transform -rotate-90">
        {/* Background circle */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="currentColor"
          strokeWidth={strokeWidth}
          fill="none"
          className="text-slate-100 dark:text-slate-800"
        />
        {/* Progress arc */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={`url(#${gradientId})`}
          strokeWidth={strokeWidth}
          fill="none"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className="transition-all duration-700 ease-out"
        />
        <defs>
          <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor={colorClass?.includes('emerald') ? '#10b981' : colorClass?.includes('amber') ? '#f59e0b' : colorClass?.includes('rose') ? '#f43f5e' : '#0284c7'} />
            <stop offset="100%" stopColor={colorClass?.includes('emerald') ? '#34d399' : colorClass?.includes('amber') ? '#fbbf24' : colorClass?.includes('rose') ? '#fb7185' : '#0d9488'} />
          </linearGradient>
        </defs>
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={`text-2xl font-bold ${colorClass?.includes('emerald') ? 'text-emerald-700 dark:text-emerald-400' : colorClass?.includes('amber') ? 'text-amber-700 dark:text-amber-400' : colorClass?.includes('rose') ? 'text-rose-700 dark:text-rose-400' : 'text-sky-800 dark:text-sky-400'}`}>
          {Math.round(value)}%
        </span>
      </div>
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
    </div>
  );
}

// -------------------------------------------------------
// Uses SubjectPerformanceData from centralized engine
// -------------------------------------------------------

// -------------------------------------------------------
// Activity timeline filter type
// -------------------------------------------------------
type TimelineFilter = 'all' | 'quiz' | 'attendance' | 'assignment' | 'grading' | 'risk';

// -------------------------------------------------------
// Main Component
// -------------------------------------------------------
export default function StudentTrackingSection({
  profileId,
  attendanceRecords,
  attendanceSessions,
  quizzes,
  scores,
  submissions,
  assignments,
}: StudentTrackingSectionProps) {
  const { t } = useTranslations();
  const locale = useLocaleStore((s) => s.locale);

  // ─── Fetch subjects ───
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [subjectNames, setSubjectNames] = useState<Record<string, string>>({});

  useEffect(() => {
    async function fetchSubjects() {
      const { data: enrollments } = await supabase
        .from('subject_students')
        .select('subject_id')
        .eq('student_id', profileId);

      if (enrollments && enrollments.length > 0) {
        const subjectIds = enrollments.map(e => e.subject_id);
        const { data: subjectData } = await supabase
          .from('subjects')
          .select('id, name')
          .in('id', subjectIds);

        if (subjectData) {
          const nameMap: Record<string, string> = {};
          (subjectData as { id: string; name: string }[]).forEach(s => {
            nameMap[s.id] = s.name;
          });
          setSubjectNames(nameMap);
          setSubjects(subjectData as Subject[]);
        }
      }
    }
    fetchSubjects();
  }, [profileId]);

  // ─── Compute all metrics using shared engine ───
  const metrics = useMemo<StudentPerformanceMetrics>(() => {
    return computeAllMetrics({
      scores: scores.map(s => ({
        score: s.score,
        total: s.total,
        completed_at: s.completed_at,
        student_id: s.student_id,
      })),
      attendanceSessions: attendanceSessions.map(s => ({ id: s.id })),
      attendanceRecords: attendanceRecords.map(r => ({
        session_id: r.session_id,
        student_id: r.student_id,
        attendance_status: r.attendance_status,
      })),
      submissions: submissions.map(s => ({
        assignment_id: s.assignment_id,
        student_id: s.student_id,
        score: s.score ?? null,
        status: s.status,
        submitted_at: s.submitted_at,
      })),
      assignments: assignments.map(a => ({
        id: a.id,
        max_score: a.max_score,
        due_date: a.due_date,
      })),
      studentId: profileId,
    });
  }, [scores, attendanceSessions, attendanceRecords, submissions, assignments, profileId]);

  // ─── Per-subject performance using centralized engine ───
  const subjectPerformances = useMemo<SubjectPerformanceData[]>(() => {
    // Discover unique subject IDs from all data sources
    const subjectIds = new Set<string>();
    scores.forEach(s => {
      const quiz = quizzes.find(q => q.id === s.quiz_id);
      if (quiz?.subject_id) subjectIds.add(quiz.subject_id);
    });
    attendanceSessions.forEach(s => subjectIds.add(s.subject_id));
    assignments.forEach(a => {
      if (a.subject_id) subjectIds.add(a.subject_id);
    });

    // Compute per-subject metrics using the centralized engine
    return Array.from(subjectIds).map(subjectId => {
      const subjectStudentScores = scores
        .filter(s => quizzes.find(q => q.id === s.quiz_id)?.subject_id === subjectId)
        .map(s => ({ score: s.score, total: s.total, completed_at: s.completed_at }));

      const subjectSessions = attendanceSessions
        .filter(s => s.subject_id === subjectId)
        .map(s => ({ id: s.id }));

      const subjectAssignments = assignments
        .filter(a => (a.subject_id || 'unknown') === subjectId)
        .map(a => ({ id: a.id, max_score: a.max_score, due_date: a.due_date }));

      const subjectSubmissions = submissions
        .filter(s => s.student_id === profileId)
        .map(s => ({
          assignment_id: s.assignment_id,
          student_id: s.student_id,
          score: s.score ?? null,
          status: s.status,
          submitted_at: s.submitted_at,
        }));

      return computeSubjectPerformance({
        subjectId,
        subjectName: subjectNames[subjectId] || t('student.trackingUnknownSubject'),
        studentScores: subjectStudentScores,
        attendanceSessions: subjectSessions,
        attendanceRecords: attendanceRecords.map(r => ({
          session_id: r.session_id,
          student_id: r.student_id,
          attendance_status: r.attendance_status,
        })),
        studentId: profileId,
        assignments: subjectAssignments,
        submissions: subjectSubmissions,
      });
    });
  }, [scores, quizzes, attendanceSessions, attendanceRecords, submissions, assignments, profileId, subjectNames, t]);

  // ─── Attendance by subject (with attendance_status support) ───
  const attendanceBySubject = useMemo(() => {
    const subjectMap = new Map<string, { name: string; total: number; attended: number; lateCount: number; partialCount: number }>();

    attendanceSessions.forEach(session => {
      const name = subjectNames[session.subject_id] || t('student.trackingUnknownSubject');
      const existing = subjectMap.get(session.subject_id) || { name, total: 0, attended: 0, lateCount: 0, partialCount: 0 };
      existing.total += 1;
      subjectMap.set(session.subject_id, existing);
    });

    attendanceRecords.forEach(record => {
      const session = attendanceSessions.find(s => s.id === record.session_id);
      if (session) {
        const existing = subjectMap.get(session.subject_id);
        if (existing) {
          existing.attended += 1;
          if (record.attendance_status === 'late') existing.lateCount += 1;
          if (record.attendance_status === 'partial') existing.partialCount += 1;
        }
      }
    });

    return Array.from(subjectMap.entries()).map(([id, data]) => ({
      id,
      ...data,
      rate: data.total > 0 ? (data.attended / data.total) * 100 : 0,
    }));
  }, [attendanceSessions, attendanceRecords, subjectNames, t]);

  // ─── Activity timeline (enhanced with filter and new event types) ───
  const activityTimeline = useMemo(() => {
    const activities: Array<{ date: string; type: 'attendance' | 'quiz' | 'assignment' | 'grading' | 'risk' | 'achievement'; title: string; detail: string; importance?: 'high' | 'medium' | 'low' }> = [];

    // Attendance activities
    attendanceRecords.forEach(record => {
      const session = attendanceSessions.find(s => s.id === record.session_id);
      const subjectName = session ? (subjectNames[session.subject_id] || t('student.trackingCourse')) : t('student.trackingCourse');
      const statusLabel = record.attendance_status === 'late'
        ? ` (${t('student.trackingLateBadge')})`
        : record.attendance_status === 'partial'
        ? ` (${t('student.trackingPartialBadge')})`
        : '';
      activities.push({
        date: record.checked_in_at,
        type: 'attendance',
        title: t('student.trackingActivityAttendanceRecord'),
        detail: `${subjectName}${statusLabel}`,
        importance: record.attendance_status === 'late' || record.attendance_status === 'partial' ? 'medium' : 'low',
      });
    });

    // Quiz activities
    scores.forEach(score => {
      activities.push({
        date: score.completed_at,
        type: 'quiz',
        title: t('student.trackingActivityQuizComplete'),
        detail: `${score.quiz_title} — ${score.score}/${score.total}`,
        importance: score.total > 0 && (score.score / score.total) * 100 >= 90 ? 'high' : 'medium',
      });
    });

    // Assignment submission activities
    submissions.forEach(sub => {
      const assignment = assignments.find(a => a.id === sub.assignment_id);
      activities.push({
        date: sub.submitted_at,
        type: 'assignment',
        title: t('student.trackingActivityAssignmentSubmit'),
        detail: assignment?.title || t('student.trackingCourse'),
        importance: 'low',
      });
    });

    // Grading events
    submissions.filter(s => s.status === 'graded').forEach(sub => {
      const assignment = assignments.find(a => a.id === sub.assignment_id);
      if (assignment && sub.score != null) {
        activities.push({
          date: sub.graded_at || sub.submitted_at,
          type: 'grading',
          title: t('student.trackingTimelineFilterGrading'),
          detail: `${assignment.title} — ${sub.score}/${assignment.max_score}`,
          importance: assignment.max_score > 0 && sub.score != null && (sub.score / assignment.max_score) >= 0.9 ? 'high' : 'medium',
        });
      }
    });

    // Risk alert events
    if (metrics.riskLevel === 'concern' || metrics.riskLevel === 'atRisk') {
      const reasonLabels = metrics.riskReasons.map(r => {
        const map: Record<string, string> = {
          attendanceBelow50: t('student.trackingRiskReasonAttendance'),
          attendanceBelow70: t('student.trackingRiskReasonAttendance'),
          performanceBelow60: t('student.trackingRiskReasonPerformance'),
          performanceBelow70: t('student.trackingRiskReasonPerformance'),
          missedLast3Assignments: t('student.trackingRiskReasonMissed3'),
          decliningTrend: t('student.trackingRiskReasonDeclining'),
          inactivity: t('student.trackingRiskReasonInactivity'),
        };
        return map[r] || r;
      });
      activities.push({
        date: new Date().toISOString(),
        type: 'risk',
        title: t('student.trackingTimelineFilterRisk'),
        detail: reasonLabels.join(', '),
        importance: 'high',
      });
    }

    // Achievement events for top performers
    if (metrics.performanceLevel === 'excellent' && metrics.overallPerformance >= 95) {
      activities.push({
        date: new Date().toISOString(),
        type: 'achievement',
        title: t('student.trackingTimelineAchievement'),
        detail: `${Math.round(metrics.overallPerformance)}%`,
        importance: 'high',
      });
    }

    // Sort by date descending
    activities.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    return activities;
  }, [attendanceRecords, attendanceSessions, subjectNames, scores, submissions, assignments, metrics, t]);

  // ─── Timeline filter state ───
  const [timelineFilter, setTimelineFilter] = useState<TimelineFilter>('all');

  const filteredTimeline = useMemo(() => {
    if (timelineFilter === 'all') return activityTimeline;
    return activityTimeline.filter(a => a.type === timelineFilter);
  }, [activityTimeline, timelineFilter]);

  // ─── Recent attendance (enhanced with status badges) ───
  const recentAttendance = useMemo(() => {
    return attendanceRecords
      .sort((a, b) => new Date(b.checked_in_at).getTime() - new Date(a.checked_in_at).getTime())
      .slice(0, 10)
      .map(record => {
        const session = attendanceSessions.find(s => s.id === record.session_id);
        const subjectName = session ? (subjectNames[session.subject_id] || t('student.trackingUnknownSubject')) : t('student.trackingUnknownSubject');
        return {
          date: record.checked_in_at,
          subjectName,
          status: record.attendance_status || 'present',
        };
      });
  }, [attendanceRecords, attendanceSessions, subjectNames, t]);

  // ─── Late/partial counts ───
  const lateCount = useMemo(() => attendanceRecords.filter(r => r.attendance_status === 'late').length, [attendanceRecords]);
  const partialCount = useMemo(() => attendanceRecords.filter(r => r.attendance_status === 'partial').length, [attendanceRecords]);

  // ─── Performance level config ───
  const performanceConfig = getPerformanceLevelConfig(metrics.performanceLevel);
  const efficiencyConfig = getEfficiencyLevelConfig(metrics.efficiencyLevel);
  const growthConfig = getGrowthTrendConfig(metrics.growthTrend);
  const riskConfig = getRiskLevelConfig(metrics.riskLevel);

  // ─── Risk reason label helper ───
  const getRiskReasonLabel = useCallback((reason: string): string => {
    const map: Record<string, string> = {
      attendanceBelow50: t('student.trackingRiskReasonAttendance'),
      attendanceBelow70: t('student.trackingRiskReasonAttendance'),
      performanceBelow60: t('student.trackingRiskReasonPerformance'),
      performanceBelow70: t('student.trackingRiskReasonPerformance'),
      missedLast3Assignments: t('student.trackingRiskReasonMissed3'),
      decliningTrend: t('student.trackingRiskReasonDeclining'),
      inactivity: t('student.trackingRiskReasonInactivity'),
    };
    return map[reason] || reason;
  }, [t]);

  // ─── Risk level label helper ───
  const getRiskLevelLabel = useCallback((level: RiskLevel): string => {
    const map: Record<RiskLevel, string> = {
      healthy: t('student.trackingRiskHealthy'),
      monitor: t('student.trackingRiskMonitor'),
      concern: t('student.trackingRiskConcern'),
      atRisk: t('student.trackingRiskAtRisk'),
    };
    return map[level];
  }, [t]);

  // ─── Growth trend label helper ───
  const getGrowthTrendLabel = useCallback((trend: GrowthTrend): string => {
    const map: Record<GrowthTrend, string> = {
      improving: t('student.trackingGrowthImproving'),
      stable: t('student.trackingGrowthStable'),
      declining: t('student.trackingGrowthDeclining'),
    };
    return map[trend];
  }, [t]);

  // ─── Attendance status badge renderer ───
  const renderAttendanceStatusBadge = (status: 'present' | 'late' | 'partial' | 'absent') => {
    const badgeConfig: Record<string, { label: string; className: string }> = {
      present: { label: t('student.trackingPresentBadge'), className: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400 border-emerald-100 dark:border-emerald-900/60' },
      late: { label: t('student.trackingLateBadge'), className: 'bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400 border-amber-100 dark:border-amber-900/60' },
      partial: { label: t('student.trackingPartialBadge'), className: 'bg-sky-50 text-sky-700 dark:bg-sky-900/15 dark:text-sky-400 border-sky-100 dark:border-sky-900/60' },
      absent: { label: t('student.trackingAbsent'), className: 'bg-rose-50 text-rose-700 dark:bg-rose-900/20 dark:text-rose-400 border-rose-100 dark:border-rose-900/60' },
    };
    const cfg = badgeConfig[status] || badgeConfig.present;
    return (
      <Badge variant="secondary" className={`text-[10px] px-1.5 py-0 ${cfg.className}`}>
        {cfg.label}
      </Badge>
    );
  };

  // ─── Mini progress bar for subject table ───
  const MiniBar = ({ value, colorClass }: { value: number; colorClass: string }) => (
    <div className="flex items-center gap-1.5">
      <div className="flex-1 h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden min-w-[40px]">
        <div
          className={`h-full rounded-full transition-all duration-500 ${colorClass}`}
          style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
        />
      </div>
      <span className="text-[10px] font-medium text-muted-foreground min-w-[28px] text-end">
        {Math.round(value)}%
      </span>
    </div>
  );

  // ─── Timeline filter buttons ───
  const timelineFilters: { key: TimelineFilter; label: string }[] = [
    { key: 'all', label: t('student.trackingTimelineFilterAll') },
    { key: 'quiz', label: t('student.trackingTimelineFilterQuizzes') },
    { key: 'attendance', label: t('student.trackingTimelineFilterAttendance') },
    { key: 'assignment', label: t('student.trackingTimelineFilterAssignments') },
    { key: 'grading', label: t('student.trackingTimelineFilterGrading') },
    { key: 'risk', label: t('student.trackingTimelineFilterRisk') },
  ];

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="space-y-6"
    >
      {/* ════════════════════════════════════════════════════════════
          Section 1: Header
          ════════════════════════════════════════════════════════════ */}
      <motion.div variants={itemVariants} className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-sky-600 to-teal-600 shadow-lg shadow-sky-600/25">
          <Activity className="h-5 w-5 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-foreground">{t('student.trackingTitle')}</h1>
          <p className="text-sm text-muted-foreground">{t('student.trackingSubtitle')}</p>
        </div>
      </motion.div>

      {/* ════════════════════════════════════════════════════════════
          Section 2: KPI Overview Cards (5 cards)
          ════════════════════════════════════════════════════════════ */}
      <motion.div variants={itemVariants}>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4">
          {/* Card 1: Overall Performance */}
          <Card className="border-sky-100/50 shadow-sm">
            <CardContent className="p-4 flex flex-col items-center">
              <CircularProgress
                value={metrics.overallPerformance}
                size={80}
                strokeWidth={7}
                label={t('student.trackingOverallProgress')}
                gradientId="overallGrad"
                colorClass={performanceConfig.color}
              />
              <Badge
                className={`mt-2 text-[10px] px-2 py-0.5 ${performanceConfig.bgColor} ${performanceConfig.textColor} border-0`}
              >
                {performanceConfig.icon} {t(`student.trackingExamPerformance`)}
              </Badge>
            </CardContent>
          </Card>

          {/* Card 2: Efficiency */}
          <Card className="border-sky-100/50 shadow-sm">
            <CardContent className="p-4 flex flex-col items-center">
              {metrics.efficiencyLevel === 'insufficient' ? (
                <>
                  <div className="relative flex flex-col items-center">
                    <svg width={80} height={80} className="transform -rotate-90">
                      <circle
                        cx={40}
                        cy={40}
                        r={33}
                        stroke="currentColor"
                        strokeWidth={7}
                        fill="none"
                        className="text-slate-100 dark:text-slate-800"
                      />
                      <circle
                        cx={40}
                        cy={40}
                        r={33}
                        stroke="#94a3b8"
                        strokeWidth={7}
                        fill="none"
                        strokeDasharray={2 * Math.PI * 33}
                        strokeDashoffset={2 * Math.PI * 33 * 0.75}
                        strokeLinecap="round"
                        strokeOpacity={0.3}
                      />
                    </svg>
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                      <span className="text-sm font-medium text-gray-500 dark:text-gray-400">—</span>
                    </div>
                  </div>
                  <span className="text-xs font-medium text-muted-foreground">{t('student.trackingEfficiencyInsufficient')}</span>
                  <p className="text-[10px] text-muted-foreground/70 mt-0.5 text-center leading-tight">
                    {t('student.trackingEfficiencyInsufficientNote')}
                  </p>
                </>
              ) : (
                <>
                  <CircularProgress
                    value={metrics.efficiency}
                    size={80}
                    strokeWidth={7}
                    label={t('student.trackingEfficiency') || 'Efficiency'}
                    gradientId="efficiencyGrad"
                    colorClass={efficiencyConfig.color}
                  />
                  <Badge
                    className={`mt-2 text-[10px] px-2 py-0.5 ${efficiencyConfig.bgColor} ${efficiencyConfig.textColor} border-0`}
                  >
                    {metrics.efficiencyLevel === 'high' ? '⚡' : metrics.efficiencyLevel === 'medium' ? '●' : '▼'}
                  </Badge>
                </>
              )}
            </CardContent>
          </Card>

          {/* Card 3: Discipline Score */}
          <Card className="border-sky-100/50 shadow-sm">
            <CardContent className="p-4 flex flex-col items-center">
              <div className="flex h-[80px] w-[80px] items-center justify-center rounded-full bg-gradient-to-br from-violet-50 to-purple-50 dark:from-violet-900/20 dark:to-purple-900/20 ring-2 ring-violet-100 dark:ring-violet-900/40">
                <ShieldCheck className="h-8 w-8 text-violet-600 dark:text-violet-400" />
              </div>
              <span className="text-xl font-bold text-violet-700 dark:text-violet-400 mt-2">
                {Math.round(metrics.disciplineScore)}%
              </span>
              <span className="text-xs font-medium text-muted-foreground">{t('student.trackingDisciplineScore')}</span>
              <p className="text-[10px] text-muted-foreground/70 mt-0.5 text-center leading-tight">
                {t('student.trackingDisciplineTooltip')}
              </p>
            </CardContent>
          </Card>

          {/* Card 4: Growth Index */}
          <Card className="border-sky-100/50 shadow-sm">
            <CardContent className="p-4 flex flex-col items-center">
              <div className={`flex h-[80px] w-[80px] items-center justify-center rounded-full ${
                growthConfig.key === 'improving'
                  ? 'bg-emerald-50 dark:bg-emerald-900/20 ring-2 ring-emerald-100 dark:ring-emerald-900/40'
                  : growthConfig.key === 'stable'
                  ? 'bg-sky-50 dark:bg-sky-900/15 ring-2 ring-sky-100 dark:ring-sky-900/40'
                  : 'bg-rose-50 dark:bg-rose-900/20 ring-2 ring-rose-100 dark:ring-rose-900/40'
              }`}>
                {growthConfig.key === 'improving' ? (
                  <ArrowUpRight className="h-8 w-8 text-emerald-600 dark:text-emerald-400" />
                ) : growthConfig.key === 'stable' ? (
                  <ArrowRight className="h-8 w-8 text-sky-600 dark:text-sky-400" />
                ) : (
                  <ArrowDownRight className="h-8 w-8 text-rose-600 dark:text-rose-400" />
                )}
              </div>
              <span className={`text-xl font-bold mt-2 ${growthConfig.textColor}`}>
                {metrics.growthIndex.toFixed(2)}x
              </span>
              <span className="text-xs font-medium text-muted-foreground">{t('student.trackingGrowthIndex')}</span>
              <Badge
                className={`mt-1 text-[10px] px-2 py-0.5 ${growthConfig.key === 'improving' ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400' : growthConfig.key === 'stable' ? 'bg-sky-50 dark:bg-sky-900/15 text-sky-700 dark:text-sky-400' : 'bg-rose-50 dark:bg-rose-900/20 text-rose-700 dark:text-rose-400'} border-0`}
              >
                {growthConfig.icon} {getGrowthTrendLabel(metrics.growthTrend)}
              </Badge>
            </CardContent>
          </Card>

          {/* Card 5: Risk Level */}
          <Card className={`${riskConfig.borderColor} shadow-sm`}>
            <CardContent className="p-4 flex flex-col items-center">
              <div className={`flex h-[80px] w-[80px] items-center justify-center rounded-full ${riskConfig.bgColor} ring-2 ${riskConfig.borderColor}`}>
                <AlertTriangle className={`h-8 w-8 ${riskConfig.textColor}`} />
              </div>
              <Badge
                className={`mt-2 text-xs px-2.5 py-0.5 ${riskConfig.bgColor} ${riskConfig.textColor} ${riskConfig.borderColor} border`}
              >
                {getRiskLevelLabel(metrics.riskLevel)}
              </Badge>
              <span className="text-xs font-medium text-muted-foreground mt-1">{t('student.trackingRiskLevel')}</span>
              {metrics.riskReasons.length > 0 ? (
                <div className="mt-1.5 space-y-0.5 w-full">
                  {metrics.riskReasons.slice(0, 3).map((reason, idx) => (
                    <p key={idx} className="text-[10px] text-muted-foreground/80 truncate text-center">
                      • {getRiskReasonLabel(reason)}
                    </p>
                  ))}
                </div>
              ) : (
                <p className="text-[10px] text-muted-foreground/60 mt-1">{t('student.trackingNoRiskReasons')}</p>
              )}
            </CardContent>
          </Card>
        </div>
      </motion.div>

      {/* ════════════════════════════════════════════════════════════
          Section 2.5: Status Legend — explains what each status means
          ════════════════════════════════════════════════════════════ */}
      <motion.div variants={itemVariants}>
        <Card className="border-sky-100/50 shadow-sm">
          <CardContent className="p-4">
            <h3 className="text-sm font-bold text-foreground mb-3 flex items-center gap-2">
              <Info className="h-4 w-4 text-sky-600" />
              {locale === 'ar' ? 'دليل الحالات' : 'Status Guide'}
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Performance Levels */}
              <div>
                <p className="text-xs font-semibold text-muted-foreground mb-1.5">{locale === 'ar' ? 'مستويات الأداء' : 'Performance Levels'}</p>
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-emerald-500 shrink-0" />
                    <span className="text-xs text-foreground">{locale === 'ar' ? 'ممتاز (≥90%) — أداء مميز ومرتفع' : 'Excellent (≥90%) — Outstanding performance'}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-sky-500 shrink-0" />
                    <span className="text-xs text-foreground">{locale === 'ar' ? 'جيد جداً (80-89%) — أداء فوق المتوسط' : 'Very Good (80-89%) — Above average'}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-amber-500 shrink-0" />
                    <span className="text-xs text-foreground">{locale === 'ar' ? 'جيد (70-79%) — أداء مقبول جيد' : 'Good (70-79%) — Acceptable performance'}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-orange-500 shrink-0" />
                    <span className="text-xs text-foreground">{locale === 'ar' ? 'مقبول (60-69%) — يحتاج تحسين' : 'Acceptable (60-69%) — Needs improvement'}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-rose-500 shrink-0" />
                    <span className="text-xs text-foreground">{locale === 'ar' ? 'ضعيف (<60%) — أداء غير مقبول' : 'Weak (<60%) — Unacceptable performance'}</span>
                  </div>
                </div>
              </div>
              {/* Risk & Growth */}
              <div>
                <p className="text-xs font-semibold text-muted-foreground mb-1.5">{locale === 'ar' ? 'مؤشرات المتابعة' : 'Tracking Indicators'}</p>
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-emerald-500 shrink-0" />
                    <span className="text-xs text-foreground">{locale === 'ar' ? 'سليم — لا مخاطر مقلقة' : 'Healthy — No concerning risks'}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-amber-500 shrink-0" />
                    <span className="text-xs text-foreground">{locale === 'ar' ? 'مراقبة — يحتاج متابعة' : 'Monitor — Needs attention'}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-orange-500 shrink-0" />
                    <span className="text-xs text-foreground">{locale === 'ar' ? 'قلق — انخفاض ملحوظ' : 'Concern — Notable decline'}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-rose-500 shrink-0" />
                    <span className="text-xs text-foreground">{locale === 'ar' ? 'في خطر — تدخل عاجل مطلوب' : 'At Risk — Urgent intervention needed'}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <ArrowUpRight className="h-2 w-2 text-emerald-600 shrink-0" />
                    <span className="text-xs text-foreground">{locale === 'ar' ? 'تحسن — اتجاه تصاعدي' : 'Improving — Upward trend'}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <ArrowDownRight className="h-2 w-2 text-rose-600 shrink-0" />
                    <span className="text-xs text-foreground">{locale === 'ar' ? 'تراجع — اتجاه تنازلي' : 'Declining — Downward trend'}</span>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* ════════════════════════════════════════════════════════════
          Section 3: Performance Breakdown + Attendance by Subject
          ════════════════════════════════════════════════════════════ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: Performance Breakdown */}
        <motion.div variants={itemVariants}>
          <Card className="border-sky-100/50 shadow-sm h-full">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <BarChart3 className="h-5 w-5 text-sky-600" />
                {t('student.trackingPerformanceSummary')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {/* Exam Performance */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-gray-900 dark:text-foreground">{t('student.trackingExamPerformance')}</p>
                    <span className="text-sm font-bold text-sky-700 dark:text-sky-400">{Math.round(metrics.examPerformance)}%</span>
                  </div>
                  <Progress value={metrics.examPerformance} className="h-2.5" />
                  <p className="text-[10px] text-muted-foreground/70">{t('student.trackingWeightedExamNote')}</p>
                </div>

                {/* Attendance Score */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-gray-900 dark:text-foreground">{t('student.trackingAttendanceScore')}</p>
                    <span className="text-sm font-bold text-teal-700 dark:text-teal-400">{Math.round(metrics.attendanceScore)}%</span>
                  </div>
                  <Progress value={metrics.attendanceScore} className="h-2.5" />
                  <p className="text-[10px] text-muted-foreground/70">{t('student.trackingAttendancePointsNote')}</p>
                </div>

                {/* Assignment Compliance */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-gray-900 dark:text-foreground">{t('student.trackingAssignCompliance')}</p>
                    <span className="text-sm font-bold text-amber-700 dark:text-amber-400">{Math.round(metrics.assignmentCompliance)}%</span>
                  </div>
                  <Progress value={metrics.assignmentCompliance} className="h-2.5" />
                  <p className="text-[10px] text-muted-foreground/70">{metrics.completedAssignments}/{metrics.totalAssignments}</p>
                </div>

                {/* Assignment Quality */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-gray-900 dark:text-foreground">{t('student.trackingAssignQuality')}</p>
                    <span className="text-sm font-bold text-violet-700 dark:text-violet-400">{Math.round(metrics.assignmentQuality)}%</span>
                  </div>
                  <Progress value={metrics.assignmentQuality} className="h-2.5" />
                  <p className="text-[10px] text-muted-foreground/70">{metrics.totalEarnedPoints}/{metrics.totalPossiblePoints} pts</p>
                </div>

                {/* Weighted calculation display */}
                <div className="mt-4 p-3 rounded-xl bg-gradient-to-l from-sky-50/50 to-teal-50/50 dark:from-sky-900/10 dark:to-teal-900/10 border border-sky-100/50 dark:border-sky-900/30">
                  <p className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-2">{t('student.trackingOverallProgress')}</p>
                  <div className="grid grid-cols-4 gap-2 text-center">
                    <div>
                      <p className="text-sm font-bold text-sky-700 dark:text-sky-400">{Math.round(metrics.examPerformance)}%</p>
                      <p className="text-[10px] text-muted-foreground">×35%</p>
                    </div>
                    <div>
                      <p className="text-sm font-bold text-teal-700 dark:text-teal-400">{Math.round(metrics.attendanceScore)}%</p>
                      <p className="text-[10px] text-muted-foreground">×20%</p>
                    </div>
                    <div>
                      <p className="text-sm font-bold text-amber-700 dark:text-amber-400">{Math.round(metrics.assignmentCompliance)}%</p>
                      <p className="text-[10px] text-muted-foreground">×15%</p>
                    </div>
                    <div>
                      <p className="text-sm font-bold text-violet-700 dark:text-violet-400">{Math.round(metrics.assignmentQuality)}%</p>
                      <p className="text-[10px] text-muted-foreground">×30%</p>
                    </div>
                  </div>
                  <div className="mt-2 pt-2 border-t border-sky-100/50 dark:border-sky-900/30 text-center">
                    <p className="text-lg font-bold text-gray-900 dark:text-foreground">
                      {Math.round(metrics.overallPerformance)}%
                    </p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* Right: Attendance by Subject */}
        <motion.div variants={itemVariants}>
          <Card className="border-sky-100/50 shadow-sm h-full">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <BookOpen className="h-5 w-5 text-sky-600" />
                {t('student.trackingAttendanceBySubject')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {attendanceBySubject.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <BookOpen className="h-10 w-10 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">{t('student.trackingNoAttendanceData')}</p>
                </div>
              ) : (
                <div className="space-y-3 max-h-[420px] overflow-y-auto custom-scrollbar">
                  {attendanceBySubject.map((item) => (
                    <div key={item.id} className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-slate-50/50 dark:hover:bg-slate-900/20 transition-colors">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium text-gray-900 dark:text-foreground truncate">{item.name}</p>
                          {item.lateCount > 0 && (
                            <Badge variant="secondary" className="text-[9px] px-1 py-0 bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400 border-amber-100 dark:border-amber-900/60">
                              {item.lateCount} {t('student.trackingLateBadge')}
                            </Badge>
                          )}
                          {item.partialCount > 0 && (
                            <Badge variant="secondary" className="text-[9px] px-1 py-0 bg-sky-50 text-sky-700 dark:bg-sky-900/15 dark:text-sky-400 border-sky-100 dark:border-sky-900/60">
                              {item.partialCount} {t('student.trackingPartialBadge')}
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          <Progress value={item.rate} className="h-2 flex-1" />
                          <span className="text-xs font-medium text-sky-700 dark:text-sky-400 min-w-[40px] text-start">
                            {Math.round(item.rate)}%
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {t('student.trackingOutOf', { attended: item.attended, total: item.total })}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>
      </div>

      {/* ════════════════════════════════════════════════════════════
          Section 4: Course Performance
          ════════════════════════════════════════════════════════════ */}
      <motion.div variants={itemVariants}>
        <Card className="border-sky-100/50 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <Target className="h-5 w-5 text-sky-600" />
              {t('student.trackingCoursePerformance')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {subjectPerformances.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Target className="h-10 w-10 mx-auto mb-2 opacity-30" />
                <p className="text-sm">{t('student.trackingNoAttendanceData')}</p>
              </div>
            ) : (
              <div className="space-y-3 max-h-96 overflow-y-auto custom-scrollbar">
                {subjectPerformances.map((subject) => {
                  const subjectRiskConfig = getRiskLevelConfig(subject.riskLevel);
                  const subjectGrowthConfig = getGrowthTrendConfig(subject.growthTrend);
                  return (
                    <div
                      key={subject.subjectId}
                      className="p-3 rounded-xl border border-slate-100/50 dark:border-slate-800/50 hover:border-sky-100/50 dark:hover:border-sky-900/30 transition-colors"
                    >
                      {/* Subject header row */}
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-sm font-semibold text-gray-900 dark:text-foreground truncate max-w-[200px]">
                          {subject.subjectName}
                        </p>
                        <div className="flex items-center gap-2 shrink-0">
                          {/* Growth trend badge */}
                          <Badge
                            variant="secondary"
                            className={`text-[9px] px-1.5 py-0 ${
                              subject.growthTrend === 'improving'
                                ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400'
                                : subject.growthTrend === 'stable'
                                ? 'bg-sky-50 dark:bg-sky-900/15 text-sky-700 dark:text-sky-400'
                                : 'bg-rose-50 dark:bg-rose-900/20 text-rose-700 dark:text-rose-400'
                            } border-0`}
                          >
                            {subjectGrowthConfig.icon} {getGrowthTrendLabel(subject.growthTrend)}
                          </Badge>
                          {/* Risk level badge */}
                          <Badge
                            variant="secondary"
                            className={`text-[9px] px-1.5 py-0 ${subjectRiskConfig.bgColor} ${subjectRiskConfig.textColor} border-0`}
                          >
                            {getRiskLevelLabel(subject.riskLevel)}
                          </Badge>
                        </div>
                      </div>

                      {/* Mini performance bars */}
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                        <div>
                          <p className="text-[10px] text-muted-foreground mb-0.5">{t('student.trackingExamPerformance')}</p>
                          <MiniBar value={subject.examPerformance} colorClass="bg-sky-500" />
                        </div>
                        <div>
                          <p className="text-[10px] text-muted-foreground mb-0.5">{t('student.trackingAttendanceScore')}</p>
                          <MiniBar value={subject.attendanceScore} colorClass="bg-teal-500" />
                        </div>
                        <div>
                          <p className="text-[10px] text-muted-foreground mb-0.5">{t('student.trackingAssignCompliance')}</p>
                          <MiniBar value={subject.assignmentCompliance} colorClass="bg-amber-500" />
                        </div>
                        <div>
                          <p className="text-[10px] text-muted-foreground mb-0.5">{t('student.trackingAssignQuality')}</p>
                          <MiniBar value={subject.assignmentQuality} colorClass="bg-violet-500" />
                        </div>
                      </div>

                      {/* Overall for subject */}
                      <div className="mt-2 pt-2 border-t border-slate-100/50 dark:border-slate-800/50">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] text-muted-foreground">{t('student.trackingOverallProgress')}</span>
                          <div className="flex items-center gap-2">
                            <div className="w-20 h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                              <div
                                className="h-full rounded-full bg-gradient-to-l from-sky-500 to-teal-500 transition-all duration-500"
                                style={{ width: `${Math.min(100, Math.max(0, subject.overallPerformance))}%` }}
                              />
                            </div>
                            <span className="text-xs font-bold text-gray-700 dark:text-gray-300">
                              {Math.round(subject.overallPerformance)}%
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </motion.div>

      {/* ════════════════════════════════════════════════════════════
          Section 5: Activity Timeline + Attendance Details
          ════════════════════════════════════════════════════════════ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: Activity Timeline (enhanced with filters) */}
        <motion.div variants={itemVariants}>
          <Card className="border-sky-100/50 shadow-sm h-full">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <Activity className="h-5 w-5 text-sky-600" />
                {t('student.trackingActivityTimeline')}
              </CardTitle>
              {/* Filter buttons */}
              <div className="flex flex-wrap gap-1 mt-2">
                {timelineFilters.map(f => (
                  <button
                    key={f.key}
                    onClick={() => setTimelineFilter(f.key)}
                    className={`px-2.5 py-1 rounded-md text-[10px] font-medium transition-all ${
                      timelineFilter === f.key
                        ? 'bg-sky-100 dark:bg-sky-900/30 text-sky-700 dark:text-sky-400 ring-1 ring-sky-200 dark:ring-sky-800'
                        : 'bg-slate-50 dark:bg-slate-800/40 text-muted-foreground hover:bg-slate-100 dark:hover:bg-slate-800/60'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </CardHeader>
            <CardContent>
              {filteredTimeline.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Activity className="h-10 w-10 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">{t('student.trackingNoActivity')}</p>
                </div>
              ) : (
                <div className="relative space-y-0 max-h-80 overflow-y-auto custom-scrollbar">
                  {/* Timeline line */}
                  <div className="absolute end-[15px] top-2 bottom-2 w-0.5 bg-sky-100 dark:bg-sky-900/30" />

                  {filteredTimeline.slice(0, 25).map((item, idx) => {
                    const iconMap: Record<string, React.ReactNode> = {
                      attendance: <CheckCircle2 className="h-4 w-4 text-teal-600" />,
                      quiz: <FileText className="h-4 w-4 text-sky-600" />,
                      assignment: <ClipboardList className="h-4 w-4 text-amber-600" />,
                      grading: <Award className="h-4 w-4 text-violet-600" />,
                      risk: <AlertTriangle className="h-4 w-4 text-rose-600" />,
                      achievement: <Zap className="h-4 w-4 text-emerald-600" />,
                    };
                    const bgMap: Record<string, string> = {
                      attendance: 'bg-teal-50 ring-teal-100 dark:bg-teal-900/20 dark:ring-teal-900/40',
                      quiz: 'bg-sky-50 dark:bg-sky-900/15 ring-sky-100 dark:ring-sky-800',
                      assignment: 'bg-amber-50 ring-amber-100 dark:bg-amber-900/20 dark:ring-amber-900/40',
                      grading: 'bg-violet-50 ring-violet-100 dark:bg-violet-900/20 dark:ring-violet-900/40',
                      risk: 'bg-rose-50 ring-rose-100 dark:bg-rose-900/20 dark:ring-rose-900/40',
                      achievement: 'bg-emerald-50 ring-emerald-100 dark:bg-emerald-900/20 dark:ring-emerald-900/40',
                    };
                    const badgeMap: Record<string, { label: string; className: string }> = {
                      attendance: { label: t('student.trackingAttendanceBadge'), className: 'bg-teal-50 text-teal-700 border-teal-100 dark:bg-teal-900/20 dark:text-teal-400 dark:border-teal-900/60' },
                      quiz: { label: t('student.trackingQuizBadge'), className: 'bg-sky-50 dark:bg-sky-900/15 text-sky-700 dark:text-sky-400 border-sky-100 dark:border-sky-900/60' },
                      assignment: { label: t('student.trackingAssignmentBadge'), className: 'bg-amber-50 text-amber-700 border-amber-100 dark:bg-amber-900/20 dark:text-amber-400 dark:border-amber-900/60' },
                      grading: { label: t('student.trackingTimelineFilterGrading'), className: 'bg-violet-50 text-violet-700 border-violet-100 dark:bg-violet-900/20 dark:text-violet-400 dark:border-violet-900/60' },
                      risk: { label: t('student.trackingTimelineFilterRisk'), className: 'bg-rose-50 text-rose-700 border-rose-100 dark:bg-rose-900/20 dark:text-rose-400 dark:border-rose-900/60' },
                      achievement: { label: t('student.trackingTimelineAchievement'), className: 'bg-emerald-50 text-emerald-700 border-emerald-100 dark:bg-emerald-900/20 dark:text-emerald-400 dark:border-emerald-900/60' },
                    };

                    return (
                      <div key={idx} className="relative flex items-start gap-3 py-2 px-1">
                        {/* Timeline dot */}
                        <div className={`relative z-10 flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full ring-2 ${bgMap[item.type] || bgMap.quiz}`}>
                          {iconMap[item.type] || iconMap.quiz}
                        </div>
                        {/* Content */}
                        <div className="flex-1 min-w-0 pt-0.5">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-sm font-medium text-gray-900 dark:text-foreground">{item.title}</p>
                            <Badge variant="secondary" className={`text-[10px] px-1.5 py-0 ${(badgeMap[item.type] || badgeMap.quiz).className}`}>
                              {(badgeMap[item.type] || badgeMap.quiz).label}
                            </Badge>
                            {item.importance === 'high' && (
                              <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 font-medium">
                                ★
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground truncate">{item.detail}</p>
                          <p className="text-xs text-muted-foreground/60 mt-0.5">
                            {formatDate(item.date)} — {formatTime(item.date)}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>

        {/* Right: Attendance Details (enhanced with status badges) */}
        <motion.div variants={itemVariants}>
          <Card className="border-sky-100/50 shadow-sm h-full">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <Calendar className="h-5 w-5 text-sky-600" />
                {t('student.trackingRecentAttendance')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {/* Late/partial count stats */}
              {(lateCount > 0 || partialCount > 0) && (
                <div className="flex items-center gap-3 mb-3 p-2 rounded-lg bg-slate-50/50 dark:bg-slate-900/20 border border-slate-100/50 dark:border-slate-800/50">
                  {lateCount > 0 && (
                    <div className="flex items-center gap-1.5">
                      <Clock className="h-3.5 w-3.5 text-amber-600" />
                      <span className="text-xs text-amber-700 dark:text-amber-400 font-medium">
                        {lateCount} {t('student.trackingLateBadge')}
                      </span>
                    </div>
                  )}
                  {partialCount > 0 && (
                    <div className="flex items-center gap-1.5">
                      <CheckCircle2 className="h-3.5 w-3.5 text-sky-600" />
                      <span className="text-xs text-sky-700 dark:text-sky-400 font-medium">
                        {partialCount} {t('student.trackingPartialBadge')}
                      </span>
                    </div>
                  )}
                </div>
              )}

              {recentAttendance.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Calendar className="h-10 w-10 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">{t('student.trackingNoAttendanceRecord')}</p>
                </div>
              ) : (
                <div className="space-y-2 max-h-80 overflow-y-auto custom-scrollbar">
                  {recentAttendance.map((item, idx) => {
                    const statusIconMap: Record<string, React.ReactNode> = {
                      present: <CheckCircle2 className="h-4 w-4 text-emerald-600" />,
                      late: <Clock className="h-4 w-4 text-amber-600" />,
                      partial: <CheckCircle2 className="h-4 w-4 text-sky-600" />,
                      absent: <XCircle className="h-4 w-4 text-rose-600" />,
                    };
                    const statusBgMap: Record<string, string> = {
                      present: 'bg-emerald-50 ring-emerald-100 dark:bg-emerald-900/20 dark:ring-emerald-900/40',
                      late: 'bg-amber-50 ring-amber-100 dark:bg-amber-900/20 dark:ring-amber-900/40',
                      partial: 'bg-sky-50 ring-sky-100 dark:bg-sky-900/15 dark:ring-sky-900/40',
                      absent: 'bg-rose-50 ring-rose-100 dark:bg-rose-900/20 dark:ring-rose-900/40',
                    };

                    return (
                      <div key={idx} className="flex items-center gap-3 p-2 rounded-lg hover:bg-slate-50/50 dark:hover:bg-slate-900/20 transition-colors">
                        <div className={`flex h-8 w-8 items-center justify-center rounded-full ring-2 ${statusBgMap[item.status] || statusBgMap.present}`}>
                          {statusIconMap[item.status] || statusIconMap.present}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900 dark:text-foreground truncate">{item.subjectName}</p>
                          <p className="text-xs text-muted-foreground">
                            {formatDate(item.date)} — {formatTime(item.date)}
                          </p>
                        </div>
                        {renderAttendanceStatusBadge(item.status)}
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </motion.div>
  );
}

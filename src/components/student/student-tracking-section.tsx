'use client';

import { useMemo, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid as RechartsCartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
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
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
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

  // ─── Monthly trend data for student area chart ───
  const studentTrendData = useMemo(() => {
    if (scores.length === 0) return [];
    const byMonth = new Map<string, { totalPct: number; count: number }>();
    scores.forEach(s => {
      try {
        const date = new Date(s.completed_at);
        const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        const entry = byMonth.get(key) || { totalPct: 0, count: 0 };
        if (s.total > 0) {
          entry.totalPct += (s.score / s.total) * 100;
          entry.count++;
        }
        byMonth.set(key, entry);
      } catch { /* skip */ }
    });
    return Array.from(byMonth.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-12)
      .map(([month, data]) => ({
        month,
        performance: data.count > 0 ? Math.round(data.totalPct / data.count) : 0,
      }));
  }, [scores]);

  // ─── Pie chart data for student performance level ───
  const studentLevelPieData = useMemo(() => {
    const allLevels = [
      { name: locale === 'ar' ? 'ممتاز' : 'Excellent', key: 'excellent' as PerformanceLevel, color: '#10b981' },
      { name: locale === 'ar' ? 'جيد جداً' : 'Very Good', key: 'veryGood' as PerformanceLevel, color: '#0ea5e9' },
      { name: locale === 'ar' ? 'جيد' : 'Good', key: 'good' as PerformanceLevel, color: '#14b8a6' },
      { name: locale === 'ar' ? 'مقبول' : 'Acceptable', key: 'acceptable' as PerformanceLevel, color: '#f59e0b' },
      { name: locale === 'ar' ? 'ضعيف' : 'Weak', key: 'weak' as PerformanceLevel, color: '#ef4444' },
    ];
    // Show the student's level highlighted in pie
    return allLevels.map(l => ({
      ...l,
      value: l.key === metrics.performanceLevel ? 1 : 0,
      isCurrent: l.key === metrics.performanceLevel,
    }));
  }, [metrics.performanceLevel, locale]);

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
  const [showInstructions, setShowInstructions] = useState(false);
  const [showPerformanceCharts, setShowPerformanceCharts] = useState(false);

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

  // ─── Per-course status config helper ───
  const getCourseStatusConfig = useCallback((pct: number) => {
    if (pct >= 80) return { label: t('student.trackingAdvanced'), className: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400 border-emerald-100 dark:border-emerald-900/60' };
    if (pct >= 60) return { label: t('student.trackingOnTrack'), className: 'bg-sky-50 text-sky-700 dark:bg-sky-900/15 dark:text-sky-400 border-sky-100 dark:border-sky-900/60' };
    if (pct >= 40) return { label: t('student.trackingNeedsAttention'), className: 'bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400 border-amber-100 dark:border-amber-900/60' };
    return { label: t('student.trackingAtRiskCourse'), className: 'bg-rose-50 text-rose-700 dark:bg-rose-900/20 dark:text-rose-400 border-rose-100 dark:border-rose-900/60' };
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
        <motion.button
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.9 }}
          onClick={() => setShowInstructions(true)}
          className="flex h-8 w-8 items-center justify-center rounded-full bg-sky-50 dark:bg-sky-900/20 ring-2 ring-sky-100 dark:ring-sky-900/40 text-sky-600 hover:bg-sky-100 dark:hover:bg-sky-900/30 transition-colors"
        >
          <Info className="h-4 w-4" />
        </motion.button>
        <Dialog open={showInstructions} onOpenChange={setShowInstructions}>
          <DialogContent className="max-w-2xl max-h-[85vh]">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Info className="h-5 w-5 text-sky-600" />
                {t('student.trackingInstructionsTitle')}
              </DialogTitle>
            </DialogHeader>
            <div className="overflow-y-auto max-h-[70vh] pr-1 space-y-5 p-1">
              {/* ── Section 1: How Overall Performance is Calculated ── */}
              <div>
                <h3 className="text-sm font-bold text-foreground mb-2 flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-sky-100 dark:bg-sky-900/30 text-sky-700 dark:text-sky-400 text-xs font-bold">1</span>
                  {locale === 'ar' ? 'كيف يُحسب الأداء العام؟' : 'How is Overall Performance Calculated?'}
                </h3>
                <p className="text-xs text-muted-foreground mb-3">
                  {locale === 'ar'
                    ? 'يُحسب أداؤك العام من 4 عناصر مُرجّحة (مجموع الأوزان = 100%). إذا لم تتوفر بيانات لأحد العناصر يُعاد توزيع وزنه تلقائياً على العناصر المتبقية.'
                    : 'Your overall performance is calculated from 4 weighted components (weights sum to 100%). If data is missing for a component, its weight is automatically redistributed among the remaining components.'}
                </p>
                <div className="space-y-2">
                  {/* Exam Performance */}
                  <div className="p-3 rounded-lg bg-sky-50 dark:bg-sky-900/10 border border-sky-100 dark:border-sky-900/30">
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-sm font-medium text-sky-700 dark:text-sky-400">
                        📝 {locale === 'ar' ? 'أداء الاختبارات' : 'Exam Performance'}
                      </p>
                      <span className="text-xs font-bold bg-sky-200 dark:bg-sky-800 text-sky-800 dark:text-sky-200 px-2 py-0.5 rounded-full">35%</span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {locale === 'ar'
                        ? 'المعادلة: (مجموع الدرجات المحصّلة ÷ مجموع الدرجات الكلية) × 100 — تُرجّح بالدرجة الكلية للاختبار وليس بنسبة مئوية متساوية، مما يعطي الاختبارات الكبيرة وزناً أكبر.'
                        : 'Formula: (Total Earned Marks ÷ Total Possible Marks) × 100 — Weighted by total marks (not equal percentages), so major exams carry more weight than small quizzes.'}
                    </p>
                  </div>
                  {/* Attendance Score */}
                  <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-900/10 border border-emerald-100 dark:border-emerald-900/30">
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">
                        🏫 {locale === 'ar' ? 'درجة الحضور' : 'Attendance Score'}
                      </p>
                      <span className="text-xs font-bold bg-emerald-200 dark:bg-emerald-800 text-emerald-800 dark:text-emerald-200 px-2 py-0.5 rounded-full">20%</span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {locale === 'ar'
                        ? 'نظام النقاط: حاضر = 100 نقطة، متأخر = 75 نقطة، حضور جزئي = 50 نقطة، غائب = 0 نقطة. ثم: (مجموع النقاط ÷ الحد الأقصى للنقاط) × 100.'
                        : 'Points system: Present = 100 pts, Late = 75 pts, Partial = 50 pts, Absent = 0 pts. Then: (Total Points ÷ Max Points) × 100.'}
                    </p>
                  </div>
                  {/* Assignment Compliance */}
                  <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-900/10 border border-amber-100 dark:border-amber-900/30">
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-sm font-medium text-amber-700 dark:text-amber-400">
                        ✅ {locale === 'ar' ? 'الالتزام بالمهام' : 'Assignment Compliance'}
                      </p>
                      <span className="text-xs font-bold bg-amber-200 dark:bg-amber-800 text-amber-800 dark:text-amber-200 px-2 py-0.5 rounded-full">15%</span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {locale === 'ar'
                        ? 'المعادلة: (عدد المهام المسلّمة ÷ إجمالي المهام) × 100 — يقيس مدى التزامك بتسليم المهام بغض النظر عن الدرجة.'
                        : 'Formula: (Submitted Assignments ÷ Total Assignments) × 100 — Measures your commitment to submitting work regardless of grade.'}
                    </p>
                  </div>
                  {/* Assignment Quality */}
                  <div className="p-3 rounded-lg bg-teal-50 dark:bg-teal-900/10 border border-teal-100 dark:border-teal-900/30">
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-sm font-medium text-teal-700 dark:text-teal-400">
                        🎯 {locale === 'ar' ? 'جودة المهام' : 'Assignment Quality'}
                      </p>
                      <span className="text-xs font-bold bg-teal-200 dark:bg-teal-800 text-teal-800 dark:text-teal-200 px-2 py-0.5 rounded-full">30%</span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {locale === 'ar'
                        ? 'المعادلة: (مجموع النقاط المحصّلة من المهام ÷ مجموع النقاط الكلية للمهام) × 100 — يقيس جودة عملك والدرجات التي حققتها.'
                        : 'Formula: (Total Earned Points from Assignments ÷ Total Possible Points) × 100 — Measures the quality of your work and grades achieved.'}
                    </p>
                  </div>
                </div>
                <div className="mt-2 p-2.5 rounded-lg bg-gray-50 dark:bg-gray-900/20 border border-gray-200 dark:border-gray-800">
                  <p className="text-xs text-muted-foreground text-center font-medium">
                    {locale === 'ar'
                      ? '📊 الأداء العام = (اختبارات × 35% + حضور × 20% + التزام × 15% + جودة × 30%) ÷ مجموع الأوزان المتوفرة'
                      : '📊 Overall = (Exams × 35% + Attendance × 20% + Compliance × 15% + Quality × 30%) ÷ Sum of Available Weights'}
                  </p>
                </div>
              </div>

              {/* ── Section 2: Performance Levels ── */}
              <div>
                <h3 className="text-sm font-bold text-foreground mb-2 flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-sky-100 dark:bg-sky-900/30 text-sky-700 dark:text-sky-400 text-xs font-bold">2</span>
                  {locale === 'ar' ? 'مستويات الأداء' : 'Performance Levels'}
                </h3>
                <div className="grid grid-cols-1 gap-1.5">
                  <div className="flex items-center gap-2 text-xs"><span className="text-emerald-600 dark:text-emerald-400">★</span><span className="font-medium">{locale === 'ar' ? 'ممتاز' : 'Excellent'}</span><span className="text-muted-foreground">≥90%</span></div>
                  <div className="flex items-center gap-2 text-xs"><span className="text-sky-600 dark:text-sky-400">◆</span><span className="font-medium">{locale === 'ar' ? 'جيد جداً' : 'Very Good'}</span><span className="text-muted-foreground">80-89%</span></div>
                  <div className="flex items-center gap-2 text-xs"><span className="text-teal-600 dark:text-teal-400">●</span><span className="font-medium">{locale === 'ar' ? 'جيد' : 'Good'}</span><span className="text-muted-foreground">70-79%</span></div>
                  <div className="flex items-center gap-2 text-xs"><span className="text-amber-600 dark:text-amber-400">▲</span><span className="font-medium">{locale === 'ar' ? 'مقبول' : 'Acceptable'}</span><span className="text-muted-foreground">60-69%</span></div>
                  <div className="flex items-center gap-2 text-xs"><span className="text-rose-600 dark:text-rose-400">▼</span><span className="font-medium">{locale === 'ar' ? 'ضعيف' : 'Weak'}</span><span className="text-muted-foreground">&lt;60%</span></div>
                </div>
              </div>

              {/* ── Section 3: Risk Level & Point System ── */}
              <div>
                <h3 className="text-sm font-bold text-foreground mb-2 flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-400 text-xs font-bold">3</span>
                  {locale === 'ar' ? 'مستوى الخطورة ونظام النقاط' : 'Risk Level & Point System'}
                </h3>
                <p className="text-xs text-muted-foreground mb-2">
                  {locale === 'ar'
                    ? 'يتم احتساب نقاط الخطورة بناءً على عدة عوامل، وكل عامل يضيف نقاطاً للمخاطرة:'
                    : 'Risk points are calculated based on several factors, each adding to your risk score:'}
                </p>
                <div className="space-y-1.5 mb-3">
                  <div className="flex items-center gap-2 text-xs"><span className="text-rose-600 dark:text-rose-400">+3</span><span className="text-muted-foreground">{locale === 'ar' ? 'الحضور أقل من 50%' : 'Attendance below 50%'}</span></div>
                  <div className="flex items-center gap-2 text-xs"><span className="text-amber-600 dark:text-amber-400">+1</span><span className="text-muted-foreground">{locale === 'ar' ? 'الحضور أقل من 70%' : 'Attendance below 70%'}</span></div>
                  <div className="flex items-center gap-2 text-xs"><span className="text-rose-600 dark:text-rose-400">+3</span><span className="text-muted-foreground">{locale === 'ar' ? 'الأداء العام أقل من 60%' : 'Overall performance below 60%'}</span></div>
                  <div className="flex items-center gap-2 text-xs"><span className="text-amber-600 dark:text-amber-400">+1</span><span className="text-muted-foreground">{locale === 'ar' ? 'الأداء العام أقل من 70%' : 'Overall performance below 70%'}</span></div>
                  <div className="flex items-center gap-2 text-xs"><span className="text-orange-600 dark:text-orange-400">+2</span><span className="text-muted-foreground">{locale === 'ar' ? 'عدم تسليم آخر 3 مهام' : 'Missed last 3 assignments'}</span></div>
                  <div className="flex items-center gap-2 text-xs"><span className="text-orange-600 dark:text-orange-400">+2</span><span className="text-muted-foreground">{locale === 'ar' ? 'اتجاه أداء تنازلي' : 'Declining performance trend'}</span></div>
                  <div className="flex items-center gap-2 text-xs"><span className="text-orange-600 dark:text-orange-400">+2</span><span className="text-muted-foreground">{locale === 'ar' ? 'عدم النشاط لأكثر من 14 يوماً' : 'Inactive for more than 14 days'}</span></div>
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  <div className="flex items-center gap-1.5 text-xs px-2 py-1 rounded bg-emerald-50 dark:bg-emerald-900/10"><span className="h-2 w-2 rounded-full bg-emerald-500" />{locale === 'ar' ? 'سليم (< 2 نقطة)' : 'Healthy (< 2 pts)'}</div>
                  <div className="flex items-center gap-1.5 text-xs px-2 py-1 rounded bg-amber-50 dark:bg-amber-900/10"><span className="h-2 w-2 rounded-full bg-amber-500" />{locale === 'ar' ? 'مراقبة (2-3 نقاط)' : 'Monitor (2-3 pts)'}</div>
                  <div className="flex items-center gap-1.5 text-xs px-2 py-1 rounded bg-orange-50 dark:bg-orange-900/10"><span className="h-2 w-2 rounded-full bg-orange-500" />{locale === 'ar' ? 'قلق (4-5 نقاط)' : 'Concern (4-5 pts)'}</div>
                  <div className="flex items-center gap-1.5 text-xs px-2 py-1 rounded bg-rose-50 dark:bg-rose-900/10"><span className="h-2 w-2 rounded-full bg-rose-500" />{locale === 'ar' ? 'في خطر (≥ 6 نقاط)' : 'At Risk (≥ 6 pts)'}</div>
                </div>
              </div>

              {/* ── Section 4: Growth, Efficiency, Discipline ── */}
              <div>
                <h3 className="text-sm font-bold text-foreground mb-2 flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 text-xs font-bold">4</span>
                  {locale === 'ar' ? 'المؤشرات الإضافية' : 'Additional Indicators'}
                </h3>
                <div className="space-y-2">
                  <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-900/10 border border-emerald-100 dark:border-emerald-900/30">
                    <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400 mb-1">📈 {locale === 'ar' ? 'مؤشر النمو' : 'Growth Index'}</p>
                    <p className="text-xs text-muted-foreground">
                      {locale === 'ar'
                        ? 'يقسم درجاتك الزمنية إلى أثلاث، ويقارن متوسط الثلث الأخير بالأول. النسبة ≥ 1.1 = تحسن (↑)، بين 0.9-1.1 = ثابت (→)، أقل من 0.9 = تراجع (↓).'
                        : 'Divides your scores chronologically into thirds, comparing the last third\'s average to the first. Ratio ≥ 1.1 = improving (↑), 0.9-1.1 = stable (→), below 0.9 = declining (↓).'}
                    </p>
                  </div>
                  <div className="p-3 rounded-lg bg-teal-50 dark:bg-teal-900/10 border border-teal-100 dark:border-teal-900/30">
                    <p className="text-sm font-medium text-teal-700 dark:text-teal-400 mb-1">⚡ {locale === 'ar' ? 'الكفاءة' : 'Efficiency'}</p>
                    <p className="text-xs text-muted-foreground">
                      {locale === 'ar'
                        ? 'المعادلة: (الأداء العام ÷ الجهد) × 100. الجهد = (الحضور × 50% + الالتزام بالمهام × 50%). عالية ≥ 80%، متوسطة 50-79%، منخفضة < 50%. إذا كان الجهد < 40% تظهر "بيانات غير كافية".'
                        : 'Formula: (Overall Performance ÷ Effort) × 100. Effort = (Attendance × 50% + Compliance × 50%). High ≥ 80%, Medium 50-79%, Low < 50%. If effort < 40%, shows "Insufficient Data".'}
                    </p>
                  </div>
                  <div className="p-3 rounded-lg bg-violet-50 dark:bg-violet-900/10 border border-violet-100 dark:border-violet-900/30">
                    <p className="text-sm font-medium text-violet-700 dark:text-violet-400 mb-1">📋 {locale === 'ar' ? 'درجة الانضباط' : 'Discipline Score'}</p>
                    <p className="text-xs text-muted-foreground">
                      {locale === 'ar'
                        ? 'ثلاثة عناصر مُرجّحة: انتظام الحضور (40%) + التسليم في الوقت (40%) + احترام المواعيد (20%). يُخصم حتى 20 نقطة بسبب التأخير.'
                        : 'Three weighted components: Attendance consistency (40%) + On-time submissions (40%) + Deadline respect (20%). Up to 20 pts penalty for late arrivals.'}
                    </p>
                  </div>
                </div>
              </div>

              {/* ── Section 5: Course Status ── */}
              <div>
                <h3 className="text-sm font-bold text-foreground mb-2 flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-400 text-xs font-bold">5</span>
                  {locale === 'ar' ? 'حالة المقرر' : 'Course Status'}
                </h3>
                <p className="text-xs text-muted-foreground mb-2">
                  {locale === 'ar'
                    ? 'كل مقرر يُحسب له أداء عام بنفس المعادلة، ويُصنّف حسب النتيجة:'
                    : 'Each course calculates its own overall performance using the same formula, then classified:'}
                </p>
                <div className="grid grid-cols-2 gap-1.5">
                  <div className="flex items-center gap-1.5 text-xs px-2 py-1 rounded bg-emerald-50 dark:bg-emerald-900/10"><span className="text-emerald-600">●</span>{locale === 'ar' ? 'متقدم (≥80%)' : 'Advanced (≥80%)'}</div>
                  <div className="flex items-center gap-1.5 text-xs px-2 py-1 rounded bg-teal-50 dark:bg-teal-900/10"><span className="text-teal-600">●</span>{locale === 'ar' ? 'على المسار (60-79%)' : 'On Track (60-79%)'}</div>
                  <div className="flex items-center gap-1.5 text-xs px-2 py-1 rounded bg-amber-50 dark:bg-amber-900/10"><span className="text-amber-600">●</span>{locale === 'ar' ? 'يحتاج متابعة (40-59%)' : 'Needs Attention (40-59%)'}</div>
                  <div className="flex items-center gap-1.5 text-xs px-2 py-1 rounded bg-rose-50 dark:bg-rose-900/10"><span className="text-rose-600">●</span>{locale === 'ar' ? 'في خطر (<40%)' : 'At Risk (<40%)'}</div>
                </div>
              </div>

              {/* ── Tip ── */}
              <div className="p-3 rounded-lg bg-sky-50 dark:bg-sky-900/10 border border-sky-200 dark:border-sky-900/40">
                <p className="text-xs font-medium text-sky-700 dark:text-sky-400 mb-1">💡 {locale === 'ar' ? 'نصيحة' : 'Tip'}</p>
                <p className="text-xs text-muted-foreground">
                  {locale === 'ar'
                    ? 'ركّز على تحسين العنصر الأضعف أولاً لأن له وزناً كبيراً في النتيجة النهائية. الاختبارات وجودة المهام يمثلان معاً 65% من أدائك العام.'
                    : 'Focus on improving your weakest component first as it has the biggest impact. Exams and assignment quality together make up 65% of your overall performance.'}
                </p>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </motion.div>

      {/* Current Status Indicator Banner */}
      <motion.div variants={itemVariants}>
        <Card className={`border-2 ${performanceConfig.ringColor} ${performanceConfig.bgColor} shadow-md`}>
          <CardContent className="p-4">
            <div className="flex items-center gap-4">
              <div className={`flex h-14 w-14 items-center justify-center rounded-full ${performanceConfig.bgColor} ring-2 ${performanceConfig.ringColor}`}>
                {metrics.overallPerformance >= 80 ? (
                  <Award className={`h-7 w-7 ${performanceConfig.textColor}`} />
                ) : metrics.overallPerformance >= 60 ? (
                  <Target className={`h-7 w-7 ${performanceConfig.textColor}`} />
                ) : (
                  <AlertTriangle className={`h-7 w-7 ${performanceConfig.textColor}`} />
                )}
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-bold text-gray-900 dark:text-foreground">
                    {t('student.trackingCurrentStatus')}
                  </h2>
                  <Badge className={`${performanceConfig.bgColor} ${performanceConfig.textColor} border-0 text-sm px-3 py-1`}>
                    {performanceConfig.icon} {t(`student.trackingExamPerformance`)}
                  </Badge>
                </div>
                <div className="flex items-center gap-3 mt-1">
                  <span className={`text-2xl font-bold ${performanceConfig.textColor}`}>
                    {Math.round(metrics.overallPerformance)}%
                  </span>
                  <Badge variant="outline" className={`${riskConfig.bgColor} ${riskConfig.textColor} ${riskConfig.borderColor} text-xs`}>
                    {getRiskLevelLabel(metrics.riskLevel)}
                  </Badge>
                  <Badge className={`${growthConfig.key === 'improving' ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400' : growthConfig.key === 'stable' ? 'bg-sky-50 dark:bg-sky-900/15 text-sky-700 dark:text-sky-400' : 'bg-rose-50 dark:bg-rose-900/20 text-rose-700 dark:text-rose-400'} border-0 text-xs`}>
                    {growthConfig.icon} {getGrowthTrendLabel(metrics.growthTrend)}
                  </Badge>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* ════════════════════════════════════════════════════════════
          Section 2: Compact Performance Summary Bar
          ════════════════════════════════════════════════════════════ */}
      <motion.div variants={itemVariants}>
        <div className="flex flex-wrap items-center gap-2 sm:gap-3 p-3 rounded-xl bg-gradient-to-l from-sky-50/60 via-teal-50/40 to-white dark:from-sky-900/10 dark:via-teal-900/5 dark:to-card border border-sky-100/60 dark:border-sky-900/30">
          <div className="flex items-center gap-2 me-1">
            <Activity className="h-4 w-4 text-sky-600" />
            <p className="text-sm font-bold text-foreground">{locale === 'ar' ? 'ملخص الأداء' : 'Performance Summary'}</p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-teal-100/80 dark:bg-teal-900/20 text-teal-700 dark:text-teal-400 text-xs font-medium">
              <TrendingUp className="h-3 w-3" />
              {Math.round(metrics.overallPerformance)}% {t('student.trackingOverallProgress')}
            </span>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-sky-100/80 dark:bg-sky-900/20 text-sky-700 dark:text-sky-400 text-xs font-medium">
              <Zap className="h-3 w-3" />
              {Math.round(metrics.efficiency)}% {t('student.trackingEfficiency')}
            </span>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-violet-100/80 dark:bg-violet-900/20 text-violet-700 dark:text-violet-400 text-xs font-medium">
              <ShieldCheck className="h-3 w-3" />
              {Math.round(metrics.disciplineScore)}% {t('student.trackingDisciplineScore')}
            </span>
            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium ${growthConfig.key === 'improving' ? 'bg-emerald-100/80 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400' : growthConfig.key === 'stable' ? 'bg-sky-100/80 dark:bg-sky-900/20 text-sky-700 dark:text-sky-400' : 'bg-rose-100/80 dark:bg-rose-900/20 text-rose-700 dark:text-rose-400'}`}>
              {growthConfig.key === 'improving' ? <ArrowUpRight className="h-3 w-3" /> : growthConfig.key === 'stable' ? <ArrowRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
              {metrics.growthIndex.toFixed(2)} {t('student.trackingGrowthIndex')}
            </span>
            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium ${riskConfig.bgColor} ${riskConfig.textColor}`}>
              <AlertTriangle className="h-3 w-3" />
              {getRiskLevelLabel(metrics.riskLevel)}
            </span>
          </div>
          <button
            onClick={() => setShowPerformanceCharts(!showPerformanceCharts)}
            className="ms-auto flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium bg-white dark:bg-gray-800 text-muted-foreground hover:text-foreground shadow-sm border border-gray-200 dark:border-gray-700 transition-colors"
          >
            <BarChart3 className="h-3 w-3" />
            {showPerformanceCharts ? (locale === 'ar' ? 'إخفاء الرسوم' : 'Hide Charts') : (locale === 'ar' ? 'عرض الرسوم' : 'Show Charts')}
          </button>
        </div>
        {/* Collapsible Charts */}
        <AnimatePresence>
          {showPerformanceCharts && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.3 }}
              className="overflow-hidden"
            >
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-3">
                {/* Area Chart: Performance Trend */}
                <div className="rounded-xl border border-sky-100/60 dark:border-sky-900/30 bg-sky-50/30 dark:bg-sky-900/5 p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <TrendingUp className="h-4 w-4 text-sky-600" />
                    <p className="text-xs font-medium text-foreground">{t('teacher.performanceTrend')}</p>
                  </div>
                  {studentTrendData.length < 2 ? (
                    <div className="py-6 text-center text-muted-foreground text-xs">
                      <BarChart3 className="h-6 w-6 mx-auto mb-1 opacity-30" />
                      {t('teacher.noTrendData')}
                    </div>
                  ) : (
                    <div className="h-[180px] w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={studentTrendData} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                          <defs>
                            <linearGradient id="stuPerfGrad" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#0ea5e9" stopOpacity={0.3} />
                              <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0} />
                            </linearGradient>
                          </defs>
                          <RechartsCartesianGrid strokeDasharray="3 3" stroke="rgba(128,128,128,0.15)" />
                          <XAxis dataKey="month" tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} tickFormatter={(v: string) => v.slice(5)} />
                          <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} />
                          <RechartsTooltip
                            contentStyle={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)', borderRadius: '8px', fontSize: '11px' }}
                            formatter={((value: unknown) => [`${value}%`, locale === 'ar' ? 'الأداء' : 'Performance']) as never}
                          />
                          <Area type="monotone" dataKey="performance" stroke="#0ea5e9" strokeWidth={2.5} fill="url(#stuPerfGrad)" dot={{ r: 3, fill: '#0ea5e9', strokeWidth: 0 }} activeDot={{ r: 5, stroke: '#0ea5e9', strokeWidth: 2, fill: '#fff' }} />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </div>

                {/* Pie Chart: Student Performance Level */}
                <div className="rounded-xl border border-amber-100/60 dark:border-amber-900/30 bg-amber-50/30 dark:bg-amber-900/5 p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <Award className="h-4 w-4 text-amber-500" />
                    <p className="text-xs font-medium text-foreground">{t('teacher.studentLevelDistribution')}</p>
                  </div>
                  <div className="flex flex-col sm:flex-row items-center gap-3">
                    <div className="h-[150px] w-[150px] shrink-0">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={studentLevelPieData}
                            cx="50%"
                            cy="50%"
                            innerRadius={38}
                            outerRadius={68}
                            paddingAngle={3}
                            dataKey="value"
                            stroke="none"
                          >
                            {studentLevelPieData.map((entry, index) => (
                              <Cell key={`cell-${index}`} fill={entry.isCurrent ? entry.color : '#e5e7eb'} fillOpacity={entry.isCurrent ? 1 : 0.3} />
                            ))}
                          </Pie>
                          <RechartsTooltip
                            contentStyle={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)', borderRadius: '8px', fontSize: '11px' }}
                            formatter={((value: unknown, name: unknown) => [value === 1 ? (locale === 'ar' ? 'مستواك الحالي' : 'Your Level') : '', name || '']) as never}
                          />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="flex flex-col gap-1.5 flex-1">
                      {studentLevelPieData.map((entry) => (
                        <div key={entry.name} className={`flex items-center gap-2 p-1 rounded-md ${entry.isCurrent ? 'bg-muted/50' : ''}`}>
                          <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: entry.isCurrent ? entry.color : '#d1d5db', opacity: entry.isCurrent ? 1 : 0.5 }} />
                          <span className={`text-[11px] flex-1 ${entry.isCurrent ? 'text-foreground font-bold' : 'text-muted-foreground'}`}>{entry.name}</span>
                          {entry.isCurrent && (
                            <Badge className="text-[8px] px-1.5 py-0" style={{ backgroundColor: entry.color, color: '#fff' }}>
                              {Math.round(metrics.overallPerformance)}%
                            </Badge>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
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
                        <div className="flex items-center gap-1.5 min-w-0">
                          <p className="text-sm font-semibold text-gray-900 dark:text-foreground truncate max-w-[200px]">
                            {subject.subjectName}
                          </p>
                          <Badge variant="secondary" className={`text-[9px] px-1.5 py-0 shrink-0 ${getCourseStatusConfig(subject.overallPerformance).className}`}>
                            {getCourseStatusConfig(subject.overallPerformance).label}
                          </Badge>
                        </div>
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

      {/* ════════════════════════════════════════════════════════════
          Status Legend — explains what each status means
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
    </motion.div>
  );
}

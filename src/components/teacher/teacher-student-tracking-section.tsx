'use client';

import { useMemo, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import {
  Activity,
  TrendingUp,
  Award,
  Users,
  Filter,
  ChevronDown,
  BarChart3,
  Trophy,
  ClipboardList,
  Clock,
  CheckCircle2,
  XCircle,
  FileText,
  Search,
  Download,
  Mail,
  Zap,
  Route,
  Target,
  BookOpen,
  ShieldCheck,
  AlertTriangle,
  Flame,
  Info,
  ArrowUpRight,
  ArrowDownRight,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { UserProfile, Score, Quiz, Subject } from '@/lib/types';
import UserAvatar from '@/components/shared/user-avatar';
import UserLink from '@/components/shared/user-link';
import { useTranslations } from '@/i18n/use-translations';
import { useLocaleStore } from '@/i18n/locale-store';
import {
  computeAllMetrics,
  computeSubjectPerformance,
  type StudentPerformanceMetrics,
  type PerformanceLevel,
  type PerformanceLevelConfig,
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
  type SubjectPerformanceData,
  type ActivityType,
  type ActivityEvent,
  DEFAULT_WEIGHTS,
} from '@/lib/performance-calculator';

// -------------------------------------------------------
// Props
// -------------------------------------------------------
interface TeacherStudentTrackingSectionProps {
  profile: UserProfile;
  students: UserProfile[];
  scores: Score[];
  quizzes: Quiz[];
  teacherSubmissions: { id: string; assignment_id: string; student_id: string; score: number | null; status: string; submitted_at?: string }[];
  teacherAssignments: { id: string; max_score: number; subject_id: string | null; due_date?: string }[];
  teacherAttendanceSessions: { id: string; subject_id: string }[];
  teacherAttendanceRecords: { id: string; session_id: string; student_id: string; attendance_status?: 'present' | 'late' | 'partial' | 'absent' }[];
  subjects?: Subject[];
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
// Percentage Range Types (kept locally for range filter UI)
// -------------------------------------------------------
type PercentageRange = '90-100' | '80-89' | '70-79' | '60-69' | 'below-60';

interface PercentageRangeConfig {
  key: PercentageRange;
  label: string;
  range: string;
  color: string;
  bgColor: string;
  textColor: string;
  borderColor: string;
}

const PERCENTAGE_RANGES: PercentageRangeConfig[] = [
  {
    key: '90-100',
    label: 'teacher.trackingRangeExcellent',
    range: '90% - 100%',
    color: 'bg-emerald-500',
    bgColor: 'bg-emerald-50 dark:bg-emerald-900/20',
    textColor: 'text-emerald-700 dark:text-emerald-500',
    borderColor: 'border-emerald-200 dark:border-emerald-900/60',
  },
  {
    key: '80-89',
    label: 'teacher.trackingRangeVeryGood',
    range: '80% - 89%',
    color: 'bg-sky-500',
    bgColor: 'bg-sky-50 dark:bg-sky-900/15',
    textColor: 'text-sky-700 dark:text-sky-400',
    borderColor: 'border-sky-200 dark:border-sky-900/60',
  },
  {
    key: '70-79',
    label: 'teacher.trackingRangeGood',
    range: '70% - 79%',
    color: 'bg-teal-500',
    bgColor: 'bg-teal-50 dark:bg-teal-900/20',
    textColor: 'text-teal-700 dark:text-teal-500',
    borderColor: 'border-teal-200 dark:border-teal-900/60',
  },
  {
    key: '60-69',
    label: 'teacher.trackingRangeAcceptable',
    range: '60% - 69%',
    color: 'bg-amber-500',
    bgColor: 'bg-amber-50 dark:bg-amber-900/20',
    textColor: 'text-amber-700 dark:text-amber-500',
    borderColor: 'border-amber-200 dark:border-amber-900/60',
  },
  {
    key: 'below-60',
    label: 'teacher.trackingRangeWeak',
    range: 'teacher.trackingBelow60',
    color: 'bg-rose-500',
    bgColor: 'bg-rose-50 dark:bg-rose-900/20',
    textColor: 'text-rose-700 dark:text-rose-500',
    borderColor: 'border-rose-200 dark:border-rose-900/60',
  },
];

function getPercentageRange(overallPct: number): PercentageRange {
  if (overallPct >= 90) return '90-100';
  if (overallPct >= 80) return '80-89';
  if (overallPct >= 70) return '70-79';
  if (overallPct >= 60) return '60-69';
  return 'below-60';
}

function getPercentageRangeConfig(range: PercentageRange): PercentageRangeConfig {
  return PERCENTAGE_RANGES.find(r => r.key === range) || PERCENTAGE_RANGES[4];
}

// -------------------------------------------------------
// Performance Level Labels (not in calculator config)
// -------------------------------------------------------
const PERFORMANCE_LEVEL_LABELS: Record<PerformanceLevel, string> = {
  excellent: 'teacher.trackingLevelExcellent',
  veryGood: 'teacher.trackingLevelVeryGood',
  good: 'teacher.trackingLevelGood',
  acceptable: 'teacher.trackingLevelAcceptable',
  weak: 'teacher.trackingLevelWeak',
};

function getPerformanceLevelLabel(level: PerformanceLevel): string {
  return PERFORMANCE_LEVEL_LABELS[level] || 'teacher.trackingLevelWeak';
}

// -------------------------------------------------------
// Helpers
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
// Student Performance Data (extended with new metrics)
// Uses SubjectPerformanceData from centralized engine
// -------------------------------------------------------
interface StudentPerformanceData {
  student: UserProfile;
  metrics: StudentPerformanceMetrics;
  level: PerformanceLevel;
  percentageRange: PercentageRange;
  studentScores: Score[];
  subjectPerformances: SubjectPerformanceData[];
  recentActivities: ActivityEvent[];
  percentile: number;
  percentileLabel: string;
}

// -------------------------------------------------------
// Sort options (extended)
// -------------------------------------------------------
type SortOption = 'name' | 'performance' | 'attendance' | 'quiz' | 'efficiency' | 'discipline' | 'growth' | 'risk' | 'exam' | 'assignQuality';

const SORT_OPTIONS: { key: SortOption; label: string }[] = [
  { key: 'name', label: 'teacher.trackingSortName' },
  { key: 'performance', label: 'teacher.trackingSortPerformance' },
  { key: 'attendance', label: 'teacher.trackingSortAttendance' },
  { key: 'quiz', label: 'teacher.trackingSortQuiz' },
  { key: 'efficiency', label: 'teacher.trackingSortEfficiency' },
  { key: 'discipline', label: 'teacher.trackingSortDiscipline' },
  { key: 'growth', label: 'teacher.trackingSortGrowth' },
  { key: 'risk', label: 'teacher.trackingSortRisk' },
  { key: 'exam', label: 'teacher.trackingSortExam' },
  { key: 'assignQuality', label: 'teacher.trackingSortAssignQuality' },
];

// -------------------------------------------------------
// Main Component
// -------------------------------------------------------
export default function TeacherStudentTrackingSection({
  profile,
  students,
  scores,
  quizzes,
  teacherSubmissions,
  teacherAssignments,
  teacherAttendanceSessions,
  teacherAttendanceRecords,
  subjects = [],
}: TeacherStudentTrackingSectionProps) {
  const { t, direction } = useTranslations();
  const locale = useLocaleStore((s) => s.locale);
  // ─── Local state ───
  const [filterLevel, setFilterLevel] = useState<PerformanceLevel | 'all'>('all');
  const [filterRange, setFilterRange] = useState<PercentageRange | 'all'>('all');
  const [filterRisk, setFilterRisk] = useState<RiskLevel | 'all'>('all');
  const [sortBy, setSortBy] = useState<SortOption>('performance');
  const [expandedStudentId, setExpandedStudentId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilterTab, setActiveFilterTab] = useState<'level' | 'range' | 'risk' | 'charts'>('level');
  const [showInstructions, setShowInstructions] = useState(false);

  // ─── Subject name lookup ───
  const subjectNameMap = useMemo(() => {
    const map = new Map<string, string>();
    subjects.forEach(s => map.set(s.id, s.name));
    quizzes.forEach(q => {
      if (q.subject_id && !map.has(q.subject_id)) {
        map.set(q.subject_id, q.title || t('teacher.trackingCourse'));
      }
    });
    return map;
  }, [subjects, quizzes, t]);

  // ─── Compute performance data for each student using shared engine ───
  const studentPerformanceData = useMemo<StudentPerformanceData[]>(() => {
    const allOverallScores: number[] = [];

    // First pass: compute metrics for each student
    const dataWithMetrics = students.map(student => {
      const metrics = computeAllMetrics({
        scores: scores.map(s => ({
          score: s.score,
          total: s.total,
          completed_at: s.completed_at,
          student_id: s.student_id,
        })),
        attendanceSessions: teacherAttendanceSessions.map(s => ({ id: s.id })),
        attendanceRecords: teacherAttendanceRecords.map(r => ({
          session_id: r.session_id,
          student_id: r.student_id,
          attendance_status: r.attendance_status,
        })),
        submissions: teacherSubmissions.map(s => ({
          assignment_id: s.assignment_id,
          student_id: s.student_id,
          score: s.score,
          status: s.status,
          submitted_at: s.submitted_at || new Date().toISOString(),
        })),
        assignments: teacherAssignments.map(a => ({
          id: a.id,
          max_score: a.max_score,
          due_date: a.due_date,
        })),
        studentId: student.id,
      });

      allOverallScores.push(metrics.overallPerformance);

      // ─── Per-subject performance using centralized engine ───
      const studentScores = scores.filter(s => s.student_id === student.id);

      // Discover unique subject IDs from all data sources
      const subjectIds = new Set<string>();
      studentScores.forEach(s => {
        const quiz = quizzes.find(q => q.id === s.quiz_id);
        if (quiz?.subject_id) subjectIds.add(quiz.subject_id);
      });
      teacherAttendanceSessions.forEach(s => subjectIds.add(s.subject_id));
      teacherAssignments.forEach(a => {
        if (a.subject_id) subjectIds.add(a.subject_id);
      });

      // Compute per-subject metrics using the centralized engine
      const subjectPerformances: SubjectPerformanceData[] = Array.from(subjectIds).map(subjectId => {
        const subjectStudentScores = studentScores
          .filter(s => quizzes.find(q => q.id === s.quiz_id)?.subject_id === subjectId)
          .map(s => ({ score: s.score, total: s.total, completed_at: s.completed_at }));

        const subjectSessions = teacherAttendanceSessions
          .filter(s => s.subject_id === subjectId)
          .map(s => ({ id: s.id }));

        const subjectAssignments = teacherAssignments
          .filter(a => (a.subject_id || 'unknown') === subjectId)
          .map(a => ({ id: a.id, max_score: a.max_score, due_date: a.due_date }));

        const subjectSubmissions = teacherSubmissions
          .filter(s => s.student_id === student.id)
          .map(s => ({
            assignment_id: s.assignment_id,
            student_id: s.student_id,
            score: s.score,
            status: s.status,
            submitted_at: s.submitted_at || new Date().toISOString(),
          }));

        return computeSubjectPerformance({
          subjectId,
          subjectName: subjectNameMap.get(subjectId) || t('teacher.trackingCourse'),
          studentScores: subjectStudentScores,
          attendanceSessions: subjectSessions,
          attendanceRecords: teacherAttendanceRecords.map(r => ({
            session_id: r.session_id,
            student_id: r.student_id,
            attendance_status: r.attendance_status,
          })),
          studentId: student.id,
          assignments: subjectAssignments,
          submissions: subjectSubmissions,
        });
      });

      // ─── Build activity timeline ───
      const recentActivities: ActivityEvent[] = [];

      // Quiz activities
      studentScores.forEach(score => {
        recentActivities.push({
          date: score.completed_at,
          type: 'quiz',
          title: t('teacher.trackingActivityQuizComplete'),
          detail: `${score.quiz_title} — ${score.score}/${score.total}`,
          importance: score.total > 0 && (score.score / score.total) * 100 >= 90 ? 'high' : 'medium',
        });
      });

      // Attendance activities
      const studentRecords = teacherAttendanceRecords.filter(r => r.student_id === student.id);
      studentRecords.slice(0, 5).forEach(record => {
        const session = teacherAttendanceSessions.find(s => s.id === record.session_id);
        const subjectName = session ? subjectNameMap.get(session.subject_id) || t('teacher.trackingCourse') : t('teacher.trackingAttendanceSession');
        recentActivities.push({
          date: record.id,
          type: 'attendance',
          title: t('teacher.trackingActivityAttendanceRecord'),
          detail: subjectName,
          importance: 'low',
        });
      });

      // Assignment submission activities
      const studentSubmissions = teacherSubmissions.filter(s => s.student_id === student.id);
      studentSubmissions.forEach(sub => {
        const assignment = teacherAssignments.find(a => a.id === sub.assignment_id);
        recentActivities.push({
          date: sub.submitted_at || new Date().toISOString(),
          type: 'assignment',
          title: t('teacher.trackingActivityAssignmentSubmit'),
          detail: assignment ? `${t('teacher.trackingTaskLabel')} (${sub.score !== null ? `${sub.score}/${assignment.max_score}` : t('teacher.trackingGrading')})` : t('teacher.trackingTaskLabel'),
          importance: 'low',
        });
      });

      // Grading events
      studentSubmissions.filter(s => s.status === 'graded').forEach(sub => {
        const assignment = teacherAssignments.find(a => a.id === sub.assignment_id);
        if (assignment && sub.score !== null) {
          recentActivities.push({
            date: sub.submitted_at || new Date().toISOString(),
            type: 'grading',
            title: t('teacher.trackingTimelineGrading'),
            detail: `${t('teacher.trackingTaskLabel')} — ${sub.score}/${assignment.max_score}`,
            importance: sub.score / assignment.max_score >= 0.9 ? 'high' : 'medium',
          });
        }
      });

      // Risk alert events
      if (metrics.riskLevel === 'concern' || metrics.riskLevel === 'atRisk') {
        recentActivities.push({
          date: new Date().toISOString(),
          type: 'risk',
          title: t('teacher.trackingTimelineRiskAlert'),
          detail: metrics.riskReasons.map(r => t(`teacher.trackingRiskReason${r.charAt(0).toUpperCase() + r.slice(1)}`)).join(', '),
          importance: 'high',
        });
      }

      // Achievement events for top performers
      if (metrics.performanceLevel === 'excellent' && metrics.overallPerformance >= 95) {
        recentActivities.push({
          date: new Date().toISOString(),
          type: 'achievement',
          title: t('teacher.trackingTimelineAchievement'),
          detail: `${t('teacher.trackingLevelExcellent')} — ${Math.round(metrics.overallPerformance)}%`,
          importance: 'high',
        });
      }

      // Sort by date
      recentActivities.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

      return {
        student,
        metrics,
        level: metrics.performanceLevel,
        percentageRange: getPercentageRange(metrics.overallPerformance),
        studentScores,
        subjectPerformances,
        recentActivities: recentActivities.slice(0, 15),
        percentile: 0,
        percentileLabel: '',
      };
    });

    // Second pass: calculate percentiles
    if (allOverallScores.length > 0) {
      dataWithMetrics.forEach(d => {
        d.percentile = calculatePercentile(d.metrics.overallPerformance, allOverallScores);
        d.percentileLabel = getPercentileLabel(d.percentile);
      });
    }

    return dataWithMetrics;
  }, [students, scores, teacherSubmissions, teacherAssignments, teacherAttendanceSessions, teacherAttendanceRecords, quizzes, subjectNameMap, t]);

  // ─── Overview stats ───
  const overviewStats = useMemo(() => {
    const totalStudents = students.length;
    const avgPerformance = totalStudents > 0
      ? studentPerformanceData.reduce((sum, d) => sum + d.metrics.overallPerformance, 0) / totalStudents
      : 0;
    const avgAttendance = totalStudents > 0
      ? studentPerformanceData.reduce((sum, d) => sum + d.metrics.attendanceScore, 0) / totalStudents
      : 0;
    const avgDiscipline = totalStudents > 0
      ? studentPerformanceData.reduce((sum, d) => sum + d.metrics.disciplineScore, 0) / totalStudents
      : 0;
    const atRiskStudents = studentPerformanceData.filter(d => d.metrics.riskLevel === 'atRisk' || d.metrics.riskLevel === 'concern').length;
    const topPerformers = studentPerformanceData.filter(d => d.metrics.performanceLevel === 'excellent').length;
    return { totalStudents, avgPerformance, avgAttendance, avgDiscipline, atRiskStudents, topPerformers };
  }, [students.length, studentPerformanceData]);

  // ─── Classification counts ───
  const classificationCounts = useMemo(() => {
    const counts: Record<PerformanceLevel, number> = { excellent: 0, veryGood: 0, good: 0, acceptable: 0, weak: 0 };
    studentPerformanceData.forEach(d => { counts[d.level]++; });
    return counts;
  }, [studentPerformanceData]);

  // ─── Percentage range distribution ───
  const percentageRangeDistribution = useMemo(() => {
    const distribution: Record<PercentageRange, number> = { '90-100': 0, '80-89': 0, '70-79': 0, '60-69': 0, 'below-60': 0 };
    studentPerformanceData.forEach(d => { distribution[d.percentageRange]++; });
    return distribution;
  }, [studentPerformanceData]);

  // ─── Risk level distribution ───
  const riskLevelDistribution = useMemo(() => {
    const distribution: Record<RiskLevel, number> = { healthy: 0, monitor: 0, concern: 0, atRisk: 0 };
    studentPerformanceData.forEach(d => { distribution[d.metrics.riskLevel]++; });
    return distribution;
  }, [studentPerformanceData]);

  // ─── Class average efficiency ───
  const classAvgEfficiency = useMemo(() => {
    if (studentPerformanceData.length === 0) return 0;
    return studentPerformanceData.reduce((sum, d) => sum + d.metrics.efficiency, 0) / studentPerformanceData.length;
  }, [studentPerformanceData]);

  // ─── Top 5 & Bottom 5 Students ───
  const topStudents = useMemo(() => {
    return [...studentPerformanceData]
      .sort((a, b) => b.metrics.overallPerformance - a.metrics.overallPerformance)
      .slice(0, 5);
  }, [studentPerformanceData]);

  const bottomStudents = useMemo(() => {
    return [...studentPerformanceData]
      .sort((a, b) => a.metrics.overallPerformance - b.metrics.overallPerformance)
      .slice(0, 5);
  }, [studentPerformanceData]);

  // ─── Per-Course Rankings (ALL students per course) ───
  const perCourseRankings = useMemo(() => {
    return subjects.map(subject => {
      const subjectScores = scores.filter(s => {
        const quiz = quizzes.find(q => q.id === s.quiz_id);
        return quiz?.subject_id === subject.id;
      });
      const subjectStudentIds = new Set(subjectScores.map(s => s.student_id));
      const subjectAssignments = teacherAssignments.filter(a => a.subject_id === subject.id);
      const subjectSessions = teacherAttendanceSessions.filter(s => s.subject_id === subject.id);

      if (subjectStudentIds.size === 0 && subjectAssignments.length === 0) return null;

      const courseStudentMetrics = studentPerformanceData
        .filter(d => subjectStudentIds.has(d.student.id))
        .map(d => ({ student: d.student, metrics: d.metrics }));

      if (courseStudentMetrics.length === 0) return null;

      // Return ALL students sorted by performance descending
      const all = [...courseStudentMetrics].sort((a, b) => b.metrics.overallPerformance - a.metrics.overallPerformance);

      return { subject, all };
    }).filter(Boolean) as { subject: Subject; all: { student: UserProfile; metrics: StudentPerformanceMetrics }[] }[];
  }, [subjects, scores, quizzes, studentPerformanceData, teacherAssignments, teacherAttendanceSessions]);

  // ─── Monthly trend data for area chart ───
  const trackingTrendData = useMemo(() => {
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

  // ─── Pie chart data for student level distribution ───
  const trackingLevelPieData = useMemo(() => {
    if (studentPerformanceData.length === 0) return [];
    return [
      { name: locale === 'ar' ? 'ممتاز' : 'Excellent', value: classificationCounts.excellent, color: '#10b981' },
      { name: locale === 'ar' ? 'جيد جداً' : 'Very Good', value: classificationCounts.veryGood, color: '#0ea5e9' },
      { name: locale === 'ar' ? 'جيد' : 'Good', value: classificationCounts.good, color: '#14b8a6' },
      { name: locale === 'ar' ? 'مقبول' : 'Acceptable', value: classificationCounts.acceptable, color: '#f59e0b' },
      { name: locale === 'ar' ? 'ضعيف' : 'Weak', value: classificationCounts.weak, color: '#ef4444' },
    ].filter(d => d.value > 0);
  }, [studentPerformanceData, classificationCounts, locale]);

  // ─── Filtered & sorted students ───
  const filteredStudents = useMemo(() => {
    let data = [...studentPerformanceData];

    // Filter by level
    if (filterLevel !== 'all') {
      data = data.filter(d => d.level === filterLevel);
    }

    // Filter by percentage range
    if (filterRange !== 'all') {
      data = data.filter(d => d.percentageRange === filterRange);
    }

    // Filter by risk level
    if (filterRisk !== 'all') {
      data = data.filter(d => d.metrics.riskLevel === filterRisk);
    }

    // Filter by search
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      data = data.filter(d =>
        d.student.name.toLowerCase().includes(q) ||
        d.student.email.toLowerCase().includes(q)
      );
    }

    // Sort
    data.sort((a, b) => {
      switch (sortBy) {
        case 'name':
          return a.student.name.localeCompare(b.student.name, 'ar');
        case 'performance':
          return b.metrics.overallPerformance - a.metrics.overallPerformance;
        case 'attendance':
          return b.metrics.attendanceScore - a.metrics.attendanceScore;
        case 'quiz':
          return b.metrics.examPerformance - a.metrics.examPerformance;
        case 'efficiency':
          return b.metrics.efficiency - a.metrics.efficiency;
        case 'discipline':
          return b.metrics.disciplineScore - a.metrics.disciplineScore;
        case 'growth':
          return b.metrics.growthIndex - a.metrics.growthIndex;
        case 'risk': {
          const riskOrder: Record<RiskLevel, number> = { atRisk: 4, concern: 3, monitor: 2, healthy: 1 };
          return riskOrder[b.metrics.riskLevel] - riskOrder[a.metrics.riskLevel];
        }
        case 'exam':
          return b.metrics.examPerformance - a.metrics.examPerformance;
        case 'assignQuality':
          return b.metrics.assignmentQuality - a.metrics.assignmentQuality;
        default:
          return 0;
      }
    });

    return data;
  }, [studentPerformanceData, filterLevel, filterRange, filterRisk, searchQuery, sortBy]);

  // ─── Toggle expand ───
  const toggleExpand = (studentId: string) => {
    setExpandedStudentId(prev => prev === studentId ? null : studentId);
  };

  // ─── Export CSV ───
  const handleExport = useCallback(() => {
    const headers = [
      t('teacher.trackingCsvName'),
      t('teacher.trackingCsvEmail'),
      t('teacher.trackingCsvExamPerformance'),
      t('teacher.trackingCsvAttendanceScore'),
      t('teacher.trackingCsvAssignCompliance'),
      t('teacher.trackingCsvAssignQuality'),
      t('teacher.trackingCsvOverallPerformance'),
      t('teacher.trackingCsvClassification'),
      t('teacher.trackingCsvEfficiency'),
      t('teacher.trackingCsvEfficiencyLevel'),
      t('teacher.trackingCsvDiscipline'),
      t('teacher.trackingCsvGrowth'),
      t('teacher.trackingCsvGrowthTrend'),
      t('teacher.trackingCsvRisk'),
      t('teacher.trackingCsvRiskReasons'),
      t('teacher.trackingCsvRanking'),
    ];

    const riskReasonTranslationMap: Record<string, string> = {
      attendanceBelow50: t('teacher.trackingRiskReasonAttendance'),
      attendanceBelow70: t('teacher.trackingRiskReasonAttendance70'),
      performanceBelow60: t('teacher.trackingRiskReasonPerformance'),
      performanceBelow70: t('teacher.trackingRiskReasonPerformance70'),
      missedLast3Assignments: t('teacher.trackingRiskReasonMissed3'),
      decliningTrend: t('teacher.trackingRiskReasonDeclining'),
      inactivity: t('teacher.trackingRiskReasonInactivity'),
    };

    const percentileLabelMap: Record<string, string> = {
      top5: t('teacher.trackingPercentileTop5'),
      top10: t('teacher.trackingPercentileTop10'),
      top25: t('teacher.trackingPercentileTop25'),
      top50: t('teacher.trackingPercentileTop50'),
      below50: t('teacher.trackingPercentileBelow50'),
    };

    const efficiencyLabelMap: Record<EfficiencyLevel, string> = {
      high: t('teacher.trackingEfficiencyHigh'),
      medium: t('teacher.trackingEfficiencyMedium'),
      low: t('teacher.trackingEfficiencyLow'),
      insufficient: t('teacher.trackingEfficiencyInsufficient'),
    };

    const growthTrendLabelMap: Record<GrowthTrend, string> = {
      improving: t('teacher.trackingGrowthImproving'),
      stable: t('teacher.trackingGrowthStable'),
      declining: t('teacher.trackingGrowthDeclining'),
    };

    const riskLabelMap: Record<RiskLevel, string> = {
      healthy: t('teacher.trackingRiskHealthy'),
      monitor: t('teacher.trackingRiskMonitor'),
      concern: t('teacher.trackingRiskConcern'),
      atRisk: t('teacher.trackingRiskAtRisk'),
    };

    const rows = studentPerformanceData.map(d => [
      d.student.name,
      d.student.email,
      Math.round(d.metrics.examPerformance) + '%',
      Math.round(d.metrics.attendanceScore) + '%',
      Math.round(d.metrics.assignmentCompliance) + '%',
      Math.round(d.metrics.assignmentQuality) + '%',
      Math.round(d.metrics.overallPerformance) + '%',
      t(getPerformanceLevelLabel(d.level)),
      Math.round(d.metrics.efficiency) + '%',
      efficiencyLabelMap[d.metrics.efficiencyLevel],
      Math.round(d.metrics.disciplineScore) + '%',
      d.metrics.growthIndex.toFixed(2),
      growthTrendLabelMap[d.metrics.growthTrend],
      riskLabelMap[d.metrics.riskLevel],
      d.metrics.riskReasons.map(r => riskReasonTranslationMap[r] || r).join('; '),
      percentileLabelMap[d.percentileLabel] || '',
    ]);

    // BOM for Arabic UTF-8 support
    const BOM = '\uFEFF';
    const csvContent = BOM + [headers, ...rows].map(row => row.join(',')).join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `student_performance_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }, [studentPerformanceData, t]);

  // ─── Risk level label helper ───
  const getRiskLabel = useCallback((level: RiskLevel): string => {
    const map: Record<RiskLevel, string> = {
      healthy: t('teacher.trackingRiskHealthy'),
      monitor: t('teacher.trackingRiskMonitor'),
      concern: t('teacher.trackingRiskConcern'),
      atRisk: t('teacher.trackingRiskAtRisk'),
    };
    return map[level];
  }, [t]);

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="space-y-6"
    >
      {/* Header */}
      <motion.div variants={itemVariants} className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-sky-600 to-teal-600 shadow-lg shadow-sky-600/25">
            <Activity className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-foreground">{t('nav.studentTracking')}</h1>
            <p className="text-sm text-muted-foreground">{t('teacher.trackingSubtitle')}</p>
          </div>
        </div>
        {/* Export button & Info button */}
        <div className="flex items-center gap-2">
          <motion.button
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            onClick={() => setShowInstructions(true)}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-sky-50 dark:bg-sky-900/20 ring-2 ring-sky-100 dark:ring-sky-900/40 text-sky-600 hover:bg-sky-100 dark:hover:bg-sky-900/30 transition-colors"
          >
            <Info className="h-4 w-4" />
          </motion.button>
          <motion.button
            whileHover={{ scale: 1.04 }}
            whileTap={{ scale: 0.96 }}
            onClick={handleExport}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-l from-sky-600 to-teal-600 text-white text-sm font-medium shadow-md shadow-sky-600/20 hover:shadow-lg hover:shadow-sky-600/30 transition-shadow"
          >
            <Download className="h-4 w-4" />
            <span className="hidden sm:inline">{t('teacher.trackingExportData')}</span>
          </motion.button>
        </div>
      </motion.div>

      {/* Instructions Dialog */}
      <Dialog open={showInstructions} onOpenChange={setShowInstructions}>
        <DialogContent className="max-w-2xl max-h-[85vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Info className="h-5 w-5 text-sky-600" />
              {t('teacher.trackingInstructionsTitle')}
            </DialogTitle>
          </DialogHeader>
          <div className="overflow-y-auto max-h-[70vh] pr-1 space-y-5 p-1">
            {/* ── Section 1: How Student Performance is Calculated ── */}
            <div>
              <h3 className="text-sm font-bold text-foreground mb-2 flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-sky-100 dark:bg-sky-900/30 text-sky-700 dark:text-sky-400 text-xs font-bold">1</span>
                {locale === 'ar' ? 'كيف يُحسب أداء الطالب؟' : 'How is Student Performance Calculated?'}
              </h3>
              <p className="text-xs text-muted-foreground mb-3">
                {locale === 'ar'
                  ? 'يُحسب أداء كل طالب من 4 عناصر مُرجّحة. إذا لم تتوفر بيانات لعنصر يُعاد توزيع وزنه تلقائياً.'
                  : 'Each student\'s performance is calculated from 4 weighted components. If data is missing, its weight is automatically redistributed.'}
              </p>
              <div className="space-y-2">
                <div className="p-3 rounded-lg bg-sky-50 dark:bg-sky-900/10 border border-sky-100 dark:border-sky-900/30">
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-sm font-medium text-sky-700 dark:text-sky-400">📝 {locale === 'ar' ? 'أداء الاختبارات' : 'Exam Performance'}</p>
                    <span className="text-xs font-bold bg-sky-200 dark:bg-sky-800 text-sky-800 dark:text-sky-200 px-2 py-0.5 rounded-full">35%</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {locale === 'ar'
                      ? 'المعادلة: (مجموع الدرجات المحصّلة ÷ مجموع الدرجات الكلية) × 100 — تُرجّح بالدرجة الكلية للاختبار.'
                      : 'Formula: (Total Earned Marks ÷ Total Possible Marks) × 100 — Weighted by total marks so major exams carry more weight.'}
                  </p>
                </div>
                <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-900/10 border border-emerald-100 dark:border-emerald-900/30">
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">🏫 {locale === 'ar' ? 'درجة الحضور' : 'Attendance Score'}</p>
                    <span className="text-xs font-bold bg-emerald-200 dark:bg-emerald-800 text-emerald-800 dark:text-emerald-200 px-2 py-0.5 rounded-full">20%</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {locale === 'ar'
                      ? 'نظام النقاط: حاضر = 100، متأخر = 75، جزئي = 50، غائب = 0. ثم: (المجموع ÷ الحد الأقصى) × 100.'
                      : 'Points: Present = 100, Late = 75, Partial = 50, Absent = 0. Then: (Total ÷ Max) × 100.'}
                  </p>
                </div>
                <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-900/10 border border-amber-100 dark:border-amber-900/30">
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-sm font-medium text-amber-700 dark:text-amber-400">✅ {locale === 'ar' ? 'الالتزام بالمهام' : 'Assignment Compliance'}</p>
                    <span className="text-xs font-bold bg-amber-200 dark:bg-amber-800 text-amber-800 dark:text-amber-200 px-2 py-0.5 rounded-full">15%</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {locale === 'ar'
                      ? 'المعادلة: (المهام المسلّمة ÷ إجمالي المهام) × 100 — يقيس التزام الطالب بالتسليم.'
                      : 'Formula: (Submitted ÷ Total Assignments) × 100 — Measures submission commitment.'}
                  </p>
                </div>
                <div className="p-3 rounded-lg bg-teal-50 dark:bg-teal-900/10 border border-teal-100 dark:border-teal-900/30">
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-sm font-medium text-teal-700 dark:text-teal-400">🎯 {locale === 'ar' ? 'جودة المهام' : 'Assignment Quality'}</p>
                    <span className="text-xs font-bold bg-teal-200 dark:bg-teal-800 text-teal-800 dark:text-teal-200 px-2 py-0.5 rounded-full">30%</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {locale === 'ar'
                      ? 'المعادلة: (النقاط المحصّلة ÷ النقاط الكلية للمهام) × 100 — يقيس جودة العمل.'
                      : 'Formula: (Earned Points ÷ Possible Points) × 100 — Measures work quality.'}
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

            {/* ── Section 2: Section Health Indicator ── */}
            <div>
              <h3 className="text-sm font-bold text-foreground mb-2 flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 text-xs font-bold">2</span>
                {locale === 'ar' ? 'مؤشر صحة القسم' : 'Section Health Indicator'}
              </h3>
              <p className="text-xs text-muted-foreground mb-2">
                {locale === 'ar'
                  ? 'يُظهر ملخصاً سريعاً لحالة القسم بناءً على متوسط الأداء وتوزيع مستويات الخطورة:'
                  : 'Shows a quick summary of section health based on average performance and risk distribution:'}
              </p>
              <div className="grid grid-cols-2 gap-1.5">
                <div className="flex items-center gap-1.5 text-xs px-2 py-1 rounded bg-emerald-50 dark:bg-emerald-900/10"><span className="text-emerald-600">●</span>{locale === 'ar' ? 'ممتاز (المتوسط ≥80%)' : 'Excellent (Avg ≥80%)'}</div>
                <div className="flex items-center gap-1.5 text-xs px-2 py-1 rounded bg-teal-50 dark:bg-teal-900/10"><span className="text-teal-600">●</span>{locale === 'ar' ? 'جيد (المتوسط 60-79%)' : 'Good (Avg 60-79%)'}</div>
                <div className="flex items-center gap-1.5 text-xs px-2 py-1 rounded bg-amber-50 dark:bg-amber-900/10"><span className="text-amber-600">●</span>{locale === 'ar' ? 'يحتاج تحسين (المتوسط 40-59%)' : 'Needs Improvement (Avg 40-59%)'}</div>
                <div className="flex items-center gap-1.5 text-xs px-2 py-1 rounded bg-rose-50 dark:bg-rose-900/10"><span className="text-rose-600">●</span>{locale === 'ar' ? 'حرج (المتوسط <40%)' : 'Critical (Avg <40%)'}</div>
              </div>
            </div>

            {/* ── Section 3: Risk Point System (Teacher View) ── */}
            <div>
              <h3 className="text-sm font-bold text-foreground mb-2 flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-400 text-xs font-bold">3</span>
                {locale === 'ar' ? 'نظام نقاط الخطورة' : 'Risk Point System'}
              </h3>
              <p className="text-xs text-muted-foreground mb-2">
                {locale === 'ar'
                  ? 'كل طالب يُحسب له نقاط خطورة تراكمية بناءً على العوامل التالية:'
                  : 'Each student accumulates risk points based on these factors:'}
              </p>
              <div className="space-y-1.5 mb-3">
                <div className="flex items-center gap-2 text-xs"><span className="text-rose-600 dark:text-rose-400">+3</span><span className="text-muted-foreground">{locale === 'ar' ? 'حضور الطالب أقل من 50%' : 'Student attendance below 50%'}</span></div>
                <div className="flex items-center gap-2 text-xs"><span className="text-amber-600 dark:text-amber-400">+1</span><span className="text-muted-foreground">{locale === 'ar' ? 'حضور الطالب أقل من 70%' : 'Student attendance below 70%'}</span></div>
                <div className="flex items-center gap-2 text-xs"><span className="text-rose-600 dark:text-rose-400">+3</span><span className="text-muted-foreground">{locale === 'ar' ? 'أداء الطالب أقل من 60%' : 'Student performance below 60%'}</span></div>
                <div className="flex items-center gap-2 text-xs"><span className="text-amber-600 dark:text-amber-400">+1</span><span className="text-muted-foreground">{locale === 'ar' ? 'أداء الطالب أقل من 70%' : 'Student performance below 70%'}</span></div>
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

            {/* ── Section 4: Per-Course Indicator ── */}
            <div>
              <h3 className="text-sm font-bold text-foreground mb-2 flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-400 text-xs font-bold">4</span>
                {locale === 'ar' ? 'مؤشر المقرر لكل طالب' : 'Per-Course Student Indicator'}
              </h3>
              <p className="text-xs text-muted-foreground mb-2">
                {locale === 'ar'
                  ? 'لكل طالب يُحسب أداء خاص بكل مقرر بنفس المعادلة. يساعدك على تحديد المقررات التي يواجه فيها الطالب مشاكل بسرعة:'
                  : 'For each student, per-course performance is calculated using the same formula. Helps you quickly identify problematic courses:'}
              </p>
              <div className="grid grid-cols-2 gap-1.5">
                <div className="flex items-center gap-1.5 text-xs px-2 py-1 rounded bg-emerald-50 dark:bg-emerald-900/10"><span className="text-emerald-600">●</span>{locale === 'ar' ? 'متقدم (≥80%)' : 'Advanced (≥80%)'}</div>
                <div className="flex items-center gap-1.5 text-xs px-2 py-1 rounded bg-teal-50 dark:bg-teal-900/10"><span className="text-teal-600">●</span>{locale === 'ar' ? 'على المسار (60-79%)' : 'On Track (60-79%)'}</div>
                <div className="flex items-center gap-1.5 text-xs px-2 py-1 rounded bg-amber-50 dark:bg-amber-900/10"><span className="text-amber-600">●</span>{locale === 'ar' ? 'يحتاج متابعة (40-59%)' : 'Needs Attention (40-59%)'}</div>
                <div className="flex items-center gap-1.5 text-xs px-2 py-1 rounded bg-rose-50 dark:bg-rose-900/10"><span className="text-rose-600">●</span>{locale === 'ar' ? 'في خطر (<40%)' : 'At Risk (<40%)'}</div>
              </div>
            </div>

            {/* ── Section 5: Additional Metrics Explanation ── */}
            <div>
              <h3 className="text-sm font-bold text-foreground mb-2 flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 text-xs font-bold">5</span>
                {locale === 'ar' ? 'المقاييس الإضافية' : 'Additional Metrics'}
              </h3>
              <div className="space-y-2">
                <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-900/10 border border-emerald-100 dark:border-emerald-900/30">
                  <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400 mb-1">📈 {locale === 'ar' ? 'مؤشر النمو' : 'Growth Index'}</p>
                  <p className="text-xs text-muted-foreground">
                    {locale === 'ar'
                      ? 'يقارن متوسط درجات الثلث الأخير بالثلث الأول زمنياً. ≥ 1.1 = تحسن، 0.9-1.1 = ثابت، < 0.9 = تراجع.'
                      : 'Compares the last third\'s average scores to the first third chronologically. ≥ 1.1 = improving, 0.9-1.1 = stable, < 0.9 = declining.'}
                  </p>
                </div>
                <div className="p-3 rounded-lg bg-teal-50 dark:bg-teal-900/10 border border-teal-100 dark:border-teal-900/30">
                  <p className="text-sm font-medium text-teal-700 dark:text-teal-400 mb-1">⚡ {locale === 'ar' ? 'الكفاءة' : 'Efficiency'}</p>
                  <p className="text-xs text-muted-foreground">
                    {locale === 'ar'
                      ? 'المعادلة: (الأداء العام ÷ الجهد) × 100. الجهد = (الحضور × 50% + الالتزام × 50%). تقيس مدى استفادة الطالب من جهده.'
                      : 'Formula: (Overall Performance ÷ Effort) × 100. Effort = (Attendance × 50% + Compliance × 50%). Measures how well the student utilizes their effort.'}
                  </p>
                </div>
                <div className="p-3 rounded-lg bg-violet-50 dark:bg-violet-900/10 border border-violet-100 dark:border-violet-900/30">
                  <p className="text-sm font-medium text-violet-700 dark:text-violet-400 mb-1">📋 {locale === 'ar' ? 'الانضباط' : 'Discipline'}</p>
                  <p className="text-xs text-muted-foreground">
                    {locale === 'ar'
                      ? 'مُكوّن من: انتظام الحضور (40%) + التسليم في الوقت (40%) + احترام المواعيد (20%). خصم حتى 20 نقطة للتأخير.'
                      : 'Components: Attendance consistency (40%) + On-time submissions (40%) + Deadline respect (20%). Up to 20 pts penalty for late arrivals.'}
                  </p>
                </div>
              </div>
            </div>

            {/* ── Teacher Action Tip ── */}
            <div className="p-3 rounded-lg bg-sky-50 dark:bg-sky-900/10 border border-sky-200 dark:border-sky-900/40">
              <p className="text-xs font-medium text-sky-700 dark:text-sky-400 mb-1">💡 {locale === 'ar' ? 'نصيحة للمعلم' : 'Teacher Tip'}</p>
              <p className="text-xs text-muted-foreground">
                {locale === 'ar'
                  ? 'استخدم الفلترة حسب مستوى الخطورة لتحديد الطلاب الذين يحتاجون تدخلاً عاجلاً. الطلاب "في خطر" (≥ 6 نقاط) يجب التواصل معهم فوراً. راقب المقررات "في خطر" لكل طالب لمعرفة أين يحتاج الدعم.'
                  : 'Use risk level filters to identify students needing urgent intervention. "At Risk" students (≥ 6 pts) should be contacted immediately. Monitor per-course "At Risk" indicators to pinpoint where each student needs support.'}
              </p>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Compact Overview Strip + Health Status ── */}
      <motion.div variants={itemVariants}>
        <div className={`rounded-xl border shadow-sm overflow-hidden ${
          overviewStats.atRiskStudents === 0 && overviewStats.avgPerformance >= 70
            ? 'border-emerald-200/60 dark:border-emerald-900/40 bg-gradient-to-l from-emerald-50/40 via-card to-card dark:from-emerald-900/10'
            : overviewStats.avgPerformance >= 50
            ? 'border-amber-200/60 dark:border-amber-900/40 bg-gradient-to-l from-amber-50/40 via-card to-card dark:from-amber-900/10'
            : 'border-rose-200/60 dark:border-rose-900/40 bg-gradient-to-l from-rose-50/40 via-card to-card dark:from-rose-900/10'
        }`}>
          {/* Health status header */}
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-border/40">
            <div className="flex items-center gap-2.5">
              <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${
                overviewStats.atRiskStudents === 0 && overviewStats.avgPerformance >= 70
                  ? 'bg-emerald-100 dark:bg-emerald-900/30'
                  : overviewStats.avgPerformance >= 50
                  ? 'bg-amber-100 dark:bg-amber-900/30'
                  : 'bg-rose-100 dark:bg-rose-900/30'
              }`}>
                {overviewStats.atRiskStudents === 0 && overviewStats.avgPerformance >= 70 ? (
                  <Award className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                ) : overviewStats.avgPerformance >= 50 ? (
                  <Target className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                ) : (
                  <AlertTriangle className="h-4 w-4 text-rose-600 dark:text-rose-400" />
                )}
              </div>
              <div>
                <h3 className="text-xs font-bold text-foreground">{t('teacher.trackingSectionHealth')}</h3>
                <Badge className={`text-[9px] px-1.5 py-0 border-0 mt-0.5 ${
                  overviewStats.atRiskStudents === 0 && overviewStats.avgPerformance >= 70
                    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                    : overviewStats.avgPerformance >= 50
                    ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                    : 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400'
                }`}>
                  {overviewStats.atRiskStudents === 0 && overviewStats.avgPerformance >= 70
                    ? t('teacher.trackingAdvanced')
                    : overviewStats.avgPerformance >= 50
                    ? t('teacher.trackingNeedsAttention')
                    : t('teacher.trackingAtRiskCourse')}
                </Badge>
              </div>
            </div>
            {overviewStats.atRiskStudents > 0 && (
              <div className="flex items-center gap-1 px-2 py-1 rounded-lg bg-rose-50 dark:bg-rose-900/20 border border-rose-200/60 dark:border-rose-900/40">
                <AlertTriangle className="h-3 w-3 text-rose-500" />
                <span className="text-[10px] font-bold text-rose-600 dark:text-rose-400">{overviewStats.atRiskStudents}</span>
                <span className="text-[10px] text-rose-500 dark:text-rose-500">{t('teacher.trackingRiskLevel')}</span>
              </div>
            )}
          </div>
          {/* Compact stat pills */}
          <div className="flex flex-wrap items-center gap-2 px-4 py-3">
            <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-sky-50 dark:bg-sky-900/20 border border-sky-100 dark:border-sky-900/40">
              <Users className="h-3.5 w-3.5 text-sky-600 dark:text-sky-400" />
              <span className="text-xs font-bold text-sky-700 dark:text-sky-400">{overviewStats.totalStudents}</span>
              <span className="text-[10px] text-sky-600 dark:text-sky-500">{t('teacher.trackingTotalStudents')}</span>
            </div>
            <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-teal-50 dark:bg-teal-900/20 border border-teal-100 dark:border-teal-900/40">
              <TrendingUp className="h-3.5 w-3.5 text-teal-600 dark:text-teal-400" />
              <span className="text-xs font-bold text-teal-700 dark:text-teal-400">{Math.round(overviewStats.avgPerformance)}%</span>
              <span className="text-[10px] text-teal-600 dark:text-teal-500">{t('teacher.trackingAvgPerformance')}</span>
            </div>
            <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-100 dark:border-amber-900/40">
              <Clock className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
              <span className="text-xs font-bold text-amber-700 dark:text-amber-400">{Math.round(overviewStats.avgAttendance)}%</span>
              <span className="text-[10px] text-amber-600 dark:text-amber-500">{t('teacher.trackingAttendanceRate')}</span>
            </div>
            <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-violet-50 dark:bg-violet-900/20 border border-violet-100 dark:border-violet-900/40">
              <ShieldCheck className="h-3.5 w-3.5 text-violet-600 dark:text-violet-400" />
              <span className="text-xs font-bold text-violet-700 dark:text-violet-400">{Math.round(overviewStats.avgDiscipline)}%</span>
              <span className="text-[10px] text-violet-600 dark:text-violet-500">{t('teacher.trackingDisciplineScore')}</span>
            </div>
            {overviewStats.topPerformers > 0 && (
              <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-100 dark:border-emerald-900/40">
                <Award className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                <span className="text-xs font-bold text-emerald-700 dark:text-emerald-400">{overviewStats.topPerformers}</span>
                <span className="text-[10px] text-emerald-600 dark:text-emerald-500">{t('teacher.trackingTopPerformers')}</span>
              </div>
            )}
          </div>
        </div>
      </motion.div>

      {/* ── Classification Distribution with Tabs (level / range / risk) ── */}
      <motion.div variants={itemVariants}>
        <Card className="border-sky-100/50 shadow-sm">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <CardTitle className="text-lg flex items-center gap-2">
                <Filter className="h-5 w-5 text-sky-600" />
                {t('teacher.trackingClassificationByPerformance')}
              </CardTitle>
              {/* Tab switcher */}
              <div className="flex items-center gap-1 bg-gray-100 dark:bg-gray-800/40 rounded-lg p-0.5">
                <button
                  onClick={() => setActiveFilterTab('level')}
                  className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
                    activeFilterTab === 'level'
                      ? 'bg-white dark:bg-card text-gray-900 dark:text-gray-100 shadow-sm'
                      : 'text-gray-500 dark:text-muted-foreground hover:text-gray-700 dark:text-foreground'
                  }`}
                >
                  {t('teacher.trackingByLevel')}
                </button>
                <button
                  onClick={() => setActiveFilterTab('range')}
                  className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
                    activeFilterTab === 'range'
                      ? 'bg-white dark:bg-card text-gray-900 dark:text-gray-100 shadow-sm'
                      : 'text-gray-500 dark:text-muted-foreground hover:text-gray-700 dark:text-foreground'
                  }`}
                >
                  {t('teacher.trackingByPercentage')}
                </button>
                <button
                  onClick={() => setActiveFilterTab('risk')}
                  className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
                    activeFilterTab === 'risk'
                      ? 'bg-white dark:bg-card text-gray-900 dark:text-gray-100 shadow-sm'
                      : 'text-gray-500 dark:text-muted-foreground hover:text-gray-700 dark:text-foreground'
                  }`}
                >
                  {t('teacher.trackingRiskLevel')}
                </button>
                <button
                  onClick={() => setActiveFilterTab('charts')}
                  className={`flex items-center gap-1 px-3 py-1 rounded-md text-xs font-medium transition-all ${
                    activeFilterTab === 'charts'
                      ? 'bg-white dark:bg-card text-gray-900 dark:text-gray-100 shadow-sm'
                      : 'text-gray-500 dark:text-muted-foreground hover:text-gray-700 dark:text-foreground'
                  }`}
                >
                  <BarChart3 className="h-3 w-3" />
                  {t('teacher.chartView')}
                </button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <AnimatePresence mode="wait">
              {activeFilterTab === 'level' ? (
                <motion.div
                  key="level-tab"
                  initial={{ opacity: 0, x: 10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -10 }}
                  transition={{ duration: 0.2 }}
                >
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
                    {PERFORMANCE_LEVELS.map(level => {
                      const count = classificationCounts[level.key];
                      const isActive = filterLevel === level.key;
                      return (
                        <motion.button
                          key={level.key}
                          whileHover={{ scale: 1.03 }}
                          whileTap={{ scale: 0.97 }}
                          onClick={() => setFilterLevel(isActive ? 'all' : level.key)}
                          className={`relative flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all duration-200 ${
                            isActive
                              ? `${level.bgColor} ${level.ringColor} ring-2 border-current ${level.textColor}`
                              : 'bg-white dark:bg-card border-gray-100 hover:border-gray-200 text-gray-600 dark:text-muted-foreground dark:text-gray-500'
                          }`}
                        >
                          <span className={`text-3xl font-bold ${isActive ? level.textColor : 'text-gray-400 dark:text-muted-foreground'}`}>
                            {count}
                          </span>
                          <span className={`text-sm font-medium ${isActive ? level.textColor : 'text-gray-500 dark:text-muted-foreground'}`}>
                            {t(getPerformanceLevelLabel(level.key))}
                          </span>
                          <span className={`text-xs ${isActive ? level.textColor : 'text-gray-400 dark:text-muted-foreground'}`}>
                            {level.key === 'excellent' ? '90-100%' : level.key === 'veryGood' ? '80-89%' : level.key === 'good' ? '70-79%' : level.key === 'acceptable' ? '60-69%' : '<60%'}
                          </span>
                          {isActive && (
                            <motion.div
                              layoutId="activeFilterIndicator"
                              className={`absolute bottom-0 start-1/2 -translate-x-1/2 w-8 h-1 rounded-full ${level.color}`}
                              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                            />
                          )}
                        </motion.button>
                      );
                    })}
                  </div>
                </motion.div>
              ) : activeFilterTab === 'range' ? (
                <motion.div
                  key="range-tab"
                  initial={{ opacity: 0, x: 10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -10 }}
                  transition={{ duration: 0.2 }}
                >
                  {/* Percentage range filter buttons */}
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-4">
                    {PERCENTAGE_RANGES.map(range => {
                      const count = percentageRangeDistribution[range.key];
                      const isActive = filterRange === range.key;
                      return (
                        <motion.button
                          key={range.key}
                          whileHover={{ scale: 1.03 }}
                          whileTap={{ scale: 0.97 }}
                          onClick={() => setFilterRange(isActive ? 'all' : range.key)}
                          className={`relative flex flex-col items-center gap-1.5 p-3 rounded-xl border-2 transition-all duration-200 ${
                            isActive
                              ? `${range.bgColor} ${range.borderColor} border-current ${range.textColor}`
                              : 'bg-white dark:bg-card border-gray-100 hover:border-gray-200 text-gray-600 dark:text-muted-foreground dark:text-gray-500'
                          }`}
                        >
                          <span className={`text-2xl font-bold ${isActive ? range.textColor : 'text-gray-400 dark:text-muted-foreground'}`}>
                            {count}
                          </span>
                          <span className={`text-xs font-medium ${isActive ? range.textColor : 'text-gray-500 dark:text-muted-foreground'}`}>
                            {t(range.label)}
                          </span>
                          <span className={`text-[10px] ${isActive ? range.textColor : 'text-gray-400 dark:text-muted-foreground'}`}>
                            {range.key === 'below-60' ? t(range.range) : range.range}
                          </span>
                        </motion.button>
                      );
                    })}
                  </div>

                  {/* Performance Distribution Horizontal Bar Chart */}
                  <div className="mt-2 p-4 rounded-xl bg-gradient-to-l from-gray-50/80 dark:from-gray-800/50 to-white dark:to-card border border-gray-100/80 dark:border-gray-800/60">
                    <div className="flex items-center gap-2 mb-3">
                      <BarChart3 className="h-4 w-4 text-sky-600" />
                      <span className="text-sm font-medium text-gray-900 dark:text-foreground">{t('teacher.trackingPerformanceDistribution')}</span>
                    </div>
                    <div className="space-y-2.5">
                      {PERCENTAGE_RANGES.map(range => {
                        const count = percentageRangeDistribution[range.key];
                        const percentage = students.length > 0 ? (count / students.length) * 100 : 0;
                        return (
                          <div key={range.key} className="flex items-center gap-3">
                            <span className="text-[11px] font-medium text-gray-600 dark:text-muted-foreground min-w-[70px] text-start">
                              {range.key === 'below-60' ? t(range.range) : range.range}
                            </span>
                            <div className="flex-1 h-6 bg-gray-100 dark:bg-gray-800/40 rounded-full overflow-hidden">
                              <motion.div
                                initial={{ width: 0 }}
                                animate={{ width: `${Math.max(percentage, 0)}%` }}
                                transition={{ duration: 0.6, ease: 'easeOut' as const }}
                                className={`h-full ${range.color} rounded-full`}
                              />
                            </div>
                            <span className="text-xs font-bold text-gray-700 dark:text-foreground min-w-[30px] text-center">
                              {count}
                            </span>
                            <span className="text-[10px] text-gray-400 dark:text-muted-foreground min-w-[35px] text-center">
                              {Math.round(percentage)}%
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </motion.div>
              ) : activeFilterTab === 'risk' ? (
                /* Risk Level Distribution Tab */
                <motion.div
                  key="risk-tab"
                  initial={{ opacity: 0, x: 10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -10 }}
                  transition={{ duration: 0.2 }}
                >
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {RISK_LEVELS.map(risk => {
                      const count = riskLevelDistribution[risk.key];
                      const isActive = filterRisk === risk.key;
                      return (
                        <motion.button
                          key={risk.key}
                          whileHover={{ scale: 1.03 }}
                          whileTap={{ scale: 0.97 }}
                          onClick={() => setFilterRisk(isActive ? 'all' : risk.key)}
                          className={`relative flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all duration-200 ${
                            isActive
                              ? `${risk.bgColor} ${risk.borderColor} border-current ${risk.textColor}`
                              : 'bg-white dark:bg-card border-gray-100 hover:border-gray-200 text-gray-600 dark:text-muted-foreground dark:text-gray-500'
                          }`}
                        >
                          <span className={`flex h-3 w-3 rounded-full ${risk.dotColor} mb-1`} />
                          <span className={`text-3xl font-bold ${isActive ? risk.textColor : 'text-gray-400 dark:text-muted-foreground'}`}>
                            {count}
                          </span>
                          <span className={`text-sm font-medium ${isActive ? risk.textColor : 'text-gray-500 dark:text-muted-foreground'}`}>
                            {getRiskLabel(risk.key)}
                          </span>
                          {isActive && (
                            <motion.div
                              layoutId="activeRiskFilterIndicator"
                              className={`absolute bottom-0 start-1/2 -translate-x-1/2 w-8 h-1 rounded-full ${risk.color}`}
                              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                            />
                          )}
                        </motion.button>
                      );
                    })}
                  </div>

                  {/* Risk Distribution Bar Chart */}
                  <div className="mt-4 p-4 rounded-xl bg-gradient-to-l from-gray-50/80 dark:from-gray-800/50 to-white dark:to-card border border-gray-100/80 dark:border-gray-800/60">
                    <div className="flex items-center gap-2 mb-3">
                      <AlertTriangle className="h-4 w-4 text-rose-600" />
                      <span className="text-sm font-medium text-gray-900 dark:text-foreground">{t('teacher.trackingRiskLevel')}</span>
                    </div>
                    <div className="space-y-2.5">
                      {RISK_LEVELS.map(risk => {
                        const count = riskLevelDistribution[risk.key];
                        const percentage = students.length > 0 ? (count / students.length) * 100 : 0;
                        return (
                          <div key={risk.key} className="flex items-center gap-3">
                            <span className="text-[11px] font-medium text-gray-600 dark:text-muted-foreground min-w-[70px] text-start">
                              {getRiskLabel(risk.key)}
                            </span>
                            <div className="flex-1 h-6 bg-gray-100 dark:bg-gray-800/40 rounded-full overflow-hidden">
                              <motion.div
                                initial={{ width: 0 }}
                                animate={{ width: `${Math.max(percentage, 0)}%` }}
                                transition={{ duration: 0.6, ease: 'easeOut' as const }}
                                className={`h-full ${risk.color} rounded-full`}
                              />
                            </div>
                            <span className="text-xs font-bold text-gray-700 dark:text-foreground min-w-[30px] text-center">
                              {count}
                            </span>
                            <span className="text-[10px] text-gray-400 dark:text-muted-foreground min-w-[35px] text-center">
                              {Math.round(percentage)}%
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </motion.div>
              ) : activeFilterTab === 'charts' ? (
                /* ── Charts Tab: Performance Trend + Level Distribution ── */
                <motion.div
                  key="charts-tab"
                  initial={{ opacity: 0, x: 10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -10 }}
                  transition={{ duration: 0.2 }}
                >
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    {/* Area Chart: Performance Trend */}
                    <div className="rounded-xl border border-sky-100/60 dark:border-sky-900/30 bg-sky-50/30 dark:bg-sky-900/5 p-3">
                      <div className="flex items-center gap-2 mb-2">
                        <TrendingUp className="h-4 w-4 text-sky-600" />
                        <p className="text-xs font-medium text-foreground">{t('teacher.performanceTrend')}</p>
                      </div>
                      {trackingTrendData.length < 2 ? (
                        <div className="py-6 text-center text-muted-foreground text-xs">
                          <BarChart3 className="h-6 w-6 mx-auto mb-1 opacity-30" />
                          {t('teacher.noTrendData')}
                        </div>
                      ) : (
                        <div className="h-[180px] w-full">
                          <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={trackingTrendData} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                              <defs>
                                <linearGradient id="trackPerfGrad" x1="0" y1="0" x2="0" y2="1">
                                  <stop offset="5%" stopColor="#0ea5e9" stopOpacity={0.3} />
                                  <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0} />
                                </linearGradient>
                              </defs>
                              <CartesianGrid strokeDasharray="3 3" stroke="rgba(128,128,128,0.15)" />
                              <XAxis dataKey="month" tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} tickFormatter={(v: string) => v.slice(5)} />
                              <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} />
                              <Tooltip
                                contentStyle={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)', borderRadius: '8px', fontSize: '11px' }}
                                formatter={((value: unknown) => [`${value}%`, locale === 'ar' ? 'الأداء' : 'Performance']) as never}
                              />
                              <Area type="monotone" dataKey="performance" stroke="#0ea5e9" strokeWidth={2.5} fill="url(#trackPerfGrad)" dot={{ r: 3, fill: '#0ea5e9', strokeWidth: 0 }} activeDot={{ r: 5, stroke: '#0ea5e9', strokeWidth: 2, fill: '#fff' }} />
                            </AreaChart>
                          </ResponsiveContainer>
                        </div>
                      )}
                    </div>

                    {/* Pie Chart: Student Level Distribution */}
                    <div className="rounded-xl border border-amber-100/60 dark:border-amber-900/30 bg-amber-50/30 dark:bg-amber-900/5 p-3">
                      <div className="flex items-center gap-2 mb-2">
                        <Award className="h-4 w-4 text-amber-500" />
                        <p className="text-xs font-medium text-foreground">{t('teacher.studentLevelDistribution')}</p>
                      </div>
                      {trackingLevelPieData.length === 0 ? (
                        <div className="py-6 text-center text-muted-foreground text-xs">
                          <Award className="h-6 w-6 mx-auto mb-1 opacity-30" />
                          {t('teacher.noPerformanceData')}
                        </div>
                      ) : (
                        <div className="flex flex-col sm:flex-row items-center gap-3">
                          <div className="h-[150px] w-[150px] shrink-0">
                            <ResponsiveContainer width="100%" height="100%">
                              <PieChart>
                                <Pie data={trackingLevelPieData} cx="50%" cy="50%" innerRadius={38} outerRadius={68} paddingAngle={2} dataKey="value" stroke="none">
                                  {trackingLevelPieData.map((entry, index) => (
                                    <Cell key={`cell-${index}`} fill={entry.color} />
                                  ))}
                                </Pie>
                                <Tooltip
                                  contentStyle={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)', borderRadius: '8px', fontSize: '11px' }}
                                  formatter={((value: unknown, name: unknown) => [`${value} ${locale === 'ar' ? 'طالب' : 'students'}`, name]) as never}
                                />
                              </PieChart>
                            </ResponsiveContainer>
                          </div>
                          <div className="flex flex-col gap-1.5 flex-1">
                            {trackingLevelPieData.map((entry) => {
                              const pct = studentPerformanceData.length > 0 ? Math.round((entry.value / studentPerformanceData.length) * 100) : 0;
                              return (
                                <div key={entry.name} className="flex items-center gap-2">
                                  <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: entry.color }} />
                                  <span className="text-[11px] text-foreground flex-1">{entry.name}</span>
                                  <span className="text-[11px] font-bold text-foreground">{entry.value}</span>
                                  <span className="text-[9px] text-muted-foreground">({pct}%)</span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </motion.div>
              ) : null}
            </AnimatePresence>

            {/* Active filter indicators */}
            {(filterLevel !== 'all' || filterRange !== 'all' || filterRisk !== 'all') && (
              <motion.div
                initial={{ opacity: 0, y: -5 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-3 flex items-center gap-2 flex-wrap"
              >
                <span className="text-xs text-muted-foreground">{t('teacher.trackingShowing')}</span>
                {filterLevel !== 'all' && (
                  <Badge
                    variant="secondary"
                    className={`${getPerformanceLevelConfig(filterLevel).bgColor} ${getPerformanceLevelConfig(filterLevel).textColor} cursor-pointer`}
                    onClick={() => setFilterLevel('all')}
                  >
                    {t(getPerformanceLevelLabel(filterLevel))} ({classificationCounts[filterLevel]})
                    <XCircle className="h-3 w-3 ms-1" />
                  </Badge>
                )}
                {filterRange !== 'all' && (
                  <Badge
                    variant="secondary"
                    className={`${getPercentageRangeConfig(filterRange).bgColor} ${getPercentageRangeConfig(filterRange).textColor} cursor-pointer`}
                    onClick={() => setFilterRange('all')}
                  >
                    {t(getPercentageRangeConfig(filterRange).label)} ({percentageRangeDistribution[filterRange]})
                    <XCircle className="h-3 w-3 ms-1" />
                  </Badge>
                )}
                {filterRisk !== 'all' && (
                  <Badge
                    variant="secondary"
                    className={`${getRiskLevelConfig(filterRisk).bgColor} ${getRiskLevelConfig(filterRisk).textColor} cursor-pointer`}
                    onClick={() => setFilterRisk('all')}
                  >
                    {getRiskLabel(filterRisk)} ({riskLevelDistribution[filterRisk]})
                    <XCircle className="h-3 w-3 ms-1" />
                  </Badge>
                )}
                <button
                  onClick={() => { setFilterLevel('all'); setFilterRange('all'); setFilterRisk('all'); }}
                  className="text-xs text-sky-600 hover:text-sky-700 dark:hover:text-sky-300 font-medium"
                >
                  {t('teacher.trackingViewAll')}
                </button>
              </motion.div>
            )}
          </CardContent>
        </Card>
      </motion.div>

      {/* ── Top Students & Students Needing Attention ── */}
      <motion.div variants={itemVariants}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Top Students */}
          <Card className="border-amber-100/50 shadow-sm">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-3">
                <Trophy className="h-4 w-4 text-amber-500" />
                <p className="text-sm font-medium text-foreground">{t('teacher.topPerformersOverall')}</p>
              </div>
              {topStudents.length === 0 || topStudents[0].metrics.overallPerformance === 0 ? (
                <div className="py-6 text-center text-muted-foreground text-xs">
                  <Trophy className="h-6 w-6 mx-auto mb-2 opacity-30" />
                  {t('teacher.noTopStudentsYet')}
                </div>
              ) : (
                <div className="space-y-1.5">
                  {topStudents.map(({ student, metrics }, idx) => {
                    const levelCfg = getPerformanceLevelConfig(metrics.performanceLevel);
                    const riskCfg = getRiskLevelConfig(metrics.riskLevel);
                    const growthCfg = getGrowthTrendConfig(metrics.growthTrend);
                    const effCfg = getEfficiencyLevelConfig(metrics.efficiencyLevel);
                    const isExpanded = expandedStudentId === student.id;
                    return (
                      <div key={student.id}>
                        <button
                          type="button"
                          onClick={() => toggleExpand(student.id)}
                          className="w-full flex items-center gap-2.5 p-2 rounded-lg bg-gradient-to-l from-amber-50/80 to-transparent dark:from-amber-900/10 border border-amber-100/60 dark:border-amber-900/30 hover:shadow-sm transition-shadow text-start"
                        >
                          <div className={`flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold shrink-0 ${
                            idx === 0 ? 'bg-amber-400 text-white' : idx === 1 ? 'bg-gray-300 text-gray-700 dark:bg-gray-600 dark:text-gray-200' : idx === 2 ? 'bg-amber-700 text-amber-100' : 'bg-muted text-muted-foreground'
                          }`}>
                            {idx + 1}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-medium text-foreground truncate">{student.name}</p>
                            <div className="flex items-center gap-1.5">
                              <Progress value={metrics.overallPerformance} className="h-1 flex-1" />
                              <span className={`text-[10px] font-bold ${levelCfg.textColor}`}>{Math.round(metrics.overallPerformance)}%</span>
                            </div>
                          </div>
                          <ChevronDown className={`h-3 w-3 text-muted-foreground shrink-0 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} />
                        </button>
                        <AnimatePresence>
                          {isExpanded && (
                            <motion.div
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: 'auto', opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              transition={{ duration: 0.25, ease: 'easeInOut' }}
                              className="overflow-hidden"
                            >
                              <div className="px-3 py-2.5 mt-1 rounded-lg bg-amber-50/40 dark:bg-amber-900/5 border border-amber-100/40 dark:border-amber-900/20 space-y-2">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <UserAvatar name={student.name} avatarUrl={student.avatar_url} size="sm" />
                                  <div className="min-w-0">
                                    <p className="text-xs font-semibold text-foreground truncate">{student.name}</p>
                                    {student.email && <p className="text-[10px] text-muted-foreground truncate flex items-center gap-1"><Mail className="h-2.5 w-2.5 shrink-0" />{student.email}</p>}
                                  </div>
                                  <Badge variant="secondary" className={`text-[9px] px-1.5 py-0 border-0 font-bold ${levelCfg.bgColor} ${levelCfg.textColor}`}>{t(getPerformanceLevelLabel(getPerformanceLevel(metrics.overallPerformance)))}</Badge>
                                </div>
                                <div className="grid grid-cols-2 gap-1.5 text-[10px]">
                                  <div className="flex items-center justify-between px-2 py-1 rounded bg-white/60 dark:bg-card/60">
                                    <span className="text-muted-foreground">{locale === 'ar' ? 'الاختبارات' : 'Exams'}</span>
                                    <span className="font-bold text-sky-600">{Math.round(metrics.examPerformance)}%</span>
                                  </div>
                                  <div className="flex items-center justify-between px-2 py-1 rounded bg-white/60 dark:bg-card/60">
                                    <span className="text-muted-foreground">{locale === 'ar' ? 'الحضور' : 'Attend.'}</span>
                                    <span className="font-bold text-emerald-600">{Math.round(metrics.attendanceScore)}%</span>
                                  </div>
                                  <div className="flex items-center justify-between px-2 py-1 rounded bg-white/60 dark:bg-card/60">
                                    <span className="text-muted-foreground">{locale === 'ar' ? 'الالتزام' : 'Compl.'}</span>
                                    <span className="font-bold text-amber-600">{Math.round(metrics.assignmentCompliance)}%</span>
                                  </div>
                                  <div className="flex items-center justify-between px-2 py-1 rounded bg-white/60 dark:bg-card/60">
                                    <span className="text-muted-foreground">{locale === 'ar' ? 'الجودة' : 'Quality'}</span>
                                    <span className="font-bold text-teal-600">{Math.round(metrics.assignmentQuality)}%</span>
                                  </div>
                                </div>
                                <div className="flex items-center gap-2 flex-wrap text-[10px]">
                                  <span className="text-muted-foreground">{t('teacher.trackingEfficiency')}:</span>
                                  <Badge variant="secondary" className={`text-[9px] px-1.5 py-0 border-0 ${effCfg.bgColor} ${effCfg.textColor}`}>{Math.round(metrics.efficiency)}%</Badge>
                                  <span className="text-muted-foreground">{locale === 'ar' ? 'الانضباط' : 'Discipline'}:</span>
                                  <span className="font-bold text-foreground">{Math.round(metrics.disciplineScore)}%</span>
                                  <span className="text-muted-foreground">{locale === 'ar' ? 'النمو' : 'Growth'}:</span>
                                  <span className={`font-bold ${growthCfg.textColor}`}>{growthCfg.icon} {metrics.growthIndex.toFixed(1)}</span>
                                </div>
                                {metrics.riskLevel !== 'healthy' && (
                                  <div className="flex items-center gap-1.5 flex-wrap text-[10px]">
                                    <Badge variant="outline" className={`text-[9px] px-1.5 py-0 ${riskCfg.bgColor} ${riskCfg.textColor} ${riskCfg.borderColor}`}>
                                      {locale === 'ar' ? 'مخاطر' : 'Risk'}: {getRiskLabel(metrics.riskLevel)}
                                    </Badge>
                                    <span className="text-muted-foreground">{metrics.riskReasons.map(r => t(`teacher.trackingRiskReason${r.charAt(0).toUpperCase() + r.slice(1)}`)).join(' • ')}</span>
                                  </div>
                                )}
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Students Needing Attention */}
          <Card className="border-rose-100/50 shadow-sm">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-3">
                <AlertTriangle className="h-4 w-4 text-rose-500" />
                <p className="text-sm font-medium text-foreground">{t('teacher.lowestPerformersOverall')}</p>
              </div>
              {bottomStudents.length === 0 || bottomStudents[0].metrics.overallPerformance === 0 ? (
                <div className="py-6 text-center text-muted-foreground text-xs">
                  <AlertTriangle className="h-6 w-6 mx-auto mb-2 opacity-30" />
                  {t('teacher.noStudentsNeedingAttention')}
                </div>
              ) : (
                <div className="space-y-1.5">
                  {bottomStudents.map(({ student, metrics }, idx) => {
                    const riskCfg = getRiskLevelConfig(metrics.riskLevel);
                    const levelCfg = getPerformanceLevelConfig(metrics.performanceLevel);
                    const growthCfg = getGrowthTrendConfig(metrics.growthTrend);
                    const effCfg = getEfficiencyLevelConfig(metrics.efficiencyLevel);
                    const isExpanded = expandedStudentId === student.id;
                    const riskLabelMap: Record<RiskLevel, string> = {
                      healthy: locale === 'ar' ? 'سليم' : 'Healthy',
                      monitor: locale === 'ar' ? 'مراقبة' : 'Monitor',
                      concern: locale === 'ar' ? 'قلق' : 'Concern',
                      atRisk: locale === 'ar' ? 'في خطر' : 'At Risk',
                    };
                    return (
                      <div key={student.id}>
                        <button
                          type="button"
                          onClick={() => toggleExpand(student.id)}
                          className="w-full flex items-center gap-2.5 p-2 rounded-lg bg-gradient-to-l from-rose-50/80 to-transparent dark:from-rose-900/10 border border-rose-100/60 dark:border-rose-900/30 hover:shadow-sm transition-shadow text-start"
                        >
                          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-rose-100 dark:bg-rose-900/30 text-rose-600 dark:text-rose-400 text-[10px] font-bold shrink-0">
                            {idx + 1}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <p className="text-xs font-medium text-foreground truncate">{student.name}</p>
                              <Badge variant="secondary" className={`text-[8px] px-1 py-0 ${riskCfg.bgColor} ${riskCfg.textColor} ${riskCfg.borderColor}`}>{riskLabelMap[metrics.riskLevel]}</Badge>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <Progress value={metrics.overallPerformance} className="h-1 flex-1" />
                              <span className={`text-[10px] font-bold ${levelCfg.textColor}`}>{Math.round(metrics.overallPerformance)}%</span>
                            </div>
                          </div>
                          <ChevronDown className={`h-3 w-3 text-muted-foreground shrink-0 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} />
                        </button>
                        <AnimatePresence>
                          {isExpanded && (
                            <motion.div
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: 'auto', opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              transition={{ duration: 0.25, ease: 'easeInOut' }}
                              className="overflow-hidden"
                            >
                              <div className="px-3 py-2.5 mt-1 rounded-lg bg-rose-50/40 dark:bg-rose-900/5 border border-rose-100/40 dark:border-rose-900/20 space-y-2">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <UserAvatar name={student.name} avatarUrl={student.avatar_url} size="sm" />
                                  <div className="min-w-0">
                                    <p className="text-xs font-semibold text-foreground truncate">{student.name}</p>
                                    {student.email && <p className="text-[10px] text-muted-foreground truncate flex items-center gap-1"><Mail className="h-2.5 w-2.5 shrink-0" />{student.email}</p>}
                                  </div>
                                  <Badge variant="secondary" className={`text-[9px] px-1.5 py-0 border-0 font-bold ${levelCfg.bgColor} ${levelCfg.textColor}`}>{t(getPerformanceLevelLabel(getPerformanceLevel(metrics.overallPerformance)))}</Badge>
                                </div>
                                <div className="grid grid-cols-2 gap-1.5 text-[10px]">
                                  <div className="flex items-center justify-between px-2 py-1 rounded bg-white/60 dark:bg-card/60">
                                    <span className="text-muted-foreground">{locale === 'ar' ? 'الاختبارات' : 'Exams'}</span>
                                    <span className="font-bold text-sky-600">{Math.round(metrics.examPerformance)}%</span>
                                  </div>
                                  <div className="flex items-center justify-between px-2 py-1 rounded bg-white/60 dark:bg-card/60">
                                    <span className="text-muted-foreground">{locale === 'ar' ? 'الحضور' : 'Attend.'}</span>
                                    <span className="font-bold text-emerald-600">{Math.round(metrics.attendanceScore)}%</span>
                                  </div>
                                  <div className="flex items-center justify-between px-2 py-1 rounded bg-white/60 dark:bg-card/60">
                                    <span className="text-muted-foreground">{locale === 'ar' ? 'الالتزام' : 'Compl.'}</span>
                                    <span className="font-bold text-amber-600">{Math.round(metrics.assignmentCompliance)}%</span>
                                  </div>
                                  <div className="flex items-center justify-between px-2 py-1 rounded bg-white/60 dark:bg-card/60">
                                    <span className="text-muted-foreground">{locale === 'ar' ? 'الجودة' : 'Quality'}</span>
                                    <span className="font-bold text-teal-600">{Math.round(metrics.assignmentQuality)}%</span>
                                  </div>
                                </div>
                                <div className="flex items-center gap-2 flex-wrap text-[10px]">
                                  <span className="text-muted-foreground">{t('teacher.trackingEfficiency')}:</span>
                                  <Badge variant="secondary" className={`text-[9px] px-1.5 py-0 border-0 ${effCfg.bgColor} ${effCfg.textColor}`}>{Math.round(metrics.efficiency)}%</Badge>
                                  <span className="text-muted-foreground">{locale === 'ar' ? 'الانضباط' : 'Discipline'}:</span>
                                  <span className="font-bold text-foreground">{Math.round(metrics.disciplineScore)}%</span>
                                  <span className="text-muted-foreground">{locale === 'ar' ? 'النمو' : 'Growth'}:</span>
                                  <span className={`font-bold ${growthCfg.textColor}`}>{growthCfg.icon} {metrics.growthIndex.toFixed(1)}</span>
                                </div>
                                {metrics.riskLevel !== 'healthy' && (
                                  <div className="flex items-center gap-1.5 flex-wrap text-[10px]">
                                    <Badge variant="outline" className={`text-[9px] px-1.5 py-0 ${riskCfg.bgColor} ${riskCfg.textColor} ${riskCfg.borderColor}`}>
                                      {locale === 'ar' ? 'مخاطر' : 'Risk'}: {riskLabelMap[metrics.riskLevel]}
                                    </Badge>
                                    <span className="text-muted-foreground">{metrics.riskReasons.map(r => t(`teacher.trackingRiskReason${r.charAt(0).toUpperCase() + r.slice(1)}`)).join(' • ')}</span>
                                  </div>
                                )}
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </motion.div>

      {/* ── Per-Course Rankings (Leaderboard) ── */}
      {perCourseRankings.length > 0 && (
        <motion.div variants={itemVariants}>
          <div className="space-y-4">
            {perCourseRankings.map(({ subject, all }) => {
              return (
                <CourseRankingCard
                  key={subject.id}
                  subject={subject}
                  students={all}
                  toggleExpand={toggleExpand}
                  expandedStudentId={expandedStudentId}
                  getRiskLabel={getRiskLabel}
                />
              );
            })}
          </div>
        </motion.div>
      )}

      {/* ── Search, Sort & Student List ── */}
      <motion.div variants={itemVariants}>
        <Card className="border-sky-100/50 shadow-sm">
          <CardHeader className="pb-3">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <CardTitle className="text-lg flex items-center gap-2 flex-wrap">
                <Users className="h-5 w-5 text-sky-600" />
                <span>{t('teacher.trackingStudentListFull')}</span>
                <span className="text-sm font-normal text-muted-foreground">
                  • {filteredStudents.length} {t('teacher.trackingOfTotal')} {studentPerformanceData.length}
                </span>
                <span className="text-sm font-normal text-muted-foreground">
                  • {t('teacher.trackingSortedBy')}: {t(SORT_OPTIONS.find(o => o.key === sortBy)?.label || 'teacher.trackingSortPerformance')}
                </span>
                {(filterLevel !== 'all' || filterRange !== 'all' || filterRisk !== 'all') && (
                  <span className="text-sm font-normal text-muted-foreground">
                    • {t('teacher.trackingFilteredBy')}: {[
                      filterLevel !== 'all' && t(getPerformanceLevelLabel(filterLevel)),
                      filterRange !== 'all' && t(getPercentageRangeConfig(filterRange).label),
                      filterRisk !== 'all' && getRiskLabel(filterRisk),
                    ].filter(Boolean).join(' + ')}
                  </span>
                )}
              </CardTitle>

              <div className="flex items-center gap-2">
                {/* Search */}
                <div className="relative flex-1 sm:flex-initial">
                  <Search className="absolute end-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <input
                    type="text"
                    placeholder={t('teacher.trackingSearchStudent')}
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    className="w-full sm:w-48 h-9 pe-9 ps-3 rounded-lg border border-gray-200 dark:border-gray-800/60 bg-white dark:bg-card text-sm focus:outline-none focus:ring-2 focus:ring-sky-200 focus:border-sky-300 transition-all"
                    dir={direction}
                  />
                </div>

                {/* Sort dropdown */}
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-muted-foreground whitespace-nowrap">{t('teacher.trackingSortBy')}</span>
                  <Select value={sortBy} onValueChange={(val) => setSortBy(val as SortOption)} dir={direction}>
                    <SelectTrigger className="h-9 w-auto min-w-[120px] ps-3 pe-8 rounded-lg border border-gray-200 dark:border-gray-800/60 bg-white dark:bg-card text-sm focus:ring-2 focus:ring-sky-200 focus:border-sky-300">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="rounded-lg">
                      {SORT_OPTIONS.map(opt => (
                        <SelectItem key={opt.key} value={opt.key} className="text-sm">
                          {t(opt.label)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {filteredStudents.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <Users className="h-12 w-12 mx-auto mb-3 opacity-30" />
                <p className="text-sm font-medium">
                  {students.length === 0 ? t('teacher.trackingNoStudentsYet') : t('teacher.trackingNoMatchingResults')}
                </p>
                <p className="text-xs mt-1">
                  {students.length === 0 ? t('teacher.trackingLinkStudentsToTrack') : t('teacher.trackingTryDifferentFilters')}
                </p>
              </div>
            ) : (
              <div className="space-y-2 max-h-[600px] overflow-y-auto custom-scrollbar">
                {filteredStudents.map((data, idx) => (
                  <StudentCard
                    key={data.student.id}
                    data={data}
                    isExpanded={expandedStudentId === data.student.id}
                    onToggle={() => toggleExpand(data.student.id)}
                    totalSessions={teacherAttendanceSessions.length}
                    totalAssignments={teacherAssignments.length}
                    classAvgEfficiency={classAvgEfficiency}
                    getRiskLabel={getRiskLabel}
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </motion.div>

      {/* ── Status Legend ── */}
      <motion.div variants={itemVariants}>
        <Card className="border-sky-100/50 shadow-sm">
          <CardContent className="p-4">
            <h3 className="text-sm font-bold text-foreground mb-3 flex items-center gap-2">
              <Info className="h-4 w-4 text-sky-600" />
              {locale === 'ar' ? 'دليل الحالات' : 'Status Guide'}
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {/* Performance Levels */}
              <div>
                <p className="text-xs font-semibold text-muted-foreground mb-1.5">{locale === 'ar' ? 'مستويات الأداء' : 'Performance Levels'}</p>
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-emerald-500 shrink-0" />
                    <span className="text-xs text-foreground">{locale === 'ar' ? 'ممتاز (≥90%)' : 'Excellent (≥90%)'}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-sky-500 shrink-0" />
                    <span className="text-xs text-foreground">{locale === 'ar' ? 'جيد جداً (80-89%)' : 'Very Good (80-89%)'}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-amber-500 shrink-0" />
                    <span className="text-xs text-foreground">{locale === 'ar' ? 'جيد (70-79%)' : 'Good (70-79%)'}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-orange-500 shrink-0" />
                    <span className="text-xs text-foreground">{locale === 'ar' ? 'مقبول (60-69%)' : 'Acceptable (60-69%)'}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-rose-500 shrink-0" />
                    <span className="text-xs text-foreground">{locale === 'ar' ? 'ضعيف (<60%)' : 'Weak (<60%)'}</span>
                  </div>
                </div>
              </div>
              {/* Risk Levels */}
              <div>
                <p className="text-xs font-semibold text-muted-foreground mb-1.5">{locale === 'ar' ? 'مستويات الخطورة' : 'Risk Levels'}</p>
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-emerald-500 shrink-0" />
                    <span className="text-xs text-foreground">{locale === 'ar' ? 'سليم — لا مخاطر' : 'Healthy — No risks'}</span>
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
                    <span className="text-xs text-foreground">{locale === 'ar' ? 'في خطر — تدخل عاجل' : 'At Risk — Urgent intervention'}</span>
                  </div>
                </div>
              </div>
              {/* Growth & Efficiency */}
              <div>
                <p className="text-xs font-semibold text-muted-foreground mb-1.5">{locale === 'ar' ? 'الاتجاه والكفاءة' : 'Growth & Efficiency'}</p>
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <ArrowUpRight className="h-2 w-2 text-emerald-600 shrink-0" />
                    <span className="text-xs text-foreground">{locale === 'ar' ? 'تحسن — اتجاه تصاعدي' : 'Improving — Upward trend'}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <ArrowDownRight className="h-2 w-2 text-rose-600 shrink-0" />
                    <span className="text-xs text-foreground">{locale === 'ar' ? 'تراجع — اتجاه تنازلي' : 'Declining — Downward trend'}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-emerald-500 shrink-0" />
                    <span className="text-xs text-foreground">{locale === 'ar' ? 'كفاءة عالية' : 'High efficiency'}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-amber-500 shrink-0" />
                    <span className="text-xs text-foreground">{locale === 'ar' ? 'كفاءة متوسطة' : 'Medium efficiency'}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-rose-500 shrink-0" />
                    <span className="text-xs text-foreground">{locale === 'ar' ? 'كفاءة منخفضة' : 'Low efficiency'}</span>
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

// -------------------------------------------------------
// Circular Efficiency Gauge Component
// -------------------------------------------------------
function EfficiencyGauge({
  efficiency,
  efficiencyLevel,
  classAvg,
  effortScore,
}: {
  efficiency: number;
  efficiencyLevel: EfficiencyLevel;
  classAvg: number;
  effortScore: number;
}) {
  const { t } = useTranslations();
  const config = getEfficiencyLevelConfig(efficiencyLevel);
  const isInsufficient = effortScore < 40;

  // Color based on level
  const strokeColor = efficiencyLevel === 'high'
    ? '#10b981'
    : efficiencyLevel === 'medium'
      ? '#f59e0b'
      : efficiencyLevel === 'insufficient'
        ? '#9ca3af'
        : '#f43f5e';

  const displayEfficiency = isInsufficient ? 0 : Math.min(efficiency, 150);
  const circumference = 2 * Math.PI * 40;
  const progress = (displayEfficiency / 150) * circumference;
  const classAvgProgress = (classAvg / 150) * circumference;

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative w-24 h-24">
        <svg className="w-24 h-24 -rotate-90" viewBox="0 0 96 96">
          {/* Background circle */}
          <circle
            cx="48"
            cy="48"
            r="40"
            fill="none"
            stroke="var(--muted)"
            strokeWidth="6"
          />
          {/* Class average indicator */}
          {!isInsufficient && classAvg > 0 && (
            <circle
              cx="48"
              cy="48"
              r="40"
              fill="none"
              stroke="var(--border)"
              strokeWidth="2"
              strokeDasharray={`${classAvgProgress} ${circumference - classAvgProgress}`}
              strokeLinecap="round"
            />
          )}
          {/* Efficiency arc */}
          <motion.circle
            cx="48"
            cy="48"
            r="40"
            fill="none"
            stroke={strokeColor}
            strokeWidth="6"
            strokeDasharray={`${progress} ${circumference - progress}`}
            strokeLinecap="round"
            initial={{ strokeDasharray: `0 ${circumference}` }}
            animate={{ strokeDasharray: `${progress} ${circumference - progress}` }}
            transition={{ duration: 0.8, ease: 'easeOut' as const }}
          />
        </svg>
        {/* Center text */}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          {isInsufficient ? (
            <>
              <span className="text-xs font-bold text-gray-400 dark:text-gray-500">—</span>
              <span className="text-[8px] text-gray-400 dark:text-muted-foreground text-center leading-tight">{t('teacher.trackingEfficiencyInsufficient')}</span>
            </>
          ) : (
            <>
              <span className="text-lg font-bold" style={{ color: strokeColor }}>
                {Math.round(efficiency)}%
              </span>
              <span className="text-[9px] text-gray-400 dark:text-muted-foreground">{t('teacher.trackingEfficiency')}</span>
            </>
          )}
        </div>
      </div>
      <Badge
        variant="secondary"
        className={`${config.bgColor} ${config.textColor} text-[10px] px-2 py-0.5 border-0 font-bold`}
      >
        {efficiencyLevel === 'insufficient' ? t('teacher.trackingEfficiencyInsufficient') : t(`teacher.trackingEfficiency${efficiencyLevel.charAt(0).toUpperCase() + efficiencyLevel.slice(1)}` as Parameters<typeof t>[0])}
      </Badge>
      {isInsufficient && (
        <p className="text-[9px] text-gray-400 dark:text-muted-foreground text-center leading-tight max-w-[100px]">
          {t('teacher.trackingEfficiencyInsufficientNote')}
        </p>
      )}
      {!isInsufficient && classAvg > 0 && (
        <div className="flex items-center gap-1 text-[10px] text-gray-400 dark:text-muted-foreground">
          <Target className="h-3 w-3" />
          <span>{t('teacher.trackingClassAvg', { value: Math.round(classAvg) })}</span>
        </div>
      )}
    </div>
  );
}

// -------------------------------------------------------
// Subject Performance Mini Card (enhanced)
// -------------------------------------------------------
function SubjectPerformanceCard({ subject }: { subject: SubjectPerformanceData }) {
  const { t } = useTranslations();
  const levelConfig = getPerformanceLevelConfig(getPerformanceLevel(subject.overallPerformance));
  const riskConfig = getRiskLevelConfig(subject.riskLevel);
  const growthConfig = getGrowthTrendConfig(subject.growthTrend);

  const getCourseStatusConfig = (pct: number) => {
    if (pct >= 80) return { label: t('teacher.trackingAdvanced'), className: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400 border-emerald-100 dark:border-emerald-900/60' };
    if (pct >= 60) return { label: t('teacher.trackingOnTrack'), className: 'bg-sky-50 text-sky-700 dark:bg-sky-900/15 dark:text-sky-400 border-sky-100 dark:border-sky-900/60' };
    if (pct >= 40) return { label: t('teacher.trackingNeedsAttention'), className: 'bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400 border-amber-100 dark:border-amber-900/60' };
    return { label: t('teacher.trackingAtRiskCourse'), className: 'bg-rose-50 text-rose-700 dark:bg-rose-900/20 dark:text-rose-400 border-rose-100 dark:border-rose-900/60' };
  };

  const courseStatus = getCourseStatusConfig(subject.overallPerformance);

  return (
    <div className="p-3 rounded-xl bg-white/80 dark:bg-card/80 border border-gray-100/80 dark:border-gray-800/60/80 space-y-2">
      <div className="flex items-center gap-2 justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <BookOpen className="h-3.5 w-3.5 text-sky-600 shrink-0" />
          <span className="text-xs font-medium text-gray-900 dark:text-foreground truncate">{subject.subjectName}</span>
          <Badge variant="outline" className={`text-[8px] px-1 py-0 border ${courseStatus.className} shrink-0`}>
            {courseStatus.label}
          </Badge>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <span className={`text-[10px] ${growthConfig.textColor}`}>{growthConfig.icon}</span>
          {subject.riskLevel !== 'healthy' && (
            <span className={`h-2 w-2 rounded-full ${riskConfig.dotColor}`} />
          )}
        </div>
      </div>
      <div className="space-y-1.5">
        {/* Exam performance */}
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-gray-500 dark:text-muted-foreground min-w-[50px]">{t('teacher.trackingQuizzes')}</span>
          <div className="flex-1 h-2 bg-gray-100 dark:bg-gray-800/40 rounded-full overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${Math.min(subject.examPerformance, 100)}%` }}
              transition={{ duration: 0.5, ease: 'easeOut' as const }}
              className="h-full bg-sky-500 rounded-full"
            />
          </div>
          <span className="text-[10px] font-bold text-sky-700 dark:text-sky-400 min-w-[28px] text-start">
            {Math.round(subject.examPerformance)}%
          </span>
        </div>
        {/* Attendance */}
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-gray-500 dark:text-muted-foreground min-w-[50px]">{t('teacher.trackingAttendance')}</span>
          <div className="flex-1 h-2 bg-gray-100 dark:bg-gray-800/40 rounded-full overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${Math.min(subject.attendanceScore, 100)}%` }}
              transition={{ duration: 0.5, ease: 'easeOut' as const, delay: 0.1 }}
              className="h-full bg-teal-500 rounded-full"
            />
          </div>
          <span className="text-[10px] font-bold text-teal-700 dark:text-teal-500 min-w-[28px] text-start">
            {Math.round(subject.attendanceScore)}%
          </span>
        </div>
        {/* Assignments */}
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-gray-500 dark:text-muted-foreground min-w-[50px]">{t('teacher.trackingAssignments')}</span>
          <div className="flex-1 h-2 bg-gray-100 dark:bg-gray-800/40 rounded-full overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${subject.assignmentCount > 0 ? (subject.completedAssignments / subject.assignmentCount) * 100 : 0}%` }}
              transition={{ duration: 0.5, ease: 'easeOut' as const, delay: 0.2 }}
              className="h-full bg-amber-500 rounded-full"
            />
          </div>
          <span className="text-[10px] font-bold text-amber-700 dark:text-amber-500 min-w-[28px] text-start">
            {subject.completedAssignments}/{subject.assignmentCount}
          </span>
        </div>
      </div>
      {/* Overall score badge */}
      <div className="flex items-center justify-between pt-1">
        <Badge variant="secondary" className={`text-[9px] px-1.5 py-0 ${levelConfig.bgColor} ${levelConfig.textColor} border-0 font-bold`}>
          {Math.round(subject.overallPerformance)}%
        </Badge>
        {subject.riskLevel !== 'healthy' && (
          <span className={`text-[9px] ${riskConfig.textColor}`}>{subject.riskLevel === 'atRisk' ? '⚠' : subject.riskLevel === 'concern' ? '◉' : '○'}</span>
        )}
      </div>
    </div>
  );
}

// -------------------------------------------------------
// Course Ranking Card — defined below (redesigned leaderboard version)
// -------------------------------------------------------

// -------------------------------------------------------
// Student Card Component (expanded with new metrics)
// -------------------------------------------------------
function StudentCard({
  data,
  isExpanded,
  onToggle,
  totalSessions,
  totalAssignments,
  classAvgEfficiency,
  getRiskLabel,
}: {
  data: StudentPerformanceData;
  isExpanded: boolean;
  onToggle: () => void;
  totalSessions: number;
  totalAssignments: number;
  classAvgEfficiency: number;
  getRiskLabel: (level: RiskLevel) => string;
}) {
  const { t } = useTranslations();
  const locale = useLocaleStore((s) => s.locale);
  const metrics = data.metrics;
  const levelConfig = getPerformanceLevelConfig(data.level);
  const rangeConfig = getPercentageRangeConfig(data.percentageRange);
  const riskConfig = getRiskLevelConfig(metrics.riskLevel);
  const growthConfig = getGrowthTrendConfig(metrics.growthTrend);

  // Percentile badge
  const percentileBadgeMap: Record<string, { label: string; className: string }> = {
    top5: { label: t('teacher.trackingPercentileTop5'), className: 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-500 border-emerald-200 dark:border-emerald-900/60' },
    top10: { label: t('teacher.trackingPercentileTop10'), className: 'bg-sky-50 dark:bg-sky-900/15 text-sky-700 dark:text-sky-400 border-sky-200 dark:border-sky-900/60' },
    top25: { label: t('teacher.trackingPercentileTop25'), className: 'bg-teal-50 dark:bg-teal-900/20 text-teal-700 dark:text-teal-500 border-teal-200 dark:border-teal-900/60' },
    top50: { label: t('teacher.trackingPercentileTop50'), className: 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-500 border-amber-200 dark:border-amber-900/60' },
    below50: { label: t('teacher.trackingPercentileBelow50'), className: 'bg-rose-50 dark:bg-rose-900/20 text-rose-700 dark:text-rose-500 border-rose-200 dark:border-rose-900/60' },
  };
  const percentileBadge = percentileBadgeMap[data.percentileLabel] || percentileBadgeMap.below50;

  // Timeline filter state
  const [timelineFilter, setTimelineFilter] = useState<ActivityType | 'all'>('all');

  const filteredActivities = useMemo(() => {
    if (timelineFilter === 'all') return data.recentActivities;
    return data.recentActivities.filter(a => a.type === timelineFilter);
  }, [data.recentActivities, timelineFilter]);

  // Risk reason translation
  const riskReasonTranslationMap: Record<string, string> = {
    attendanceBelow50: t('teacher.trackingRiskReasonAttendance'),
    attendanceBelow70: t('teacher.trackingRiskReasonAttendance70'),
    performanceBelow60: t('teacher.trackingRiskReasonPerformance'),
    performanceBelow70: t('teacher.trackingRiskReasonPerformance70'),
    missedLast3Assignments: t('teacher.trackingRiskReasonMissed3'),
    decliningTrend: t('teacher.trackingRiskReasonDeclining'),
    inactivity: t('teacher.trackingRiskReasonInactivity'),
  };

  // ─── Download individual student report (.xlsx) ───
  const handleDownloadStudentReport = useCallback(async (studentData: StudentPerformanceData) => {
    const m = studentData.metrics;
    const XLSX = await import('xlsx');

    const riskLabelMap: Record<RiskLevel, string> = {
      healthy: t('teacher.trackingRiskHealthy'),
      monitor: t('teacher.trackingRiskMonitor'),
      concern: t('teacher.trackingRiskConcern'),
      atRisk: t('teacher.trackingRiskAtRisk'),
    };
    const levelLabelMap: Record<PerformanceLevel, string> = {
      excellent: t('teacher.trackingLevelExcellent'),
      veryGood: t('teacher.trackingLevelVeryGood'),
      good: t('teacher.trackingLevelGood'),
      acceptable: t('teacher.trackingLevelAcceptable'),
      weak: t('teacher.trackingLevelWeak'),
    };
    const efficiencyLabelMap: Record<EfficiencyLevel, string> = {
      high: t('teacher.trackingEfficiencyHigh'),
      medium: t('teacher.trackingEfficiencyMedium'),
      low: t('teacher.trackingEfficiencyLow'),
      insufficient: t('teacher.trackingEfficiencyInsufficient'),
    };
    const growthLabelMap: Record<GrowthTrend, string> = {
      improving: t('teacher.trackingGrowthImproving'),
      stable: t('teacher.trackingGrowthStable'),
      declining: t('teacher.trackingGrowthDeclining'),
    };

    // Sheet 1: Student Overview
    const overviewData = [
      [locale === 'ar' ? 'تقرير أداء الطالب' : 'Student Performance Report'],
      [],
      [locale === 'ar' ? 'الاسم' : 'Name', studentData.student.name],
      [locale === 'ar' ? 'البريد الإلكتروني' : 'Email', studentData.student.email],
      [],
      [locale === 'ar' ? 'الأداء العام' : 'Overall Performance', `${Math.round(m.overallPerformance)}%`],
      [locale === 'ar' ? 'التصنيف' : 'Classification', levelLabelMap[studentData.level]],
      [],
      [locale === 'ar' ? 'أداء الاختبارات' : 'Exam Performance', `${Math.round(m.examPerformance)}%`],
      [locale === 'ar' ? 'درجة الحضور' : 'Attendance Score', `${Math.round(m.attendanceScore)}%`],
      [locale === 'ar' ? 'التزام الواجبات' : 'Assignment Compliance', `${Math.round(m.assignmentCompliance)}%`],
      [locale === 'ar' ? 'جودة الواجبات' : 'Assignment Quality', `${Math.round(m.assignmentQuality)}%`],
      [],
      [locale === 'ar' ? 'الكفاءة' : 'Efficiency', `${Math.round(m.efficiency)}%`, efficiencyLabelMap[m.efficiencyLevel]],
      [locale === 'ar' ? 'درجة الانضباط' : 'Discipline Score', `${Math.round(m.disciplineScore)}%`],
      [locale === 'ar' ? 'مؤشر النمو' : 'Growth Index', m.growthIndex.toFixed(2), growthLabelMap[m.growthTrend]],
      [locale === 'ar' ? 'مستوى الخطورة' : 'Risk Level', riskLabelMap[m.riskLevel]],
      ...(m.riskReasons.length > 0 ? [[locale === 'ar' ? 'أسباب الخطورة' : 'Risk Reasons', m.riskReasons.map(r => riskReasonTranslationMap[r] || r).join('; ')]] : []),
    ];

    // Sheet 2: Subject Performance
    const subjectHeaders = [
      locale === 'ar' ? 'المقرر' : 'Subject',
      locale === 'ar' ? 'الأداء العام' : 'Overall',
      locale === 'ar' ? 'اختبارات' : 'Exam',
      locale === 'ar' ? 'حضور' : 'Attendance',
      locale === 'ar' ? 'التزام' : 'Compliance',
      locale === 'ar' ? 'جودة' : 'Quality',
    ];
    const subjectRows = studentData.subjectPerformances.map(sp => [
      sp.subjectName,
      `${Math.round(sp.overallPerformance)}%`,
      `${Math.round(sp.examPerformance)}%`,
      `${Math.round(sp.attendanceScore)}%`,
      `${Math.round(sp.assignmentCompliance)}%`,
      `${Math.round(sp.assignmentQuality)}%`,
    ]);

    const wb = XLSX.utils.book_new();
    const ws1 = XLSX.utils.aoa_to_sheet(overviewData);
    const ws2 = XLSX.utils.aoa_to_sheet([subjectHeaders, ...subjectRows]);

    // Set column widths
    ws1['!cols'] = [{ wch: 25 }, { wch: 20 }, { wch: 20 }];
    ws2['!cols'] = [{ wch: 25 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }];

    XLSX.utils.book_append_sheet(wb, ws1, locale === 'ar' ? 'نظرة عامة' : 'Overview');
    XLSX.utils.book_append_sheet(wb, ws2, locale === 'ar' ? 'أداء المواد' : 'Subjects');
    XLSX.writeFile(wb, `report_${studentData.student.name.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }, [t, locale, riskReasonTranslationMap]);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: 'easeOut' as const }}
      className={`rounded-xl border-2 transition-all duration-200 ${
        isExpanded
          ? `${levelConfig.bgColor} ${levelConfig.ringColor} ring-1`
          : 'border-gray-100 dark:border-gray-800/60 hover:border-gray-200 hover:bg-gray-50/50'
      }`}
    >
      {/* ── Main Row ── */}
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 p-3 sm:p-4 text-end"
      >
        {/* Avatar */}
        <UserAvatar
          name={data.student.name}
          avatarUrl={data.student.avatar_url}
          size="md"
        />

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <UserLink
              userId={data.student.id}
              name={data.student.name}
              avatarUrl={data.student.avatar_url}
              role={data.student.role}
              gender={data.student.gender}
              size="xs"
              showAvatar={false}
              showRole={false}
            />
            {data.student.email && (
              <span className="text-[11px] text-muted-foreground flex items-center gap-1 truncate max-w-[180px]">
                <Mail className="h-3 w-3 shrink-0" />
                <span className="truncate">{data.student.email}</span>
              </span>
            )}
            <Badge
              variant="secondary"
              className={`${levelConfig.bgColor} ${levelConfig.textColor} text-[10px] px-1.5 py-0 border-0 font-bold`}
            >
              {t(getPerformanceLevelLabel(data.level))}
            </Badge>
            <Badge
              variant="outline"
              className={`${percentileBadge.className} text-[9px] px-1.5 py-0 font-medium`}
            >
              {percentileBadge.label}
            </Badge>
            {metrics.riskLevel !== 'healthy' && (
              <Badge
                variant="outline"
                className={`${riskConfig.bgColor} ${riskConfig.textColor} ${riskConfig.borderColor} text-[9px] px-1.5 py-0 font-medium`}
              >
                {getRiskLabel(metrics.riskLevel)}
              </Badge>
            )}
          </div>

          {/* Progress bar */}
          <div className="flex items-center gap-2 mt-1.5">
            <Progress
              value={Math.round(metrics.overallPerformance)}
              className="h-2 flex-1"
            />
            <span className={`text-xs font-bold min-w-[40px] text-start ${levelConfig.textColor}`}>
              {Math.round(metrics.overallPerformance)}%
            </span>
          </div>
        </div>

        {/* Efficiency mini indicator */}
        <div className="hidden sm:flex flex-col items-center gap-0.5 shrink-0">
          <div className={`text-sm font-bold ${
            metrics.efficiencyLevel === 'high' ? 'text-emerald-600 dark:text-emerald-500' :
            metrics.efficiencyLevel === 'medium' ? 'text-amber-600 dark:text-amber-500' :
            metrics.efficiencyLevel === 'insufficient' ? 'text-gray-400 dark:text-gray-500' :
            'text-rose-600 dark:text-rose-500'
          }`}>
            {metrics.effortScore < 40 ? '—' : `${Math.round(metrics.efficiency)}%`}
          </div>
          <span className="text-[9px] text-gray-400 dark:text-muted-foreground">{t('teacher.trackingEfficiency')}</span>
        </div>

        {/* Growth mini indicator */}
        <div className="hidden md:flex flex-col items-center gap-0.5 shrink-0">
          <span className={`text-sm font-bold ${growthConfig.textColor}`}>
            {growthConfig.icon} {metrics.growthIndex.toFixed(1)}
          </span>
          <span className="text-[9px] text-gray-400 dark:text-muted-foreground">{t('teacher.trackingGrowthIndex')}</span>
        </div>

        {/* Expand icon */}
        <div className={`shrink-0 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}>
          <ChevronDown className="h-5 w-5 text-muted-foreground" />
        </div>
      </button>

      {/* ── Expanded Details ── */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 pt-1 space-y-4">
              {/* Download Report Button */}
              <div className="flex justify-end">
                <motion.button
                  whileHover={{ scale: 1.03 }}
                  whileTap={{ scale: 0.97 }}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDownloadStudentReport(data);
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-50 dark:bg-sky-900/20 text-sky-700 dark:text-sky-400 text-xs font-medium border border-sky-200 dark:border-sky-800/60 hover:bg-sky-100 dark:hover:bg-sky-900/30 transition-colors"
                >
                  <Download className="h-3 w-3" />
                  {t('teacher.trackingDownloadReport')}
                </motion.button>
              </div>
              {/* 4 Metric Cards: Exam, Attendance, Compliance, Quality */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
                {/* Exam Performance */}
                <div className="flex flex-col items-center gap-1.5 p-3 rounded-xl bg-white/80 dark:bg-card/80 border border-gray-100/80 dark:border-gray-800/60/80">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-100 dark:bg-sky-800/40">
                    <BarChart3 className="h-4 w-4 text-sky-700 dark:text-sky-400" />
                  </div>
                  <span className="text-lg font-bold text-sky-800 dark:text-sky-400">{Math.round(metrics.examPerformance)}%</span>
                  <span className="text-[10px] text-muted-foreground text-center leading-tight">{t('teacher.trackingExamPerformance')}</span>
                  <span className="text-[9px] text-muted-foreground">
                    {metrics.totalEarnedMarks}/{metrics.totalPossibleMarks}
                  </span>
                </div>

                {/* Attendance Score */}
                <div className="flex flex-col items-center gap-1.5 p-3 rounded-xl bg-white/80 dark:bg-card/80 border border-gray-100/80 dark:border-gray-800/60/80">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-100 dark:bg-teal-800/40">
                    <CheckCircle2 className="h-4 w-4 text-teal-700" />
                  </div>
                  <span className="text-lg font-bold text-teal-700 dark:text-teal-500">{Math.round(metrics.attendanceScore)}%</span>
                  <span className="text-[10px] text-muted-foreground text-center leading-tight">{t('teacher.trackingAttendanceScore')}</span>
                  <span className="text-[9px] text-muted-foreground">
                    {metrics.attendedSessions}/{metrics.totalSessions} {t('teacher.trackingSession')}
                  </span>
                </div>

                {/* Assignment Compliance */}
                <div className="flex flex-col items-center gap-1.5 p-3 rounded-xl bg-white/80 dark:bg-card/80 border border-gray-100/80 dark:border-gray-800/60/80">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-100 dark:bg-amber-800/40">
                    <ClipboardList className="h-4 w-4 text-amber-700" />
                  </div>
                  <span className="text-lg font-bold text-amber-700 dark:text-amber-500">{Math.round(metrics.assignmentCompliance)}%</span>
                  <span className="text-[10px] text-muted-foreground text-center leading-tight">{t('teacher.trackingAssignCompliance')}</span>
                  <span className="text-[9px] text-muted-foreground">
                    {metrics.completedAssignments}/{metrics.totalAssignments} {t('teacher.trackingTask')}
                  </span>
                </div>

                {/* Assignment Quality */}
                <div className="flex flex-col items-center gap-1.5 p-3 rounded-xl bg-white/80 dark:bg-card/80 border border-gray-100/80 dark:border-gray-800/60/80">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-orange-100 dark:bg-orange-800/40">
                    <FileText className="h-4 w-4 text-orange-700" />
                  </div>
                  <span className="text-lg font-bold text-orange-700 dark:text-orange-500">{Math.round(metrics.assignmentQuality)}%</span>
                  <span className="text-[10px] text-muted-foreground text-center leading-tight">{t('teacher.trackingAssignQuality')}</span>
                  <span className="text-[9px] text-muted-foreground">
                    {metrics.totalEarnedPoints}/{metrics.totalPossiblePoints}
                  </span>
                </div>
              </div>

              {/* ── Efficiency Section ── */}
              <div className="p-3 rounded-xl bg-gradient-to-l from-violet-50/80 to-white border border-violet-100/50">
                <div className="flex items-center gap-2 mb-3">
                  <Zap className="h-4 w-4 text-violet-600" />
                  <span className="text-sm font-medium text-gray-900 dark:text-foreground">{t('teacher.trackingStudentEfficiency')}</span>
                  <span className="text-[10px] text-gray-400 dark:text-muted-foreground">{t('teacher.trackingFormula')}</span>
                </div>
                <div className="flex items-center gap-4">
                  {/* Circular gauge */}
                  <EfficiencyGauge
                    efficiency={metrics.efficiency}
                    efficiencyLevel={metrics.efficiencyLevel}
                    classAvg={classAvgEfficiency}
                    effortScore={metrics.effortScore}
                  />
                  {/* Efficiency breakdown */}
                  <div className="flex-1 space-y-2">
                    <div className="flex items-center justify-between p-2 rounded-lg bg-white/60 dark:bg-card/60 border border-gray-100/50 dark:border-gray-800/60/50">
                      <span className="text-[11px] text-gray-600 dark:text-muted-foreground">{t('teacher.trackingEffort')}</span>
                      <div className="flex items-center gap-2">
                        <Progress value={Math.round(metrics.effortScore)} className="h-1.5 w-16" />
                        <span className="text-xs font-bold text-gray-700 dark:text-foreground">{Math.round(metrics.effortScore)}%</span>
                      </div>
                    </div>
                    <div className="text-[9px] text-gray-400 dark:text-muted-foreground pe-2">
                      {t('teacher.trackingEffortFormula', { attendance: Math.round(metrics.attendanceScore), assignments: Math.round(metrics.assignmentCompliance) })}
                    </div>
                    <div className="flex items-center justify-between p-2 rounded-lg bg-white/60 dark:bg-card/60 border border-gray-100/50 dark:border-gray-800/60/50">
                      <span className="text-[11px] text-gray-600 dark:text-muted-foreground">{t('teacher.trackingResults')}</span>
                      <div className="flex items-center gap-2">
                        <Progress value={Math.round(metrics.resultScore)} className="h-1.5 w-16" />
                        <span className="text-xs font-bold text-gray-700 dark:text-foreground">{Math.round(metrics.resultScore)}%</span>
                      </div>
                    </div>
                    <div className="text-[9px] text-gray-400 dark:text-muted-foreground pe-2">
                      {t('teacher.trackingResultsFormula', { quizAvg: Math.round(metrics.examPerformance) })}
                    </div>
                    {/* Comparison to class average */}
                    {metrics.effortScore >= 40 && classAvgEfficiency > 0 && (
                      <div className={`flex items-center gap-1.5 text-[11px] font-medium ${
                        metrics.efficiency >= classAvgEfficiency ? 'text-emerald-600' : 'text-rose-600'
                      }`}>
                        {metrics.efficiency >= classAvgEfficiency ? (
                          <TrendingUp className="h-3 w-3" />
                        ) : (
                          <TrendingUp className="h-3 w-3 rotate-180" />
                        )}
                        <span>
                          {metrics.efficiency >= classAvgEfficiency ? t('teacher.trackingAboveClassAvg', { diff: Math.abs(Math.round(metrics.efficiency - classAvgEfficiency)) }) : t('teacher.trackingBelowClassAvg', { diff: Math.abs(Math.round(metrics.efficiency - classAvgEfficiency)) })}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* ── Discipline Score Card ── */}
              <div className="p-3 rounded-xl bg-gradient-to-l from-violet-50/60 to-teal-50/60 border border-violet-100/50">
                <div className="flex items-center gap-2 mb-2">
                  <ShieldCheck className="h-4 w-4 text-violet-600" />
                  <span className="text-sm font-medium text-gray-900 dark:text-foreground">{t('teacher.trackingDisciplineScore')}</span>
                  <span className="text-[10px] text-gray-400 dark:text-muted-foreground">{t('teacher.trackingDisciplineTooltip')}</span>
                </div>
                <div className="flex items-center gap-3 mb-2">
                  <div className="flex-1">
                    <Progress value={Math.round(metrics.disciplineScore)} className="h-2.5" />
                  </div>
                  <span className="text-lg font-bold text-violet-700 dark:text-violet-500 min-w-[45px] text-start">{Math.round(metrics.disciplineScore)}%</span>
                </div>
                <div className="grid grid-cols-3 gap-2 text-center">
                  {/* Attendance consistency */}
                  <div className="p-2 rounded-lg bg-white/60 dark:bg-card/60 border border-gray-100/50 dark:border-gray-800/60/50">
                    <p className="text-[10px] text-muted-foreground">{t('teacher.trackingAttendance')}</p>
                    <p className="text-sm font-bold text-teal-700 dark:text-teal-500">{metrics.onTimeCount + metrics.lateCount}/{metrics.totalSessions}</p>
                    <p className="text-[9px] text-muted-foreground">
                      {metrics.totalSessions > 0 ? Math.round(((metrics.onTimeCount + metrics.lateCount) / metrics.totalSessions) * 100) : 0}%
                    </p>
                  </div>
                  {/* On-time rate */}
                  <div className="p-2 rounded-lg bg-white/60 dark:bg-card/60 border border-gray-100/50 dark:border-gray-800/60/50">
                    <p className="text-[10px] text-muted-foreground">{t('teacher.trackingAttendance')}</p>
                    <p className="text-sm font-bold text-emerald-700 dark:text-emerald-500">{metrics.onTimeCount}/{metrics.onTimeCount + metrics.lateCount}</p>
                    <p className="text-[9px] text-muted-foreground">
                      {(metrics.onTimeCount + metrics.lateCount) > 0 ? Math.round((metrics.onTimeCount / (metrics.onTimeCount + metrics.lateCount)) * 100) : 100}%
                    </p>
                  </div>
                  {/* Deadline respect */}
                  <div className="p-2 rounded-lg bg-white/60 dark:bg-card/60 border border-gray-100/50 dark:border-gray-800/60/50">
                    <p className="text-[10px] text-muted-foreground">{t('teacher.trackingAssignments')}</p>
                    <p className="text-sm font-bold text-amber-700 dark:text-amber-500">
                      {metrics.totalAssignments > 0 ? metrics.totalAssignments - metrics.missedDeadlines : 0}/{metrics.totalAssignments}
                    </p>
                    <p className="text-[9px] text-muted-foreground">
                      {metrics.totalAssignments > 0 ? Math.round(((metrics.totalAssignments - metrics.missedDeadlines) / metrics.totalAssignments) * 100) : 100}%
                    </p>
                  </div>
                </div>
              </div>

              {/* ── Growth Index Card ── */}
              <div className="p-3 rounded-xl bg-gradient-to-l from-emerald-50/60 to-white border border-emerald-100/50">
                <div className="flex items-center gap-2 mb-2">
                  <Flame className="h-4 w-4 text-emerald-600" />
                  <span className="text-sm font-medium text-gray-900 dark:text-foreground">{t('teacher.trackingGrowthIndex')}</span>
                  <span className="text-[10px] text-gray-400 dark:text-muted-foreground">{t('teacher.trackingGrowthTooltip')}</span>
                </div>
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <span className={`text-2xl font-bold ${growthConfig.textColor}`}>
                      {growthConfig.icon} {metrics.growthIndex.toFixed(2)}
                    </span>
                    <Badge
                      variant="secondary"
                      className={`${growthConfig.textColor} bg-opacity-20 text-[10px] px-2 py-0.5 border-0 font-bold`}
                      style={{ backgroundColor: metrics.growthTrend === 'improving' ? 'rgba(16,185,129,0.1)' : metrics.growthTrend === 'declining' ? 'rgba(244,63,94,0.1)' : 'rgba(14,165,233,0.1)' }}
                    >
                      {metrics.growthTrend === 'improving' ? t('teacher.trackingGrowthImproving') : metrics.growthTrend === 'declining' ? t('teacher.trackingGrowthDeclining') : t('teacher.trackingGrowthStable')}
                    </Badge>
                  </div>
                </div>
                {data.studentScores.length >= 2 && (
                  <div className="mt-2 flex items-center gap-4 text-[10px] text-muted-foreground">
                    <span>{t('teacher.trackingRecentVsEarliest') || 'Recent vs Earliest'}:</span>
                    <span className="font-medium text-gray-700 dark:text-foreground">
                      {Math.round(metrics.growthIndex >= 1 ? (metrics.growthIndex - 1) * 100 : (1 - metrics.growthIndex) * 100)}% {metrics.growthTrend === 'improving' ? '↑' : metrics.growthTrend === 'declining' ? '↓' : '→'}
                    </span>
                  </div>
                )}
              </div>

              {/* ── Risk Level Badge (with reasons) ── */}
              {metrics.riskLevel !== 'healthy' && (
                <div className={`p-3 rounded-xl border ${riskConfig.borderColor} ${riskConfig.bgColor}`}>
                  <div className="flex items-center gap-2 mb-2">
                    <AlertTriangle className={`h-4 w-4 ${riskConfig.textColor}`} />
                    <span className={`text-sm font-medium ${riskConfig.textColor}`}>{t('teacher.trackingRiskLevel')}: {getRiskLabel(metrics.riskLevel)}</span>
                    <span className="text-[10px] text-gray-400 dark:text-muted-foreground">{t('teacher.trackingRiskTooltip')}</span>
                  </div>
                  {metrics.riskReasons.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-1">
                      {metrics.riskReasons.map((reason, idx) => (
                        <Badge
                          key={idx}
                          variant="outline"
                          className={`text-[9px] px-1.5 py-0 ${riskConfig.borderColor} ${riskConfig.textColor}`}
                        >
                          {riskReasonTranslationMap[reason] || reason}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* ── Per-Subject Performance ── */}
              {data.subjectPerformances.length > 0 && (
                <div className="p-3 rounded-xl bg-gradient-to-l from-sky-50/80 to-white border border-sky-100/50">
                  <div className="flex items-center gap-2 mb-3">
                    <BookOpen className="h-4 w-4 text-sky-600" />
                    <span className="text-sm font-medium text-gray-900 dark:text-foreground">{t('teacher.trackingPerformanceBySubject')}</span>
                    <Badge variant="secondary" className="text-[9px] px-1.5 py-0 bg-sky-50 dark:bg-sky-900/15 text-sky-700 dark:text-sky-400 border-sky-100 dark:border-sky-900/60">
                      {t('teacher.trackingSubjectCount', { count: data.subjectPerformances.length })}
                    </Badge>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-48 overflow-y-auto custom-scrollbar">
                    {data.subjectPerformances.map(subject => (
                      <SubjectPerformanceCard key={subject.subjectId} subject={subject} />
                    ))}
                  </div>
                </div>
              )}

              {/* ── Weighted performance breakdown (35/20/15/30) ── */}
              <div className="p-3 rounded-xl bg-gradient-to-l from-sky-50/80 to-teal-50/80 border border-sky-100/50">
                <div className="flex items-center gap-2 mb-2">
                  <TrendingUp className="h-4 w-4 text-sky-600" />
                  <span className="text-sm font-medium text-gray-900 dark:text-foreground">{t('teacher.trackingOverallPerformanceCalc')}</span>
                </div>
                <div className="grid grid-cols-4 gap-2 text-center">
                  <div>
                    <p className="text-[10px] text-muted-foreground">{t('teacher.trackingExamWeight')} (35%)</p>
                    <p className="text-sm font-bold text-sky-700 dark:text-sky-400">{Math.round(metrics.examPerformance * DEFAULT_WEIGHTS.examPerformance / 100)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground">{t('teacher.trackingAttendanceWeight')} (20%)</p>
                    <p className="text-sm font-bold text-teal-700 dark:text-teal-500">{Math.round(metrics.attendanceScore * DEFAULT_WEIGHTS.attendanceScore / 100)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground">{t('teacher.trackingComplianceWeight')} (15%)</p>
                    <p className="text-sm font-bold text-amber-700 dark:text-amber-500">{Math.round(metrics.assignmentCompliance * DEFAULT_WEIGHTS.assignmentCompliance / 100)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground">{t('teacher.trackingQualityWeight')} (30%)</p>
                    <p className="text-sm font-bold text-orange-700 dark:text-orange-500">{Math.round(metrics.assignmentQuality * DEFAULT_WEIGHTS.assignmentQuality / 100)}</p>
                  </div>
                </div>
                <div className="mt-2 pt-2 border-t border-gray-200/50 dark:border-gray-800/50 text-center">
                  <span className="text-[10px] text-muted-foreground">{t('teacher.trackingWeightedExamNote')}</span>
                </div>
              </div>

              {/* ── Enhanced Activity Timeline with Filters ── */}
              {data.recentActivities.length > 0 && (
                <div className="p-3 rounded-xl bg-gradient-to-l from-teal-50/60 to-white border border-teal-100/50">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <Route className="h-4 w-4 text-teal-600" />
                      <span className="text-sm font-medium text-gray-900 dark:text-foreground">{t('teacher.trackingStudentPath')}</span>
                      <Badge variant="secondary" className="text-[9px] px-1.5 py-0 bg-teal-50 dark:bg-teal-900/20 text-teal-700 dark:text-teal-500 border-teal-100 dark:border-teal-900/60">
                        {t('teacher.trackingActivityCount', { count: data.recentActivities.length })}
                      </Badge>
                    </div>
                  </div>

                  {/* Timeline filter buttons */}
                  <div className="flex items-center gap-1.5 mb-3 flex-wrap">
                    {([
                      { key: 'all' as const, label: t('teacher.trackingTimelineFilterAll') },
                      { key: 'quiz' as const, label: t('teacher.trackingTimelineFilterQuizzes') },
                      { key: 'attendance' as const, label: t('teacher.trackingTimelineFilterAttendance') },
                      { key: 'assignment' as const, label: t('teacher.trackingTimelineFilterAssignments') },
                      { key: 'grading' as const, label: t('teacher.trackingTimelineFilterGrading') },
                      { key: 'risk' as const, label: t('teacher.trackingTimelineFilterRisk') },
                    ] as const).map(filter => (
                      <button
                        key={filter.key}
                        onClick={() => setTimelineFilter(filter.key)}
                        className={`px-2 py-0.5 rounded-md text-[10px] font-medium transition-all ${
                          timelineFilter === filter.key
                            ? 'bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-400 ring-1 ring-teal-200 dark:ring-teal-900/60'
                            : 'bg-gray-50 dark:bg-gray-800/40 text-gray-500 dark:text-muted-foreground hover:bg-gray-100 dark:hover:bg-gray-800/60'
                        }`}
                      >
                        {filter.label}
                      </button>
                    ))}
                  </div>

                  {filteredActivities.length === 0 ? (
                    <div className="text-center py-4 text-muted-foreground">
                      <p className="text-xs">{t('teacher.trackingNoMatchingResults')}</p>
                    </div>
                  ) : (
                    <div className="relative space-y-0 max-h-52 overflow-y-auto custom-scrollbar">
                      {/* Timeline line */}
                      <div className="absolute end-[15px] top-2 bottom-2 w-0.5 bg-gradient-to-b from-teal-200 via-sky-200 to-amber-200" />

                      {filteredActivities.map((item, idx) => {
                        const iconMap: Record<ActivityType, React.ReactNode> = {
                          attendance: <CheckCircle2 className="h-3.5 w-3.5 text-teal-600" />,
                          quiz: <FileText className="h-3.5 w-3.5 text-sky-600" />,
                          assignment: <ClipboardList className="h-3.5 w-3.5 text-amber-600" />,
                          grading: <BarChart3 className="h-3.5 w-3.5 text-violet-600" />,
                          risk: <AlertTriangle className="h-3.5 w-3.5 text-rose-600" />,
                          achievement: <Award className="h-3.5 w-3.5 text-emerald-600" />,
                          feedback: <FileText className="h-3.5 w-3.5 text-sky-600" />,
                        };
                        const bgMap: Record<ActivityType, string> = {
                          attendance: 'bg-teal-50 dark:bg-teal-900/20 ring-teal-100',
                          quiz: 'bg-sky-50 dark:bg-sky-900/15 ring-sky-100',
                          assignment: 'bg-amber-50 dark:bg-amber-900/20 ring-amber-100',
                          grading: 'bg-violet-50 dark:bg-violet-900/20 ring-violet-100',
                          risk: 'bg-rose-50 dark:bg-rose-900/20 ring-rose-100',
                          achievement: 'bg-emerald-50 dark:bg-emerald-900/20 ring-emerald-100',
                          feedback: 'bg-sky-50 dark:bg-sky-900/15 ring-sky-100',
                        };
                        const dotColorMap: Record<ActivityType, string> = {
                          attendance: 'bg-teal-400',
                          quiz: 'bg-sky-400',
                          assignment: 'bg-amber-400',
                          grading: 'bg-violet-400',
                          risk: 'bg-rose-400',
                          achievement: 'bg-emerald-400',
                          feedback: 'bg-sky-400',
                        };
                        const badgeMap: Record<ActivityType, { label: string; className: string }> = {
                          attendance: { label: t('teacher.trackingAttendanceBadge'), className: 'bg-teal-50 dark:bg-teal-900/20 text-teal-700 dark:text-teal-500 border-teal-100 dark:border-teal-900/60' },
                          quiz: { label: t('teacher.trackingQuizBadge'), className: 'bg-sky-50 dark:bg-sky-900/15 text-sky-700 dark:text-sky-400 border-sky-100 dark:border-sky-900/60' },
                          assignment: { label: t('teacher.trackingAssignmentBadge'), className: 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-500 border-amber-100 dark:border-amber-900/60' },
                          grading: { label: t('teacher.trackingTimelineFilterGrading'), className: 'bg-violet-50 dark:bg-violet-900/20 text-violet-700 dark:text-violet-500 border-violet-100 dark:border-violet-900/60' },
                          risk: { label: t('teacher.trackingTimelineFilterRisk'), className: 'bg-rose-50 dark:bg-rose-900/20 text-rose-700 dark:text-rose-500 border-rose-100 dark:border-rose-900/60' },
                          achievement: { label: t('teacher.trackingTimelineAchievement'), className: 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-500 border-emerald-100 dark:border-emerald-900/60' },
                          feedback: { label: t('teacher.trackingQuizBadge'), className: 'bg-sky-50 dark:bg-sky-900/15 text-sky-700 dark:text-sky-400 border-sky-100 dark:border-sky-900/60' },
                        };

                        return (
                          <motion.div
                            key={idx}
                            initial={{ opacity: 0, x: 10 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ duration: 0.2, delay: idx * 0.05 }}
                            className="relative flex items-start gap-2.5 py-1.5 px-1"
                          >
                            <div className={`relative z-10 flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full ring-2 ${bgMap[item.type]}`}>
                              {iconMap[item.type]}
                              {/* Pulsing dot */}
                              <span className={`absolute -top-0.5 -start-0.5 h-2 w-2 rounded-full ${dotColorMap[item.type]} ring-2 ring-white`} />
                            </div>
                            <div className="flex-1 min-w-0 pt-0.5">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <p className="text-xs font-medium text-gray-900 dark:text-foreground">{item.title}</p>
                                <Badge variant="secondary" className={`text-[9px] px-1 py-0 ${badgeMap[item.type].className}`}>
                                  {badgeMap[item.type].label}
                                </Badge>
                              </div>
                              <p className="text-[11px] text-muted-foreground truncate">{item.detail}</p>
                              <p className="text-[9px] text-gray-300 mt-0.5">
                                {item.date && item.date !== new Date().toISOString()
                                  ? formatDate(item.date)
                                  : t('teacher.trackingDateUnavailable')}
                              </p>
                            </div>
                          </motion.div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// -------------------------------------------------------
// Course Ranking Card Component (Leaderboard-style)
// -------------------------------------------------------
type CourseSortOption = 'performance' | 'attendance' | 'efficiency';

const COURSE_SORT_OPTIONS: { key: CourseSortOption; labelAr: string; labelEn: string }[] = [
  { key: 'performance', labelAr: 'الأداء', labelEn: 'Performance' },
  { key: 'attendance', labelAr: 'الحضور', labelEn: 'Attendance' },
  { key: 'efficiency', labelAr: 'الكفاءة', labelEn: 'Efficiency' },
];

function CourseRankingCard({
  subject,
  students,
  toggleExpand,
  expandedStudentId,
  getRiskLabel,
}: {
  subject: Subject;
  students: { student: UserProfile; metrics: StudentPerformanceMetrics }[];
  toggleExpand: (id: string) => void;
  expandedStudentId: string | null;
  getRiskLabel: (level: RiskLevel) => string;
}) {
  const { t, direction } = useTranslations();
  const locale = useLocaleStore((s) => s.locale);
  const [courseSortBy, setCourseSortBy] = useState<CourseSortOption>('performance');
  const [showAll, setShowAll] = useState(false);

  const INITIAL_SHOW_COUNT = 5;

  // Sort students based on selected sort option
  const sortedStudents = useMemo(() => {
    const sorted = [...students];
    sorted.sort((a, b) => {
      switch (courseSortBy) {
        case 'performance':
          return b.metrics.overallPerformance - a.metrics.overallPerformance;
        case 'attendance':
          return b.metrics.attendanceScore - a.metrics.attendanceScore;
        case 'efficiency':
          return b.metrics.efficiency - a.metrics.efficiency;
        default:
          return 0;
      }
    });
    return sorted;
  }, [students, courseSortBy]);

  const displayedStudents = showAll ? sortedStudents : sortedStudents.slice(0, INITIAL_SHOW_COUNT);

  // Compute course average
  const courseAvg = students.length > 0
    ? Math.round(students.reduce((sum, s) => sum + s.metrics.overallPerformance, 0) / students.length)
    : 0;

  // Medal emojis for top 3
  const medals = ['🥇', '🥈', '🥉'];

  // Background gradients for top 3
  const rankBgClass = (idx: number): string => {
    if (courseSortBy !== 'performance') return '';
    if (idx === 0) return 'bg-gradient-to-l from-amber-50/80 via-yellow-50/40 to-transparent dark:from-amber-900/10 dark:via-yellow-900/5 border-amber-200/50 dark:border-amber-900/30';
    if (idx === 1) return 'bg-gradient-to-l from-gray-50/80 via-slate-50/40 to-transparent dark:from-gray-800/10 dark:via-slate-800/5 border-gray-200/50 dark:border-gray-700/30';
    if (idx === 2) return 'bg-gradient-to-l from-orange-50/80 via-amber-50/40 to-transparent dark:from-orange-900/10 dark:via-amber-900/5 border-orange-200/50 dark:border-orange-900/30';
    return '';
  };

  return (
    <Card className="border-violet-100/50 shadow-sm overflow-hidden">
      {/* Course Header */}
      <div className="px-4 py-3 bg-gradient-to-l from-violet-50/60 to-transparent dark:from-violet-900/10 border-b border-violet-100/50 dark:border-violet-900/20">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-100 dark:bg-violet-900/30">
              <BookOpen className="h-4 w-4 text-violet-600 dark:text-violet-400" />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">{subject.name}</p>
              <p className="text-[10px] text-muted-foreground">
                {students.length} {locale === 'ar' ? 'طالب' : 'student(s)'} • {locale === 'ar' ? 'المتوسط' : 'Avg'}: {courseAvg}%
              </p>
            </div>
          </div>
          {/* Sort dropdown */}
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-muted-foreground whitespace-nowrap">{t('teacher.trackingRankingBy')}:</span>
            <Select value={courseSortBy} onValueChange={(val) => setCourseSortBy(val as CourseSortOption)} dir={direction}>
              <SelectTrigger className="h-7 w-auto min-w-[90px] ps-2 pe-6 rounded-md border border-violet-200 dark:border-violet-900/40 bg-white dark:bg-card text-[11px] focus:ring-1 focus:ring-violet-200">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="rounded-lg">
                {COURSE_SORT_OPTIONS.map(opt => (
                  <SelectItem key={opt.key} value={opt.key} className="text-[11px]">
                    {locale === 'ar' ? opt.labelAr : opt.labelEn}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* Leaderboard */}
      <CardContent className="p-3">
        <div className="space-y-1.5">
          {displayedStudents.map(({ student, metrics }, idx) => {
            const levelCfg = getPerformanceLevelConfig(metrics.performanceLevel);
            const riskCfg = getRiskLevelConfig(metrics.riskLevel);
            const growthCfg = getGrowthTrendConfig(metrics.growthTrend);
            const effCfg = getEfficiencyLevelConfig(metrics.efficiencyLevel);
            const isExpanded = expandedStudentId === student.id;
            const bgClass = rankBgClass(idx);
            const sortValue = courseSortBy === 'performance'
              ? metrics.overallPerformance
              : courseSortBy === 'attendance'
                ? metrics.attendanceScore
                : metrics.efficiency;

            // Performance bar color based on value
            const barColor = sortValue >= 80 ? 'bg-emerald-500' : sortValue >= 60 ? 'bg-sky-500' : sortValue >= 40 ? 'bg-amber-500' : 'bg-rose-500';

            return (
              <div key={student.id}>
                <button
                  type="button"
                  onClick={() => toggleExpand(student.id)}
                  className={`w-full flex items-center gap-2.5 p-2 rounded-lg border transition-all text-start ${
                    bgClass || 'border-transparent hover:bg-gray-50/50 dark:hover:bg-gray-800/20'
                  } ${bgClass ? 'border' : ''}`}
                >
                  {/* Rank */}
                  <div className="w-7 shrink-0 text-center">
                    {idx < 3 && courseSortBy === 'performance' ? (
                      <span className="text-base leading-none">{medals[idx]}</span>
                    ) : (
                      <span className="text-[10px] font-bold text-muted-foreground">{idx + 1}</span>
                    )}
                  </div>

                  {/* Avatar + Name */}
                  <UserAvatar name={student.name} avatarUrl={student.avatar_url} size="sm" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <p className="text-xs font-medium text-foreground truncate">{student.name}</p>
                      <Badge variant="secondary" className={`text-[8px] px-1 py-0 border-0 font-bold ${levelCfg.bgColor} ${levelCfg.textColor}`}>
                        {t(getPerformanceLevelLabel(metrics.performanceLevel))}
                      </Badge>
                    </div>
                    {/* Performance bar */}
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <div className="flex-1 h-1.5 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: `${Math.round(sortValue)}%` }}
                          transition={{ duration: 0.6, ease: 'easeOut' }}
                          className={`h-full rounded-full ${barColor}`}
                        />
                      </div>
                      <span className={`text-[10px] font-bold min-w-[32px] text-end ${levelCfg.textColor}`}>
                        {Math.round(sortValue)}%
                      </span>
                    </div>
                  </div>

                  {/* Mini indicators */}
                  <div className="hidden sm:flex flex-col items-center gap-0.5 shrink-0">
                    <span className={`text-[10px] font-bold ${
                      metrics.efficiencyLevel === 'high' ? 'text-emerald-600' :
                      metrics.efficiencyLevel === 'medium' ? 'text-amber-600' : 'text-rose-600'
                    }`}>{Math.round(metrics.efficiency)}%</span>
                    <span className="text-[8px] text-muted-foreground">{t('teacher.trackingEfficiency')}</span>
                  </div>

                  <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground shrink-0 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} />
                </button>

                {/* Expanded detail */}
                <AnimatePresence>
                  {isExpanded && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.25, ease: 'easeInOut' }}
                      className="overflow-hidden"
                    >
                      <div className="px-3 py-2.5 mt-1 mx-1 rounded-lg bg-violet-50/40 dark:bg-violet-900/5 border border-violet-100/40 dark:border-violet-900/20 space-y-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <div className="min-w-0">
                            <p className="text-xs font-semibold text-foreground truncate">{student.name}</p>
                            {student.email && <p className="text-[10px] text-muted-foreground truncate flex items-center gap-1"><Mail className="h-2.5 w-2.5 shrink-0" />{student.email}</p>}
                          </div>
                          <Badge variant="secondary" className={`text-[9px] px-1.5 py-0 border-0 font-bold ${levelCfg.bgColor} ${levelCfg.textColor}`}>
                            {Math.round(metrics.overallPerformance)}% — {t(getPerformanceLevelLabel(metrics.performanceLevel))}
                          </Badge>
                        </div>
                        <div className="grid grid-cols-2 gap-1.5 text-[10px]">
                          <div className="flex items-center justify-between px-2 py-1 rounded bg-white/60 dark:bg-card/60">
                            <span className="text-muted-foreground">{locale === 'ar' ? 'الاختبارات' : 'Exams'}</span>
                            <span className="font-bold text-sky-600">{Math.round(metrics.examPerformance)}%</span>
                          </div>
                          <div className="flex items-center justify-between px-2 py-1 rounded bg-white/60 dark:bg-card/60">
                            <span className="text-muted-foreground">{locale === 'ar' ? 'الحضور' : 'Attend.'}</span>
                            <span className="font-bold text-emerald-600">{Math.round(metrics.attendanceScore)}%</span>
                          </div>
                          <div className="flex items-center justify-between px-2 py-1 rounded bg-white/60 dark:bg-card/60">
                            <span className="text-muted-foreground">{locale === 'ar' ? 'الالتزام' : 'Compl.'}</span>
                            <span className="font-bold text-amber-600">{Math.round(metrics.assignmentCompliance)}%</span>
                          </div>
                          <div className="flex items-center justify-between px-2 py-1 rounded bg-white/60 dark:bg-card/60">
                            <span className="text-muted-foreground">{locale === 'ar' ? 'الجودة' : 'Quality'}</span>
                            <span className="font-bold text-teal-600">{Math.round(metrics.assignmentQuality)}%</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-wrap text-[10px]">
                          <span className="text-muted-foreground">{t('teacher.trackingEfficiency')}:</span>
                          <Badge variant="secondary" className={`text-[9px] px-1.5 py-0 border-0 ${effCfg.bgColor} ${effCfg.textColor}`}>{Math.round(metrics.efficiency)}%</Badge>
                          <span className="text-muted-foreground">{locale === 'ar' ? 'الانضباط' : 'Discipline'}:</span>
                          <span className="font-bold text-foreground">{Math.round(metrics.disciplineScore)}%</span>
                          <span className="text-muted-foreground">{locale === 'ar' ? 'النمو' : 'Growth'}:</span>
                          <span className={`font-bold ${growthCfg.textColor}`}>{growthCfg.icon} {metrics.growthIndex.toFixed(1)}</span>
                        </div>
                        {metrics.riskLevel !== 'healthy' && (
                          <div className="flex items-center gap-1.5 flex-wrap text-[10px]">
                            <Badge variant="outline" className={`text-[9px] px-1.5 py-0 ${riskCfg.bgColor} ${riskCfg.textColor} ${riskCfg.borderColor}`}>
                              {locale === 'ar' ? 'مخاطر' : 'Risk'}: {getRiskLabel(metrics.riskLevel)}
                            </Badge>
                            <span className="text-muted-foreground">{metrics.riskReasons.map(r => t(`teacher.trackingRiskReason${r.charAt(0).toUpperCase() + r.slice(1)}`)).join(' • ')}</span>
                          </div>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>

        {/* Show more / Show less toggle */}
        {sortedStudents.length > INITIAL_SHOW_COUNT && (
          <div className="mt-2 flex justify-center">
            <button
              onClick={() => setShowAll(prev => !prev)}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium text-violet-600 dark:text-violet-400 hover:bg-violet-50 dark:hover:bg-violet-900/10 transition-colors"
            >
              <ChevronDown className={`h-3.5 w-3.5 transition-transform duration-200 ${showAll ? 'rotate-180' : ''}`} />
              {showAll
                ? (locale === 'ar' ? 'عرض أقل' : 'Show Less')
                : (locale === 'ar' ? `عرض الكل (${sortedStudents.length})` : `Show All (${sortedStudents.length})`)
              }
            </button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

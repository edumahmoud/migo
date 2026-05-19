'use client';

import { useMemo, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Activity,
  TrendingUp,
  Award,
  Users,
  Filter,
  ArrowUpDown,
  ChevronDown,
  BarChart3,
  ClipboardList,
  Clock,
  CheckCircle2,
  XCircle,
  FileText,
  Search,
  Download,
  Zap,
  Route,
  Target,
  BookOpen,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import type { UserProfile, Score, Quiz, Subject } from '@/lib/types';
import UserAvatar from '@/components/shared/user-avatar';
import UserLink from '@/components/shared/user-link';

// -------------------------------------------------------
// Props
// -------------------------------------------------------
interface TeacherStudentTrackingSectionProps {
  profile: UserProfile;
  students: UserProfile[];
  scores: Score[];
  quizzes: Quiz[];
  teacherSubmissions: { id: string; assignment_id: string; student_id: string; score: number | null; status: string }[];
  teacherAssignments: { id: string; max_score: number; subject_id: string | null }[];
  teacherAttendanceSessions: { id: string; subject_id: string }[];
  teacherAttendanceRecords: { id: string; session_id: string; student_id: string }[];
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
// Performance Level Types
// -------------------------------------------------------
type PerformanceLevel = 'excellent' | 'good' | 'average' | 'weak';

interface PerformanceLevelConfig {
  key: PerformanceLevel;
  label: string;
  color: string;
  bgColor: string;
  ringColor: string;
  textColor: string;
  icon: string;
}

const PERFORMANCE_LEVELS: PerformanceLevelConfig[] = [
  {
    key: 'excellent',
    label: 'ممتاز',
    color: 'bg-emerald-500',
    bgColor: 'bg-emerald-50 dark:bg-emerald-950/30',
    ringColor: 'ring-emerald-100',
    textColor: 'text-emerald-700 dark:text-emerald-300',
    icon: '★',
  },
  {
    key: 'good',
    label: 'جيد',
    color: 'bg-sky-500',
    bgColor: 'bg-sky-50 dark:bg-sky-950/30',
    ringColor: 'ring-sky-100',
    textColor: 'text-sky-700 dark:text-sky-300',
    icon: '◆',
  },
  {
    key: 'average',
    label: 'متوسط',
    color: 'bg-amber-500',
    bgColor: 'bg-amber-50 dark:bg-amber-950/30',
    ringColor: 'ring-amber-100',
    textColor: 'text-amber-700 dark:text-amber-300',
    icon: '●',
  },
  {
    key: 'weak',
    label: 'ضعيف',
    color: 'bg-rose-500',
    bgColor: 'bg-rose-50 dark:bg-rose-950/30',
    ringColor: 'ring-rose-100',
    textColor: 'text-rose-700 dark:text-rose-300',
    icon: '▼',
  },
];

// -------------------------------------------------------
// Percentage Range Types
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
    label: 'ممتاز',
    range: '90% - 100%',
    color: 'bg-emerald-500',
    bgColor: 'bg-emerald-50 dark:bg-emerald-950/30',
    textColor: 'text-emerald-700 dark:text-emerald-300',
    borderColor: 'border-emerald-200 dark:border-emerald-800',
  },
  {
    key: '80-89',
    label: 'جيد جداً',
    range: '80% - 89%',
    color: 'bg-sky-500',
    bgColor: 'bg-sky-50 dark:bg-sky-950/30',
    textColor: 'text-sky-700 dark:text-sky-300',
    borderColor: 'border-sky-200 dark:border-sky-800',
  },
  {
    key: '70-79',
    label: 'جيد',
    range: '70% - 79%',
    color: 'bg-teal-500',
    bgColor: 'bg-teal-50 dark:bg-teal-950/30',
    textColor: 'text-teal-700 dark:text-teal-300',
    borderColor: 'border-teal-200 dark:border-teal-800',
  },
  {
    key: '60-69',
    label: 'مقبول',
    range: '60% - 69%',
    color: 'bg-amber-500',
    bgColor: 'bg-amber-50 dark:bg-amber-950/30',
    textColor: 'text-amber-700 dark:text-amber-300',
    borderColor: 'border-amber-200 dark:border-amber-800',
  },
  {
    key: 'below-60',
    label: 'ضعيف',
    range: 'أقل من 60%',
    color: 'bg-rose-500',
    bgColor: 'bg-rose-50 dark:bg-rose-950/30',
    textColor: 'text-rose-700 dark:text-rose-300',
    borderColor: 'border-rose-200 dark:border-rose-800',
  },
];

// -------------------------------------------------------
// Efficiency Level Types
// -------------------------------------------------------
type EfficiencyLevel = 'high' | 'medium' | 'low';

interface EfficiencyLevelConfig {
  key: EfficiencyLevel;
  label: string;
  color: string;
  bgColor: string;
  textColor: string;
  ringColor: string;
}

const EFFICIENCY_LEVELS: EfficiencyLevelConfig[] = [
  {
    key: 'high',
    label: 'عالي الكفاءة',
    color: 'text-emerald-600 dark:text-emerald-400',
    bgColor: 'bg-emerald-50 dark:bg-emerald-950/30',
    textColor: 'text-emerald-700 dark:text-emerald-300',
    ringColor: 'stroke-emerald-500',
  },
  {
    key: 'medium',
    label: 'متوسط الكفاءة',
    color: 'text-amber-600 dark:text-amber-400',
    bgColor: 'bg-amber-50 dark:bg-amber-950/30',
    textColor: 'text-amber-700 dark:text-amber-300',
    ringColor: 'stroke-amber-500',
  },
  {
    key: 'low',
    label: 'منخفض الكفاءة',
    color: 'text-rose-600 dark:text-rose-400',
    bgColor: 'bg-rose-50 dark:bg-rose-950/30',
    textColor: 'text-rose-700 dark:text-rose-300',
    ringColor: 'stroke-rose-500',
  },
];

// -------------------------------------------------------
// Helpers
// -------------------------------------------------------
function getPerformanceLevel(overallPct: number): PerformanceLevel {
  if (overallPct >= 85) return 'excellent';
  if (overallPct >= 70) return 'good';
  if (overallPct >= 50) return 'average';
  return 'weak';
}

function getPerformanceLevelConfig(level: PerformanceLevel): PerformanceLevelConfig {
  return PERFORMANCE_LEVELS.find(l => l.key === level) || PERFORMANCE_LEVELS[3];
}

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

function getEfficiencyLevel(efficiency: number): EfficiencyLevel {
  if (efficiency >= 80) return 'high';
  if (efficiency >= 50) return 'medium';
  return 'low';
}

function getEfficiencyLevelConfig(level: EfficiencyLevel): EfficiencyLevelConfig {
  return EFFICIENCY_LEVELS.find(l => l.key === level) || EFFICIENCY_LEVELS[2];
}

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
// Per-Subject Performance Data
// -------------------------------------------------------
interface SubjectPerformance {
  subjectId: string;
  subjectName: string;
  quizAvg: number;
  attendanceRate: number;
  quizCount: number;
  attendanceSessions: number;
  attendedSessions: number;
  assignmentCount: number;
  completedAssignments: number;
}

// -------------------------------------------------------
// Student Performance Data
// -------------------------------------------------------
interface StudentPerformanceData {
  student: UserProfile;
  quizAvg: number;
  attendanceRate: number;
  assignmentCompletion: number;
  overallPerformance: number;
  level: PerformanceLevel;
  percentageRange: PercentageRange;
  studentScores: Score[];
  studentSubmissions: { id: string; assignment_id: string; student_id: string; score: number | null; status: string }[];
  attendedSessionIds: Set<string>;
  recentActivities: Array<{ date: string; type: 'quiz' | 'attendance' | 'assignment'; title: string; detail: string }>;
  // New fields
  effortScore: number;
  resultScore: number;
  efficiency: number;
  efficiencyLevel: EfficiencyLevel;
  subjectPerformances: SubjectPerformance[];
}

// -------------------------------------------------------
// Sort options
// -------------------------------------------------------
type SortOption = 'name' | 'performance' | 'attendance' | 'quiz' | 'efficiency';

const SORT_OPTIONS: { key: SortOption; label: string }[] = [
  { key: 'name', label: 'الاسم' },
  { key: 'performance', label: 'الأداء العام' },
  { key: 'attendance', label: 'الحضور' },
  { key: 'quiz', label: 'الاختبارات' },
  { key: 'efficiency', label: 'الكفاءة' },
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
  // ─── Local state ───
  const [filterLevel, setFilterLevel] = useState<PerformanceLevel | 'all'>('all');
  const [filterRange, setFilterRange] = useState<PercentageRange | 'all'>('all');
  const [sortBy, setSortBy] = useState<SortOption>('performance');
  const [expandedStudentId, setExpandedStudentId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilterTab, setActiveFilterTab] = useState<'level' | 'range'>('level');

  // ─── Subject name lookup ───
  const subjectNameMap = useMemo(() => {
    const map = new Map<string, string>();
    subjects.forEach(s => map.set(s.id, s.name));
    // Also derive from quiz titles as fallback
    quizzes.forEach(q => {
      if (q.subject_id && !map.has(q.subject_id)) {
        map.set(q.subject_id, q.title || 'مقرر');
      }
    });
    return map;
  }, [subjects, quizzes]);

  // ─── Compute performance data for each student ───
  const studentPerformanceData = useMemo<StudentPerformanceData[]>(() => {
    return students.map(student => {
      // Quiz performance
      const studentScores = scores.filter(s => s.student_id === student.id);
      const quizAvg = studentScores.length > 0
        ? studentScores.reduce((sum, s) => sum + (s.total > 0 ? (s.score / s.total) * 100 : 0), 0) / studentScores.length
        : 0;

      // Attendance rate
      const studentRecords = teacherAttendanceRecords.filter(r => r.student_id === student.id);
      const attendedSessionIds = new Set(studentRecords.map(r => r.session_id));
      const attendanceRate = teacherAttendanceSessions.length > 0
        ? (attendedSessionIds.size / teacherAttendanceSessions.length) * 100
        : 0;

      // Assignment completion
      const studentSubmissions = teacherSubmissions.filter(s => s.student_id === student.id);
      const completedAssignments = studentSubmissions.filter(s => s.status === 'graded' || s.status === 'submitted').length;
      const assignmentCompletion = teacherAssignments.length > 0
        ? (completedAssignments / teacherAssignments.length) * 100
        : 0;

      // Overall performance (weighted: quiz 40%, attendance 30%, assignments 30%)
      const overallPerformance = quizAvg * 0.4 + attendanceRate * 0.3 + assignmentCompletion * 0.3;

      const level = getPerformanceLevel(overallPerformance);
      const percentageRange = getPercentageRange(overallPerformance);

      // ─── Efficiency calculation ───
      // Effort = weighted average of (attendance rate, assignment submission rate)
      const effortScore = (attendanceRate * 0.5 + assignmentCompletion * 0.5);
      // Results = weighted average of quiz scores
      const resultScore = quizAvg;
      // Efficiency = (Results / Effort) * 100, clamped 0-150
      const efficiency = effortScore > 0
        ? Math.min(Math.max((resultScore / effortScore) * 100, 0), 150)
        : 0;
      const efficiencyLevel = getEfficiencyLevel(efficiency);

      // ─── Per-subject performance ───
      const subjectMap = new Map<string, SubjectPerformance>();

      // Gather quiz data per subject
      studentScores.forEach(score => {
        const quiz = quizzes.find(q => q.id === score.quiz_id);
        const subjectId = quiz?.subject_id || 'unknown';
        if (!subjectMap.has(subjectId)) {
          subjectMap.set(subjectId, {
            subjectId,
            subjectName: subjectNameMap.get(subjectId) || 'مقرر',
            quizAvg: 0,
            attendanceRate: 0,
            quizCount: 0,
            attendanceSessions: 0,
            attendedSessions: 0,
            assignmentCount: 0,
            completedAssignments: 0,
          });
        }
        const entry = subjectMap.get(subjectId)!;
        entry.quizCount++;
        entry.quizAvg += score.total > 0 ? (score.score / score.total) * 100 : 0;
      });

      // Average quiz scores per subject
      subjectMap.forEach(entry => {
        if (entry.quizCount > 0) {
          entry.quizAvg = entry.quizAvg / entry.quizCount;
        }
      });

      // Attendance per subject
      teacherAttendanceSessions.forEach(session => {
        const subjectId = session.subject_id;
        if (!subjectMap.has(subjectId)) {
          subjectMap.set(subjectId, {
            subjectId,
            subjectName: subjectNameMap.get(subjectId) || 'مقرر',
            quizAvg: 0,
            attendanceRate: 0,
            quizCount: 0,
            attendanceSessions: 0,
            attendedSessions: 0,
            assignmentCount: 0,
            completedAssignments: 0,
          });
        }
        const entry = subjectMap.get(subjectId)!;
        entry.attendanceSessions++;
        if (attendedSessionIds.has(session.id)) {
          entry.attendedSessions++;
        }
      });

      // Calculate attendance rate per subject
      subjectMap.forEach(entry => {
        entry.attendanceRate = entry.attendanceSessions > 0
          ? (entry.attendedSessions / entry.attendanceSessions) * 100
          : 0;
      });

      // Assignments per subject
      teacherAssignments.forEach(assignment => {
        const subjectId = assignment.subject_id || 'unknown';
        if (!subjectMap.has(subjectId)) {
          subjectMap.set(subjectId, {
            subjectId,
            subjectName: subjectNameMap.get(subjectId) || 'مقرر',
            quizAvg: 0,
            attendanceRate: 0,
            quizCount: 0,
            attendanceSessions: 0,
            attendedSessions: 0,
            assignmentCount: 0,
            completedAssignments: 0,
          });
        }
        const entry = subjectMap.get(subjectId)!;
        entry.assignmentCount++;
        // Check if student submitted this assignment
        const submitted = studentSubmissions.some(s => s.assignment_id === assignment.id && (s.status === 'graded' || s.status === 'submitted'));
        if (submitted) {
          entry.completedAssignments++;
        }
      });

      const subjectPerformances = Array.from(subjectMap.values());

      // ─── Recent activities ───
      const recentActivities: Array<{ date: string; type: 'quiz' | 'attendance' | 'assignment'; title: string; detail: string }> = [];

      // Quiz activities
      studentScores.slice(0, 5).forEach(score => {
        recentActivities.push({
          date: score.completed_at,
          type: 'quiz',
          title: 'إكمال اختبار',
          detail: `${score.quiz_title} — ${score.score}/${score.total}`,
        });
      });

      // Attendance activities
      studentRecords.slice(0, 5).forEach(record => {
        const session = teacherAttendanceSessions.find(s => s.id === record.session_id);
        const subjectName = session ? subjectNameMap.get(session.subject_id) || 'مقرر' : 'جلسة حضور';
        recentActivities.push({
          date: session ? session.id : new Date().toISOString(), // Best available date
          type: 'attendance',
          title: 'تسجيل حضور',
          detail: subjectName,
        });
      });

      // Assignment activities
      studentSubmissions.slice(0, 5).forEach(sub => {
        const assignment = teacherAssignments.find(a => a.id === sub.assignment_id);
        recentActivities.push({
          date: new Date().toISOString(), // Submissions don't have submitted_at in this data shape
          type: 'assignment',
          title: 'تسليم مهمة',
          detail: assignment ? `مهمة (${sub.score !== null ? `${sub.score}/${assignment.max_score}` : 'قيد التصحيح'})` : 'مهمة',
        });
      });

      // Sort by date
      recentActivities.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

      return {
        student,
        quizAvg,
        attendanceRate,
        assignmentCompletion,
        overallPerformance,
        level,
        percentageRange,
        studentScores,
        studentSubmissions,
        attendedSessionIds,
        recentActivities: recentActivities.slice(0, 10),
        effortScore,
        resultScore,
        efficiency,
        efficiencyLevel,
        subjectPerformances,
      };
    });
  }, [students, scores, teacherSubmissions, teacherAssignments, teacherAttendanceSessions, teacherAttendanceRecords, quizzes, subjectNameMap]);

  // ─── Overview stats ───
  const overviewStats = useMemo(() => {
    const totalStudents = students.length;
    const avgPerformance = totalStudents > 0
      ? studentPerformanceData.reduce((sum, d) => sum + d.overallPerformance, 0) / totalStudents
      : 0;
    const avgAttendance = totalStudents > 0
      ? studentPerformanceData.reduce((sum, d) => sum + d.attendanceRate, 0) / totalStudents
      : 0;
    const avgEfficiency = totalStudents > 0
      ? studentPerformanceData.reduce((sum, d) => sum + d.efficiency, 0) / totalStudents
      : 0;
    const topPerformers = studentPerformanceData.filter(d => d.level === 'excellent').length;
    return { totalStudents, avgPerformance, avgAttendance, avgEfficiency, topPerformers };
  }, [students.length, studentPerformanceData]);

  // ─── Classification counts ───
  const classificationCounts = useMemo(() => {
    const counts: Record<PerformanceLevel, number> = { excellent: 0, good: 0, average: 0, weak: 0 };
    studentPerformanceData.forEach(d => { counts[d.level]++; });
    return counts;
  }, [studentPerformanceData]);

  // ─── Percentage range distribution ───
  const percentageRangeDistribution = useMemo(() => {
    const distribution: Record<PercentageRange, number> = { '90-100': 0, '80-89': 0, '70-79': 0, '60-69': 0, 'below-60': 0 };
    studentPerformanceData.forEach(d => { distribution[d.percentageRange]++; });
    return distribution;
  }, [studentPerformanceData]);

  // ─── Class average efficiency ───
  const classAvgEfficiency = useMemo(() => {
    if (studentPerformanceData.length === 0) return 0;
    return studentPerformanceData.reduce((sum, d) => sum + d.efficiency, 0) / studentPerformanceData.length;
  }, [studentPerformanceData]);

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
          return b.overallPerformance - a.overallPerformance;
        case 'attendance':
          return b.attendanceRate - a.attendanceRate;
        case 'quiz':
          return b.quizAvg - a.quizAvg;
        case 'efficiency':
          return b.efficiency - a.efficiency;
        default:
          return 0;
      }
    });

    return data;
  }, [studentPerformanceData, filterLevel, filterRange, searchQuery, sortBy]);

  // ─── Toggle expand ───
  const toggleExpand = (studentId: string) => {
    setExpandedStudentId(prev => prev === studentId ? null : studentId);
  };

  // ─── Export CSV ───
  const handleExport = useCallback(() => {
    const headers = [
      'الاسم',
      'البريد الإلكتروني',
      'متوسط الاختبارات',
      'نسبة الحضور',
      'إكمال المهام',
      'الأداء العام',
      'التصنيف',
      'النسبة المئوية',
      'الكفاءة',
      'مستوى الكفاءة',
    ];

    const rows = studentPerformanceData.map(d => [
      d.student.name,
      d.student.email,
      Math.round(d.quizAvg) + '%',
      Math.round(d.attendanceRate) + '%',
      Math.round(d.assignmentCompletion) + '%',
      Math.round(d.overallPerformance) + '%',
      getPerformanceLevelConfig(d.level).label,
      d.percentageRange === 'below-60' ? 'أقل من 60%' : d.percentageRange.replace('-', ' - ') + '%',
      Math.round(d.efficiency) + '%',
      getEfficiencyLevelConfig(d.efficiencyLevel).label,
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
  }, [studentPerformanceData]);

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
            <h1 className="text-2xl font-bold text-gray-900">تتبع الطلاب</h1>
            <p className="text-sm text-muted-foreground">متابعة أداء وحضور وتقدم وكفاءة الطلاب</p>
          </div>
        </div>
        {/* Export button */}
        <motion.button
          whileHover={{ scale: 1.04 }}
          whileTap={{ scale: 0.96 }}
          onClick={handleExport}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-l from-sky-600 to-teal-600 text-white text-sm font-medium shadow-md shadow-sky-600/20 hover:shadow-lg hover:shadow-sky-600/30 transition-shadow"
        >
          <Download className="h-4 w-4" />
          <span className="hidden sm:inline">تصدير البيانات</span>
        </motion.button>
      </motion.div>

      {/* ── Overview Cards ── */}
      <motion.div variants={itemVariants}>
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 sm:gap-4">
          {/* Total Students */}
          <Card className="border-sky-100/50 shadow-sm">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-50 dark:bg-sky-950/30 ring-2 ring-sky-100">
                  <Users className="h-5 w-5 text-sky-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-sky-800 dark:text-sky-200">{overviewStats.totalStudents}</p>
                  <p className="text-xs text-muted-foreground">إجمالي الطلاب</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Average Performance */}
          <Card className="border-teal-100/50 shadow-sm">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-50 dark:bg-teal-950/30 ring-2 ring-teal-100">
                  <TrendingUp className="h-5 w-5 text-teal-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-teal-700 dark:text-teal-300">{Math.round(overviewStats.avgPerformance)}%</p>
                  <p className="text-xs text-muted-foreground">متوسط الأداء</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Attendance Rate */}
          <Card className="border-amber-100/50 shadow-sm">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50 dark:bg-amber-950/30 ring-2 ring-amber-100">
                  <Clock className="h-5 w-5 text-amber-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-amber-700 dark:text-amber-300">{Math.round(overviewStats.avgAttendance)}%</p>
                  <p className="text-xs text-muted-foreground">معدل الحضور</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Average Efficiency */}
          <Card className="border-violet-100/50 shadow-sm">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-50 dark:bg-violet-950/30 ring-2 ring-violet-100">
                  <Zap className="h-5 w-5 text-violet-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-violet-700">{Math.round(overviewStats.avgEfficiency)}%</p>
                  <p className="text-xs text-muted-foreground">متوسط الكفاءة</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Top Performers */}
          <Card className="border-emerald-100/50 shadow-sm col-span-2 lg:col-span-1">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 dark:bg-emerald-950/30 ring-2 ring-emerald-100">
                  <Award className="h-5 w-5 text-emerald-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-emerald-700 dark:text-emerald-300">{overviewStats.topPerformers}</p>
                  <p className="text-xs text-muted-foreground">ممتاز</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </motion.div>

      {/* ── Classification Distribution with Tabs ── */}
      <motion.div variants={itemVariants}>
        <Card className="border-sky-100/50 shadow-sm">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg flex items-center gap-2">
                <Filter className="h-5 w-5 text-sky-600" />
                تصنيف الطلاب حسب الأداء
              </CardTitle>
              {/* Tab switcher */}
              <div className="flex items-center gap-1 bg-gray-100 dark:bg-gray-800/50 rounded-lg p-0.5">
                <button
                  onClick={() => setActiveFilterTab('level')}
                  className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
                    activeFilterTab === 'level'
                      ? 'bg-white dark:bg-card text-gray-900 dark:text-gray-100 shadow-sm'
                      : 'text-gray-500 dark:text-gray-400 hover:text-gray-700'
                  }`}
                >
                  حسب المستوى
                </button>
                <button
                  onClick={() => setActiveFilterTab('range')}
                  className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
                    activeFilterTab === 'range'
                      ? 'bg-white dark:bg-card text-gray-900 dark:text-gray-100 shadow-sm'
                      : 'text-gray-500 dark:text-gray-400 hover:text-gray-700'
                  }`}
                >
                  حسب النسبة
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
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
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
                              : 'bg-white dark:bg-card border-gray-100 hover:border-gray-200 text-gray-600 dark:text-gray-300'
                          }`}
                        >
                          <span className={`text-3xl font-bold ${isActive ? level.textColor : 'text-gray-400'}`}>
                            {count}
                          </span>
                          <span className={`text-sm font-medium ${isActive ? level.textColor : 'text-gray-500 dark:text-gray-400'}`}>
                            {level.label}
                          </span>
                          <span className={`text-xs ${isActive ? level.textColor : 'text-gray-400'}`}>
                            {level.key === 'excellent' ? '85%+' : level.key === 'good' ? '70-84%' : level.key === 'average' ? '50-69%' : '<50%'}
                          </span>
                          {isActive && (
                            <motion.div
                              layoutId="activeFilterIndicator"
                              className={`absolute bottom-0 left-1/2 -translate-x-1/2 w-8 h-1 rounded-full ${level.color}`}
                              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                            />
                          )}
                        </motion.button>
                      );
                    })}
                  </div>
                </motion.div>
              ) : (
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
                              : 'bg-white dark:bg-card border-gray-100 hover:border-gray-200 text-gray-600 dark:text-gray-300'
                          }`}
                        >
                          <span className={`text-2xl font-bold ${isActive ? range.textColor : 'text-gray-400'}`}>
                            {count}
                          </span>
                          <span className={`text-xs font-medium ${isActive ? range.textColor : 'text-gray-500 dark:text-gray-400'}`}>
                            {range.label}
                          </span>
                          <span className={`text-[10px] ${isActive ? range.textColor : 'text-gray-400'}`}>
                            {range.range}
                          </span>
                        </motion.button>
                      );
                    })}
                  </div>

                  {/* Performance Distribution Horizontal Bar Chart */}
                  <div className="mt-2 p-4 rounded-xl bg-gradient-to-l from-gray-50/80 dark:from-gray-800/50 to-white dark:to-card border border-gray-100/80 dark:border-gray-700">
                    <div className="flex items-center gap-2 mb-3">
                      <BarChart3 className="h-4 w-4 text-sky-600" />
                      <span className="text-sm font-medium text-gray-900">توزيع الأداء</span>
                    </div>
                    <div className="space-y-2.5">
                      {PERCENTAGE_RANGES.map(range => {
                        const count = percentageRangeDistribution[range.key];
                        const percentage = students.length > 0 ? (count / students.length) * 100 : 0;
                        return (
                          <div key={range.key} className="flex items-center gap-3">
                            <span className="text-[11px] font-medium text-gray-600 min-w-[70px] text-left">
                              {range.range}
                            </span>
                            <div className="flex-1 h-6 bg-gray-100 dark:bg-gray-800/50 rounded-full overflow-hidden">
                              <motion.div
                                initial={{ width: 0 }}
                                animate={{ width: `${Math.max(percentage, 0)}%` }}
                                transition={{ duration: 0.6, ease: 'easeOut' as const }}
                                className={`h-full ${range.color} rounded-full`}
                              />
                            </div>
                            <span className="text-xs font-bold text-gray-700 min-w-[30px] text-center">
                              {count}
                            </span>
                            <span className="text-[10px] text-gray-400 min-w-[35px] text-center">
                              {Math.round(percentage)}%
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Active filter indicators */}
            {(filterLevel !== 'all' || filterRange !== 'all') && (
              <motion.div
                initial={{ opacity: 0, y: -5 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-3 flex items-center gap-2 flex-wrap"
              >
                <span className="text-xs text-muted-foreground">عرض:</span>
                {filterLevel !== 'all' && (
                  <Badge
                    variant="secondary"
                    className={`${getPerformanceLevelConfig(filterLevel).bgColor} ${getPerformanceLevelConfig(filterLevel).textColor} cursor-pointer`}
                    onClick={() => setFilterLevel('all')}
                  >
                    {getPerformanceLevelConfig(filterLevel).label} ({classificationCounts[filterLevel]})
                    <XCircle className="h-3 w-3 ms-1" />
                  </Badge>
                )}
                {filterRange !== 'all' && (
                  <Badge
                    variant="secondary"
                    className={`${getPercentageRangeConfig(filterRange).bgColor} ${getPercentageRangeConfig(filterRange).textColor} cursor-pointer`}
                    onClick={() => setFilterRange('all')}
                  >
                    {getPercentageRangeConfig(filterRange).label} ({percentageRangeDistribution[filterRange]})
                    <XCircle className="h-3 w-3 ms-1" />
                  </Badge>
                )}
                <button
                  onClick={() => { setFilterLevel('all'); setFilterRange('all'); }}
                  className="text-xs text-sky-600 hover:text-sky-700 font-medium"
                >
                  عرض الكل
                </button>
              </motion.div>
            )}
          </CardContent>
        </Card>
      </motion.div>

      {/* ── Search, Sort & Student List ── */}
      <motion.div variants={itemVariants}>
        <Card className="border-sky-100/50 shadow-sm">
          <CardHeader className="pb-3">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <Users className="h-5 w-5 text-sky-600" />
                قائمة الطلاب
                <span className="text-sm font-normal text-muted-foreground">
                  ({filteredStudents.length} طالب)
                </span>
              </CardTitle>

              <div className="flex items-center gap-2">
                {/* Search */}
                <div className="relative flex-1 sm:flex-initial">
                  <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <input
                    type="text"
                    placeholder="بحث عن طالب..."
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    className="w-full sm:w-48 h-9 pr-9 pl-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-card text-sm focus:outline-none focus:ring-2 focus:ring-sky-200 focus:border-sky-300 transition-all"
                    dir="rtl"
                  />
                </div>

                {/* Sort dropdown */}
                <div className="relative">
                  <select
                    value={sortBy}
                    onChange={e => setSortBy(e.target.value as SortOption)}
                    className="h-9 pl-3 pr-8 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-card text-sm focus:outline-none focus:ring-2 focus:ring-sky-200 focus:border-sky-300 appearance-none cursor-pointer"
                    dir="rtl"
                  >
                    {SORT_OPTIONS.map(opt => (
                      <option key={opt.key} value={opt.key}>
                        ترتيب: {opt.label}
                      </option>
                    ))}
                  </select>
                  <ArrowUpDown className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {filteredStudents.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <Users className="h-12 w-12 mx-auto mb-3 opacity-30" />
                <p className="text-sm font-medium">
                  {students.length === 0 ? 'لا يوجد طلاب بعد' : 'لا توجد نتائج مطابقة'}
                </p>
                <p className="text-xs mt-1">
                  {students.length === 0 ? 'قم بربط الطلاب لبدء تتبع أدائهم' : 'جرّب تغيير معايير البحث أو التصفية'}
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
                  />
                ))}
              </div>
            )}
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
}: {
  efficiency: number;
  efficiencyLevel: EfficiencyLevel;
  classAvg: number;
}) {
  const config = getEfficiencyLevelConfig(efficiencyLevel);
  const displayEfficiency = Math.min(efficiency, 150);
  const circumference = 2 * Math.PI * 40; // radius 40
  const progress = (displayEfficiency / 150) * circumference;
  const classAvgProgress = (classAvg / 150) * circumference;

  // Color based on level
  const strokeColor = efficiencyLevel === 'high'
    ? '#10b981' // emerald-500
    : efficiencyLevel === 'medium'
      ? '#f59e0b' // amber-500
      : '#f43f5e'; // rose-500

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
            stroke="#f1f5f9"
            strokeWidth="6"
          />
          {/* Class average indicator */}
          <circle
            cx="48"
            cy="48"
            r="40"
            fill="none"
            stroke="#e2e8f0"
            strokeWidth="2"
            strokeDasharray={`${classAvgProgress} ${circumference - classAvgProgress}`}
            strokeLinecap="round"
          />
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
          <span className="text-lg font-bold" style={{ color: strokeColor }}>
            {Math.round(efficiency)}%
          </span>
          <span className="text-[9px] text-gray-400">كفاءة</span>
        </div>
      </div>
      <Badge
        variant="secondary"
        className={`${config.bgColor} ${config.textColor} text-[10px] px-2 py-0.5 border-0 font-bold`}
      >
        {config.label}
      </Badge>
      {classAvg > 0 && (
        <div className="flex items-center gap-1 text-[10px] text-gray-400">
          <Target className="h-3 w-3" />
          <span>متوسط الفصل: {Math.round(classAvg)}%</span>
        </div>
      )}
    </div>
  );
}

// -------------------------------------------------------
// Subject Performance Mini Card
// -------------------------------------------------------
function SubjectPerformanceCard({ subject }: { subject: SubjectPerformance }) {
  return (
    <div className="p-3 rounded-xl bg-white/80 dark:bg-card/80 border border-gray-100/80 dark:border-gray-700/80 space-y-2">
      <div className="flex items-center gap-2">
        <BookOpen className="h-3.5 w-3.5 text-sky-600 shrink-0" />
        <span className="text-xs font-medium text-gray-900 truncate">{subject.subjectName}</span>
      </div>
      <div className="space-y-1.5">
        {/* Quiz avg */}
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-gray-500 min-w-[50px]">الاختبارات</span>
          <div className="flex-1 h-2 bg-gray-100 dark:bg-gray-800/50 rounded-full overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${Math.min(subject.quizAvg, 100)}%` }}
              transition={{ duration: 0.5, ease: 'easeOut' as const }}
              className="h-full bg-sky-500 rounded-full"
            />
          </div>
          <span className="text-[10px] font-bold text-sky-700 dark:text-sky-300 min-w-[28px] text-left">
            {Math.round(subject.quizAvg)}%
          </span>
        </div>
        {/* Attendance */}
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-gray-500 min-w-[50px]">الحضور</span>
          <div className="flex-1 h-2 bg-gray-100 dark:bg-gray-800/50 rounded-full overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${Math.min(subject.attendanceRate, 100)}%` }}
              transition={{ duration: 0.5, ease: 'easeOut' as const, delay: 0.1 }}
              className="h-full bg-teal-500 rounded-full"
            />
          </div>
          <span className="text-[10px] font-bold text-teal-700 dark:text-teal-300 min-w-[28px] text-left">
            {Math.round(subject.attendanceRate)}%
          </span>
        </div>
        {/* Assignments */}
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-gray-500 min-w-[50px]">المهام</span>
          <div className="flex-1 h-2 bg-gray-100 dark:bg-gray-800/50 rounded-full overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${subject.assignmentCount > 0 ? (subject.completedAssignments / subject.assignmentCount) * 100 : 0}%` }}
              transition={{ duration: 0.5, ease: 'easeOut' as const, delay: 0.2 }}
              className="h-full bg-amber-500 rounded-full"
            />
          </div>
          <span className="text-[10px] font-bold text-amber-700 dark:text-amber-300 min-w-[28px] text-left">
            {subject.completedAssignments}/{subject.assignmentCount}
          </span>
        </div>
      </div>
    </div>
  );
}

// -------------------------------------------------------
// Student Card Component
// -------------------------------------------------------
function StudentCard({
  data,
  isExpanded,
  onToggle,
  totalSessions,
  totalAssignments,
  classAvgEfficiency,
}: {
  data: StudentPerformanceData;
  isExpanded: boolean;
  onToggle: () => void;
  totalSessions: number;
  totalAssignments: number;
  classAvgEfficiency: number;
}) {
  const levelConfig = getPerformanceLevelConfig(data.level);
  const rangeConfig = getPercentageRangeConfig(data.percentageRange);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: 'easeOut' as const }}
      className={`rounded-xl border-2 transition-all duration-200 ${
        isExpanded
          ? `${levelConfig.bgColor} ${levelConfig.ringColor} ring-1`
          : 'border-gray-100 dark:border-gray-700 hover:border-gray-200 hover:bg-gray-50/50'
      }`}
    >
      {/* ── Main Row ── */}
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 p-3 sm:p-4 text-right"
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
            <Badge
              variant="secondary"
              className={`${levelConfig.bgColor} ${levelConfig.textColor} text-[10px] px-1.5 py-0 border-0 font-bold`}
            >
              {levelConfig.label}
            </Badge>
            <Badge
              variant="outline"
              className={`${rangeConfig.bgColor} ${rangeConfig.textColor} ${rangeConfig.borderColor} text-[9px] px-1.5 py-0 font-medium`}
            >
              {rangeConfig.range}
            </Badge>
          </div>

          {/* Progress bar */}
          <div className="flex items-center gap-2 mt-1.5">
            <Progress
              value={Math.round(data.overallPerformance)}
              className="h-2 flex-1"
            />
            <span className={`text-xs font-bold min-w-[40px] text-left ${levelConfig.textColor}`}>
              {Math.round(data.overallPerformance)}%
            </span>
          </div>
        </div>

        {/* Efficiency mini indicator */}
        <div className="hidden sm:flex flex-col items-center gap-0.5 shrink-0">
          <div className={`text-sm font-bold ${
            data.efficiencyLevel === 'high' ? 'text-emerald-600 dark:text-emerald-400' :
            data.efficiencyLevel === 'medium' ? 'text-amber-600 dark:text-amber-400' : 'text-rose-600 dark:text-rose-400'
          }`}>
            {Math.round(data.efficiency)}%
          </div>
          <span className="text-[9px] text-gray-400">كفاءة</span>
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
              {/* Performance breakdown cards */}
              <div className="grid grid-cols-3 gap-2 sm:gap-3">
                {/* Quiz average */}
                <div className="flex flex-col items-center gap-1.5 p-3 rounded-xl bg-white/80 dark:bg-card/80 border border-gray-100/80 dark:border-gray-700/80">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-100 dark:bg-sky-900/50">
                    <BarChart3 className="h-4 w-4 text-sky-700" />
                  </div>
                  <span className="text-lg font-bold text-sky-800 dark:text-sky-200">{Math.round(data.quizAvg)}%</span>
                  <span className="text-[10px] text-muted-foreground text-center leading-tight">متوسط الاختبارات</span>
                </div>

                {/* Attendance rate */}
                <div className="flex flex-col items-center gap-1.5 p-3 rounded-xl bg-white/80 dark:bg-card/80 border border-gray-100/80 dark:border-gray-700/80">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-100 dark:bg-teal-900/50">
                    <CheckCircle2 className="h-4 w-4 text-teal-700" />
                  </div>
                  <span className="text-lg font-bold text-teal-700 dark:text-teal-300">{Math.round(data.attendanceRate)}%</span>
                  <span className="text-[10px] text-muted-foreground text-center leading-tight">نسبة الحضور</span>
                  <span className="text-[9px] text-muted-foreground">
                    {data.attendedSessionIds.size}/{totalSessions} جلسة
                  </span>
                </div>

                {/* Assignment completion */}
                <div className="flex flex-col items-center gap-1.5 p-3 rounded-xl bg-white/80 dark:bg-card/80 border border-gray-100/80 dark:border-gray-700/80">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-100 dark:bg-amber-900/50">
                    <ClipboardList className="h-4 w-4 text-amber-700" />
                  </div>
                  <span className="text-lg font-bold text-amber-700 dark:text-amber-300">{Math.round(data.assignmentCompletion)}%</span>
                  <span className="text-[10px] text-muted-foreground text-center leading-tight">إكمال المهام</span>
                  <span className="text-[9px] text-muted-foreground">
                    {data.studentSubmissions.filter(s => s.status === 'graded' || s.status === 'submitted').length}/{totalAssignments} مهمة
                  </span>
                </div>
              </div>

              {/* ── Efficiency Section (كفاءة الطالب) ── */}
              <div className="p-3 rounded-xl bg-gradient-to-l from-violet-50/80 to-white border border-violet-100/50">
                <div className="flex items-center gap-2 mb-3">
                  <Zap className="h-4 w-4 text-violet-600" />
                  <span className="text-sm font-medium text-gray-900">كفاءة الطالب</span>
                  <span className="text-[10px] text-gray-400">(النتائج / الجهد) × 100</span>
                </div>
                <div className="flex items-center gap-4">
                  {/* Circular gauge */}
                  <EfficiencyGauge
                    efficiency={data.efficiency}
                    efficiencyLevel={data.efficiencyLevel}
                    classAvg={classAvgEfficiency}
                  />
                  {/* Efficiency breakdown */}
                  <div className="flex-1 space-y-2">
                    <div className="flex items-center justify-between p-2 rounded-lg bg-white/60 dark:bg-card/60 border border-gray-100/50 dark:border-gray-700/50">
                      <span className="text-[11px] text-gray-600 dark:text-gray-400">الجهد المبذول</span>
                      <div className="flex items-center gap-2">
                        <Progress value={Math.round(data.effortScore)} className="h-1.5 w-16" />
                        <span className="text-xs font-bold text-gray-700">{Math.round(data.effortScore)}%</span>
                      </div>
                    </div>
                    <div className="text-[9px] text-gray-400 pr-2">
                      حضور ({Math.round(data.attendanceRate)}%) × 50% + مهام ({Math.round(data.assignmentCompletion)}%) × 50%
                    </div>
                    <div className="flex items-center justify-between p-2 rounded-lg bg-white/60 dark:bg-card/60 border border-gray-100/50 dark:border-gray-700/50">
                      <span className="text-[11px] text-gray-600 dark:text-gray-400">النتائج المحققة</span>
                      <div className="flex items-center gap-2">
                        <Progress value={Math.round(data.resultScore)} className="h-1.5 w-16" />
                        <span className="text-xs font-bold text-gray-700">{Math.round(data.resultScore)}%</span>
                      </div>
                    </div>
                    <div className="text-[9px] text-gray-400 pr-2">
                      متوسط الاختبارات ({Math.round(data.quizAvg)}%)
                    </div>
                    {/* Comparison to class average */}
                    {classAvgEfficiency > 0 && (
                      <div className={`flex items-center gap-1.5 text-[11px] font-medium ${
                        data.efficiency >= classAvgEfficiency ? 'text-emerald-600' : 'text-rose-600'
                      }`}>
                        {data.efficiency >= classAvgEfficiency ? (
                          <TrendingUp className="h-3 w-3" />
                        ) : (
                          <TrendingUp className="h-3 w-3 rotate-180" />
                        )}
                        <span>
                          {data.efficiency >= classAvgEfficiency ? 'فوق' : 'تحت'} متوسط الفصل بـ{Math.abs(Math.round(data.efficiency - classAvgEfficiency))}%
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* ── Per-Subject Performance (مسار الطالب - المقررات) ── */}
              {data.subjectPerformances.length > 0 && (
                <div className="p-3 rounded-xl bg-gradient-to-l from-sky-50/80 to-white border border-sky-100/50">
                  <div className="flex items-center gap-2 mb-3">
                    <BookOpen className="h-4 w-4 text-sky-600" />
                    <span className="text-sm font-medium text-gray-900">الأداء حسب المقرر</span>
                    <Badge variant="secondary" className="text-[9px] px-1.5 py-0 bg-sky-50 dark:bg-sky-950/30 text-sky-700 dark:text-sky-300 border-sky-100 dark:border-sky-800">
                      {data.subjectPerformances.length} مقرر
                    </Badge>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-48 overflow-y-auto custom-scrollbar">
                    {data.subjectPerformances.map(subject => (
                      <SubjectPerformanceCard key={subject.subjectId} subject={subject} />
                    ))}
                  </div>
                </div>
              )}

              {/* Weighted performance breakdown */}
              <div className="p-3 rounded-xl bg-gradient-to-l from-sky-50/80 to-teal-50/80 border border-sky-100/50">
                <div className="flex items-center gap-2 mb-2">
                  <TrendingUp className="h-4 w-4 text-sky-600" />
                  <span className="text-sm font-medium text-gray-900">حساب الأداء العام</span>
                </div>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div>
                    <p className="text-[10px] text-muted-foreground">اختبارات (40%)</p>
                    <p className="text-sm font-bold text-sky-700 dark:text-sky-300">{Math.round(data.quizAvg * 0.4)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground">حضور (30%)</p>
                    <p className="text-sm font-bold text-teal-700 dark:text-teal-300">{Math.round(data.attendanceRate * 0.3)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground">مهمات (30%)</p>
                    <p className="text-sm font-bold text-amber-700 dark:text-amber-300">{Math.round(data.assignmentCompletion * 0.3)}</p>
                  </div>
                </div>
              </div>

              {/* ── Enhanced Activity Timeline (مسار الطالب) ── */}
              {data.recentActivities.length > 0 && (
                <div className="p-3 rounded-xl bg-gradient-to-l from-teal-50/60 to-white border border-teal-100/50">
                  <div className="flex items-center gap-2 mb-3">
                    <Route className="h-4 w-4 text-teal-600" />
                    <span className="text-sm font-medium text-gray-900">مسار الطالب</span>
                    <Badge variant="secondary" className="text-[9px] px-1.5 py-0 bg-teal-50 dark:bg-teal-950/30 text-teal-700 dark:text-teal-300 border-teal-100 dark:border-teal-800">
                      {data.recentActivities.length} نشاط
                    </Badge>
                  </div>
                  <div className="relative space-y-0 max-h-52 overflow-y-auto custom-scrollbar">
                    {/* Timeline line */}
                    <div className="absolute right-[15px] top-2 bottom-2 w-0.5 bg-gradient-to-b from-teal-200 via-sky-200 to-amber-200" />

                    {data.recentActivities.map((item, idx) => {
                      const iconMap = {
                        attendance: <CheckCircle2 className="h-3.5 w-3.5 text-teal-600" />,
                        quiz: <FileText className="h-3.5 w-3.5 text-sky-600" />,
                        assignment: <ClipboardList className="h-3.5 w-3.5 text-amber-600" />,
                      };
                      const bgMap = {
                        attendance: 'bg-teal-50 dark:bg-teal-950/30 ring-teal-100',
                        quiz: 'bg-sky-50 dark:bg-sky-950/30 ring-sky-100',
                        assignment: 'bg-amber-50 dark:bg-amber-950/30 ring-amber-100',
                      };
                      const dotColorMap = {
                        attendance: 'bg-teal-400',
                        quiz: 'bg-sky-400',
                        assignment: 'bg-amber-400',
                      };
                      const badgeMap = {
                        attendance: { label: 'حضور', className: 'bg-teal-50 dark:bg-teal-950/30 text-teal-700 dark:text-teal-300 border-teal-100 dark:border-teal-800' },
                        quiz: { label: 'اختبار', className: 'bg-sky-50 dark:bg-sky-950/30 text-sky-700 dark:text-sky-300 border-sky-100 dark:border-sky-800' },
                        assignment: { label: 'مهمة', className: 'bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300 border-amber-100 dark:border-amber-800' },
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
                            <span className={`absolute -top-0.5 -left-0.5 h-2 w-2 rounded-full ${dotColorMap[item.type]} ring-2 ring-white`} />
                          </div>
                          <div className="flex-1 min-w-0 pt-0.5">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <p className="text-xs font-medium text-gray-900">{item.title}</p>
                              <Badge variant="secondary" className={`text-[9px] px-1 py-0 ${badgeMap[item.type].className}`}>
                                {badgeMap[item.type].label}
                              </Badge>
                            </div>
                            <p className="text-[11px] text-muted-foreground truncate">{item.detail}</p>
                            <p className="text-[9px] text-gray-300 mt-0.5">
                              {item.date && item.date !== new Date().toISOString()
                                ? formatDate(item.date)
                                : 'تاريخ غير متوفر'}
                            </p>
                          </div>
                        </motion.div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

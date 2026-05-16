'use client';

import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Activity,
  TrendingUp,
  Award,
  Users,
  Filter,
  ArrowUpDown,
  ChevronDown,
  ChevronUp,
  BarChart3,
  ClipboardList,
  Clock,
  CheckCircle2,
  XCircle,
  FileText,
  Search,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import type { UserProfile, Score, Quiz } from '@/lib/types';
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
  teacherAssignments: { id: string; max_score: number }[];
  teacherAttendanceSessions: { id: string; subject_id: string }[];
  teacherAttendanceRecords: { id: string; session_id: string; student_id: string }[];
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
  visible: { opacity: 1, y: 0, transition: { duration: 0.35, ease: 'easeOut' } },
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
    bgColor: 'bg-emerald-50',
    ringColor: 'ring-emerald-100',
    textColor: 'text-emerald-700',
    icon: '★',
  },
  {
    key: 'good',
    label: 'جيد',
    color: 'bg-sky-500',
    bgColor: 'bg-sky-50',
    ringColor: 'ring-sky-100',
    textColor: 'text-sky-700',
    icon: '◆',
  },
  {
    key: 'average',
    label: 'متوسط',
    color: 'bg-amber-500',
    bgColor: 'bg-amber-50',
    ringColor: 'ring-amber-100',
    textColor: 'text-amber-700',
    icon: '●',
  },
  {
    key: 'weak',
    label: 'ضعيف',
    color: 'bg-rose-500',
    bgColor: 'bg-rose-50',
    ringColor: 'ring-rose-100',
    textColor: 'text-rose-700',
    icon: '▼',
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
// Student Performance Data
// -------------------------------------------------------
interface StudentPerformanceData {
  student: UserProfile;
  quizAvg: number;
  attendanceRate: number;
  assignmentCompletion: number;
  overallPerformance: number;
  level: PerformanceLevel;
  studentScores: Score[];
  studentSubmissions: { id: string; assignment_id: string; student_id: string; score: number | null; status: string }[];
  attendedSessionIds: Set<string>;
  recentActivities: Array<{ date: string; type: 'quiz' | 'attendance' | 'assignment'; title: string; detail: string }>;
}

// -------------------------------------------------------
// Sort options
// -------------------------------------------------------
type SortOption = 'name' | 'performance' | 'attendance' | 'quiz';

const SORT_OPTIONS: { key: SortOption; label: string }[] = [
  { key: 'name', label: 'الاسم' },
  { key: 'performance', label: 'الأداء العام' },
  { key: 'attendance', label: 'الحضور' },
  { key: 'quiz', label: 'الاختبارات' },
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
}: TeacherStudentTrackingSectionProps) {
  // ─── Local state ───
  const [filterLevel, setFilterLevel] = useState<PerformanceLevel | 'all'>('all');
  const [sortBy, setSortBy] = useState<SortOption>('performance');
  const [expandedStudentId, setExpandedStudentId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

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

      // Recent activities
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
        recentActivities.push({
          date: new Date().toISOString(), // Records don't have checked_in_at in this data shape
          type: 'attendance',
          title: 'تسجيل حضور',
          detail: 'جلسة حضور',
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
        studentScores,
        studentSubmissions,
        attendedSessionIds,
        recentActivities: recentActivities.slice(0, 10),
      };
    });
  }, [students, scores, teacherSubmissions, teacherAssignments, teacherAttendanceSessions, teacherAttendanceRecords]);

  // ─── Overview stats ───
  const overviewStats = useMemo(() => {
    const totalStudents = students.length;
    const avgPerformance = totalStudents > 0
      ? studentPerformanceData.reduce((sum, d) => sum + d.overallPerformance, 0) / totalStudents
      : 0;
    const avgAttendance = totalStudents > 0
      ? studentPerformanceData.reduce((sum, d) => sum + d.attendanceRate, 0) / totalStudents
      : 0;
    const topPerformers = studentPerformanceData.filter(d => d.level === 'excellent').length;
    return { totalStudents, avgPerformance, avgAttendance, topPerformers };
  }, [students.length, studentPerformanceData]);

  // ─── Classification counts ───
  const classificationCounts = useMemo(() => {
    const counts: Record<PerformanceLevel, number> = { excellent: 0, good: 0, average: 0, weak: 0 };
    studentPerformanceData.forEach(d => { counts[d.level]++; });
    return counts;
  }, [studentPerformanceData]);

  // ─── Filtered & sorted students ───
  const filteredStudents = useMemo(() => {
    let data = [...studentPerformanceData];

    // Filter by level
    if (filterLevel !== 'all') {
      data = data.filter(d => d.level === filterLevel);
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
        default:
          return 0;
      }
    });

    return data;
  }, [studentPerformanceData, filterLevel, searchQuery, sortBy]);

  // ─── Toggle expand ───
  const toggleExpand = (studentId: string) => {
    setExpandedStudentId(prev => prev === studentId ? null : studentId);
  };

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="space-y-6"
    >
      {/* Header */}
      <motion.div variants={itemVariants} className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-sky-600 to-teal-600 shadow-lg shadow-sky-600/25">
          <Activity className="h-5 w-5 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">تتبع الطلاب</h1>
          <p className="text-sm text-muted-foreground">متابعة أداء وحضور وتقدم الطلاب</p>
        </div>
      </motion.div>

      {/* ── Overview Cards ── */}
      <motion.div variants={itemVariants}>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          {/* Total Students */}
          <Card className="border-sky-100/50 shadow-sm">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-50 ring-2 ring-sky-100">
                  <Users className="h-5 w-5 text-sky-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-sky-800">{overviewStats.totalStudents}</p>
                  <p className="text-xs text-muted-foreground">إجمالي الطلاب</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Average Performance */}
          <Card className="border-teal-100/50 shadow-sm">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-50 ring-2 ring-teal-100">
                  <TrendingUp className="h-5 w-5 text-teal-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-teal-700">{Math.round(overviewStats.avgPerformance)}%</p>
                  <p className="text-xs text-muted-foreground">متوسط الأداء</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Attendance Rate */}
          <Card className="border-amber-100/50 shadow-sm">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50 ring-2 ring-amber-100">
                  <Clock className="h-5 w-5 text-amber-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-amber-700">{Math.round(overviewStats.avgAttendance)}%</p>
                  <p className="text-xs text-muted-foreground">معدل الحضور</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Top Performers */}
          <Card className="border-emerald-100/50 shadow-sm">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 ring-2 ring-emerald-100">
                  <Award className="h-5 w-5 text-emerald-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-emerald-700">{overviewStats.topPerformers}</p>
                  <p className="text-xs text-muted-foreground">ممتاز</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </motion.div>

      {/* ── Classification Distribution ── */}
      <motion.div variants={itemVariants}>
        <Card className="border-sky-100/50 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <Filter className="h-5 w-5 text-sky-600" />
              تصنيف الطلاب حسب الأداء
            </CardTitle>
          </CardHeader>
          <CardContent>
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
                        : 'bg-white border-gray-100 hover:border-gray-200 text-gray-600'
                    }`}
                  >
                    <span className={`text-3xl font-bold ${isActive ? level.textColor : 'text-gray-400'}`}>
                      {count}
                    </span>
                    <span className={`text-sm font-medium ${isActive ? level.textColor : 'text-gray-500'}`}>
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

            {/* Active filter indicator */}
            {filterLevel !== 'all' && (
              <motion.div
                initial={{ opacity: 0, y: -5 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-3 flex items-center gap-2"
              >
                <span className="text-xs text-muted-foreground">عرض:</span>
                <Badge
                  variant="secondary"
                  className={`${getPerformanceLevelConfig(filterLevel).bgColor} ${getPerformanceLevelConfig(filterLevel).textColor} cursor-pointer`}
                  onClick={() => setFilterLevel('all')}
                >
                  {getPerformanceLevelConfig(filterLevel).label} ({classificationCounts[filterLevel]})
                  <XCircle className="h-3 w-3 mr-1" />
                </Badge>
                <button
                  onClick={() => setFilterLevel('all')}
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
                    className="w-full sm:w-48 h-9 pr-9 pl-3 rounded-lg border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-sky-200 focus:border-sky-300 transition-all"
                    dir="rtl"
                  />
                </div>

                {/* Sort dropdown */}
                <div className="relative">
                  <select
                    value={sortBy}
                    onChange={e => setSortBy(e.target.value as SortOption)}
                    className="h-9 pl-3 pr-8 rounded-lg border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-sky-200 focus:border-sky-300 appearance-none cursor-pointer"
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
// Student Card Component
// -------------------------------------------------------
function StudentCard({
  data,
  isExpanded,
  onToggle,
  totalSessions,
  totalAssignments,
}: {
  data: StudentPerformanceData;
  isExpanded: boolean;
  onToggle: () => void;
  totalSessions: number;
  totalAssignments: number;
}) {
  const levelConfig = getPerformanceLevelConfig(data.level);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
      className={`rounded-xl border-2 transition-all duration-200 ${
        isExpanded
          ? `${levelConfig.bgColor} ${levelConfig.ringColor} ring-1`
          : 'border-gray-100 hover:border-gray-200 hover:bg-gray-50/50'
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
                <div className="flex flex-col items-center gap-1.5 p-3 rounded-xl bg-white/80 border border-gray-100/80">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-100">
                    <BarChart3 className="h-4 w-4 text-sky-700" />
                  </div>
                  <span className="text-lg font-bold text-sky-800">{Math.round(data.quizAvg)}%</span>
                  <span className="text-[10px] text-muted-foreground text-center leading-tight">متوسط الاختبارات</span>
                </div>

                {/* Attendance rate */}
                <div className="flex flex-col items-center gap-1.5 p-3 rounded-xl bg-white/80 border border-gray-100/80">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-100">
                    <CheckCircle2 className="h-4 w-4 text-teal-700" />
                  </div>
                  <span className="text-lg font-bold text-teal-700">{Math.round(data.attendanceRate)}%</span>
                  <span className="text-[10px] text-muted-foreground text-center leading-tight">نسبة الحضور</span>
                  <span className="text-[9px] text-muted-foreground">
                    {data.attendedSessionIds.size}/{totalSessions} جلسة
                  </span>
                </div>

                {/* Assignment completion */}
                <div className="flex flex-col items-center gap-1.5 p-3 rounded-xl bg-white/80 border border-gray-100/80">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-100">
                    <ClipboardList className="h-4 w-4 text-amber-700" />
                  </div>
                  <span className="text-lg font-bold text-amber-700">{Math.round(data.assignmentCompletion)}%</span>
                  <span className="text-[10px] text-muted-foreground text-center leading-tight">إكمال المهام</span>
                  <span className="text-[9px] text-muted-foreground">
                    {data.studentSubmissions.filter(s => s.status === 'graded' || s.status === 'submitted').length}/{totalAssignments} مهمة
                  </span>
                </div>
              </div>

              {/* Weighted performance breakdown */}
              <div className="p-3 rounded-xl bg-gradient-to-l from-sky-50/80 to-teal-50/80 border border-sky-100/50">
                <div className="flex items-center gap-2 mb-2">
                  <TrendingUp className="h-4 w-4 text-sky-600" />
                  <span className="text-sm font-medium text-gray-900">حساب الأداء العام</span>
                </div>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div>
                    <p className="text-[10px] text-muted-foreground">اختبارات (40%)</p>
                    <p className="text-sm font-bold text-sky-700">{Math.round(data.quizAvg * 0.4)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground">حضور (30%)</p>
                    <p className="text-sm font-bold text-teal-700">{Math.round(data.attendanceRate * 0.3)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground">مهمات (30%)</p>
                    <p className="text-sm font-bold text-amber-700">{Math.round(data.assignmentCompletion * 0.3)}</p>
                  </div>
                </div>
              </div>

              {/* Recent activities */}
              {data.recentActivities.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <Activity className="h-4 w-4 text-sky-600" />
                    <span className="text-sm font-medium text-gray-900">النشاط الأخير</span>
                  </div>
                  <div className="relative space-y-0 max-h-48 overflow-y-auto custom-scrollbar">
                    {/* Timeline line */}
                    <div className="absolute right-[15px] top-2 bottom-2 w-0.5 bg-sky-100" />

                    {data.recentActivities.map((item, idx) => {
                      const iconMap = {
                        attendance: <CheckCircle2 className="h-3.5 w-3.5 text-teal-600" />,
                        quiz: <FileText className="h-3.5 w-3.5 text-sky-600" />,
                        assignment: <ClipboardList className="h-3.5 w-3.5 text-amber-600" />,
                      };
                      const bgMap = {
                        attendance: 'bg-teal-50 ring-teal-100',
                        quiz: 'bg-sky-50 ring-sky-100',
                        assignment: 'bg-amber-50 ring-amber-100',
                      };
                      const badgeMap = {
                        attendance: { label: 'حضور', className: 'bg-teal-50 text-teal-700 border-teal-100' },
                        quiz: { label: 'اختبار', className: 'bg-sky-50 text-sky-700 border-sky-100' },
                        assignment: { label: 'مهمة', className: 'bg-amber-50 text-amber-700 border-amber-100' },
                      };

                      return (
                        <div key={idx} className="relative flex items-start gap-2.5 py-1.5 px-1">
                          <div className={`relative z-10 flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full ring-2 ${bgMap[item.type]}`}>
                            {iconMap[item.type]}
                          </div>
                          <div className="flex-1 min-w-0 pt-0.5">
                            <div className="flex items-center gap-1.5">
                              <p className="text-xs font-medium text-gray-900">{item.title}</p>
                              <Badge variant="secondary" className={`text-[9px] px-1 py-0 ${badgeMap[item.type].className}`}>
                                {badgeMap[item.type].label}
                              </Badge>
                            </div>
                            <p className="text-[11px] text-muted-foreground truncate">{item.detail}</p>
                          </div>
                        </div>
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

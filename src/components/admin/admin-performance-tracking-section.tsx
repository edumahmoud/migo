'use client';

import { useMemo, useState, useCallback, useEffect } from 'react';
import { motion } from 'framer-motion';
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
  BarChart,
  Bar,
  Legend,
} from 'recharts';
import {
  Activity,
  Users,
  BookOpen,
  TrendingUp,
  AlertTriangle,
  Award,
  Download,
  Search,
  Info,
  GraduationCap,
  ArrowUpRight,
  ArrowDownRight,
  ArrowRight,
  LayoutDashboard,
  Clock,
  AlertOctagon,
  Flame,
  Target,
  Zap,
  ShieldCheck,
  ChevronLeft,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Input } from '@/components/ui/input';
import { supabase } from '@/lib/supabase';
import { useTranslations } from '@/i18n/use-translations';
import { useLocaleStore } from '@/i18n/locale-store';
import {
  computeAllMetrics,
  computeCohortAnalytics,
  type StudentPerformanceMetrics,
  type PerformanceLevel,
  type RiskLevel,
  type GrowthTrend,
  getPerformanceLevelConfig,
  getRiskLevelConfig,
  getGrowthTrendConfig,
  PERFORMANCE_LEVELS,
  type SubjectPerformanceData,
} from '@/lib/performance-calculator';
import UserAvatar from '@/components/shared/user-avatar';
import type { UserProfile, Subject, Score, Quiz } from '@/lib/types';

// Animation variants
const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.08 } },
};

const itemVariants = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.35, ease: 'easeOut' as const } },
};

// Course status helper
function getCourseStatusConfig(pct: number, t: (key: string) => string) {
  if (pct >= 80) return { label: t('admin.performanceTrackingAdvanced'), className: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400 border-emerald-100 dark:border-emerald-900/60', dotClass: 'bg-emerald-500' };
  if (pct >= 60) return { label: t('admin.performanceTrackingOnTrack'), className: 'bg-sky-50 text-sky-700 dark:bg-sky-900/15 dark:text-sky-400 border-sky-100 dark:border-sky-900/60', dotClass: 'bg-sky-500' };
  if (pct >= 40) return { label: t('admin.performanceTrackingNeedsAttention'), className: 'bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400 border-amber-100 dark:border-amber-900/60', dotClass: 'bg-amber-500' };
  return { label: t('admin.performanceTrackingAtRisk'), className: 'bg-rose-50 text-rose-700 dark:bg-rose-900/20 dark:text-rose-400 border-rose-100 dark:border-rose-900/60', dotClass: 'bg-rose-500' };
}

// Pie chart label renderer
const RADIAN = Math.PI / 180;
function renderCustomizedLabel({ cx, cy, midAngle, innerRadius, outerRadius, percent }: { cx: number; cy: number; midAngle: number; innerRadius: number; outerRadius: number; percent: number }) {
  if (percent < 0.05) return null;
  const radius = innerRadius + (outerRadius - innerRadius) * 0.5;
  const x = cx + radius * Math.cos(-midAngle * RADIAN);
  const y = cy + radius * Math.sin(-midAngle * RADIAN);
  return (
    <text x={x} y={y} fill="white" textAnchor="middle" dominantBaseline="central" className="text-[10px] font-bold">
      {`${(percent * 100).toFixed(0)}%`}
    </text>
  );
}

interface AdminPerformanceTrackingSectionProps {
  profile: UserProfile;
}

export default function AdminPerformanceTrackingSection({ profile }: AdminPerformanceTrackingSectionProps) {
  const { t } = useTranslations();
  const locale = useLocaleStore((s) => s.locale);
  const [activeTrackingTab, setActiveTrackingTab] = useState<'overview' | 'courses' | 'students' | 'attendance' | 'risk'>('overview');
  const [activeStudentSubTab, setActiveStudentSubTab] = useState<'students' | 'teachers'>('students');
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [courseDrillDown, setCourseDrillDown] = useState<string | null>(null);
  const [students, setStudents] = useState<UserProfile[]>([]);
  const [teachers, setTeachers] = useState<UserProfile[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [scores, setScores] = useState<Score[]>([]);
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [teacherSubmissions, setTeacherSubmissions] = useState<{ id: string; assignment_id: string; student_id: string; score: number | null; status: string; submitted_at?: string }[]>([]);
  const [teacherAssignments, setTeacherAssignments] = useState<{ id: string; max_score: number; subject_id: string | null; due_date?: string }[]>([]);
  const [teacherAttendanceSessions, setTeacherAttendanceSessions] = useState<{ id: string; subject_id: string }[]>([]);
  const [teacherAttendanceRecords, setTeacherAttendanceRecords] = useState<{ id: string; session_id: string; student_id: string; attendance_status?: 'present' | 'late' | 'partial' | 'absent' }[]>([]);

  // Fetch all data on mount
  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      try {
        const [studentsRes, teachersRes, subjectsRes, scoresRes, quizzesRes, subsRes, assignRes, sessionsRes, recordsRes] = await Promise.all([
          supabase.from('users').select('*').eq('role', 'student'),
          supabase.from('users').select('*').eq('role', 'teacher'),
          supabase.from('subjects').select('*'),
          supabase.from('scores').select('*'),
          supabase.from('quizzes').select('*'),
          supabase.from('submissions').select('*'),
          supabase.from('assignments').select('*'),
          supabase.from('attendance_sessions').select('*'),
          supabase.from('attendance_records').select('*'),
        ]);

        setStudents((studentsRes.data as UserProfile[]) || []);
        setTeachers((teachersRes.data as UserProfile[]) || []);
        setSubjects((subjectsRes.data as Subject[]) || []);
        setScores((scoresRes.data as Score[]) || []);
        setQuizzes((quizzesRes.data as Quiz[]) || []);
        setTeacherSubmissions(subsRes.data || []);
        setTeacherAssignments(assignRes.data || []);
        setTeacherAttendanceSessions(sessionsRes.data || []);
        setTeacherAttendanceRecords(recordsRes.data || []);
      } catch (err) {
        console.error('Error fetching admin tracking data:', err);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  // ─── Subject name lookup ───
  const subjectNameMap = useMemo(() => {
    const map = new Map<string, string>();
    subjects.forEach(s => map.set(s.id, s.name));
    return map;
  }, [subjects]);

  // ─── Compute student performance data (system-wide) ───
  const studentPerformanceData = useMemo(() => {
    return students.map(student => {
      const metrics = computeAllMetrics({
        scores: scores.map(s => ({ score: s.score, total: s.total, completed_at: s.completed_at, student_id: s.student_id })),
        attendanceSessions: teacherAttendanceSessions.map(s => ({ id: s.id })),
        attendanceRecords: teacherAttendanceRecords.map(r => ({ session_id: r.session_id, student_id: r.student_id, attendance_status: r.attendance_status })),
        submissions: teacherSubmissions.map(s => ({ assignment_id: s.assignment_id, student_id: s.student_id, score: s.score, status: s.status, submitted_at: s.submitted_at || new Date().toISOString() })),
        assignments: teacherAssignments.map(a => ({ id: a.id, max_score: a.max_score, due_date: a.due_date })),
        studentId: student.id,
      });
      return { student, metrics };
    });
  }, [students, scores, teacherAttendanceSessions, teacherAttendanceRecords, teacherSubmissions, teacherAssignments]);

  // ─── Cohort analytics (system-wide aggregated stats) ───
  const cohortAnalytics = useMemo(() => {
    return computeCohortAnalytics(studentPerformanceData.map(d => d.metrics));
  }, [studentPerformanceData]);

  // ─── Compute teacher stats ───
  const teacherStatsData = useMemo(() => {
    return teachers.map(teacher => {
      const teacherSubjects = subjects.filter(s => s.teacher_id === teacher.id);
      const teacherSubjectIds = new Set(teacherSubjects.map(s => s.id));

      const teacherStudents = studentPerformanceData.filter(sp => {
        const studentScores = scores.filter(s => s.student_id === sp.student.id);
        return studentScores.some(s => {
          const quiz = quizzes.find(q => q.id === s.quiz_id);
          return quiz && teacherSubjectIds.has(quiz.subject_id || '');
        });
      });

      const avgPerformance = teacherStudents.length > 0
        ? teacherStudents.reduce((sum, d) => sum + d.metrics.overallPerformance, 0) / teacherStudents.length
        : 0;
      const avgAttendance = teacherStudents.length > 0
        ? teacherStudents.reduce((sum, d) => sum + d.metrics.attendanceScore, 0) / teacherStudents.length
        : 0;
      const atRiskCount = teacherStudents.filter(d => d.metrics.riskLevel === 'atRisk' || d.metrics.riskLevel === 'concern').length;

      return { teacher, subjectCount: teacherSubjects.length, studentCount: teacherStudents.length, avgPerformance, avgAttendance, atRiskCount };
    });
  }, [teachers, subjects, studentPerformanceData, scores, quizzes]);

  // ─── Compute course stats ───
  const courseStatsData = useMemo(() => {
    return subjects.map(subject => {
      const subjectStudentIds = new Set<string>();
      scores.filter(s => {
        const quiz = quizzes.find(q => q.id === s.quiz_id);
        return quiz?.subject_id === subject.id;
      }).forEach(s => subjectStudentIds.add(s.student_id));

      const subjectStudents = studentPerformanceData.filter(sp => subjectStudentIds.has(sp.student.id));

      const subjectScores = scores.filter(s => {
        const quiz = quizzes.find(q => q.id === s.quiz_id);
        return quiz?.subject_id === subject.id;
      });
      const avgScore = subjectScores.length > 0
        ? subjectScores.reduce((sum, s) => sum + (s.total > 0 ? (s.score / s.total) * 100 : 0), 0) / subjectScores.length
        : 0;
      const avgAttendance = subjectStudents.length > 0
        ? subjectStudents.reduce((sum, d) => sum + d.metrics.attendanceScore, 0) / subjectStudents.length
        : 0;
      const atRiskCount = subjectStudents.filter(d => d.metrics.riskLevel === 'atRisk' || d.metrics.riskLevel === 'concern').length;
      const difficulty = Math.max(0, 100 - avgScore);
      const teacherObj = teachers.find(t => t.id === subject.teacher_id);

      return { subject, enrollmentCount: subjectStudentIds.size, avgPerformance: avgScore, avgAttendance, atRiskCount, difficulty, studentCount: subjectStudentIds.size, teacherName: teacherObj?.name || '' };
    });
  }, [subjects, scores, quizzes, studentPerformanceData, teachers]);

  // ─── Overview stats ───
  const overviewStats = useMemo(() => {
    const totalStudents = students.length;
    const totalTeachers = teachers.length;
    const totalCourses = subjects.length;
    const atRiskCount = studentPerformanceData.filter(d => d.metrics.riskLevel === 'atRisk' || d.metrics.riskLevel === 'concern').length;
    const advancedCount = studentPerformanceData.filter(d => d.metrics.overallPerformance >= 80).length;
    const avgPerformance = totalStudents > 0
      ? studentPerformanceData.reduce((sum, d) => sum + d.metrics.overallPerformance, 0) / totalStudents
      : 0;
    return { totalStudents, totalTeachers, totalCourses, atRiskCount, advancedCount, avgPerformance };
  }, [students.length, teachers.length, subjects.length, studentPerformanceData]);

  // ─── Performance trend data (monthly, system-wide) ───
  const performanceTrendData = useMemo(() => {
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

  // ─── Level distribution pie data ───
  const levelDistributionData = useMemo(() => {
    return [
      { name: locale === 'ar' ? 'ممتاز' : 'Excellent', value: cohortAnalytics.performanceDistribution.excellent, color: '#10b981' },
      { name: locale === 'ar' ? 'جيد جداً' : 'Very Good', value: cohortAnalytics.performanceDistribution.veryGood, color: '#0ea5e9' },
      { name: locale === 'ar' ? 'جيد' : 'Good', value: cohortAnalytics.performanceDistribution.good, color: '#14b8a6' },
      { name: locale === 'ar' ? 'مقبول' : 'Acceptable', value: cohortAnalytics.performanceDistribution.acceptable, color: '#f59e0b' },
      { name: locale === 'ar' ? 'ضعيف' : 'Weak', value: cohortAnalytics.performanceDistribution.weak, color: '#ef4444' },
    ].filter(d => d.value > 0);
  }, [cohortAnalytics, locale]);

  // ─── Performance distribution histogram ───
  const performanceDistributionData = useMemo(() => {
    const buckets = [
      { range: '0-20%', min: 0, max: 20, count: 0, color: '#ef4444' },
      { range: '20-40%', min: 20, max: 40, count: 0, color: '#f97316' },
      { range: '40-60%', min: 40, max: 60, count: 0, color: '#f59e0b' },
      { range: '60-80%', min: 60, max: 80, count: 0, color: '#0ea5e9' },
      { range: '80-100%', min: 80, max: 101, count: 0, color: '#10b981' },
    ];
    studentPerformanceData.forEach(d => {
      const pct = Math.round(d.metrics.overallPerformance);
      const bucket = buckets.find(b => pct >= b.min && pct < b.max);
      if (bucket) bucket.count++;
    });
    return buckets;
  }, [studentPerformanceData]);

  // ─── Top/Bottom 5 students ───
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

  // ─── Course comparison data ───
  const courseComparisonData = useMemo(() => {
    return courseStatsData
      .map(d => ({
        name: d.subject.name.length > 15 ? d.subject.name.slice(0, 15) + '…' : d.subject.name,
        fullName: d.subject.name,
        avg: Math.round(d.avgPerformance),
        avgAtt: Math.round(d.avgAttendance),
        difficulty: Math.round(d.difficulty),
        atRisk: d.atRiskCount,
        studentCount: d.studentCount,
        subjectId: d.subject.id,
      }))
      .sort((a, b) => b.avg - a.avg);
  }, [courseStatsData]);

  // ─── Attendance distribution pie ───
  const attendanceDistributionData = useMemo(() => {
    let present = 0, late = 0, absent = 0, partial = 0;
    teacherAttendanceRecords.forEach(r => {
      if (r.attendance_status === 'present') present++;
      else if (r.attendance_status === 'late') late++;
      else if (r.attendance_status === 'absent') absent++;
      else if (r.attendance_status === 'partial') partial++;
    });
    const total = present + late + absent + partial;
    if (total === 0) return [];
    return [
      { name: t('admin.adminTrackingPresent'), value: present, color: '#10b981' },
      { name: t('admin.adminTrackingLate'), value: late, color: '#f59e0b' },
      { name: t('admin.adminTrackingAbsent'), value: absent, color: '#ef4444' },
      { name: t('admin.adminTrackingPartial'), value: partial, color: '#0ea5e9' },
    ].filter(d => d.value > 0);
  }, [teacherAttendanceRecords, t]);

  // ─── Attendance trend data ───
  const attendanceTrendData = useMemo(() => {
    if (teacherAttendanceRecords.length === 0) return [];
    const sessionMap = new Map<string, { present: number; late: number; absent: number; total: number }>();
    teacherAttendanceRecords.forEach(r => {
      const session = teacherAttendanceSessions.find(s => s.id === r.session_id);
      if (!session) return;
      const subjectName = subjectNameMap.get(session.subject_id) || session.id.slice(0, 8);
      const entry = sessionMap.get(subjectName) || { present: 0, late: 0, absent: 0, total: 0 };
      entry.total++;
      if (r.attendance_status === 'present') entry.present++;
      else if (r.attendance_status === 'late') entry.late++;
      else if (r.attendance_status === 'absent') entry.absent++;
      sessionMap.set(subjectName, entry);
    });
    return Array.from(sessionMap.entries())
      .map(([name, data]) => ({
        name: name.length > 12 ? name.slice(0, 12) + '…' : name,
        present: data.total > 0 ? Math.round((data.present / data.total) * 100) : 0,
        late: data.total > 0 ? Math.round((data.late / data.total) * 100) : 0,
        absent: data.total > 0 ? Math.round((data.absent / data.total) * 100) : 0,
      })).slice(-10);
  }, [teacherAttendanceRecords, teacherAttendanceSessions, subjectNameMap]);

  // ─── Risk distribution pie ───
  const riskDistributionData = useMemo(() => {
    return [
      { name: locale === 'ar' ? 'سليم' : 'Healthy', value: cohortAnalytics.riskDistribution.healthy, color: '#10b981' },
      { name: locale === 'ar' ? 'مراقبة' : 'Monitor', value: cohortAnalytics.riskDistribution.monitor, color: '#f59e0b' },
      { name: locale === 'ar' ? 'قلق' : 'Concern', value: cohortAnalytics.riskDistribution.concern, color: '#f97316' },
      { name: locale === 'ar' ? 'في خطر' : 'At Risk', value: cohortAnalytics.riskDistribution.atRisk, color: '#ef4444' },
    ].filter(d => d.value > 0);
  }, [cohortAnalytics, locale]);

  // ─── Trend analysis: system-wide performance change detection ───
  const trendAnalysisData = useMemo(() => {
    if (scores.length === 0) return [];
    const getPeriodKey = (dateStr: string): string => {
      try {
        const date = new Date(dateStr);
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      } catch {
        return 'unknown';
      }
    };

    const result: { studentId: string; studentName: string; studentAvatar: string | null | undefined; previousScore: number; currentScore: number; change: number; direction: 'improved' | 'declined' | 'stable'; periodData: { period: string; score: number }[] }[] = [];

    for (const spd of studentPerformanceData) {
      const studentScores = scores.filter(s => s.student_id === spd.student.id);
      if (studentScores.length === 0) continue;

      const periodMap = new Map<string, { totalPct: number; count: number }>();
      studentScores.forEach(s => {
        if (s.total <= 0) return;
        const key = getPeriodKey(s.completed_at);
        const entry = periodMap.get(key) || { totalPct: 0, count: 0 };
        entry.totalPct += (s.score / s.total) * 100;
        entry.count++;
        periodMap.set(key, entry);
      });

      const sortedPeriods = Array.from(periodMap.entries()).sort(([a], [b]) => a.localeCompare(b));
      if (sortedPeriods.length < 2) continue;

      const periodData = sortedPeriods.map(([period, data]) => ({
        period,
        score: data.count > 0 ? Math.round(data.totalPct / data.count) : 0,
      }));

      const currentPeriod = periodData[periodData.length - 1];
      const previousPeriod = periodData[periodData.length - 2];
      const change = currentPeriod.score - previousPeriod.score;
      let direction: 'improved' | 'declined' | 'stable' = 'stable';
      if (change > 2) direction = 'improved';
      else if (change < -2) direction = 'declined';

      result.push({
        studentId: spd.student.id,
        studentName: spd.student.name,
        studentAvatar: spd.student.avatar_url,
        previousScore: previousPeriod.score,
        currentScore: currentPeriod.score,
        change,
        direction,
        periodData,
      });
    }

    const directionOrder = { declined: 0, improved: 1, stable: 2 };
    result.sort((a, b) => {
      if (directionOrder[a.direction] !== directionOrder[b.direction]) return directionOrder[a.direction] - directionOrder[b.direction];
      return Math.abs(b.change) - Math.abs(a.change);
    });

    return result;
  }, [scores, studentPerformanceData]);

  const trendSummary = useMemo(() => ({
    improved: trendAnalysisData.filter(d => d.direction === 'improved').length,
    declined: trendAnalysisData.filter(d => d.direction === 'declined').length,
    stable: trendAnalysisData.filter(d => d.direction === 'stable').length,
  }), [trendAnalysisData]);

  // ─── Sudden drop detection ───
  const suddenDropStudents = useMemo(() => trendAnalysisData.filter(d => d.change <= -10), [trendAnalysisData]);

  // ─── Improvement streak detection ───
  const improvementStreakStudents = useMemo(() => trendAnalysisData.filter(d => {
    if (d.periodData.length < 3) return false;
    const last3 = d.periodData.slice(-3);
    return last3[1].score > last3[0].score && last3[2].score > last3[1].score;
  }), [trendAnalysisData]);

  // ─── Engagement scores ───
  const engagementData = useMemo(() => {
    return studentPerformanceData.map(spd => {
      const engagement = Math.round((spd.metrics.attendanceScore * 0.5) + (spd.metrics.assignmentCompliance * 0.5));
      return { studentId: spd.student.id, studentName: spd.student.name, avatarUrl: spd.student.avatar_url, engagement, attendanceRate: spd.metrics.attendanceScore, complianceRate: spd.metrics.assignmentCompliance };
    }).sort((a, b) => b.engagement - a.engagement).slice(0, 20);
  }, [studentPerformanceData]);

  // ─── Filtered students/teachers/courses ───
  const filteredStudents = useMemo(() => {
    if (!searchQuery.trim()) return studentPerformanceData;
    const q = searchQuery.trim().toLowerCase();
    return studentPerformanceData.filter(d => d.student.name.toLowerCase().includes(q) || d.student.email?.toLowerCase().includes(q));
  }, [studentPerformanceData, searchQuery]);

  const filteredTeachers = useMemo(() => {
    if (!searchQuery.trim()) return teacherStatsData;
    const q = searchQuery.trim().toLowerCase();
    return teacherStatsData.filter(d => d.teacher.name.toLowerCase().includes(q) || d.teacher.email?.toLowerCase().includes(q));
  }, [teacherStatsData, searchQuery]);

  const filteredCourses = useMemo(() => {
    if (!searchQuery.trim()) return courseStatsData;
    const q = searchQuery.trim().toLowerCase();
    return courseStatsData.filter(d => d.subject.name.toLowerCase().includes(q));
  }, [courseStatsData, searchQuery]);

  // ─── Export function ───
  const handleExport = useCallback(async () => {
    const XLSX = await import('xlsx');

    const studentHeaders = [locale === 'ar' ? 'الاسم' : 'Name', locale === 'ar' ? 'البريد الإلكتروني' : 'Email', locale === 'ar' ? 'الأداء العام' : 'Overall', locale === 'ar' ? 'الحضور' : 'Attendance', locale === 'ar' ? 'الخطورة' : 'Risk', locale === 'ar' ? 'النمو' : 'Growth'];
    const studentRows = studentPerformanceData.map(d => [d.student.name, d.student.email, `${Math.round(d.metrics.overallPerformance)}%`, `${Math.round(d.metrics.attendanceScore)}%`, d.metrics.riskLevel, d.metrics.growthTrend]);

    const teacherHeaders = [locale === 'ar' ? 'الاسم' : 'Name', locale === 'ar' ? 'البريد الإلكتروني' : 'Email', locale === 'ar' ? 'عدد المقررات' : 'Courses', locale === 'ar' ? 'عدد الطلاب' : 'Students', locale === 'ar' ? 'متوسط الأداء' : 'Avg Performance', locale === 'ar' ? 'في خطر' : 'At Risk'];
    const teacherRows = teacherStatsData.map(d => [d.teacher.name, d.teacher.email, d.subjectCount, d.studentCount, `${Math.round(d.avgPerformance)}%`, d.atRiskCount]);

    const courseHeaders = [locale === 'ar' ? 'المقرر' : 'Course', locale === 'ar' ? 'المعلم' : 'Teacher', locale === 'ar' ? 'المسجلين' : 'Enrolled', locale === 'ar' ? 'متوسط الأداء' : 'Avg Performance', locale === 'ar' ? 'في خطر' : 'At Risk'];
    const courseRows = courseStatsData.map(d => [d.subject.name, d.teacherName, d.enrollmentCount, `${Math.round(d.avgPerformance)}%`, d.atRiskCount]);

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([studentHeaders, ...studentRows]), locale === 'ar' ? 'الطلاب' : 'Students');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([teacherHeaders, ...teacherRows]), locale === 'ar' ? 'المعلمين' : 'Teachers');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([courseHeaders, ...courseRows]), locale === 'ar' ? 'المقررات' : 'Courses');
    XLSX.writeFile(wb, `admin_tracking_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }, [studentPerformanceData, teacherStatsData, courseStatsData, locale]);

  // ─── Loading state ───
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-sky-200 border-t-sky-600" />
          <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
        </div>
      </div>
    );
  }

  return (
    <motion.div variants={containerVariants} initial="hidden" animate="visible" className="space-y-6">
      {/* ═══ Header ═══ */}
      <motion.div variants={itemVariants} className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-sky-600 to-teal-600 shadow-lg shadow-sky-600/25">
            <Activity className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-foreground">{t('admin.performanceTrackingTitle')}</h1>
            <p className="text-sm text-muted-foreground">{t('admin.performanceTrackingSubtitle')}</p>
          </div>
        </div>
        <motion.button
          whileHover={{ scale: 1.04 }}
          whileTap={{ scale: 0.96 }}
          onClick={handleExport}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-l from-sky-600 to-teal-600 text-white text-sm font-medium shadow-md shadow-sky-600/20 hover:shadow-lg transition-shadow"
        >
          <Download className="h-4 w-4" />
          <span className="hidden sm:inline">{t('teacher.trackingExportData')}</span>
        </motion.button>
      </motion.div>

      {/* ═══ Tab Navigation ═══ */}
      <motion.div variants={itemVariants}>
        <div className="flex items-center gap-1 bg-gray-100 dark:bg-gray-800/40 rounded-xl p-1 overflow-x-auto custom-scrollbar">
          {([
            { key: 'overview' as const, icon: LayoutDashboard, labelAr: 'نظرة عامة', labelEn: 'Overview' },
            { key: 'courses' as const, icon: BookOpen, labelAr: 'تحليل المقررات', labelEn: 'Courses Analytics' },
            { key: 'students' as const, icon: Users, labelAr: 'تحليل الطلاب', labelEn: 'Students Analytics' },
            { key: 'attendance' as const, icon: Clock, labelAr: 'الحضور والتفاعل', labelEn: 'Attendance & Engagement' },
            { key: 'risk' as const, icon: AlertOctagon, labelAr: 'المخاطر والرؤى', labelEn: 'Risk & Insights' },
          ] as const).map(tab => (
            <button
              key={tab.key}
              onClick={() => { setActiveTrackingTab(tab.key); setSearchQuery(''); setCourseDrillDown(null); }}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all whitespace-nowrap ${
                activeTrackingTab === tab.key
                  ? 'bg-white dark:bg-card text-gray-900 dark:text-gray-100 shadow-sm'
                  : 'text-gray-500 dark:text-muted-foreground hover:text-gray-700 dark:hover:text-gray-300'
              }`}
            >
              <tab.icon className="h-3.5 w-3.5" />
              {locale === 'ar' ? tab.labelAr : tab.labelEn}
              {tab.key === 'risk' && overviewStats.atRiskCount > 0 && (
                <span className="flex h-4 min-w-[16px] items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-bold text-white">{overviewStats.atRiskCount}</span>
              )}
            </button>
          ))}
        </div>
      </motion.div>

      {/* ══════════════════════════════════════════════════════════════════ */}
      {/* TAB 1: OVERVIEW DASHBOARD                                        */}
      {/* ══════════════════════════════════════════════════════════════════ */}
      {activeTrackingTab === 'overview' && (
        <>
          {/* ── KPI Cards Row ── */}
          <motion.div variants={itemVariants}>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4">
              <Card className="border-sky-100/50 shadow-sm">
                <CardContent className="p-3">
                  <div className="flex items-center gap-2">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-sky-50 dark:bg-sky-900/15">
                      <Users className="h-4 w-4 text-sky-600" />
                    </div>
                    <div>
                      <p className="text-xl font-bold text-sky-800 dark:text-sky-400">{overviewStats.totalStudents}</p>
                      <p className="text-[10px] text-muted-foreground">{t('admin.adminTrackingTotalStudents')}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card className="border-teal-100/50 shadow-sm">
                <CardContent className="p-3">
                  <div className="flex items-center gap-2">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-teal-50 dark:bg-teal-900/20">
                      <GraduationCap className="h-4 w-4 text-teal-600" />
                    </div>
                    <div>
                      <p className="text-xl font-bold text-teal-700 dark:text-teal-500">{overviewStats.totalTeachers}</p>
                      <p className="text-[10px] text-muted-foreground">{t('admin.adminTrackingTotalTeachers')}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card className="border-violet-100/50 shadow-sm">
                <CardContent className="p-3">
                  <div className="flex items-center gap-2">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-violet-50 dark:bg-violet-900/20">
                      <BookOpen className="h-4 w-4 text-violet-600" />
                    </div>
                    <div>
                      <p className="text-xl font-bold text-violet-700 dark:text-violet-500">{overviewStats.totalCourses}</p>
                      <p className="text-[10px] text-muted-foreground">{t('admin.adminTrackingTotalCourses')}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card className="border-amber-100/50 shadow-sm">
                <CardContent className="p-3">
                  <div className="flex items-center gap-2">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-50 dark:bg-amber-900/20">
                      <TrendingUp className="h-4 w-4 text-amber-600" />
                    </div>
                    <div>
                      <p className="text-xl font-bold text-amber-700 dark:text-amber-500">{Math.round(overviewStats.avgPerformance)}%</p>
                      <p className="text-[10px] text-muted-foreground">{t('admin.adminTrackingAvgPerformance')}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card className="border-rose-100/50 shadow-sm">
                <CardContent className="p-3">
                  <div className="flex items-center gap-2">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-rose-50 dark:bg-rose-900/20">
                      <AlertTriangle className="h-4 w-4 text-rose-600" />
                    </div>
                    <div>
                      <p className="text-xl font-bold text-rose-700 dark:text-rose-500">{overviewStats.atRiskCount}</p>
                      <p className="text-[10px] text-muted-foreground">{t('admin.adminTrackingAtRiskCount')}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card className="border-emerald-100/50 shadow-sm">
                <CardContent className="p-3">
                  <div className="flex items-center gap-2">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-50 dark:bg-emerald-900/20">
                      <Award className="h-4 w-4 text-emerald-600" />
                    </div>
                    <div>
                      <p className="text-xl font-bold text-emerald-700 dark:text-emerald-500">{overviewStats.advancedCount}</p>
                      <p className="text-[10px] text-muted-foreground">{t('admin.adminTrackingTopPerformers')}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </motion.div>

          {/* ── Charts Row: Performance Trend + Level Distribution ── */}
          <motion.div variants={itemVariants}>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Performance Trend Area Chart */}
              <Card className="border-sky-100/50 shadow-sm">
                <CardHeader className="pb-2 pt-4 px-4">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <TrendingUp className="h-4 w-4 text-sky-600" />
                    {t('admin.adminTrackingPerformanceTrend')}
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-4">
                  {performanceTrendData.length === 0 ? (
                    <div className="flex items-center justify-center h-48 text-muted-foreground text-xs">{t('common.noData')}</div>
                  ) : (
                    <ResponsiveContainer width="100%" height={220}>
                      <AreaChart data={performanceTrendData}>
                        <defs>
                          <linearGradient id="adminPerfGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#0ea5e9" stopOpacity={0.3} />
                            <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                        <XAxis dataKey="month" tick={{ fontSize: 10 }} stroke="#94a3b8" />
                        <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} stroke="#94a3b8" />
                        <Tooltip formatter={(value: number) => `${value}%` as never} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                        <Area type="monotone" dataKey="performance" stroke="#0ea5e9" strokeWidth={2} fill="url(#adminPerfGrad)" />
                      </AreaChart>
                    </ResponsiveContainer>
                  )}
                </CardContent>
              </Card>

              {/* Level Distribution Pie Chart */}
              <Card className="border-sky-100/50 shadow-sm">
                <CardHeader className="pb-2 pt-4 px-4">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <Target className="h-4 w-4 text-teal-600" />
                    {t('admin.adminTrackingLevelDistribution')}
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-4">
                  {levelDistributionData.length === 0 ? (
                    <div className="flex items-center justify-center h-48 text-muted-foreground text-xs">{t('common.noData')}</div>
                  ) : (
                    <ResponsiveContainer width="100%" height={220}>
                      <PieChart>
                        <Pie data={levelDistributionData} cx="50%" cy="50%" outerRadius={80} innerRadius={35} dataKey="value" labelLine={false} label={renderCustomizedLabel}>
                          {levelDistributionData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip formatter={(value: number) => value as never} />
                        <Legend wrapperStyle={{ fontSize: 10 }} />
                      </PieChart>
                    </ResponsiveContainer>
                  )}
                </CardContent>
              </Card>
            </div>
          </motion.div>

          {/* ── Performance Distribution Bar Chart ── */}
          <motion.div variants={itemVariants}>
            <Card className="border-sky-100/50 shadow-sm">
              <CardHeader className="pb-2 pt-4 px-4">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Activity className="h-4 w-4 text-violet-600" />
                  {t('admin.adminTrackingPerformanceDistribution')}
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={performanceDistributionData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="range" tick={{ fontSize: 10 }} stroke="#94a3b8" />
                    <YAxis tick={{ fontSize: 10 }} stroke="#94a3b8" />
                    <Tooltip formatter={(value: number) => value as never} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                    <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                      {performanceDistributionData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </motion.div>

          {/* ── Top 5 / Bottom 5 Students ── */}
          <motion.div variants={itemVariants}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Top 5 */}
              <Card className="border-emerald-100/50 shadow-sm">
                <CardHeader className="pb-2 pt-4 px-4">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2 text-emerald-700 dark:text-emerald-500">
                    <Award className="h-4 w-4" />
                    {t('admin.adminTrackingTopStudents')}
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-4">
                  <div className="space-y-2">
                    {topStudents.map(({ student, metrics }, idx) => (
                      <div key={student.id} className="flex items-center gap-2 p-2 rounded-lg bg-emerald-50/50 dark:bg-emerald-900/10">
                        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 text-[10px] font-bold">{idx + 1}</span>
                        <UserAvatar name={student.name} avatarUrl={student.avatar_url} size="xs" />
                        <span className="text-xs font-medium truncate flex-1">{student.name}</span>
                        <span className="text-xs font-bold text-emerald-700 dark:text-emerald-400">{Math.round(metrics.overallPerformance)}%</span>
                      </div>
                    ))}
                    {topStudents.length === 0 && <p className="text-xs text-muted-foreground text-center py-4">{t('common.noData')}</p>}
                  </div>
                </CardContent>
              </Card>

              {/* Bottom 5 */}
              <Card className="border-rose-100/50 shadow-sm">
                <CardHeader className="pb-2 pt-4 px-4">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2 text-rose-700 dark:text-rose-500">
                    <AlertTriangle className="h-4 w-4" />
                    {t('admin.adminTrackingBottomStudents')}
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-4">
                  <div className="space-y-2">
                    {bottomStudents.map(({ student, metrics }, idx) => (
                      <div key={student.id} className="flex items-center gap-2 p-2 rounded-lg bg-rose-50/50 dark:bg-rose-900/10">
                        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-400 text-[10px] font-bold">{idx + 1}</span>
                        <UserAvatar name={student.name} avatarUrl={student.avatar_url} size="xs" />
                        <span className="text-xs font-medium truncate flex-1">{student.name}</span>
                        <span className="text-xs font-bold text-rose-700 dark:text-rose-400">{Math.round(metrics.overallPerformance)}%</span>
                      </div>
                    ))}
                    {bottomStudents.length === 0 && <p className="text-xs text-muted-foreground text-center py-4">{t('common.noData')}</p>}
                  </div>
                </CardContent>
              </Card>
            </div>
          </motion.div>

          {/* ── System Health Bar ── */}
          <motion.div variants={itemVariants}>
            <Card className="border-sky-100/50 shadow-sm">
              <CardContent className="p-4">
                <h3 className="text-sm font-bold text-foreground mb-3 flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-sky-600" />
                  {t('admin.adminTrackingSystemHealth')}
                </h3>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="text-center">
                    <p className="text-xs text-muted-foreground mb-1">{locale === 'ar' ? 'متوسط الحضور' : 'Avg Attendance'}</p>
                    <p className="text-lg font-bold text-teal-600">{Math.round(cohortAnalytics.avgAttendance)}%</p>
                  </div>
                  <div className="text-center">
                    <p className="text-xs text-muted-foreground mb-1">{locale === 'ar' ? 'متوسط الانضباط' : 'Avg Discipline'}</p>
                    <p className="text-lg font-bold text-violet-600">{Math.round(cohortAnalytics.avgDiscipline)}%</p>
                  </div>
                  <div className="text-center">
                    <p className="text-xs text-muted-foreground mb-1">{locale === 'ar' ? 'متوسط الكفاءة' : 'Avg Efficiency'}</p>
                    <p className="text-lg font-bold text-sky-600">{Math.round(cohortAnalytics.avgEfficiency)}%</p>
                  </div>
                  <div className="text-center">
                    <p className="text-xs text-muted-foreground mb-1">{locale === 'ar' ? 'نسبة التميز' : 'Excellence Rate'}</p>
                    <p className="text-lg font-bold text-emerald-600">{overviewStats.totalStudents > 0 ? Math.round((overviewStats.advancedCount / overviewStats.totalStudents) * 100) : 0}%</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        </>
      )}

      {/* ══════════════════════════════════════════════════════════════════ */}
      {/* TAB 2: COURSES ANALYTICS                                         */}
      {/* ══════════════════════════════════════════════════════════════════ */}
      {activeTrackingTab === 'courses' && (
        <>
          {/* Course Comparison Bar Chart */}
          <motion.div variants={itemVariants}>
            <Card className="border-violet-100/50 shadow-sm">
              <CardHeader className="pb-2 pt-4 px-4">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <BookOpen className="h-4 w-4 text-violet-600" />
                  {t('admin.adminTrackingCourseComparison')}
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                {courseComparisonData.length === 0 ? (
                  <div className="flex items-center justify-center h-48 text-muted-foreground text-xs">{t('admin.adminTrackingNoCoursesData')}</div>
                ) : (
                  <ResponsiveContainer width="100%" height={courseComparisonData.length > 6 ? 400 : 280}>
                    <BarChart data={courseComparisonData} layout="vertical" margin={{ left: 20 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 10 }} stroke="#94a3b8" />
                      <YAxis dataKey="name" type="category" tick={{ fontSize: 10 }} width={100} stroke="#94a3b8" />
                      <Tooltip formatter={(value: number, name: string) => [`${value}%`, name === 'avg' ? (locale === 'ar' ? 'الأداء' : 'Performance') : name === 'avgAtt' ? (locale === 'ar' ? 'الحضور' : 'Attendance') : name] as never} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                      <Legend wrapperStyle={{ fontSize: 10 }} />
                      <Bar dataKey="avg" fill="#8b5cf6" radius={[0, 4, 4, 0]} name={locale === 'ar' ? 'الأداء' : 'Performance'} />
                      <Bar dataKey="avgAtt" fill="#14b8a6" radius={[0, 4, 4, 0]} name={locale === 'ar' ? 'الحضور' : 'Attendance'} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </motion.div>

          {/* Course Cards Grid with Difficulty Index */}
          <motion.div variants={itemVariants}>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <Target className="h-4 w-4 text-violet-600" />
                {t('admin.adminTrackingDifficultyIndex')}
              </h3>
              {courseDrillDown && (
                <button onClick={() => setCourseDrillDown(null)} className="flex items-center gap-1 text-xs text-sky-600 hover:text-sky-700">
                  <ChevronLeft className="h-3 w-3" />
                  {t('admin.adminTrackingBackToCourses')}
                </button>
              )}
            </div>

            {!courseDrillDown ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {courseStatsData.map(course => {
                  const statusConfig = getCourseStatusConfig(course.avgPerformance, t);
                  return (
                    <Card
                      key={course.subject.id}
                      className="border-gray-100 dark:border-gray-800/60 shadow-sm cursor-pointer hover:shadow-md transition-shadow"
                      onClick={() => setCourseDrillDown(course.subject.id)}
                    >
                      <CardContent className="p-3">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-medium truncate max-w-[70%]">{course.subject.name}</span>
                          <Badge variant="secondary" className={`text-[9px] px-1.5 py-0 ${statusConfig.className}`}>{statusConfig.label}</Badge>
                        </div>
                        <div className="flex items-center gap-2 mb-1.5">
                          <Progress value={Math.round(course.avgPerformance)} className="h-1.5 flex-1" />
                          <span className="text-xs font-bold">{Math.round(course.avgPerformance)}%</span>
                        </div>
                        <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                          <span>{course.studentCount} {t('admin.adminTrackingStudentCountShort')}</span>
                          <span>{locale === 'ar' ? 'صعوبة' : 'Diff'}: {Math.round(course.difficulty)}%</span>
                          {course.atRiskCount > 0 && <span className="text-rose-600">{course.atRiskCount} ⚠</span>}
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            ) : (
              /* Drill-down: show students in this course */
              <Card className="border-violet-100/50 shadow-sm">
                <CardContent className="p-4">
                  <h4 className="text-sm font-semibold mb-3">{t('admin.adminTrackingCourseDetails')}</h4>
                  {(() => {
                    const courseStudents = studentPerformanceData
                      .filter(sp => {
                        const studentScores = scores.filter(s => s.student_id === sp.student.id);
                        return studentScores.some(s => {
                          const quiz = quizzes.find(q => q.id === s.quiz_id);
                          return quiz?.subject_id === courseDrillDown;
                        });
                      })
                      .sort((a, b) => b.metrics.overallPerformance - a.metrics.overallPerformance);

                    if (courseStudents.length === 0) return <p className="text-xs text-muted-foreground text-center py-6">{t('common.noData')}</p>;

                    return (
                      <div className="space-y-2 max-h-[400px] overflow-y-auto custom-scrollbar">
                        {courseStudents.map(({ student, metrics }, idx) => {
                          const perfConfig = getPerformanceLevelConfig(metrics.performanceLevel);
                          return (
                            <div key={student.id} className="flex items-center gap-3 p-2 rounded-lg border border-gray-100 dark:border-gray-800/60">
                              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-400 text-[10px] font-bold shrink-0">{idx + 1}</span>
                              <UserAvatar name={student.name} avatarUrl={student.avatar_url} size="xs" />
                              <div className="flex-1 min-w-0">
                                <span className="text-xs font-medium truncate block">{student.name}</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <Progress value={Math.round(metrics.overallPerformance)} className="h-1.5 w-16" />
                                <span className={`text-xs font-bold ${perfConfig.textColor}`}>{Math.round(metrics.overallPerformance)}%</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}
                </CardContent>
              </Card>
            )}
          </motion.div>
        </>
      )}

      {/* ══════════════════════════════════════════════════════════════════ */}
      {/* TAB 3: STUDENTS ANALYTICS                                        */}
      {/* ══════════════════════════════════════════════════════════════════ */}
      {activeTrackingTab === 'students' && (
        <>
          {/* Sub-tab: Students / Teachers */}
          <motion.div variants={itemVariants}>
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-1 bg-gray-100 dark:bg-gray-800/40 rounded-lg p-0.5">
                {(['students', 'teachers'] as const).map(subTab => (
                  <button
                    key={subTab}
                    onClick={() => { setActiveStudentSubTab(subTab); setSearchQuery(''); }}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                      activeStudentSubTab === subTab
                        ? 'bg-white dark:bg-card text-gray-900 dark:text-gray-100 shadow-sm'
                        : 'text-gray-500 dark:text-muted-foreground hover:text-gray-700'
                    }`}
                  >
                    {subTab === 'students' ? t('admin.adminTrackingStudentList') : t('admin.adminTrackingTeacherList')}
                  </button>
                ))}
              </div>
              <div className="relative flex-1 min-w-[200px] max-w-xs">
                <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder={activeStudentSubTab === 'teachers' ? t('admin.adminTrackingSearchTeacher') : t('admin.adminTrackingSearchStudent')}
                  className="ps-9 h-8 text-sm"
                />
              </div>
            </div>
          </motion.div>

          {/* Students List */}
          {activeStudentSubTab === 'students' && (
            <motion.div variants={itemVariants}>
              <Card className="border-sky-100/50 shadow-sm">
                <CardContent className="p-4">
                  {filteredStudents.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      <Users className="h-10 w-10 mx-auto mb-2 opacity-30" />
                      <p className="text-sm">{t('admin.adminTrackingNoStudentsFound')}</p>
                    </div>
                  ) : (
                    <div className="space-y-2 max-h-[500px] overflow-y-auto custom-scrollbar">
                      {filteredStudents.map(({ student, metrics }) => {
                        const perfConfig = getPerformanceLevelConfig(metrics.performanceLevel);
                        const riskConfig = getRiskLevelConfig(metrics.riskLevel);
                        const courseStatus = getCourseStatusConfig(metrics.overallPerformance, t);
                        return (
                          <div key={student.id} className="flex items-center gap-3 p-3 rounded-xl border border-gray-100 dark:border-gray-800/60 hover:bg-gray-50/50 dark:hover:bg-gray-900/20 transition-colors">
                            <UserAvatar name={student.name} avatarUrl={student.avatar_url} size="sm" />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-sm font-medium text-gray-900 dark:text-foreground truncate">{student.name}</span>
                                <Badge variant="secondary" className={`text-[9px] px-1.5 py-0 ${courseStatus.className}`}>{courseStatus.label}</Badge>
                                {metrics.riskLevel !== 'healthy' && (
                                  <Badge variant="outline" className={`${riskConfig.bgColor} ${riskConfig.textColor} ${riskConfig.borderColor} text-[9px] px-1.5 py-0`}>
                                    {metrics.riskLevel === 'atRisk' ? '🔴' : metrics.riskLevel === 'concern' ? '🟠' : '🟡'} {t('teacher.trackingRisk' + metrics.riskLevel.charAt(0).toUpperCase() + metrics.riskLevel.slice(1))}
                                  </Badge>
                                )}
                              </div>
                              <div className="flex items-center gap-2 mt-1">
                                <Progress value={Math.round(metrics.overallPerformance)} className="h-1.5 flex-1" />
                                <span className={`text-xs font-bold ${perfConfig.textColor}`}>{Math.round(metrics.overallPerformance)}%</span>
                              </div>
                            </div>
                            <div className="hidden sm:flex flex-col items-end gap-1">
                              <span className="text-[10px] text-muted-foreground">{locale === 'ar' ? 'حضور' : 'Att'}: {Math.round(metrics.attendanceScore)}%</span>
                              <span className="text-[10px] text-muted-foreground">{locale === 'ar' ? 'التزام' : 'Comp'}: {Math.round(metrics.assignmentCompliance)}%</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>
            </motion.div>
          )}

          {/* Teachers List */}
          {activeStudentSubTab === 'teachers' && (
            <motion.div variants={itemVariants}>
              <Card className="border-teal-100/50 shadow-sm">
                <CardContent className="p-4">
                  {filteredTeachers.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      <GraduationCap className="h-10 w-10 mx-auto mb-2 opacity-30" />
                      <p className="text-sm">{t('admin.adminTrackingNoTeachersFound')}</p>
                    </div>
                  ) : (
                    <div className="space-y-2 max-h-[500px] overflow-y-auto custom-scrollbar">
                      {filteredTeachers.map(({ teacher, subjectCount, studentCount, avgPerformance, avgAttendance, atRiskCount }) => {
                        const statusConfig = getCourseStatusConfig(avgPerformance, t);
                        return (
                          <div key={teacher.id} className="flex items-center gap-3 p-3 rounded-xl border border-gray-100 dark:border-gray-800/60 hover:bg-gray-50/50 dark:hover:bg-gray-900/20 transition-colors">
                            <UserAvatar name={teacher.name} avatarUrl={teacher.avatar_url} size="sm" />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-sm font-medium text-gray-900 dark:text-foreground truncate">{teacher.name}</span>
                                <Badge variant="secondary" className={`text-[9px] px-1.5 py-0 ${statusConfig.className}`}>{statusConfig.label}</Badge>
                              </div>
                              <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                                <span>{subjectCount} {t('admin.adminTrackingSubjectCount')}</span>
                                <span>{studentCount} {t('admin.adminTrackingStudentCountShort')}</span>
                                {atRiskCount > 0 && <span className="text-rose-600 font-medium">{atRiskCount} {t('admin.adminTrackingAtRiskCount')}</span>}
                              </div>
                            </div>
                            <div className="hidden sm:flex flex-col items-end gap-1">
                              <div className="flex items-center gap-2">
                                <Progress value={Math.round(avgPerformance)} className="h-1.5 w-16" />
                                <span className="text-sm font-bold">{Math.round(avgPerformance)}%</span>
                              </div>
                              <span className="text-[10px] text-muted-foreground">{locale === 'ar' ? 'حضور' : 'Att'}: {Math.round(avgAttendance)}%</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>
            </motion.div>
          )}
        </>
      )}

      {/* ══════════════════════════════════════════════════════════════════ */}
      {/* TAB 4: ATTENDANCE & ENGAGEMENT                                   */}
      {/* ══════════════════════════════════════════════════════════════════ */}
      {activeTrackingTab === 'attendance' && (
        <>
          {/* Attendance Charts Row */}
          <motion.div variants={itemVariants}>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Attendance Distribution Pie */}
              <Card className="border-teal-100/50 shadow-sm">
                <CardHeader className="pb-2 pt-4 px-4">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <Clock className="h-4 w-4 text-teal-600" />
                    {t('admin.adminTrackingAttendanceDistribution')}
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-4">
                  {attendanceDistributionData.length === 0 ? (
                    <div className="flex items-center justify-center h-48 text-muted-foreground text-xs">{t('admin.adminTrackingNoAttendanceData')}</div>
                  ) : (
                    <ResponsiveContainer width="100%" height={220}>
                      <PieChart>
                        <Pie data={attendanceDistributionData} cx="50%" cy="50%" outerRadius={80} innerRadius={35} dataKey="value" labelLine={false} label={renderCustomizedLabel}>
                          {attendanceDistributionData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip formatter={(value: number) => value as never} />
                        <Legend wrapperStyle={{ fontSize: 10 }} />
                      </PieChart>
                    </ResponsiveContainer>
                  )}
                </CardContent>
              </Card>

              {/* Attendance Trend Stacked Bar Chart */}
              <Card className="border-teal-100/50 shadow-sm">
                <CardHeader className="pb-2 pt-4 px-4">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <TrendingUp className="h-4 w-4 text-teal-600" />
                    {t('admin.adminTrackingAttendanceTrend')}
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-4">
                  {attendanceTrendData.length === 0 ? (
                    <div className="flex items-center justify-center h-48 text-muted-foreground text-xs">{t('admin.adminTrackingNoAttendanceData')}</div>
                  ) : (
                    <ResponsiveContainer width="100%" height={220}>
                      <BarChart data={attendanceTrendData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                        <XAxis dataKey="name" tick={{ fontSize: 9 }} stroke="#94a3b8" />
                        <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} stroke="#94a3b8" />
                        <Tooltip formatter={(value: number) => `${value}%` as never} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                        <Legend wrapperStyle={{ fontSize: 10 }} />
                        <Bar dataKey="present" stackId="a" fill="#10b981" name={locale === 'ar' ? 'حاضر' : 'Present'} />
                        <Bar dataKey="late" stackId="a" fill="#f59e0b" name={locale === 'ar' ? 'متأخر' : 'Late'} />
                        <Bar dataKey="absent" stackId="a" fill="#ef4444" name={locale === 'ar' ? 'غائب' : 'Absent'} />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </CardContent>
              </Card>
            </div>
          </motion.div>

          {/* Engagement Scores */}
          <motion.div variants={itemVariants}>
            <Card className="border-teal-100/50 shadow-sm">
              <CardHeader className="pb-2 pt-4 px-4">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Zap className="h-4 w-4 text-amber-600" />
                  {t('admin.adminTrackingEngagementScores')}
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                {engagementData.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground text-xs">{t('common.noData')}</div>
                ) : (
                  <div className="space-y-2 max-h-[400px] overflow-y-auto custom-scrollbar">
                    {engagementData.map((d, idx) => (
                      <div key={d.studentId} className="flex items-center gap-2 p-2 rounded-lg border border-gray-100 dark:border-gray-800/60">
                        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 text-[9px] font-bold shrink-0">{idx + 1}</span>
                        <UserAvatar name={d.studentName} avatarUrl={d.avatarUrl} size="xs" />
                        <span className="text-xs font-medium truncate flex-1">{d.studentName}</span>
                        <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                          <span>{t('admin.adminTrackingEngagement')}: <strong className="text-foreground">{d.engagement}%</strong></span>
                          <span className="hidden sm:inline">{t('admin.adminTrackingCompliance')}: {Math.round(d.complianceRate)}%</span>
                        </div>
                        <div className="w-16">
                          <Progress value={d.engagement} className="h-1.5" />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </motion.div>
        </>
      )}

      {/* ══════════════════════════════════════════════════════════════════ */}
      {/* TAB 5: RISK & INSIGHTS                                           */}
      {/* ══════════════════════════════════════════════════════════════════ */}
      {activeTrackingTab === 'risk' && (
        <>
          {/* Risk Distribution Pie + Trend Summary */}
          <motion.div variants={itemVariants}>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Risk Distribution Pie */}
              <Card className="border-rose-100/50 shadow-sm">
                <CardHeader className="pb-2 pt-4 px-4">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2 text-rose-700 dark:text-rose-500">
                    <AlertOctagon className="h-4 w-4" />
                    {t('admin.adminTrackingRiskDistribution')}
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-4">
                  {riskDistributionData.length === 0 ? (
                    <div className="flex items-center justify-center h-48 text-muted-foreground text-xs">{t('admin.adminTrackingNoRiskData')}</div>
                  ) : (
                    <ResponsiveContainer width="100%" height={220}>
                      <PieChart>
                        <Pie data={riskDistributionData} cx="50%" cy="50%" outerRadius={80} innerRadius={35} dataKey="value" labelLine={false} label={renderCustomizedLabel}>
                          {riskDistributionData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip formatter={(value: number) => value as never} />
                        <Legend wrapperStyle={{ fontSize: 10 }} />
                      </PieChart>
                    </ResponsiveContainer>
                  )}
                </CardContent>
              </Card>

              {/* Trend Summary Cards */}
              <Card className="border-sky-100/50 shadow-sm">
                <CardHeader className="pb-2 pt-4 px-4">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <TrendingUp className="h-4 w-4 text-sky-600" />
                    {t('admin.adminTrackingTrendSummary')}
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-4">
                  <div className="grid grid-cols-3 gap-3 mb-4">
                    <div className="text-center p-3 rounded-xl bg-emerald-50 dark:bg-emerald-900/10">
                      <ArrowUpRight className="h-5 w-5 text-emerald-600 mx-auto mb-1" />
                      <p className="text-2xl font-bold text-emerald-700 dark:text-emerald-500">{trendSummary.improved}</p>
                      <p className="text-[10px] text-muted-foreground">{t('admin.adminTrackingImproved')}</p>
                    </div>
                    <div className="text-center p-3 rounded-xl bg-sky-50 dark:bg-sky-900/10">
                      <ArrowRight className="h-5 w-5 text-sky-600 mx-auto mb-1" />
                      <p className="text-2xl font-bold text-sky-700 dark:text-sky-500">{trendSummary.stable}</p>
                      <p className="text-[10px] text-muted-foreground">{t('admin.adminTrackingStable')}</p>
                    </div>
                    <div className="text-center p-3 rounded-xl bg-rose-50 dark:bg-rose-900/10">
                      <ArrowDownRight className="h-5 w-5 text-rose-600 mx-auto mb-1" />
                      <p className="text-2xl font-bold text-rose-700 dark:text-rose-500">{trendSummary.declined}</p>
                      <p className="text-[10px] text-muted-foreground">{t('admin.adminTrackingDeclined')}</p>
                    </div>
                  </div>

                  {/* At-Risk Students Quick List */}
                  <h4 className="text-xs font-semibold text-foreground mb-2 flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3 text-rose-500" />
                    {t('admin.adminTrackingAtRiskStudents')}
                  </h4>
                  <div className="space-y-1 max-h-[200px] overflow-y-auto custom-scrollbar">
                    {studentPerformanceData
                      .filter(d => d.metrics.riskLevel === 'atRisk' || d.metrics.riskLevel === 'concern')
                      .sort((a, b) => a.metrics.overallPerformance - b.metrics.overallPerformance)
                      .slice(0, 10)
                      .map(({ student, metrics }) => {
                        const riskConfig = getRiskLevelConfig(metrics.riskLevel);
                        return (
                          <div key={student.id} className="flex items-center gap-2 p-1.5 rounded-lg bg-rose-50/50 dark:bg-rose-900/10">
                            <UserAvatar name={student.name} avatarUrl={student.avatar_url} size="xs" />
                            <span className="text-xs truncate flex-1">{student.name}</span>
                            <span className={`text-[10px] font-bold ${riskConfig.textColor}`}>{Math.round(metrics.overallPerformance)}%</span>
                          </div>
                        );
                      })}
                    {studentPerformanceData.filter(d => d.metrics.riskLevel === 'atRisk' || d.metrics.riskLevel === 'concern').length === 0 && (
                      <p className="text-xs text-muted-foreground text-center py-3">{t('common.noData')}</p>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>
          </motion.div>

          {/* Insight Cards: Sudden Drop, Improvement Streak, Volatile */}
          <motion.div variants={itemVariants}>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {/* Sudden Drop */}
              <Card className="border-rose-100/50 shadow-sm">
                <CardHeader className="pb-2 pt-4 px-4">
                  <CardTitle className="text-xs font-semibold flex items-center gap-2 text-rose-700 dark:text-rose-500">
                    <ArrowDownRight className="h-3.5 w-3.5" />
                    {t('admin.adminTrackingSuddenDrop')}
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-4">
                  <p className="text-3xl font-bold text-rose-700 dark:text-rose-500 mb-1">{suddenDropStudents.length}</p>
                  <p className="text-[10px] text-muted-foreground mb-2">{locale === 'ar' ? 'انخفاض ≥10% في آخر فترة' : '≥10% drop in last period'}</p>
                  <div className="space-y-1 max-h-[120px] overflow-y-auto custom-scrollbar">
                    {suddenDropStudents.slice(0, 5).map(d => (
                      <div key={d.studentId} className="flex items-center gap-2 text-[10px]">
                        <span className="truncate flex-1">{d.studentName}</span>
                        <span className="text-rose-600 font-bold">{d.change}%</span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              {/* Improvement Streak */}
              <Card className="border-emerald-100/50 shadow-sm">
                <CardHeader className="pb-2 pt-4 px-4">
                  <CardTitle className="text-xs font-semibold flex items-center gap-2 text-emerald-700 dark:text-emerald-500">
                    <Flame className="h-3.5 w-3.5" />
                    {t('admin.adminTrackingImprovementStreak')}
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-4">
                  <p className="text-3xl font-bold text-emerald-700 dark:text-emerald-500 mb-1">{improvementStreakStudents.length}</p>
                  <p className="text-[10px] text-muted-foreground mb-2">{locale === 'ar' ? '3+ فترات تحسن متتالية' : '3+ consecutive periods up'}</p>
                  <div className="space-y-1 max-h-[120px] overflow-y-auto custom-scrollbar">
                    {improvementStreakStudents.slice(0, 5).map(d => (
                      <div key={d.studentId} className="flex items-center gap-2 text-[10px]">
                        <span className="truncate flex-1">{d.studentName}</span>
                        <span className="text-emerald-600 font-bold">+{d.change}%</span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              {/* Most Improved */}
              <Card className="border-sky-100/50 shadow-sm">
                <CardHeader className="pb-2 pt-4 px-4">
                  <CardTitle className="text-xs font-semibold flex items-center gap-2 text-sky-700 dark:text-sky-500">
                    <Award className="h-3.5 w-3.5" />
                    {t('admin.adminTrackingInsightMostImproved')}
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-4">
                  <p className="text-[10px] text-muted-foreground mb-2">{locale === 'ar' ? 'أكبر تحسن في الأداء' : 'Largest performance gains'}</p>
                  <div className="space-y-1 max-h-[180px] overflow-y-auto custom-scrollbar">
                    {trendAnalysisData
                      .filter(d => d.direction === 'improved')
                      .sort((a, b) => b.change - a.change)
                      .slice(0, 5)
                      .map(d => (
                        <div key={d.studentId} className="flex items-center gap-2 p-1 rounded bg-emerald-50/50 dark:bg-emerald-900/10">
                          <ArrowUpRight className="h-3 w-3 text-emerald-600 shrink-0" />
                          <span className="text-[10px] truncate flex-1">{d.studentName}</span>
                          <span className="text-[10px] font-bold text-emerald-600">+{d.change}%</span>
                        </div>
                      ))}
                    {trendAnalysisData.filter(d => d.direction === 'improved').length === 0 && (
                      <p className="text-[10px] text-muted-foreground text-center py-4">{t('common.noData')}</p>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>
          </motion.div>
        </>
      )}

      {/* ═══ Status Guide ═══ */}
      <motion.div variants={itemVariants}>
        <Card className="border-sky-100/50 shadow-sm">
          <CardContent className="p-4">
            <h3 className="text-sm font-bold text-foreground mb-3 flex items-center gap-2">
              <Info className="h-4 w-4 text-sky-600" />
              {locale === 'ar' ? 'دليل الحالات' : 'Status Guide'}
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <p className="text-xs font-semibold text-muted-foreground mb-1.5">{locale === 'ar' ? 'مستويات الأداء' : 'Performance Levels'}</p>
                <div className="space-y-1">
                  {[
                    { color: 'bg-emerald-500', label: locale === 'ar' ? 'متقدم (≥80%)' : 'Advanced (≥80%)' },
                    { color: 'bg-sky-500', label: locale === 'ar' ? 'على المسار (60-79%)' : 'On Track (60-79%)' },
                    { color: 'bg-amber-500', label: locale === 'ar' ? 'يحتاج متابعة (40-59%)' : 'Needs Attention (40-59%)' },
                    { color: 'bg-rose-500', label: locale === 'ar' ? 'في خطر (<40%)' : 'At Risk (<40%)' },
                  ].map((item, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <span className={`h-2 w-2 rounded-full ${item.color} shrink-0`} />
                      <span className="text-xs text-foreground">{item.label}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-xs font-semibold text-muted-foreground mb-1.5">{locale === 'ar' ? 'مستويات الخطورة' : 'Risk Levels'}</p>
                <div className="space-y-1">
                  {[
                    { color: 'bg-emerald-500', label: locale === 'ar' ? 'سليم' : 'Healthy' },
                    { color: 'bg-amber-500', label: locale === 'ar' ? 'مراقبة' : 'Monitor' },
                    { color: 'bg-orange-500', label: locale === 'ar' ? 'قلق' : 'Concern' },
                    { color: 'bg-rose-500', label: locale === 'ar' ? 'في خطر' : 'At Risk' },
                  ].map((item, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <span className={`h-2 w-2 rounded-full ${item.color} shrink-0`} />
                      <span className="text-xs text-foreground">{item.label}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-xs font-semibold text-muted-foreground mb-1.5">{locale === 'ar' ? 'مؤشرات النمو' : 'Growth Indicators'}</p>
                <div className="space-y-1">
                  {[
                    { icon: <ArrowUpRight className="h-2 w-2 text-emerald-600 shrink-0" />, label: locale === 'ar' ? 'تحسن' : 'Improving' },
                    { icon: <ArrowRight className="h-2 w-2 text-sky-600 shrink-0" />, label: locale === 'ar' ? 'ثابت' : 'Stable' },
                    { icon: <ArrowDownRight className="h-2 w-2 text-rose-600 shrink-0" />, label: locale === 'ar' ? 'تراجع' : 'Declining' },
                  ].map((item, i) => (
                    <div key={i} className="flex items-center gap-2">
                      {item.icon}
                      <span className="text-xs text-foreground">{item.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    </motion.div>
  );
}

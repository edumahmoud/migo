'use client';

import { useMemo, useState, useCallback, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  Activity,
  Users,
  BookOpen,
  TrendingUp,
  AlertTriangle,
  Award,
  Download,
  Search,
  Target,
  Info,
  GraduationCap,
  ArrowUpRight,
  ArrowDownRight,
  ArrowRight,
  ShieldCheck,
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
  computeSubjectPerformance,
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

interface AdminPerformanceTrackingSectionProps {
  profile: UserProfile;
}

export default function AdminPerformanceTrackingSection({ profile }: AdminPerformanceTrackingSectionProps) {
  const { t } = useTranslations();
  const locale = useLocaleStore((s) => s.locale);
  const [activeTab, setActiveTab] = useState<'students' | 'teachers' | 'courses'>('students');
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [students, setStudents] = useState<UserProfile[]>([]);
  const [teachers, setTeachers] = useState<UserProfile[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [scores, setScores] = useState<Score[]>([]);
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [teacherSubmissions, setTeacherSubmissions] = useState<{ id: string; assignment_id: string; student_id: string; score: number | null; status: string; submitted_at?: string }[]>([]);
  const [teacherAssignments, setTeacherAssignments] = useState<{ id: string; max_score: number; subject_id: string | null; due_date?: string }[]>([]);
  const [teacherAttendanceSessions, setTeacherAttendanceSessions] = useState<{ id: string; subject_id: string }[]>([]);
  const [teacherAttendanceRecords, setTeacherAttendanceRecords] = useState<{ id: string; session_id: string; student_id: string; attendance_status?: 'present' | 'late' | 'partial' | 'absent' }[]>([]);

  // Fetch all data on mount using useEffect (not useMemo — useMemo must not have side effects)
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

  // Compute student performance data
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

  // Compute teacher stats
  const teacherStatsData = useMemo(() => {
    return teachers.map(teacher => {
      // Find subjects owned by this teacher
      const teacherSubjects = subjects.filter(s => s.teacher_id === teacher.id);
      const teacherSubjectIds = new Set(teacherSubjects.map(s => s.id));

      // Find students enrolled in teacher's subjects
      const teacherStudents = studentPerformanceData.filter(sp => {
        // Check if student has scores in teacher's quizzes
        const studentScores = scores.filter(s => s.student_id === sp.student.id);
        return studentScores.some(s => {
          const quiz = quizzes.find(q => q.id === s.quiz_id);
          return quiz && teacherSubjectIds.has(quiz.subject_id || '');
        });
      });

      const avgPerformance = teacherStudents.length > 0
        ? teacherStudents.reduce((sum, d) => sum + d.metrics.overallPerformance, 0) / teacherStudents.length
        : 0;
      const atRiskCount = teacherStudents.filter(d => d.metrics.riskLevel === 'atRisk' || d.metrics.riskLevel === 'concern').length;

      return { teacher, subjectCount: teacherSubjects.length, studentCount: teacherStudents.length, avgPerformance, atRiskCount };
    });
  }, [teachers, subjects, studentPerformanceData, scores, quizzes]);

  // Compute course stats
  const courseStatsData = useMemo(() => {
    return subjects.map(subject => {
      // Find students enrolled in this subject
      const subjectStudentIds = new Set<string>();
      scores.filter(s => {
        const quiz = quizzes.find(q => q.id === s.quiz_id);
        return quiz?.subject_id === subject.id;
      }).forEach(s => subjectStudentIds.add(s.student_id));

      const subjectStudents = studentPerformanceData.filter(sp => subjectStudentIds.has(sp.student.id));

      // Compute per-subject metrics
      const subjectScores = scores.filter(s => {
        const quiz = quizzes.find(q => q.id === s.quiz_id);
        return quiz?.subject_id === subject.id;
      });
      const avgScore = subjectScores.length > 0
        ? subjectScores.reduce((sum, s) => sum + (s.total > 0 ? (s.score / s.total) * 100 : 0), 0) / subjectScores.length
        : 0;

      const atRiskCount = subjectStudents.filter(d => d.metrics.riskLevel === 'atRisk' || d.metrics.riskLevel === 'concern').length;

      return { subject, enrollmentCount: subjectStudentIds.size, avgPerformance: avgScore, atRiskCount };
    });
  }, [subjects, scores, quizzes, studentPerformanceData]);

  // Overview stats
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

  // Export function
  const handleExport = useCallback(async () => {
    const XLSX = await import('xlsx');

    // Students sheet
    const studentHeaders = [
      locale === 'ar' ? 'الاسم' : 'Name',
      locale === 'ar' ? 'البريد الإلكتروني' : 'Email',
      locale === 'ar' ? 'الأداء العام' : 'Overall',
      locale === 'ar' ? 'الحضور' : 'Attendance',
      locale === 'ar' ? 'الخطورة' : 'Risk',
      locale === 'ar' ? 'النمو' : 'Growth',
    ];
    const studentRows = studentPerformanceData.map(d => [
      d.student.name,
      d.student.email,
      `${Math.round(d.metrics.overallPerformance)}%`,
      `${Math.round(d.metrics.attendanceScore)}%`,
      d.metrics.riskLevel,
      d.metrics.growthTrend,
    ]);

    // Teachers sheet
    const teacherHeaders = [
      locale === 'ar' ? 'الاسم' : 'Name',
      locale === 'ar' ? 'البريد الإلكتروني' : 'Email',
      locale === 'ar' ? 'عدد المقررات' : 'Courses',
      locale === 'ar' ? 'عدد الطلاب' : 'Students',
      locale === 'ar' ? 'متوسط الأداء' : 'Avg Performance',
      locale === 'ar' ? 'في خطر' : 'At Risk',
    ];
    const teacherRows = teacherStatsData.map(d => [
      d.teacher.name,
      d.teacher.email,
      d.subjectCount,
      d.studentCount,
      `${Math.round(d.avgPerformance)}%`,
      d.atRiskCount,
    ]);

    // Courses sheet
    const courseHeaders = [
      locale === 'ar' ? 'المقرر' : 'Course',
      locale === 'ar' ? 'المعلم' : 'Teacher',
      locale === 'ar' ? 'المسجلين' : 'Enrolled',
      locale === 'ar' ? 'متوسط الأداء' : 'Avg Performance',
      locale === 'ar' ? 'في خطر' : 'At Risk',
    ];
    const courseRows = courseStatsData.map(d => [
      d.subject.name,
      d.subject.teacher_id,
      d.enrollmentCount,
      `${Math.round(d.avgPerformance)}%`,
      d.atRiskCount,
    ]);

    const wb = XLSX.utils.book_new();
    const ws1 = XLSX.utils.aoa_to_sheet([studentHeaders, ...studentRows]);
    const ws2 = XLSX.utils.aoa_to_sheet([teacherHeaders, ...teacherRows]);
    const ws3 = XLSX.utils.aoa_to_sheet([courseHeaders, ...courseRows]);

    XLSX.utils.book_append_sheet(wb, ws1, locale === 'ar' ? 'الطلاب' : 'Students');
    XLSX.utils.book_append_sheet(wb, ws2, locale === 'ar' ? 'المعلمين' : 'Teachers');
    XLSX.utils.book_append_sheet(wb, ws3, locale === 'ar' ? 'المقررات' : 'Courses');
    XLSX.writeFile(wb, `performance_tracking_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }, [studentPerformanceData, teacherStatsData, courseStatsData, locale]);

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

  const filteredStudents = searchQuery.trim()
    ? studentPerformanceData.filter(d => d.student.name.toLowerCase().includes(searchQuery.toLowerCase()) || d.student.email?.toLowerCase().includes(searchQuery.toLowerCase()))
    : studentPerformanceData;

  const filteredTeachers = searchQuery.trim()
    ? teacherStatsData.filter(d => d.teacher.name.toLowerCase().includes(searchQuery.toLowerCase()))
    : teacherStatsData;

  const filteredCourses = searchQuery.trim()
    ? courseStatsData.filter(d => d.subject.name.toLowerCase().includes(searchQuery.toLowerCase()))
    : courseStatsData;

  return (
    <motion.div variants={containerVariants} initial="hidden" animate="visible" className="space-y-6">
      {/* Header */}
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

      {/* Overview Cards */}
      <motion.div variants={itemVariants}>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4">
          <Card className="border-sky-100/50 shadow-sm">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-50 dark:bg-sky-900/15 ring-2 ring-sky-100">
                  <Users className="h-5 w-5 text-sky-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-sky-800 dark:text-sky-400">{overviewStats.totalStudents}</p>
                  <p className="text-xs text-muted-foreground">{t('admin.performanceTrackingStudents')}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="border-teal-100/50 shadow-sm">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-50 dark:bg-teal-900/20 ring-2 ring-teal-100">
                  <GraduationCap className="h-5 w-5 text-teal-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-teal-700 dark:text-teal-500">{overviewStats.totalTeachers}</p>
                  <p className="text-xs text-muted-foreground">{t('admin.performanceTrackingTeachers')}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="border-violet-100/50 shadow-sm">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-50 dark:bg-violet-900/20 ring-2 ring-violet-100">
                  <BookOpen className="h-5 w-5 text-violet-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-violet-700 dark:text-violet-500">{overviewStats.totalCourses}</p>
                  <p className="text-xs text-muted-foreground">{t('admin.performanceTrackingCourses')}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="border-amber-100/50 shadow-sm">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50 dark:bg-amber-900/20 ring-2 ring-amber-100">
                  <TrendingUp className="h-5 w-5 text-amber-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-amber-700 dark:text-amber-500">{Math.round(overviewStats.avgPerformance)}%</p>
                  <p className="text-xs text-muted-foreground">{t('teacher.trackingAvgPerformance')}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="border-rose-100/50 shadow-sm">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-rose-50 dark:bg-rose-900/20 ring-2 ring-rose-100">
                  <AlertTriangle className="h-5 w-5 text-rose-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-rose-700 dark:text-rose-500">{overviewStats.atRiskCount}</p>
                  <p className="text-xs text-muted-foreground">{t('teacher.trackingRiskLevel')}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="border-emerald-100/50 shadow-sm">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 dark:bg-emerald-900/20 ring-2 ring-emerald-100">
                  <Award className="h-5 w-5 text-emerald-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-emerald-700 dark:text-emerald-500">{overviewStats.advancedCount}</p>
                  <p className="text-xs text-muted-foreground">{t('teacher.trackingTopPerformers')}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </motion.div>

      {/* Tab Switcher + Search */}
      <motion.div variants={itemVariants}>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1 bg-gray-100 dark:bg-gray-800/40 rounded-lg p-0.5">
            {(['students', 'teachers', 'courses'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => { setActiveTab(tab); setSearchQuery(''); }}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                  activeTab === tab
                    ? 'bg-white dark:bg-card text-gray-900 dark:text-gray-100 shadow-sm'
                    : 'text-gray-500 dark:text-muted-foreground hover:text-gray-700'
                }`}
              >
                {tab === 'students' ? t('admin.performanceTrackingStudents') : tab === 'teachers' ? t('admin.performanceTrackingTeachers') : t('admin.performanceTrackingCourses')}
              </button>
            ))}
          </div>
          <div className="relative flex-1 min-w-[200px] max-w-xs">
            <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder={t('teacher.trackingSearchStudent')}
              className="ps-9 h-8 text-sm"
            />
          </div>
        </div>
      </motion.div>

      {/* Tab Content */}
      <motion.div variants={itemVariants}>
        {activeTab === 'students' && (
          <Card className="border-sky-100/50 shadow-sm">
            <CardContent className="p-4">
              {filteredStudents.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Users className="h-10 w-10 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">{t('teacher.trackingNoStudentsYet')}</p>
                </div>
              ) : (
                <div className="space-y-2 max-h-[500px] overflow-y-auto custom-scrollbar">
                  {filteredStudents.map(({ student, metrics }) => {
                    const perfConfig = getPerformanceLevelConfig(metrics.performanceLevel);
                    const riskConfig = getRiskLevelConfig(metrics.riskLevel);
                    const growthConfig = getGrowthTrendConfig(metrics.growthTrend);
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
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {activeTab === 'teachers' && (
          <Card className="border-sky-100/50 shadow-sm">
            <CardContent className="p-4">
              {filteredTeachers.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <GraduationCap className="h-10 w-10 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">{t('teacher.trackingNoStudentsYet')}</p>
                </div>
              ) : (
                <div className="space-y-2 max-h-[500px] overflow-y-auto custom-scrollbar">
                  {filteredTeachers.map(({ teacher, subjectCount, studentCount, avgPerformance, atRiskCount }) => {
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
                            <span>{subjectCount} {t('nav.subjects')}</span>
                            <span>{studentCount} {t('nav.students')}</span>
                            {atRiskCount > 0 && <span className="text-rose-600 font-medium">{atRiskCount} {t('teacher.trackingRiskLevel')}</span>}
                          </div>
                        </div>
                        <span className="text-sm font-bold text-gray-700 dark:text-gray-300">{Math.round(avgPerformance)}%</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {activeTab === 'courses' && (
          <Card className="border-sky-100/50 shadow-sm">
            <CardContent className="p-4">
              {filteredCourses.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <BookOpen className="h-10 w-10 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">{t('student.trackingNoAttendanceData')}</p>
                </div>
              ) : (
                <div className="space-y-2 max-h-[500px] overflow-y-auto custom-scrollbar">
                  {filteredCourses.map(({ subject, enrollmentCount, avgPerformance, atRiskCount }) => {
                    const statusConfig = getCourseStatusConfig(avgPerformance, t);
                    return (
                      <div key={subject.id} className="flex items-center gap-3 p-3 rounded-xl border border-gray-100 dark:border-gray-800/60 hover:bg-gray-50/50 dark:hover:bg-gray-900/20 transition-colors">
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-50 dark:bg-violet-900/20 ring-2 ring-violet-100 dark:ring-violet-900/40">
                          <BookOpen className="h-5 w-5 text-violet-600" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-medium text-gray-900 dark:text-foreground truncate">{subject.name}</span>
                            <Badge variant="secondary" className={`text-[9px] px-1.5 py-0 ${statusConfig.className}`}>{statusConfig.label}</Badge>
                          </div>
                          <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                            <span>{enrollmentCount} {t('nav.students')}</span>
                            {atRiskCount > 0 && <span className="text-rose-600 font-medium">{atRiskCount} {t('teacher.trackingRiskLevel')}</span>}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Progress value={Math.round(avgPerformance)} className="h-1.5 w-20" />
                          <span className="text-sm font-bold text-gray-700 dark:text-gray-300">{Math.round(avgPerformance)}%</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </motion.div>

      {/* Status Guide */}
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

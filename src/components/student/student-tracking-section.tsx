'use client';

import { useMemo } from 'react';
import { motion } from 'framer-motion';
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
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import type { Score, Submission, Assignment, Subject } from '@/lib/types';
import { supabase } from '@/lib/supabase';
import { useEffect, useState } from 'react';

// -------------------------------------------------------
// Props
// -------------------------------------------------------
interface StudentTrackingSectionProps {
  profileId: string;
  attendanceRecords: { id: string; session_id: string; student_id: string; checked_in_at: string }[];
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
  visible: { opacity: 1, y: 0, transition: { duration: 0.35, ease: 'easeOut' } },
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
function CircularProgress({ value, size = 100, strokeWidth = 8, label }: { value: number; size?: number; strokeWidth?: number; label: string }) {
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
          className="text-slate-100"
        />
        {/* Progress arc */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="url(#progressGradient)"
          strokeWidth={strokeWidth}
          fill="none"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className="transition-all duration-700 ease-out"
        />
        <defs>
          <linearGradient id="progressGradient" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#0284c7" />
            <stop offset="100%" stopColor="#0d9488" />
          </linearGradient>
        </defs>
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-bold text-sky-800">{Math.round(value)}%</span>
      </div>
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
    </div>
  );
}

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
  // ─── Fetch subjects for attendance by subject ───
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

  // ─── Computed attendance stats ───
  const attendanceStats = useMemo(() => {
    const totalSessions = attendanceSessions.length;
    const attendedSessionIds = new Set(attendanceRecords.map(r => r.session_id));
    const attended = attendedSessionIds.size;
    const absent = totalSessions - attended;
    const rate = totalSessions > 0 ? (attended / totalSessions) * 100 : 0;

    return { totalSessions, attended, absent, rate };
  }, [attendanceRecords, attendanceSessions]);

  // ─── Attendance by subject ───
  const attendanceBySubject = useMemo(() => {
    const subjectMap = new Map<string, { name: string; total: number; attended: number }>();

    attendanceSessions.forEach(session => {
      const name = subjectNames[session.subject_id] || 'مقرر غير معروف';
      const existing = subjectMap.get(session.subject_id) || { name, total: 0, attended: 0 };
      existing.total += 1;
      subjectMap.set(session.subject_id, existing);
    });

    attendanceRecords.forEach(record => {
      const session = attendanceSessions.find(s => s.id === record.session_id);
      if (session) {
        const existing = subjectMap.get(session.subject_id);
        if (existing) {
          existing.attended += 1;
        }
      }
    });

    return Array.from(subjectMap.entries()).map(([id, data]) => ({
      id,
      ...data,
      rate: data.total > 0 ? (data.attended / data.total) * 100 : 0,
    }));
  }, [attendanceSessions, attendanceRecords, subjectNames]);

  // ─── Performance summary ───
  const performanceStats = useMemo(() => {
    const totalScores = scores.length;
    const avgScore = totalScores > 0
      ? scores.reduce((sum, s) => sum + (s.total > 0 ? (s.score / s.total) * 100 : 0), 0) / totalScores
      : 0;

    const completedAssignments = submissions.filter(s => s.status === 'graded' || s.status === 'submitted').length;
    const totalAssignments = assignments.length;

    return { avgScore, totalScores, completedAssignments, totalAssignments };
  }, [scores, submissions, assignments]);

  // ─── Activity timeline ───
  const activityTimeline = useMemo(() => {
    const activities: Array<{ date: string; type: 'attendance' | 'quiz' | 'assignment'; title: string; detail: string }> = [];

    // Attendance activities
    attendanceRecords.forEach(record => {
      const session = attendanceSessions.find(s => s.id === record.session_id);
      const subjectName = session ? (subjectNames[session.subject_id] || 'مقرر') : 'مقرر';
      activities.push({
        date: record.checked_in_at,
        type: 'attendance',
        title: 'تسجيل حضور',
        detail: subjectName,
      });
    });

    // Quiz activities
    scores.forEach(score => {
      activities.push({
        date: score.completed_at,
        type: 'quiz',
        title: 'إكمال اختبار',
        detail: `${score.quiz_title} — ${score.score}/${score.total}`,
      });
    });

    // Assignment activities
    submissions.forEach(sub => {
      const assignment = assignments.find(a => a.id === sub.assignment_id);
      activities.push({
        date: sub.submitted_at,
        type: 'assignment',
        title: 'تسليم مهمة',
        detail: assignment?.title || 'مهمة',
      });
    });

    // Sort by date descending
    activities.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    return activities.slice(0, 20); // Show last 20 activities
  }, [attendanceRecords, attendanceSessions, subjectNames, scores, submissions, assignments]);

  // ─── Recent attendance ───
  const recentAttendance = useMemo(() => {
    return attendanceRecords
      .sort((a, b) => new Date(b.checked_in_at).getTime() - new Date(a.checked_in_at).getTime())
      .slice(0, 10)
      .map(record => {
        const session = attendanceSessions.find(s => s.id === record.session_id);
        const subjectName = session ? (subjectNames[session.subject_id] || 'مقرر غير معروف') : 'مقرر غير معروف';
        return {
          date: record.checked_in_at,
          subjectName,
          status: 'حاضر' as const,
        };
      });
  }, [attendanceRecords, attendanceSessions, subjectNames]);

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
          <h1 className="text-2xl font-bold text-gray-900">تتبع الطالب</h1>
          <p className="text-sm text-muted-foreground">متابعة الحضور والأداء والنشاط</p>
        </div>
      </motion.div>

      {/* ── Attendance Overview Cards ── */}
      <motion.div variants={itemVariants}>
        <Card className="border-sky-100/50 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <Clock className="h-5 w-5 text-sky-600" />
              نظرة عامة على الحضور
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col sm:flex-row items-center gap-6">
              {/* Circular progress */}
              <CircularProgress value={attendanceStats.rate} label="نسبة الحضور" />

              {/* Stats cards */}
              <div className="grid grid-cols-3 gap-4 flex-1 w-full">
                <div className="text-center p-3 rounded-xl bg-sky-50/50 border border-sky-100/50">
                  <p className="text-2xl font-bold text-sky-800">{attendanceStats.totalSessions}</p>
                  <p className="text-xs text-muted-foreground">إجمالي الجلسات</p>
                </div>
                <div className="text-center p-3 rounded-xl bg-teal-50/50 border border-teal-100/50">
                  <p className="text-2xl font-bold text-teal-700">{attendanceStats.attended}</p>
                  <p className="text-xs text-muted-foreground">حاضر</p>
                </div>
                <div className="text-center p-3 rounded-xl bg-red-50/50 border border-red-100/50">
                  <p className="text-2xl font-bold text-red-600">{attendanceStats.absent}</p>
                  <p className="text-xs text-muted-foreground">غائب</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* ── Two columns: Attendance by Subject + Performance Summary ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Attendance by Subject */}
        <motion.div variants={itemVariants}>
          <Card className="border-sky-100/50 shadow-sm h-full">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <BookOpen className="h-5 w-5 text-sky-600" />
                الحضور حسب المقرر
              </CardTitle>
            </CardHeader>
            <CardContent>
              {attendanceBySubject.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <BookOpen className="h-10 w-10 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">لا توجد بيانات حضور بعد</p>
                </div>
              ) : (
                <div className="space-y-3 max-h-72 overflow-y-auto custom-scrollbar">
                  {attendanceBySubject.map((item) => (
                    <div key={item.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-slate-50/50 transition-colors">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">{item.name}</p>
                        <div className="flex items-center gap-2 mt-1">
                          <Progress value={item.rate} className="h-2 flex-1" />
                          <span className="text-xs font-medium text-sky-700 min-w-[40px] text-left">
                            {Math.round(item.rate)}%
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {item.attended} من {item.total} جلسة
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>

        {/* Performance Summary */}
        <motion.div variants={itemVariants}>
          <Card className="border-sky-100/50 shadow-sm h-full">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <Award className="h-5 w-5 text-sky-600" />
                ملخص الأداء
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {/* Average quiz score */}
                <div className="flex items-center gap-3 p-3 rounded-xl bg-sky-50/50 border border-sky-100/50">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-sky-100">
                    <BarChart3 className="h-5 w-5 text-sky-700" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-gray-900">متوسط درجات الاختبارات</p>
                    <div className="flex items-center gap-2 mt-1">
                      <Progress value={performanceStats.avgScore} className="h-2 flex-1" />
                      <span className="text-xs font-bold text-sky-700">
                        {Math.round(performanceStats.avgScore)}%
                      </span>
                    </div>
                  </div>
                </div>

                {/* Completed assignments */}
                <div className="flex items-center gap-3 p-3 rounded-xl bg-teal-50/50 border border-teal-100/50">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-teal-100">
                    <ClipboardList className="h-5 w-5 text-teal-700" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-gray-900">المهام المكتملة</p>
                    <div className="flex items-center gap-2 mt-1">
                      <Progress
                        value={performanceStats.totalAssignments > 0 ? (performanceStats.completedAssignments / performanceStats.totalAssignments) * 100 : 0}
                        className="h-2 flex-1"
                      />
                      <span className="text-xs font-bold text-teal-700">
                        {performanceStats.completedAssignments}/{performanceStats.totalAssignments}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Quiz count */}
                <div className="flex items-center gap-3 p-3 rounded-xl bg-amber-50/50 border border-amber-100/50">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-100">
                    <FileText className="h-5 w-5 text-amber-700" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-gray-900">الاختبارات المكتملة</p>
                    <p className="text-xl font-bold text-amber-700">{performanceStats.totalScores}</p>
                  </div>
                </div>

                {/* Overall progress */}
                <div className="flex items-center gap-3 p-3 rounded-xl bg-gradient-to-l from-sky-50/50 to-teal-50/50 border border-sky-100/50">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-sky-600 to-teal-600 shadow-sm">
                    <TrendingUp className="h-5 w-5 text-white" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-gray-900">التقدم العام</p>
                    <div className="flex items-center gap-2 mt-1">
                      <Progress
                        value={(() => {
                          const attendanceWeight = attendanceStats.rate * 0.4;
                          const performanceWeight = performanceStats.avgScore * 0.4;
                          const assignmentWeight = performanceStats.totalAssignments > 0
                            ? (performanceStats.completedAssignments / performanceStats.totalAssignments) * 100 * 0.2
                            : 0;
                          return attendanceWeight + performanceWeight + assignmentWeight;
                        })()}
                        className="h-2.5 flex-1"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>

      {/* ── Two columns: Recent Attendance + Activity Timeline ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Attendance */}
        <motion.div variants={itemVariants}>
          <Card className="border-sky-100/50 shadow-sm h-full">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <Calendar className="h-5 w-5 text-sky-600" />
                سجل الحضور الأخير
              </CardTitle>
            </CardHeader>
            <CardContent>
              {recentAttendance.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Calendar className="h-10 w-10 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">لا يوجد سجل حضور بعد</p>
                </div>
              ) : (
                <div className="space-y-2 max-h-72 overflow-y-auto custom-scrollbar">
                  {recentAttendance.map((item, idx) => (
                    <div key={idx} className="flex items-center gap-3 p-2 rounded-lg hover:bg-slate-50/50 transition-colors">
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-teal-50 ring-2 ring-teal-100">
                        <CheckCircle2 className="h-4 w-4 text-teal-600" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">{item.subjectName}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatDate(item.date)} — {formatTime(item.date)}
                        </p>
                      </div>
                      <Badge variant="secondary" className="bg-teal-50 text-teal-700 border-teal-100 text-xs">
                        {item.status}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>

        {/* Activity Timeline */}
        <motion.div variants={itemVariants}>
          <Card className="border-sky-100/50 shadow-sm h-full">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <Activity className="h-5 w-5 text-sky-600" />
                سجل النشاط
              </CardTitle>
            </CardHeader>
            <CardContent>
              {activityTimeline.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Activity className="h-10 w-10 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">لا يوجد نشاط بعد</p>
                </div>
              ) : (
                <div className="relative space-y-0 max-h-72 overflow-y-auto custom-scrollbar">
                  {/* Timeline line */}
                  <div className="absolute right-[15px] top-2 bottom-2 w-0.5 bg-sky-100" />

                  {activityTimeline.map((item, idx) => {
                    const iconMap = {
                      attendance: <CheckCircle2 className="h-4 w-4 text-teal-600" />,
                      quiz: <FileText className="h-4 w-4 text-sky-600" />,
                      assignment: <ClipboardList className="h-4 w-4 text-amber-600" />,
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
                      <div key={idx} className="relative flex items-start gap-3 py-2 px-1">
                        {/* Timeline dot */}
                        <div className={`relative z-10 flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full ring-2 ${bgMap[item.type]}`}>
                          {iconMap[item.type]}
                        </div>
                        {/* Content */}
                        <div className="flex-1 min-w-0 pt-0.5">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-medium text-gray-900">{item.title}</p>
                            <Badge variant="secondary" className={`text-[10px] px-1.5 py-0 ${badgeMap[item.type].className}`}>
                              {badgeMap[item.type].label}
                            </Badge>
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
      </div>
    </motion.div>
  );
}

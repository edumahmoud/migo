'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  User,
  Award,
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  Mail,
} from 'lucide-react';
import UserAvatar from '@/components/shared/user-avatar';
import UserLink from '@/components/shared/user-link';
import { supabase } from '@/lib/supabase';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { UserProfile, Score, AttendanceRecord, AttendanceSession, Submission, StudentPerformance } from '@/lib/types';

// -------------------------------------------------------
// Props
// -------------------------------------------------------
interface StudentProfileModalProps {
  studentId: string;
  subjectId: string;
  open: boolean;
  onClose: () => void;
}

// -------------------------------------------------------
// Helpers
// -------------------------------------------------------
function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString('ar-SA', { year: 'numeric', month: 'short', day: 'numeric' });
  } catch { return dateStr; }
}

// -------------------------------------------------------
// Main Component
// -------------------------------------------------------
export default function StudentProfileModal({ studentId, subjectId, open, onClose }: StudentProfileModalProps) {
  const [performance, setPerformance] = useState<StudentPerformance | null>(null);
  const [loading, setLoading] = useState(true);

  // -------------------------------------------------------
  // Fetch student performance data
  // -------------------------------------------------------
  const fetchPerformance = useCallback(async () => {
    setLoading(true);
    try {
      // Fetch student profile
      const { data: studentData } = await supabase
        .from('users')
        .select('*')
        .eq('id', studentId)
        .single();

      const student = studentData as UserProfile;

      // Fetch scores for quizzes in this subject
      const { data: quizzes } = await supabase
        .from('quizzes')
        .select('id')
        .eq('subject_id', subjectId);

      const quizIds = (quizzes || []).map((q: { id: string }) => q.id);
      let scores: Score[] = [];
      if (quizIds.length > 0) {
        const { data: scoresData } = await supabase
          .from('scores')
          .select('*')
          .eq('student_id', studentId)
          .in('quiz_id', quizIds);
        scores = (scoresData as Score[]) || [];
      }

      // Fetch attendance records for this subject
      const { data: sessions } = await supabase
        .from('attendance_sessions')
        .select('id')
        .eq('subject_id', subjectId);

      const sessionIds = (sessions || []).map((s: { id: string }) => s.id);
      let attendanceRecords: AttendanceRecord[] = [];
      let totalSessions = sessionIds.length;
      if (sessionIds.length > 0) {
        const { data: records } = await supabase
          .from('attendance_records')
          .select('*')
          .eq('student_id', studentId)
          .in('session_id', sessionIds);
        attendanceRecords = (records as AttendanceRecord[]) || [];
      }

      // Fetch submissions for assignments in this subject
      const { data: assignments } = await supabase
        .from('assignments')
        .select('id')
        .eq('subject_id', subjectId);

      const assignmentIds = (assignments || []).map((a: { id: string }) => a.id);
      let submissions: Submission[] = [];
      if (assignmentIds.length > 0) {
        const { data: subsData } = await supabase
          .from('submissions')
          .select('*')
          .eq('student_id', studentId)
          .in('assignment_id', assignmentIds);
        submissions = (subsData as Submission[]) || [];
      }

      const attendedSessions = attendanceRecords.length;
      const attendancePercentage = totalSessions > 0 ? Math.round((attendedSessions / totalSessions) * 100) : 0;
      const averageScore = scores.length > 0
        ? Math.round(scores.reduce((sum, s) => sum + (s.total > 0 ? (s.score / s.total) * 100 : 0), 0) / scores.length)
        : 0;

      setPerformance({
        student,
        scores,
        attendance_records: attendanceRecords,
        total_sessions: totalSessions,
        attended_sessions: attendedSessions,
        attendance_percentage: attendancePercentage,
        average_score: averageScore,
        submissions,
      });
    } catch (err) {
      console.error('Fetch performance error:', err);
    } finally {
      setLoading(false);
    }
  }, [studentId, subjectId]);

  useEffect(() => {
    if (open) fetchPerformance();
  }, [open, fetchPerformance]);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <User className="h-5 w-5 text-emerald-600" />
            ملف الطالب
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
          </div>
        ) : !performance ? (
          <div className="text-center py-12 text-muted-foreground">لم يتم العثور على بيانات الطالب</div>
        ) : (
          <ScrollArea className="max-h-[70vh]">
            <div className="space-y-5 pr-1">
              {/* Student info */}
              <UserLink
                userId={performance.student.id}
                name={performance.student.name}
                avatarUrl={performance.student.avatar_url}
                role="student"
                gender={performance.student.gender}
                size="xl"
                showAvatar={true}
                showUsername={false}
              />

              {/* Overall performance card */}
              <div className="rounded-xl border bg-emerald-50/50 p-4 space-y-3">
                <h5 className="text-sm font-semibold text-foreground flex items-center gap-2">
                  <Award className="h-4 w-4 text-emerald-600" />
                  الأداء العام
                </h5>
                <div className="flex items-center gap-4">
                  <div className="flex flex-col items-center">
                    <div className="relative h-16 w-16">
                      <svg className="h-16 w-16 -rotate-90" viewBox="0 0 36 36">
                        <path
                          d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                          fill="none"
                          stroke="#e5e7eb"
                          strokeWidth="3"
                        />
                        <path
                          d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                          fill="none"
                          stroke="#10b981"
                          strokeWidth="3"
                          strokeDasharray={`${performance.average_score}, 100`}
                        />
                      </svg>
                      <div className="absolute inset-0 flex items-center justify-center">
                        <span className="text-sm font-bold text-emerald-700">{performance.average_score}%</span>
                      </div>
                    </div>
                    <span className="text-xs text-muted-foreground mt-1">متوسط الدرجات</span>
                  </div>
                  <div className="flex-1 space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">الحضور</span>
                      <span className="font-medium text-foreground">{performance.attendance_percentage}%</span>
                    </div>
                    <Progress value={performance.attendance_percentage} className="h-2" />
                    <p className="text-xs text-muted-foreground">
                      {performance.attended_sessions} من {performance.total_sessions} جلسة
                    </p>
                  </div>
                </div>
              </div>

              {/* Scores list */}
              {performance.scores.length > 0 && (
                <div className="space-y-2">
                  <h5 className="text-sm font-semibold text-foreground flex items-center gap-2">
                    <Award className="h-4 w-4 text-emerald-600" />
                    نتائج الاختبارات
                  </h5>
                  <div className="space-y-2">
                    {performance.scores.map((score) => {
                      const pct = score.total > 0 ? Math.round((score.score / score.total) * 100) : 0;
                      return (
                        <div key={score.id} className="flex items-center justify-between rounded-lg border p-3">
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-foreground truncate">{score.quiz_title}</p>
                            <p className="text-xs text-muted-foreground mt-0.5">{formatDate(score.completed_at)}</p>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="text-sm font-bold text-foreground">{score.score}/{score.total}</span>
                            <Badge className={`text-[10px] ${
                              pct >= 80 ? 'bg-emerald-100 text-emerald-700' :
                              pct >= 60 ? 'bg-amber-100 text-amber-700' : 'bg-rose-100 text-rose-700'
                            }`}>
                              {pct}%
                            </Badge>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Submissions list */}
              {performance.submissions.length > 0 && (
                <div className="space-y-2">
                  <h5 className="text-sm font-semibold text-foreground flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                    التسليمات
                  </h5>
                  <div className="space-y-2">
                    {performance.submissions.map((sub) => (
                      <div key={sub.id} className="flex items-center justify-between rounded-lg border p-3">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-foreground truncate">
                            تسليم واجب
                          </p>
                          <p className="text-xs text-muted-foreground mt-0.5">{formatDate(sub.submitted_at)}</p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {sub.status === 'graded' && sub.score !== undefined && sub.score !== null ? (
                            <span className="text-sm font-bold text-emerald-700">{sub.score}</span>
                          ) : null}
                          <Badge className={`text-[10px] ${
                            sub.status === 'graded' ? 'bg-emerald-100 text-emerald-700' :
                            sub.status === 'submitted' ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'
                          }`}>
                            {sub.status === 'graded' ? 'تم التقييم' : sub.status === 'submitted' ? 'تم التسليم' : 'تم الإرجاع'}
                          </Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Empty states */}
              {performance.scores.length === 0 && performance.submissions.length === 0 && (
                <div className="text-center py-8 text-muted-foreground text-sm">
                  لا توجد بيانات أداء كافية بعد
                </div>
              )}
            </div>
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
  );
}

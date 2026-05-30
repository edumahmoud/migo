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
  TrendingUp,
  Shield,
  Zap,
  AlertTriangle,
  BarChart3,
  ClipboardList,
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
import type { UserProfile, Score, AttendanceRecord, Submission } from '@/lib/types';
import {
  computeAllMetrics,
  StudentPerformanceMetrics,
  getPerformanceLevel,
  getPerformanceLevelConfig,
  getEfficiencyLevelConfig,
  getRiskLevelConfig,
  getGrowthTrendConfig,
  DEFAULT_WEIGHTS,
} from '@/lib/performance-calculator';
import { useTranslations } from '@/i18n/use-translations';

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
  const { t, direction } = useTranslations();
  const [metrics, setMetrics] = useState<StudentPerformanceMetrics | null>(null);
  const [student, setStudent] = useState<UserProfile | null>(null);
  const [scores, setScores] = useState<Score[]>([]);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
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
      setStudent(studentData as UserProfile);

      // Fetch scores for quizzes in this subject
      const { data: quizzes } = await supabase
        .from('quizzes')
        .select('id')
        .eq('subject_id', subjectId);

      const quizIds = (quizzes || []).map((q: { id: string }) => q.id);
      let fetchedScores: Score[] = [];
      if (quizIds.length > 0) {
        const { data: scoresData } = await supabase
          .from('scores')
          .select('*')
          .eq('student_id', studentId)
          .in('quiz_id', quizIds);
        fetchedScores = (scoresData as Score[]) || [];
      }
      setScores(fetchedScores);

      // Fetch attendance records for this subject
      const { data: sessions } = await supabase
        .from('attendance_sessions')
        .select('id')
        .eq('subject_id', subjectId);

      const sessionIds = (sessions || []).map((s: { id: string }) => s.id);
      let attendanceRecords: { id: string; session_id: string; student_id: string; attendance_status?: 'present' | 'late' | 'partial' | 'absent' }[] = [];
      if (sessionIds.length > 0) {
        const { data: records } = await supabase
          .from('attendance_records')
          .select('id, session_id, student_id, attendance_status')
          .eq('student_id', studentId)
          .in('session_id', sessionIds);
        attendanceRecords = (records as AttendanceRecord[]) || [];
      }

      // Fetch submissions for assignments in this subject
      const { data: assignments } = await supabase
        .from('assignments')
        .select('id, max_score, due_date')
        .eq('subject_id', subjectId);

      const assignmentIds = (assignments || []).map((a: { id: string }) => a.id);
      let fetchedSubmissions: Submission[] = [];
      if (assignmentIds.length > 0) {
        const { data: subsData } = await supabase
          .from('submissions')
          .select('*')
          .eq('student_id', studentId)
          .in('assignment_id', assignmentIds);
        fetchedSubmissions = (subsData as Submission[]) || [];
      }
      setSubmissions(fetchedSubmissions);

      // Compute all metrics using the shared engine
      const computed = computeAllMetrics({
        scores: fetchedScores.map(s => ({ score: s.score, total: s.total, completed_at: s.completed_at, student_id: s.student_id })),
        attendanceSessions: sessionIds.map(id => ({ id })),
        attendanceRecords,
        submissions: fetchedSubmissions.map(s => ({
          assignment_id: s.assignment_id,
          student_id: s.student_id,
          score: s.score,
          status: s.status,
          submitted_at: s.submitted_at,
        })),
        assignments: (assignments || []).map((a: { id: string; max_score: number; due_date?: string }) => ({
          id: a.id,
          max_score: a.max_score,
          due_date: a.due_date,
        })),
        studentId,
      });

      setMetrics(computed);
    } catch (err) {
      console.error('Fetch performance error:', err);
    } finally {
      setLoading(false);
    }
  }, [studentId, subjectId]);

  useEffect(() => {
    if (open) fetchPerformance();
  }, [open, fetchPerformance]);

  const levelConfig = metrics ? getPerformanceLevelConfig(metrics.performanceLevel) : null;
  const efficiencyConfig = metrics ? getEfficiencyLevelConfig(metrics.efficiencyLevel) : null;
  const riskConfig = metrics ? getRiskLevelConfig(metrics.riskLevel) : null;
  const growthConfig = metrics ? getGrowthTrendConfig(metrics.growthTrend) : null;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto" dir={direction}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <User className="h-5 w-5 text-sky-700 dark:text-sky-400" />
            {t("studentProfileTitle")}
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-sky-700 dark:text-sky-400" />
          </div>
        ) : !metrics || !student ? (
          <div className="text-center py-12 text-muted-foreground">{t('studentDataNotFound')}</div>
        ) : (
          <ScrollArea className="max-h-[70vh]">
            <div className="space-y-5 pe-1">
              {/* Student info */}
              <UserLink
                userId={student.id}
                name={student.name}
                avatarUrl={student.avatar_url}
                role="student"
                gender={student.gender}
                size="lg"
                showAvatar={true}
                showUsername={false}
              />

              {/* Overall performance card */}
              <div className="rounded-xl border bg-sky-50/50 dark:bg-sky-900/15 p-4 space-y-3">
                <h5 className="text-sm font-semibold text-foreground flex items-center gap-2">
                  <Award className="h-4 w-4 text-sky-700 dark:text-sky-400" />
                  {t("overallPerformance")}
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
                          stroke="#0D9488"
                          strokeWidth="3"
                          strokeDasharray={`${Math.round(metrics.overallPerformance)}, 100`}
                        />
                      </svg>
                      <div className="absolute inset-0 flex items-center justify-center">
                        <span className="text-sm font-bold text-sky-800 dark:text-sky-400">{Math.round(metrics.overallPerformance)}%</span>
                      </div>
                    </div>
                    {levelConfig && (
                      <Badge className={`text-[9px] mt-1 ${levelConfig.bgColor} ${levelConfig.textColor} border-0`}>
                        {t(levelConfig.key === 'excellent' ? 'teacher.trackingLevelExcellent' : levelConfig.key === 'veryGood' ? 'teacher.trackingLevelVeryGood' : levelConfig.key === 'good' ? 'teacher.trackingLevelGood' : levelConfig.key === 'acceptable' ? 'teacher.trackingLevelAcceptable' : 'teacher.trackingLevelWeak')}
                      </Badge>
                    )}
                  </div>
                  <div className="flex-1 space-y-2">
                    {/* Exam Performance */}
                    <div>
                      <div className="flex items-center justify-between text-xs mb-0.5">
                        <span className="text-muted-foreground">{t('teacher.trackingExamPerformance')}</span>
                        <span className="font-medium">{Math.round(metrics.examPerformance)}%</span>
                      </div>
                      <Progress value={Math.round(metrics.examPerformance)} className="h-1.5" />
                    </div>
                    {/* Attendance Score */}
                    <div>
                      <div className="flex items-center justify-between text-xs mb-0.5">
                        <span className="text-muted-foreground">{t('teacher.trackingAttendanceScore')}</span>
                        <span className="font-medium">{Math.round(metrics.attendanceScore)}%</span>
                      </div>
                      <Progress value={Math.round(metrics.attendanceScore)} className="h-1.5" />
                    </div>
                    {/* Assignment Compliance */}
                    <div>
                      <div className="flex items-center justify-between text-xs mb-0.5">
                        <span className="text-muted-foreground">{t('teacher.trackingAssignCompliance')}</span>
                        <span className="font-medium">{Math.round(metrics.assignmentCompliance)}%</span>
                      </div>
                      <Progress value={Math.round(metrics.assignmentCompliance)} className="h-1.5" />
                    </div>
                    {/* Assignment Quality */}
                    <div>
                      <div className="flex items-center justify-between text-xs mb-0.5">
                        <span className="text-muted-foreground">{t('teacher.trackingAssignQuality')}</span>
                        <span className="font-medium">{Math.round(metrics.assignmentQuality)}%</span>
                      </div>
                      <Progress value={Math.round(metrics.assignmentQuality)} className="h-1.5" />
                    </div>
                  </div>
                </div>
              </div>

              {/* KPI Cards Row */}
              <div className="grid grid-cols-3 gap-2">
                {/* Efficiency */}
                <div className="rounded-lg border p-3 text-center">
                  <Zap className="h-4 w-4 mx-auto text-violet-600 mb-1" />
                  <p className={`text-lg font-bold ${efficiencyConfig?.textColor || 'text-gray-500'}`}>
                    {metrics.efficiencyLevel === 'insufficient' ? '—' : `${Math.round(metrics.efficiency)}%`}
                  </p>
                  <p className="text-[10px] text-muted-foreground">{t('teacher.trackingEfficiency')}</p>
                  {efficiencyConfig && (
                    <Badge className={`text-[8px] mt-0.5 ${efficiencyConfig.bgColor} ${efficiencyConfig.textColor} border-0`}>
                      {metrics.efficiencyLevel === 'insufficient' ? t('teacher.trackingEfficiencyInsufficient') :
                       metrics.efficiencyLevel === 'high' ? t('teacher.trackingEfficiencyHigh') :
                       metrics.efficiencyLevel === 'medium' ? t('teacher.trackingEfficiencyMedium') : t('teacher.trackingEfficiencyLow')}
                    </Badge>
                  )}
                </div>

                {/* Discipline */}
                <div className="rounded-lg border p-3 text-center">
                  <Shield className="h-4 w-4 mx-auto text-teal-600 mb-1" />
                  <p className="text-lg font-bold text-teal-700 dark:text-teal-500">{Math.round(metrics.disciplineScore)}%</p>
                  <p className="text-[10px] text-muted-foreground">{t('teacher.trackingDisciplineScore')}</p>
                </div>

                {/* Risk */}
                <div className="rounded-lg border p-3 text-center">
                  <AlertTriangle className="h-4 w-4 mx-auto mb-1" style={{ color: riskConfig?.textColor?.includes('emerald') ? '#059669' : riskConfig?.textColor?.includes('amber') ? '#d97706' : riskConfig?.textColor?.includes('orange') ? '#ea580c' : '#e11d48' }} />
                  <p className={`text-lg font-bold ${riskConfig?.textColor || 'text-gray-500'}`}>
                    {riskConfig && (metrics.riskLevel === 'healthy' ? t('teacher.trackingRiskHealthy') :
                     metrics.riskLevel === 'monitor' ? t('teacher.trackingRiskMonitor') :
                     metrics.riskLevel === 'concern' ? t('teacher.trackingRiskConcern') : t('teacher.trackingRiskAtRisk'))}
                  </p>
                  <p className="text-[10px] text-muted-foreground">{t('teacher.trackingRiskLevel')}</p>
                </div>
              </div>

              {/* Growth Index */}
              <div className="rounded-lg border p-3 flex items-center gap-3">
                <div className={`flex h-8 w-8 items-center justify-center rounded-full ${growthConfig?.color || 'bg-gray-100'} text-white text-sm font-bold`}>
                  {growthConfig?.icon || '→'}
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium text-foreground">{t('teacher.trackingGrowthIndex')}</p>
                  <p className="text-xs text-muted-foreground">
                    {metrics.growthTrend === 'improving' ? t('teacher.trackingGrowthImproving') :
                     metrics.growthTrend === 'stable' ? t('teacher.trackingGrowthStable') : t('teacher.trackingGrowthDeclining')}
                    {' · '}
                    {metrics.growthIndex.toFixed(2)}x
                  </p>
                </div>
              </div>

              {/* Risk Reasons */}
              {metrics.riskReasons.length > 0 && (
                <div className="rounded-lg border border-rose-100 dark:border-rose-900/30 bg-rose-50/50 dark:bg-rose-900/10 p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <AlertTriangle className="h-4 w-4 text-rose-600" />
                    <span className="text-xs font-medium text-rose-700 dark:text-rose-500">{t('teacher.trackingRiskLevel')}</span>
                  </div>
                  <ul className="space-y-1">
                    {metrics.riskReasons.map((reason, idx) => (
                      <li key={idx} className="text-xs text-rose-600 dark:text-rose-500 flex items-center gap-1.5">
                        <span className="h-1 w-1 rounded-full bg-rose-400" />
                        {t(`teacher.trackingRiskReason${reason.charAt(0).toUpperCase() + reason.slice(1)}` as Parameters<typeof t>[0])}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Weighted breakdown */}
              <div className="rounded-lg border p-3 bg-gradient-to-l from-sky-50/80 to-teal-50/80 dark:from-sky-900/10 dark:to-teal-900/10">
                <h5 className="text-xs font-medium text-muted-foreground mb-2">{t('teacher.trackingOverallPerformanceCalc')}</h5>
                <div className="grid grid-cols-4 gap-2 text-center">
                  <div>
                    <p className="text-[10px] text-muted-foreground">{DEFAULT_WEIGHTS.examPerformance}%</p>
                    <p className="text-xs font-bold text-sky-700 dark:text-sky-400">{Math.round(metrics.examPerformance * DEFAULT_WEIGHTS.examPerformance / 100)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground">{DEFAULT_WEIGHTS.attendanceScore}%</p>
                    <p className="text-xs font-bold text-teal-700 dark:text-teal-500">{Math.round(metrics.attendanceScore * DEFAULT_WEIGHTS.attendanceScore / 100)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground">{DEFAULT_WEIGHTS.assignmentCompliance}%</p>
                    <p className="text-xs font-bold text-amber-700 dark:text-amber-500">{Math.round(metrics.assignmentCompliance * DEFAULT_WEIGHTS.assignmentCompliance / 100)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground">{DEFAULT_WEIGHTS.assignmentQuality}%</p>
                    <p className="text-xs font-bold text-violet-700 dark:text-violet-500">{Math.round(metrics.assignmentQuality * DEFAULT_WEIGHTS.assignmentQuality / 100)}</p>
                  </div>
                </div>
              </div>

              {/* Scores list */}
              {scores.length > 0 && (
                <div className="space-y-2">
                  <h5 className="text-sm font-semibold text-foreground flex items-center gap-2">
                    <BarChart3 className="h-4 w-4 text-sky-700 dark:text-sky-400" />
                    {t("quizResults")}
                  </h5>
                  <div className="space-y-2 max-h-48 overflow-y-auto custom-scrollbar">
                    {scores.map((score) => {
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
                              pct >= 80 ? 'bg-sky-100 dark:bg-sky-800/40 text-sky-800 dark:text-sky-400' :
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
              {submissions.length > 0 && (
                <div className="space-y-2">
                  <h5 className="text-sm font-semibold text-foreground flex items-center gap-2">
                    <ClipboardList className="h-4 w-4 text-sky-700 dark:text-sky-400" />
                    {t("submissionsLabel")}
                  </h5>
                  <div className="space-y-2 max-h-48 overflow-y-auto custom-scrollbar">
                    {submissions.map((sub) => (
                      <div key={sub.id} className="flex items-center justify-between rounded-lg border p-3">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-foreground truncate">
                            {t("assignmentSubmission")}
                          </p>
                          <p className="text-xs text-muted-foreground mt-0.5">{formatDate(sub.submitted_at)}</p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {sub.status === 'graded' && sub.score !== undefined && sub.score !== null ? (
                            <span className="text-sm font-bold text-sky-800 dark:text-sky-400">{sub.score}</span>
                          ) : null}
                          <Badge className={`text-[10px] ${
                            sub.status === 'graded' ? 'bg-sky-100 dark:bg-sky-800/40 text-sky-800 dark:text-sky-400' :
                            sub.status === 'submitted' ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'
                          }`}>
                            {sub.status === 'graded' ? t('gradedStatus') : sub.status === 'submitted' ? t('submittedStatus') : t('returnedStatus')}
                          </Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Empty states */}
              {scores.length === 0 && submissions.length === 0 && (
                <div className="text-center py-8 text-muted-foreground text-sm">
                  {t("noPerformanceData")}
                </div>
              )}
            </div>
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
  );
}

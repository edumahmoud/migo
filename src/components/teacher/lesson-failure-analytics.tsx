'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  BarChart3,
  AlertTriangle,
  BookOpen,
  Layers,
  Loader2,
  TrendingDown,
  Users,
  CheckCircle2,
  XCircle,
  Clock,
  Target,
  AlertCircle,
} from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from 'recharts';
import { getCachedAuthHeaders } from '@/lib/client-auth';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { Subject, LessonProgress, LessonUnit } from '@/lib/types';
import { useTranslations } from '@/i18n/use-translations';

interface LessonFailureAnalyticsProps {
  subjects: Subject[];
}

const STATUS_COLORS: Record<string, string> = {
  completed: '#10b981',
  in_progress: '#3b82f6',
  failed: '#ef4444',
  not_started: '#9ca3af',
  locked: '#6b7280',
};

const STATUS_LABELS_AR: Record<string, string> = {
  completed: 'مكتمل',
  in_progress: 'قيد التنفيذ',
  failed: 'أخفق',
  not_started: 'لم يبدأ',
  locked: 'مقفل',
};

const STATUS_LABELS_EN: Record<string, string> = {
  completed: 'Completed',
  in_progress: 'In Progress',
  failed: 'Failed',
  not_started: 'Not Started',
  locked: 'Locked',
};

export default function LessonFailureAnalytics({ subjects }: LessonFailureAnalyticsProps) {
  const { t } = useTranslations('tracking');
  const { t: tCommon } = useTranslations('common');
  const [selectedSubjectId, setSelectedSubjectId] = useState<string>(subjects[0]?.id || '');
  const [progress, setProgress] = useState<LessonProgress[]>([]);
  const [units, setUnits] = useState<LessonUnit[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (subjects.length > 0 && !selectedSubjectId) {
      setSelectedSubjectId(subjects[0].id);
    }
  }, [subjects, selectedSubjectId]);

  const fetchProgress = useCallback(async () => {
    if (!selectedSubjectId) {
      setProgress([]);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/lessons/progress?subject_id=${selectedSubjectId}`, {
        headers: await getCachedAuthHeaders(),
      });
      if (!res.ok) throw new Error('Failed to fetch progress');
      const data = await res.json();
      setProgress(data.progress || []);
    } catch (err) {
      console.error('[LessonFailureAnalytics] Fetch error:', err);
      setProgress([]);
    } finally {
      setLoading(false);
    }
  }, [selectedSubjectId]);

  const fetchUnits = useCallback(async () => {
    if (!selectedSubjectId) {
      setUnits([]);
      return;
    }
    try {
      const res = await fetch(`/api/lesson-units?subject_id=${selectedSubjectId}`, {
        headers: await getCachedAuthHeaders(),
      });
      if (!res.ok) throw new Error('Failed to fetch units');
      const data = await res.json();
      setUnits(data.units || []);
    } catch (err) {
      console.error('[LessonFailureAnalytics] Units fetch error:', err);
      setUnits([]);
    }
  }, [selectedSubjectId]);

  useEffect(() => {
    fetchProgress();
    fetchUnits();
  }, [fetchProgress, fetchUnits]);

  // ─── Analytics: lessons with most failures ───
  const lessonFailureStats = useMemo(() => {
    const byLesson = new Map<string, { lesson_id: string; lesson_title: string; unit_title?: string; failed: number; in_progress: number; completed: number; total: number; avg_score: number; failed_attempts: number }>();
    for (const p of progress) {
      const key = p.lesson_id;
      if (!byLesson.has(key)) {
        byLesson.set(key, {
          lesson_id: p.lesson_id,
          lesson_title: p.lesson_title || 'Untitled',
          unit_title: p.unit_title || undefined,
          failed: 0,
          in_progress: 0,
          completed: 0,
          total: 0,
          avg_score: 0,
          failed_attempts: 0,
        });
      }
      const stat = byLesson.get(key)!;
      stat.total += 1;
      if (p.status === 'failed') stat.failed += 1;
      if (p.status === 'in_progress') stat.in_progress += 1;
      if (p.status === 'completed') stat.completed += 1;
      stat.failed_attempts += p.failed_attempts || 0;
      if (p.score_percentage != null) {
        stat.avg_score += Number(p.score_percentage);
      }
    }
    const stats = Array.from(byLesson.values());
    for (const s of stats) {
      s.avg_score = s.total > 0 ? Math.round(s.avg_score / s.total) : 0;
    }
    // Sort by failure count descending
    return stats.sort((a, b) => b.failed - a.failed || b.failed_attempts - a.failed_attempts);
  }, [progress]);

  // ─── Analytics: unit-level aggregations ───
  const unitFailureStats = useMemo(() => {
    const byUnit = new Map<string, { unit_id: string; unit_title: string; total: number; failed: number; completed: number; in_progress: number; failed_attempts: number; avg_score: number }>();
    for (const p of progress) {
      if (!p.unit_id) continue;
      if (!byUnit.has(p.unit_id)) {
        byUnit.set(p.unit_id, {
          unit_id: p.unit_id,
          unit_title: p.unit_title || 'Untitled Unit',
          total: 0,
          failed: 0,
          completed: 0,
          in_progress: 0,
          failed_attempts: 0,
          avg_score: 0,
        });
      }
      const stat = byUnit.get(p.unit_id)!;
      stat.total += 1;
      if (p.status === 'failed') stat.failed += 1;
      if (p.status === 'completed') stat.completed += 1;
      if (p.status === 'in_progress') stat.in_progress += 1;
      stat.failed_attempts += p.failed_attempts || 0;
      if (p.score_percentage != null) {
        stat.avg_score += Number(p.score_percentage);
      }
    }
    const stats = Array.from(byUnit.values());
    for (const s of stats) {
      s.avg_score = s.total > 0 ? Math.round(s.avg_score / s.total) : 0;
    }
    return stats.sort((a, b) => b.failed - a.failed);
  }, [progress]);

  // ─── Status distribution pie chart data ───
  const statusDistribution = useMemo(() => {
    const dist: Record<string, number> = { completed: 0, in_progress: 0, failed: 0, not_started: 0, locked: 0 };
    for (const p of progress) {
      dist[p.status] = (dist[p.status] || 0) + 1;
    }
    return Object.entries(dist)
      .filter(([, v]) => v > 0)
      .map(([k, v]) => ({ name: k, value: v }));
  }, [progress]);

  // ─── KPI stats ───
  const kpiStats = useMemo(() => {
    const totalRecords = progress.length;
    const completed = progress.filter((p) => p.status === 'completed').length;
    const failed = progress.filter((p) => p.status === 'failed').length;
    const inProgress = progress.filter((p) => p.status === 'in_progress').length;
    const completionRate = totalRecords > 0 ? Math.round((completed / totalRecords) * 100) : 0;
    const failureRate = totalRecords > 0 ? Math.round((failed / totalRecords) * 100) : 0;
    const totalFailedAttempts = progress.reduce((sum, p) => sum + (p.failed_attempts || 0), 0);
    const avgScore = totalRecords > 0
      ? Math.round(progress.reduce((s, p) => s + (Number(p.score_percentage) || 0), 0) / totalRecords)
      : 0;
    return { totalRecords, completed, failed, inProgress, completionRate, failureRate, totalFailedAttempts, avgScore };
  }, [progress]);

  if (subjects.length === 0) {
    return (
      <div className="text-center py-12">
        <BarChart3 className="h-12 w-12 mx-auto text-muted-foreground/40 mb-3" />
        <p className="text-sm text-muted-foreground">
          {t('noLessonProgress')}
        </p>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="space-y-5"
    >
      {/* Header & subject selector */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            {t('lessonFailuresTitle')}
          </h3>
          <p className="text-sm text-muted-foreground mt-1">
            {t('lessonFailuresDesc')}
          </p>
        </div>
        <Select value={selectedSubjectId} onValueChange={setSelectedSubjectId}>
          <SelectTrigger className="w-full sm:w-[280px]">
            <BookOpen className="h-4 w-4 me-2" />
            <SelectValue placeholder={tCommon('selectSubject') || 'Select subject'} />
          </SelectTrigger>
          <SelectContent>
            {subjects.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : progress.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <BarChart3 className="h-12 w-12 text-muted-foreground/40 mb-3" />
            <p className="text-sm text-muted-foreground max-w-md">
              {t('noLessonProgress')}
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Card>
              <CardContent className="pt-4 pb-3 px-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-xs text-muted-foreground">{t('completionRate')}</div>
                    <div className="text-2xl font-bold text-emerald-600">{kpiStats.completionRate}%</div>
                  </div>
                  <CheckCircle2 className="h-8 w-8 text-emerald-500/30" />
                </div>
                <div className="text-[10px] text-muted-foreground mt-1">
                  {kpiStats.completed} / {kpiStats.totalRecords}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-3 px-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-xs text-muted-foreground">{t('failureRate')}</div>
                    <div className="text-2xl font-bold text-rose-600">{kpiStats.failureRate}%</div>
                  </div>
                  <XCircle className="h-8 w-8 text-rose-500/30" />
                </div>
                <div className="text-[10px] text-muted-foreground mt-1">
                  {kpiStats.failed} {t('failed')}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-3 px-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-xs text-muted-foreground">{t('failedAttempts')}</div>
                    <div className="text-2xl font-bold text-amber-600">{kpiStats.totalFailedAttempts}</div>
                  </div>
                  <AlertCircle className="h-8 w-8 text-amber-500/30" />
                </div>
                <div className="text-[10px] text-muted-foreground mt-1">
                  {t('avgScore')}: {kpiStats.avgScore}%
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-3 px-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-xs text-muted-foreground">{t('inProgress')}</div>
                    <div className="text-2xl font-bold text-blue-600">{kpiStats.inProgress}</div>
                  </div>
                  <Clock className="h-8 w-8 text-blue-500/30" />
                </div>
                <div className="text-[10px] text-muted-foreground mt-1">
                  {kpiStats.totalRecords} {tCommon('total') || 'Total'}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Status distribution pie + Lesson failures bar */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Pie chart */}
            <Card className="lg:col-span-1">
              <CardHeader>
                <CardTitle className="text-sm">{t('lessonStatus') || 'Lesson Status'}</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie
                      data={statusDistribution}
                      cx="50%"
                      cy="50%"
                      outerRadius={70}
                      dataKey="value"
                      label={(entry: any) => `${entry.value}`}
                    >
                      {statusDistribution.map((entry, i) => (
                        <Cell key={i} fill={STATUS_COLORS[entry.name] || '#9ca3af'} />
                      ))}
                    </Pie>
                    <Tooltip />
                    <Legend
                      formatter={(value: string) => {
                        const map = STATUS_LABELS_AR[value] || value;
                        return <span className="text-xs">{map}</span>;
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Lesson failures bar chart */}
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  <TrendingDown className="h-4 w-4 text-rose-500" />
                  {t('lessonFailurePoints')}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {lessonFailureStats.filter((s) => s.failed > 0).length === 0 ? (
                  <div className="h-[220px] flex items-center justify-center text-sm text-muted-foreground">
                    <CheckCircle2 className="h-5 w-5 me-2 text-emerald-500" />
                    {t('noLessonProgress')}
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height={Math.max(220, lessonFailureStats.filter((s) => s.failed > 0).length * 36)}>
                    <BarChart data={lessonFailureStats.filter((s) => s.failed > 0).slice(0, 10)} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                      <XAxis type="number" />
                      <YAxis
                        type="category"
                        dataKey="lesson_title"
                        width={120}
                        tick={{ fontSize: 11 }}
                        tickFormatter={(v) => (v.length > 18 ? v.slice(0, 18) + '…' : v)}
                      />
                      <Tooltip />
                      <Bar dataKey="failed" name={t('failed') || 'Failed'} fill="#ef4444" radius={[0, 4, 4, 0]} />
                      <Bar dataKey="completed" name={t('completed') || 'Completed'} fill="#10b981" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Unit-level failures table */}
          {unitFailureStats.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  <Layers className="h-4 w-4 text-purple-500" />
                  {t('unitFailurePoints')}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-start text-xs text-muted-foreground">
                        <th className="py-2 px-2 text-start font-medium">{t('studentsPerUnit') || 'Unit'}</th>
                        <th className="py-2 px-2 text-center font-medium">{t('completed') || 'Completed'}</th>
                        <th className="py-2 px-2 text-center font-medium">{t('inProgress') || 'In Progress'}</th>
                        <th className="py-2 px-2 text-center font-medium">{t('failed') || 'Failed'}</th>
                        <th className="py-2 px-2 text-center font-medium">{t('failedAttempts') || 'Failed Attempts'}</th>
                        <th className="py-2 px-2 text-center font-medium">{t('avgScore') || 'Avg Score'}</th>
                        <th className="py-2 px-2 text-center font-medium">{t('failureRate') || 'Failure Rate'}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {unitFailureStats.map((u) => {
                        const failRate = u.total > 0 ? Math.round((u.failed / u.total) * 100) : 0;
                        return (
                          <tr key={u.unit_id} className="border-b hover:bg-muted/30">
                            <td className="py-2.5 px-2 font-medium">{u.unit_title}</td>
                            <td className="py-2.5 px-2 text-center">
                              <Badge variant="outline" className="text-emerald-700 bg-emerald-50">{u.completed}</Badge>
                            </td>
                            <td className="py-2.5 px-2 text-center">
                              <Badge variant="outline" className="text-blue-700 bg-blue-50">{u.in_progress}</Badge>
                            </td>
                            <td className="py-2.5 px-2 text-center">
                              <Badge variant="outline" className="text-rose-700 bg-rose-50">{u.failed}</Badge>
                            </td>
                            <td className="py-2.5 px-2 text-center">{u.failed_attempts}</td>
                            <td className="py-2.5 px-2 text-center">{u.avg_score}%</td>
                            <td className="py-2.5 px-2 text-center">
                              <div className="flex items-center justify-center gap-2">
                                <div className="w-16 h-2 bg-muted rounded-full overflow-hidden">
                                  <div
                                    className={`h-full ${failRate > 30 ? 'bg-rose-500' : failRate > 15 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                                    style={{ width: `${failRate}%` }}
                                  />
                                </div>
                                <span className="text-xs">{failRate}%</span>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Lesson-level failures table */}
          {lessonFailureStats.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  <BookOpen className="h-4 w-4 text-blue-500" />
                  {t('studentsPerLesson') || 'Per-Lesson Breakdown'}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-xs text-muted-foreground">
                        <th className="py-2 px-2 text-start font-medium">{t('studentsPerLesson') || 'Lesson'}</th>
                        <th className="py-2 px-2 text-start font-medium">{t('unitFailurePoints') || 'Unit'}</th>
                        <th className="py-2 px-2 text-center font-medium">{t('completed') || 'Completed'}</th>
                        <th className="py-2 px-2 text-center font-medium">{t('failed') || 'Failed'}</th>
                        <th className="py-2 px-2 text-center font-medium">{t('failedAttempts') || 'Failed Attempts'}</th>
                        <th className="py-2 px-2 text-center font-medium">{t('avgScore') || 'Avg Score'}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lessonFailureStats.slice(0, 20).map((l) => (
                        <tr key={l.lesson_id} className="border-b hover:bg-muted/30">
                          <td className="py-2 px-2 font-medium max-w-[260px] truncate">
                            <BookOpen className="h-3 w-3 inline me-1 text-muted-foreground" />
                            {l.lesson_title}
                          </td>
                          <td className="py-2 px-2 text-xs">
                            {l.unit_title ? (
                              <Badge variant="secondary" className="text-[10px]">
                                <Layers className="h-2.5 w-2.5 me-1" />
                                {l.unit_title}
                              </Badge>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                          <td className="py-2 px-2 text-center">
                            <Badge variant="outline" className="text-emerald-700 bg-emerald-50">{l.completed}</Badge>
                          </td>
                          <td className="py-2 px-2 text-center">
                            <Badge variant="outline" className="text-rose-700 bg-rose-50">{l.failed}</Badge>
                          </td>
                          <td className="py-2 px-2 text-center">{l.failed_attempts}</td>
                          <td className="py-2 px-2 text-center">{l.avg_score}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </motion.div>
  );
}

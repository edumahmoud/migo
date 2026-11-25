'use client';

import { useState, useEffect, useCallback } from 'react';
import { Award, BookOpen, ClipboardList, FileSpreadsheet, ChevronDown, RefreshCw, Loader2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { toast } from 'sonner';
import { useTranslations } from '@/i18n/use-translations';
import type { CourseGrades, GradeItem } from '@/lib/gradebook';
import { letterGrade } from '@/lib/gradebook';
import MascotLoader from '@/components/shared/mascot-loader';

function letterColor(p: number | null): string {
  if (p === null) return 'bg-muted text-muted-foreground';
  if (p >= 90) return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300';
  if (p >= 80) return 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300';
  if (p >= 70) return 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300';
  if (p >= 60) return 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300';
  return 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300';
}

export default function StudentGradesSection() {
  const { t, locale } = useTranslations();
  const [courses, setCourses] = useState<CourseGrades[]>([]);
  const [overall, setOverall] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { getCachedAuthHeaders } = await import('@/lib/client-auth');
      const headers = await getCachedAuthHeaders();
      const res = await fetch('/api/student/grades', { headers, cache: 'no-store' });
      const json = await res.json();
      if (!json.success) { toast.error(json.error || t('grades.loadFailed')); return; }
      setCourses(json.courses || []);
      setOverall(json.overall ?? null);
      if ((json.courses || []).length === 1) setOpen({ [json.courses[0].subjectId]: true });
    } catch {
      toast.error(t('grades.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { load(); }, [load]);

  const fmtDate = (d: string | null) => {
    if (!d) return '';
    try { return new Date(d).toLocaleDateString(locale === 'en' ? 'en-GB' : 'ar-EG', { day: 'numeric', month: 'short', year: 'numeric' }); } catch { return ''; }
  };

  const statusBadge = (it: GradeItem) => {
    switch (it.status) {
      case 'submitted': return <Badge variant="secondary" className="text-[11px]">{t('grades.statusSubmitted')}</Badge>;
      case 'missing': return <Badge variant="outline" className="text-[11px] text-rose-600 border-rose-200">{t('grades.statusMissing')}</Badge>;
      case 'not_taken': return <Badge variant="outline" className="text-[11px]">{t('grades.statusNotTaken')}</Badge>;
      case 'hidden': return <Badge variant="secondary" className="text-[11px]">{t('grades.statusHidden')}</Badge>;
      default: return null;
    }
  };

  if (loading) {
    return (<div className="flex justify-center py-20"><MascotLoader kind="ai" size={96} /></div>);
  }

  const gradedTotal = courses.reduce((n, c) => n + c.gradedCount, 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2"><Award className="h-5 w-5 text-emerald-600" />{t('grades.title')}</h1>
          <p className="text-sm text-muted-foreground">{t('grades.subtitle')}</p>
        </div>
        <Button variant="outline" size="sm" onClick={load} className="gap-1.5">
          <RefreshCw className="h-4 w-4" />{t('grades.refresh')}
        </Button>
      </div>

      {courses.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">
          <BookOpen className="h-10 w-10 mx-auto mb-2 opacity-40" />{t('grades.empty')}
        </CardContent></Card>
      ) : (
        <>
          <Card>
            <CardContent className="p-4 flex items-center gap-4">
              <div className={`h-16 w-16 rounded-2xl flex items-center justify-center text-2xl font-bold ${letterColor(overall)}`}>
                {overall === null ? '–' : letterGrade(overall)}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs text-muted-foreground">{t('grades.overall')}</p>
                <p className="text-2xl font-bold">{overall === null ? t('grades.noGradesYet') : `${overall}%`}</p>
                <p className="text-xs text-muted-foreground">{t('grades.summaryLine', { courses: courses.length, graded: gradedTotal })}</p>
              </div>
            </CardContent>
          </Card>

          {courses.map((c) => {
            const isOpen = !!open[c.subjectId];
            return (
              <Card key={c.subjectId} className="overflow-hidden">
                <button
                  type="button"
                  onClick={() => setOpen((o) => ({ ...o, [c.subjectId]: !o[c.subjectId] }))}
                  className="w-full text-start p-4 flex items-center gap-3 hover:bg-muted/40 transition-colors"
                  aria-expanded={isOpen}
                >
                  <span className="h-10 w-1.5 rounded-full shrink-0" style={{ backgroundColor: c.color || '#10b981' }} />
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold truncate">{c.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {c.percent === null
                        ? t('grades.noGradesYet')
                        : t('grades.pointsLine', { earned: c.earned, possible: c.possible })}
                      {' · '}{t('grades.itemsLine', { graded: c.gradedCount, total: c.totalCount })}
                    </p>
                    {c.percent !== null && <Progress value={c.percent} className="h-1.5 mt-2" />}
                  </div>
                  <div className="text-end shrink-0">
                    <span className={`inline-block rounded-lg px-2.5 py-1 text-sm font-bold ${letterColor(c.percent)}`}>
                      {c.percent === null ? '–' : `${c.letter} · ${c.percent}%`}
                    </span>
                  </div>
                  <ChevronDown className={`h-4 w-4 text-muted-foreground shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                </button>

                {isOpen && (
                  <div className="border-t divide-y">
                    {c.items.length === 0 ? (
                      <p className="p-4 text-sm text-muted-foreground">{t('grades.noItems')}</p>
                    ) : c.items.map((it) => {
                      const pct = it.status === 'graded' && it.score !== null && it.max > 0 ? Math.round((it.score / it.max) * 1000) / 10 : null;
                      return (
                        <div key={`${it.type}-${it.id}`} className="px-4 py-3 flex items-center gap-3">
                          <span className="h-8 w-8 rounded-lg bg-muted flex items-center justify-center shrink-0">
                            {it.type === 'quiz' ? <ClipboardList className="h-4 w-4" /> : <FileSpreadsheet className="h-4 w-4" />}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium truncate">{it.title}</p>
                            <p className="text-xs text-muted-foreground">
                              {it.type === 'quiz' ? t('grades.typeQuiz') : t('grades.typeAssignment')}
                              {it.date ? ` · ${fmtDate(it.date)}` : ''}
                            </p>
                            {it.feedback && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{it.feedback}</p>}
                          </div>
                          <div className="text-end shrink-0">
                            {it.status === 'graded' && it.score !== null ? (
                              <>
                                <p className="text-sm font-bold">{it.score} / {it.max}</p>
                                <p className="text-xs text-muted-foreground">{pct}%</p>
                              </>
                            ) : statusBadge(it)}
                          </div>
                        </div>
                      );
                    })}
                    <p className="px-4 py-2 text-[11px] text-muted-foreground bg-muted/30">{t('grades.footnote')}</p>
                  </div>
                )}
              </Card>
            );
          })}
        </>
      )}
    </div>
  );
}

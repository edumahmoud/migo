'use client';

import { useState, useEffect, useCallback, Fragment, type ReactNode } from 'react';
import { Award, BookOpen, ClipboardList, FileSpreadsheet, ChevronDown, RefreshCw } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { useTranslations } from '@/i18n/use-translations';
import type { CourseGrades, GradeItem } from '@/lib/gradebook';
import { letterGrade, computeTotals } from '@/lib/gradebook';
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
  const pctText = (p: number | null) => (p === null ? '–' : `${p}%`);
  const ltr = (v: ReactNode) => <bdi dir="ltr">{v}</bdi>;

  const openCourse = (id: string) => {
    setOpen((o) => ({ ...o, [id]: true }));
    setTimeout(() => document.getElementById(`grades-course-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  };

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
          {/* Overview report: one row per subject */}
          <Card className="overflow-hidden">
            <div className="px-4 pt-4 pb-2 flex items-center gap-3">
              <div className={`h-12 w-12 rounded-xl flex items-center justify-center text-xl font-bold ${letterColor(overall)}`}>
                {overall === null ? '–' : letterGrade(overall)}
              </div>
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">{t('grades.overall')}</p>
                <p className="text-lg font-bold leading-tight">{overall === null ? t('grades.noGradesYet') : `${overall}%`}</p>
                <p className="text-xs text-muted-foreground">{t('grades.summaryLine', { courses: courses.length, graded: gradedTotal })}</p>
              </div>
            </div>
            {/* Phone: one compact row per subject, no sideways scrolling */}
            <div className="md:hidden divide-y border-t">
              {courses.map((c) => (
                <button key={c.subjectId} type="button" onClick={() => openCourse(c.subjectId)} className="w-full text-start px-4 py-3 flex items-center gap-3 hover:bg-muted/30">
                  <span className="h-8 w-1 rounded-full shrink-0" style={{ backgroundColor: c.color || '#10b981' }} />
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold truncate">{c.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {t('grades.colQuizzes')} {ltr(pctText(c.quizAvg))} · {t('grades.colAssignments')} {ltr(pctText(c.assignmentAvg))}
                    </p>
                    <p className="text-xs text-muted-foreground">{t('grades.colPoints')}: {c.percent === null ? '–' : ltr(`${c.earned} / ${c.possible}`)}</p>
                  </div>
                  <span className={`rounded-lg px-2.5 py-1 text-sm font-bold shrink-0 ${letterColor(c.percent)}`}>
                    {c.percent === null ? '–' : ltr(`${c.letter} ${c.percent}%`)}
                  </span>
                </button>
              ))}
            </div>
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm min-w-[520px]">
                <thead>
                  <tr className="bg-muted/50 text-xs text-muted-foreground">
                    <th className="text-start font-semibold px-4 py-2">{t('grades.colSubject')}</th>
                    <th className="text-center font-semibold px-2 py-2">{t('grades.colQuizzes')}</th>
                    <th className="text-center font-semibold px-2 py-2">{t('grades.colAssignments')}</th>
                    <th className="text-center font-semibold px-2 py-2">{t('grades.colPoints')}</th>
                    <th className="text-center font-semibold px-2 py-2">{t('grades.colPercent')}</th>
                    <th className="text-center font-semibold px-4 py-2">{t('grades.colLetter')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {courses.map((c) => (
                    <tr key={c.subjectId} className="hover:bg-muted/30 cursor-pointer" onClick={() => openCourse(c.subjectId)}>
                      <td className="px-4 py-2.5 font-medium">
                        <span className="inline-flex items-center gap-2">
                          <span className="h-4 w-1 rounded-full shrink-0" style={{ backgroundColor: c.color || '#10b981' }} />
                          {c.name}
                        </span>
                      </td>
                      <td className="px-2 py-2.5 text-center">{pctText(c.quizAvg)}<span className="text-[11px] text-muted-foreground"> ({c.quizCount})</span></td>
                      <td className="px-2 py-2.5 text-center">{pctText(c.assignmentAvg)}<span className="text-[11px] text-muted-foreground"> ({c.assignmentCount})</span></td>
                      <td className="px-2 py-2.5 text-center">{c.percent === null ? '–' : ltr(`${c.earned} / ${c.possible}`)}</td>
                      <td className="px-2 py-2.5 text-center font-semibold">{pctText(c.percent)}</td>
                      <td className="px-4 py-2.5 text-center">
                        <span className={`inline-block rounded-md px-2 py-0.5 text-xs font-bold ${letterColor(c.percent)}`}>{c.letter ?? '–'}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Detailed report per subject (Moodle "user report"): item, grade, range, percentage, weight, feedback */}
          {courses.map((c) => {
            const isOpen = !!open[c.subjectId];
            const groups: Array<{ key: 'quiz' | 'assignment'; label: string; items: GradeItem[] }> = [
              { key: 'quiz', label: t('grades.groupQuizzes'), items: c.items.filter((i) => i.type === 'quiz') },
              { key: 'assignment', label: t('grades.groupAssignments'), items: c.items.filter((i) => i.type === 'assignment') },
            ];
            return (
              <Card key={c.subjectId} id={`grades-course-${c.subjectId}`} className="overflow-hidden scroll-mt-20">
                <button
                  type="button"
                  onClick={() => setOpen((o) => ({ ...o, [c.subjectId]: !o[c.subjectId] }))}
                  className="w-full text-start p-4 flex items-center gap-3 hover:bg-muted/40 transition-colors"
                  aria-expanded={isOpen}
                >
                  <span className="h-8 w-1.5 rounded-full shrink-0" style={{ backgroundColor: c.color || '#10b981' }} />
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold truncate">{c.name}</p>
                    <p className="text-xs text-muted-foreground">{t('grades.itemsLine', { graded: c.gradedCount, total: c.totalCount })}</p>
                  </div>
                  <span className={`rounded-lg px-2.5 py-1 text-sm font-bold ${letterColor(c.percent)}`}>
                    {c.percent === null ? '–' : `${c.letter} · ${c.percent}%`}
                  </span>
                  <ChevronDown className={`h-4 w-4 text-muted-foreground shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                </button>

                {isOpen && (
                  <div className="border-t">
                    {c.items.length > 0 && (
                      <div className="md:hidden">
                        {groups.filter((g) => g.items.length > 0).map((g) => {
                          const sub = computeTotals(g.items);
                          return (
                            <div key={g.key}>
                              <div className="px-4 py-1.5 bg-muted/40 text-xs font-bold text-muted-foreground flex items-center justify-between">
                                <span className="inline-flex items-center gap-1.5">
                                  {g.key === 'quiz' ? <ClipboardList className="h-3.5 w-3.5" /> : <FileSpreadsheet className="h-3.5 w-3.5" />}
                                  {g.label}
                                </span>
                                <span>{sub.percent === null ? '' : ltr(`${sub.earned} / ${sub.possible} · ${sub.percent}%`)}</span>
                              </div>
                              <div className="divide-y">
                                {g.items.map((it) => {
                                  const graded = it.status === 'graded' && it.score !== null && it.max > 0;
                                  const pct = graded ? Math.round(((it.score as number) / it.max) * 1000) / 10 : null;
                                  return (
                                    <div key={`${it.type}-${it.id}`} className="px-4 py-2.5 flex items-center gap-3">
                                      <div className="min-w-0 flex-1">
                                        <p className="text-sm font-medium break-words">{it.title}</p>
                                        {it.date && <p className="text-[11px] text-muted-foreground">{fmtDate(it.date)}</p>}
                                        {it.feedback && <p className="text-xs text-muted-foreground mt-0.5">{it.feedback}</p>}
                                      </div>
                                      <div className="text-end shrink-0">
                                        {graded ? (
                                          <>
                                            <p className="text-sm font-bold">{ltr(`${it.score} / ${it.max}`)}</p>
                                            <p className="text-xs text-muted-foreground">{ltr(pctText(pct))}</p>
                                          </>
                                        ) : (statusBadge(it) ?? <span className="text-muted-foreground">–</span>)}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })}
                        <div className="px-4 py-3 border-t-2 bg-muted/40 flex items-center justify-between font-bold">
                          <span>{t('grades.courseTotal')}</span>
                          <span className="flex items-center gap-2">
                            {c.percent === null ? '–' : ltr(`${c.earned} / ${c.possible} · ${c.percent}%`)}
                            {c.letter && <span className={`rounded-md px-2 py-0.5 text-xs ${letterColor(c.percent)}`}>{c.letter}</span>}
                          </span>
                        </div>
                      </div>
                    )}
                    {c.items.length === 0 ? (
                      <p className="p-4 text-sm text-muted-foreground">{t('grades.noItems')}</p>
                    ) : (
                      <div className="hidden md:block overflow-x-auto">
                      <table className="w-full text-sm min-w-[560px]">
                        <thead>
                          <tr className="bg-muted/50 text-xs text-muted-foreground">
                            <th className="text-start font-semibold px-4 py-2">{t('grades.colItem')}</th>
                            <th className="text-center font-semibold px-2 py-2">{t('grades.colGrade')}</th>
                            <th className="text-center font-semibold px-2 py-2">{t('grades.colRange')}</th>
                            <th className="text-center font-semibold px-2 py-2">{t('grades.colPercent')}</th>
                            <th className="text-center font-semibold px-2 py-2">{t('grades.colWeight')}</th>
                            <th className="text-start font-semibold px-4 py-2">{t('grades.colFeedback')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {groups.filter((g) => g.items.length > 0).map((g) => {
                            const sub = computeTotals(g.items);
                            return (
                              <Fragment key={g.key}>
                                <tr className="bg-muted/30">
                                  <td colSpan={6} className="px-4 py-1.5 text-xs font-bold text-muted-foreground">
                                    <span className="inline-flex items-center gap-1.5">
                                      {g.key === 'quiz' ? <ClipboardList className="h-3.5 w-3.5" /> : <FileSpreadsheet className="h-3.5 w-3.5" />}
                                      {g.label}
                                    </span>
                                  </td>
                                </tr>
                                {g.items.map((it) => {
                                  const graded = it.status === 'graded' && it.score !== null && it.max > 0;
                                  const pct = graded ? Math.round(((it.score as number) / it.max) * 1000) / 10 : null;
                                  const weight = graded && c.possible > 0 ? Math.round((it.max / c.possible) * 1000) / 10 : null;
                                  return (
                                    <tr key={`${it.type}-${it.id}`} className="border-t">
                                      <td className="px-4 py-2">
                                        <p className="font-medium">{it.title}</p>
                                        {it.date && <p className="text-[11px] text-muted-foreground">{fmtDate(it.date)}</p>}
                                      </td>
                                      <td className="px-2 py-2 text-center font-semibold whitespace-nowrap">{graded ? it.score : statusBadge(it) ?? '–'}</td>
                                      <td className="px-2 py-2 text-center text-muted-foreground whitespace-nowrap">{it.max > 0 ? ltr(`${0}–${it.max}`) : '–'}</td>
                                      <td className="px-2 py-2 text-center">{pctText(pct)}</td>
                                      <td className="px-2 py-2 text-center text-muted-foreground">{pctText(weight)}</td>
                                      <td className="px-4 py-2 text-xs text-muted-foreground max-w-[220px]">{it.feedback || ''}</td>
                                    </tr>
                                  );
                                })}
                                <tr className="border-t bg-muted/20 text-xs font-semibold">
                                  <td className="px-4 py-1.5">{t('grades.subtotal', { group: g.label })}</td>
                                  <td className="px-2 py-1.5 text-center">{sub.percent === null ? '–' : `${sub.earned}`}</td>
                                  <td className="px-2 py-1.5 text-center text-muted-foreground">{sub.percent === null ? '–' : ltr(`0–${sub.possible}`)}</td>
                                  <td className="px-2 py-1.5 text-center">{pctText(sub.percent)}</td>
                                  <td colSpan={2} />
                                </tr>
                              </Fragment>
                            );
                          })}
                          <tr className="border-t-2 bg-muted/40 font-bold">
                            <td className="px-4 py-2">{t('grades.courseTotal')}</td>
                            <td className="px-2 py-2 text-center">{c.percent === null ? '–' : c.earned}</td>
                            <td className="px-2 py-2 text-center">{c.percent === null ? '–' : ltr(`0–${c.possible}`)}</td>
                            <td className="px-2 py-2 text-center">{pctText(c.percent)}</td>
                            <td className="px-2 py-2 text-center">{c.percent === null ? '' : '100%'}</td>
                            <td className="px-4 py-2"><span className={`rounded-md px-2 py-0.5 text-xs ${letterColor(c.percent)}`}>{c.letter ?? ''}</span></td>
                          </tr>
                        </tbody>
                      </table>
                      </div>
                    )}
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

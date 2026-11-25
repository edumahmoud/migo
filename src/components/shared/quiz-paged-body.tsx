'use client';

/**
 * Paged quiz taking: shows `perPage` questions on each page, with Previous / Next page and a Submit
 * button on the last page. Answers are kept while moving between pages. There is no instant
 * correct/wrong feedback; grading happens on submit (see gradePagedAnswers).
 */

import { useMemo } from 'react';
import { ArrowRight, ChevronRight, Trophy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { questionDir } from '@/lib/ai/language-utils';
import { useTranslations } from '@/i18n/use-translations';
import type { Quiz, QuizQuestion, UserAnswer } from '@/lib/types';

export type PagedAnswers = Record<number, string | Record<string, string>>;

const TRUE_VALUES = ['صح', 'true', 't', 'yes', 'نعم', '1'];

function norm(s: string): string {
  return String(s)
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .toLowerCase()
    .replace(/[-_\s]/g, '')
    .trim();
}

/** Grade every question (local rules only: exact / normalized match; no AI call). */
export function gradePagedAnswers(questions: QuizQuestion[], answers: PagedAnswers): UserAnswer[] {
  const out: UserAnswer[] = [];
  questions.forEach((q, idx) => {
    const a = answers[idx];
    if (a === undefined || a === '' || (typeof a === 'object' && Object.keys(a).length === 0)) return;
    let ok = false;
    if (q.type === 'matching') {
      const m = a as Record<string, string>;
      ok = !!q.pairs && q.pairs.every((p) => m[p.key] === p.value);
    } else if (q.type === 'completion') {
      const s = norm(a as string);
      const c = norm(q.correctAnswer || '');
      ok = s.length > 0 && s === c;
    } else if (q.type === 'boolean') {
      const s = String(a).trim().toLowerCase();
      const c = String(q.correctAnswer || '').trim().toLowerCase();
      ok = s !== '' && c !== '' && (s === c || TRUE_VALUES.includes(s) === TRUE_VALUES.includes(c));
    } else {
      ok = a === q.correctAnswer;
    }
    out.push({ questionIndex: idx, type: q.type, answer: a, isCorrect: ok });
  });
  return out;
}

interface Props {
  quiz: Quiz;
  order: number[];          // question indices in display order (shuffled or natural)
  perPage: number;
  page: number;
  setPage: (p: number) => void;
  answers: PagedAnswers;
  setAnswers: (fn: (prev: PagedAnswers) => PagedAnswers) => void;
  onSubmit: () => void;
  submitting?: boolean;
}

export default function QuizPagedBody({ quiz, order, perPage, page, setPage, answers, setAnswers, onSubmit, submitting }: Props) {
  const { t } = useTranslations();
  const pages = Math.max(1, Math.ceil(order.length / perPage));
  const slice = useMemo(() => order.slice(page * perPage, page * perPage + perPage), [order, page, perPage]);
  const isLast = page >= pages - 1;
  const setAns = (idx: number, v: string | Record<string, string>) => setAnswers((prev) => ({ ...prev, [idx]: v }));
  const unanswered = order.filter((i) => {
    const a = answers[i];
    return a === undefined || a === '' || (typeof a === 'object' && Object.keys(a).length === 0);
  }).length;

  const go = (p: number) => { setPage(p); if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' }); };

  return (
    <div className="space-y-4">
      {slice.map((qi, n) => {
        const q = quiz.questions[qi];
        if (!q) return null;
        const dir = questionDir(q);
        const num = page * perPage + n + 1;
        const a = answers[qi];
        return (
          <Card key={qi} className="border-sky-200 dark:border-sky-900/60 bg-white dark:bg-card shadow-sm">
            <CardContent className="p-4 sm:p-6 space-y-3">
              <h3 className="text-base font-semibold leading-relaxed" dir={dir}>
                <span className="me-2 text-sky-700">{num}.</span>{q.question}
              </h3>

              {(q.type === 'mcq' || q.type === 'boolean') && (
                <div className="grid gap-2">
                  {(q.type === 'boolean' && (!q.options || q.options.length !== 2)
                    ? [{ v: 'صح', l: t('quiz.trueValue') }, { v: 'خطأ', l: t('quiz.falseValue') }]
                    : (q.options ?? []).map((o) => ({ v: String(o), l: String(o) }))
                  ).map((o) => (
                    <button
                      key={o.v}
                      type="button"
                      onClick={() => setAns(qi, o.v)}
                      className={`rounded-xl border-2 p-3 text-sm font-medium text-start transition-all ${
                        a === o.v
                          ? 'border-teal-500 bg-teal-50 dark:bg-teal-900/20 text-teal-700 dark:text-teal-500'
                          : 'border-sky-200 dark:border-sky-900/60 hover:border-sky-400'
                      }`}
                      dir={dir}
                    >
                      {o.l}
                    </button>
                  ))}
                </div>
              )}

              {q.type === 'completion' && (
                <Input
                  value={typeof a === 'string' ? a : ''}
                  onChange={(e) => setAns(qi, e.target.value)}
                  placeholder={t('quiz.typeAnswer')}
                  dir={dir}
                />
              )}

              {q.type === 'matching' && q.pairs && (
                <div className="space-y-2">
                  {q.pairs.map((p) => {
                    const m = (typeof a === 'object' && a ? a : {}) as Record<string, string>;
                    return (
                      <div key={p.key} className="flex flex-wrap items-center gap-2">
                        <span className="min-w-[8rem] flex-1 text-sm font-medium" dir={dir}>{p.key}</span>
                        <select
                          className="flex-1 min-w-[8rem] rounded-md border bg-background px-2 py-2 text-sm"
                          value={m[p.key] ?? ''}
                          dir={dir}
                          onChange={(e) => {
                            const next = { ...m };
                            if (e.target.value) next[p.key] = e.target.value; else delete next[p.key];
                            setAns(qi, next);
                          }}
                        >
                          <option value="">-</option>
                          {q.pairs!.map((pp) => pp.value).sort().map((v) => <option key={v} value={v}>{v}</option>)}
                        </select>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}

      <div className="flex flex-wrap items-center gap-2">
        {page > 0 && (
          <Button type="button" variant="outline" onClick={() => go(page - 1)} className="gap-1.5">
            <ChevronRight className="h-4 w-4" /> {t('common.previous')}
          </Button>
        )}
        <span className="text-xs text-muted-foreground mx-2">{page + 1} / {pages}</span>
        {!isLast ? (
          <Button type="button" onClick={() => go(page + 1)} className="me-auto gap-1.5 bg-sky-700 text-white hover:bg-sky-800">
            {t('common.next')} <ArrowRight className="h-4 w-4" />
          </Button>
        ) : (
          <Button type="button" onClick={onSubmit} disabled={submitting} className="me-auto gap-1.5 bg-sky-700 text-white hover:bg-sky-800">
            {t('quiz.submitQuiz')} <Trophy className="h-4 w-4" />
            {unanswered > 0 && <span className="text-xs opacity-80">({unanswered})</span>}
          </Button>
        )}
      </div>
    </div>
  );
}

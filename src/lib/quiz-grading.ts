// Server-side grading for quiz submissions. The browser never decides a score.
import { evaluateCompletionAnswer } from '@/lib/ai';
import type { QuizQuestion } from '@/lib/types';

const normalizeArabic = (s: string) =>
  s.replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي');

const normalizeLoose = (s: string) =>
  normalizeArabic(s)
    .toLowerCase()
    .replace(/[-_\s]/g, '')
    .replace(/ing$/, '')
    .replace(/tion$/, '')
    .replace(/ment$/, '')
    .replace(/ness$/, '')
    .replace(/able$/, '')
    .replace(/ible$/, '');

export type RawAnswer = string | Record<string, string> | undefined | null;

/** Cheap local rules for completion answers. Returns null when the AI should decide. */
function completionLocal(student: string, correct: string): boolean | null {
  if (student.toLowerCase() === correct.toLowerCase()) return true;
  const sn = normalizeLoose(student);
  const cn = normalizeLoose(correct);
  if (sn === cn && sn.length >= 3) return true;
  if ((sn.length >= 4 && cn.includes(sn)) || (cn.length >= 4 && sn.includes(cn))) {
    const maxLen = Math.max(sn.length, cn.length);
    if (maxLen > 0 && Math.abs(sn.length - cn.length) / maxLen < 0.4) return true;
  }
  const sa = normalizeArabic(student).trim();
  const ca = normalizeArabic(correct).trim();
  if (sa === ca && sa.length >= 2) return true;
  return null;
}

export async function gradeAnswer(q: QuizQuestion, answer: RawAnswer): Promise<boolean> {
  if (answer == null) return false;
  switch (q.type) {
    case 'mcq':
      return typeof answer === 'string' && answer === q.correctAnswer;
    case 'boolean': {
      if (typeof answer !== 'string') return false;
      const c = String(q.correctAnswer || '');
      return answer === c || answer.trim().toLowerCase() === c.trim().toLowerCase();
    }
    case 'matching': {
      if (typeof answer !== 'object' || !q.pairs || q.pairs.length === 0) return false;
      const map = answer as Record<string, string>;
      return q.pairs.every((p) => map[p.key] === p.value);
    }
    case 'completion': {
      if (typeof answer !== 'string') return false;
      const student = answer.trim().slice(0, 1000);
      const correct = (q.correctAnswer || '').trim();
      if (!student) return false;
      const local = completionLocal(student, correct);
      if (local !== null) return local;
      try {
        return await evaluateCompletionAnswer(q.question, correct || 'غير محدد', student);
      } catch {
        // Same benefit-of-doubt rule the quiz screen used when the AI is unavailable.
        const sl = student.replace(/\s/g, '').length;
        const cl = correct.replace(/\s/g, '').length;
        return sl >= 2 && cl > 0 && Math.min(sl, cl) / Math.max(sl, cl) >= 0.5;
      }
    }
    default:
      return false;
  }
}

/** Egypt wall-clock date + time text to a UTC timestamp in ms. */
export function cairoWallClockToMs(date: string, time: string): number | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const t = /^(\d{1,2}):(\d{2})/.exec(time || '00:00');
  if (!d || !t) return null;
  const guess = Date.UTC(+d[1], +d[2] - 1, +d[3], +t[1], +t[2]);
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Africa/Cairo', hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' }).formatToParts(new Date(guess));
  const g = (k: string) => Number(parts.find((x) => x.type === k)?.value);
  const offset = Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute')) - guess;
  return guess - offset;
}

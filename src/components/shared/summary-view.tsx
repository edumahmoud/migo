'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { motion } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import {
  ChevronLeft,
  Printer,
  FileText,
  Loader2,
  XCircle,
  BookOpen,
  Sparkles,
  Trash2,
  RefreshCw,
  ClipboardList,
  Copy,
  CheckCircle2,
  AlertTriangle,
  Play,
  ListChecks,
  Type,
  Link2,
  Wand2,
  Award,
  Lightbulb,
  ChevronDown,
  ChevronUp,
  Trophy,
  ArrowUp,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { getCachedAuthHeaders, initAuthCacheListener } from '@/lib/client-auth';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { toast } from 'sonner';
import type { Summary, Quiz, Score, UserAnswer, QuizQuestion } from '@/lib/types';

// -------------------------------------------------------
// fetchWithRetry — resilient fetch with automatic retry on network errors
// Prevents premature loading-state exit when the connection drops temporarily.
// Only gives up after all retries are exhausted or the server returns a definitive error.
// -------------------------------------------------------
async function fetchWithRetry(
  url: string,
  options: RequestInit & { timeoutMs?: number } = {},
  maxRetries: number = 3,
): Promise<Response> {
  const { timeoutMs = 300000, ...fetchOptions } = options; // 5-minute default
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const mergedSignal = AbortSignal.any
    ? AbortSignal.any([controller.signal, fetchOptions.signal].filter(Boolean) as AbortSignal[])
    : fetchOptions.signal || controller.signal;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        const backoffMs = Math.min(2000 * Math.pow(2, attempt - 1), 10000);
        console.log(`[fetchWithRetry] Retry ${attempt}/${maxRetries} after ${backoffMs}ms — ${url}`);
        await new Promise(resolve => setTimeout(resolve, backoffMs));
      }
      const res = await fetch(url, { ...fetchOptions, signal: mergedSignal });
      clearTimeout(timeoutId);
      return res;
    } catch (err: unknown) {
      lastError = err instanceof Error ? err : new Error(String(err));
      const isAbort = lastError.name === 'AbortError';
      // Don't retry if explicitly aborted (user cancelled) or timeout reached
      if (isAbort && controller.signal.aborted) {
        clearTimeout(timeoutId);
        throw lastError;
      }
      console.warn(`[fetchWithRetry] Attempt ${attempt + 1} failed:`, lastError.message);
    }
  }
  clearTimeout(timeoutId);
  throw lastError || new Error('فشل الاتصال بعد عدة محاولات');
}

// -------------------------------------------------------
// recoverSummaryFromDB — after a failed AI operation, re-fetch
// the summary from the database because the server may have
// completed the operation and saved to DB even though the HTTP
// response was lost (Vercel 60s timeout, network drop, etc.)
// Returns the updated summary if content changed, null otherwise.
// -------------------------------------------------------
async function recoverSummaryFromDB(
  summaryId: string,
  previousContent: string,
  maxAttempts: number = 3,
): Promise<Summary | null> {
  console.log('[recoverSummaryFromDB] Starting recovery, previous content length:', previousContent.length);
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    // Wait with increasing delay (5s, 10s, 15s)
    const delayMs = (attempt + 1) * 5000;
    console.log(`[recoverSummaryFromDB] Attempt ${attempt + 1}/${maxAttempts}, waiting ${delayMs}ms...`);
    await new Promise(resolve => setTimeout(resolve, delayMs));

    try {
      const { waitForSession } = await import('@/lib/client-auth');
      const token = await waitForSession(5000);
      const res = await fetch(`/api/summaries?id=${encodeURIComponent(summaryId)}`, {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
      });
      if (res.ok) {
        const { data } = await res.json();
        if (data && data.summary_content && data.summary_content.trim() !== previousContent.trim()) {
          console.log('[recoverSummaryFromDB] Content changed! Recovery successful, new length:', data.summary_content.length);
          return data as Summary;
        }
        console.log('[recoverSummaryFromDB] Content unchanged, still waiting...');
      }
    } catch (err) {
      console.warn('[recoverSummaryFromDB] Fetch error:', err instanceof Error ? err.message : err);
    }
  }
  console.log('[recoverSummaryFromDB] All recovery attempts exhausted, content not updated');
  return null;
}

// -------------------------------------------------------
// recoverQuizFromDB — after a failed quiz operation, re-fetch
// the quiz from the database because the server may have
// completed the operation even though the HTTP response was lost.
// Returns the updated quiz if found, null otherwise.
// -------------------------------------------------------
async function recoverQuizFromDB(
  summaryId: string,
  maxAttempts: number = 3,
): Promise<Quiz | null> {
  console.log('[recoverQuizFromDB] Starting recovery for summary:', summaryId);
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const delayMs = (attempt + 1) * 5000;
    console.log(`[recoverQuizFromDB] Attempt ${attempt + 1}/${maxAttempts}, waiting ${delayMs}ms...`);
    await new Promise(resolve => setTimeout(resolve, delayMs));

    try {
      const { waitForSession } = await import('@/lib/client-auth');
      const token = await waitForSession(5000);
      const res = await fetch(`/api/quizzes?summaryId=${encodeURIComponent(summaryId)}`, {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
      });
      if (res.ok) {
        const { data } = await res.json();
        const quizzes = data as Quiz[];
        if (quizzes && quizzes.length > 0) {
          console.log('[recoverQuizFromDB] Found quiz! Recovery successful');
          return quizzes[0];
        }
      }
    } catch (err) {
      console.warn('[recoverQuizFromDB] Fetch error:', err instanceof Error ? err.message : err);
    }
  }
  console.log('[recoverQuizFromDB] All recovery attempts exhausted');
  return null;
}

// -------------------------------------------------------
// AI Operation Progress Tracker
// -------------------------------------------------------
interface AiProgressState {
  percent: number;
  phase: string;
}

const AI_PHASES_SUMMARY = [
  { threshold: 0,  label: 'جاري تحليل المحتوى...' },
  { threshold: 25, label: 'جاري استخراج المفاهيم الرئيسية...' },
  { threshold: 50, label: 'جاري بناء الملخص...' },
  { threshold: 75, label: 'جاري تنسيق النص...' },
  { threshold: 90, label: 'جاري المراجعة النهائية...' },
];

const AI_PHASES_REFINE = [
  { threshold: 0,  label: 'جاري قراءة النص المستخرج...' },
  { threshold: 20, label: 'جاري تصحيح أخطاء التعرف البصري...' },
  { threshold: 45, label: 'جاري تنظيم الفقرات والعناوين...' },
  { threshold: 70, label: 'جاري تنسيق المحتوى...' },
  { threshold: 90, label: 'جاري المراجعة النهائية...' },
];

const AI_PHASES_QUIZ = [
  { threshold: 0,  label: 'جاري تحليل المحتوى...' },
  { threshold: 30, label: 'جاري إنشاء الأسئلة...' },
  { threshold: 60, label: 'جاري مراجعة الإجابات...' },
  { threshold: 85, label: 'جاري التنسيق النهائي...' },
];

function useAiProgress(isActive: boolean, phases: { threshold: number; label: string }[], estimatedDurationMs: number = 60000) {
  const [progress, setProgress] = useState<AiProgressState>({ percent: 0, phase: phases[0]?.label || '' });
  const startTimeRef = useRef<number>(0);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    if (!isActive) {
      setProgress({ percent: 0, phase: phases[0]?.label || '' });
      return;
    }

    startTimeRef.current = Date.now();

    const tick = () => {
      const elapsed = Date.now() - startTimeRef.current;
      // Use an adaptive ratio that extends the estimated duration as time passes,
      // so the progress bar never gets stuck at a ceiling like 92%.
      // The first 70% of the bar fills in ~estimatedDurationMs,
      // then it slows down progressively but still creeps toward 98%.
      const dynamicEstimate = estimatedDurationMs + Math.max(0, elapsed - estimatedDurationMs) * 3;
      const rawRatio = Math.min(elapsed / dynamicEstimate, 0.98);
      const eased = rawRatio < 0.7
        ? rawRatio * 1.0
        : 0.7 + (rawRatio - 0.7) * 0.9;
      const percent = Math.min(Math.round(eased * 100), 98);

      let currentPhase = phases[0]?.label || '';
      for (let i = phases.length - 1; i >= 0; i--) {
        if (percent >= phases[i].threshold) {
          currentPhase = phases[i].label;
          break;
        }
      }

      setProgress({ percent, phase: currentPhase });
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [isActive, phases, estimatedDurationMs]);

  const completeProgress = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    setProgress({ percent: 100, phase: 'اكتمل!' });
  }, []);

  return { progress, completeProgress };
}

// -------------------------------------------------------
// Step Progress Indicator — Modern Horizontal Design
// Shows a gradient progress bar with step dots and phase labels
// -------------------------------------------------------
function StepProgress({
  percent,
  phase,
  steps,
  color = 'sky',
}: {
  percent: number;
  phase: string;
  steps: { threshold: number; label: string }[];
  color?: 'sky' | 'teal' | 'rose';
}) {
  // Determine active step based on percent and thresholds
  let activeStepIdx = 0;
  for (let i = steps.length - 1; i >= 0; i--) {
    if (percent >= steps[i].threshold) {
      activeStepIdx = i;
      break;
    }
  }

  const colorSchemes = {
    sky: {
      text: '#0369a1',
      barGradient: 'linear-gradient(to left, #0369a1, #38bdf8)',
      barBg: '#e0f2fe',
      dotActive: '#0ea5e9',
      dotCompleted: '#38bdf8',
      dotUpcoming: '#bae6fd',
      glow: 'rgba(14,165,233,0.25)',
      labelActive: '#0369a1',
      labelUpcoming: '#93c5fd',
      checkColor: '#0369a1',
    },
    teal: {
      text: '#0f766e',
      barGradient: 'linear-gradient(to left, #0f766e, #5eead4)',
      barBg: '#ccfbf1',
      dotActive: '#14b8a6',
      dotCompleted: '#5eead4',
      dotUpcoming: '#99f6e4',
      glow: 'rgba(20,184,166,0.25)',
      labelActive: '#0f766e',
      labelUpcoming: '#5eead4',
      checkColor: '#0f766e',
    },
    rose: {
      text: '#be123c',
      barGradient: 'linear-gradient(to left, #be123c, #fb7185)',
      barBg: '#ffe4e6',
      dotActive: '#f43f5e',
      dotCompleted: '#fb7185',
      dotUpcoming: '#fda4af',
      glow: 'rgba(244,63,94,0.25)',
      labelActive: '#be123c',
      labelUpcoming: '#fb7185',
      checkColor: '#be123c',
    },
  };
  const c = colorSchemes[color];

  return (
    <div className="w-full max-w-xs mx-auto space-y-4 py-2">
      {/* Large percentage display */}
      <div className="text-center">
        {percent === 100 ? (
          <motion.div
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 300, damping: 20 }}
          >
            <CheckCircle2 className="h-12 w-12 mx-auto" style={{ color: c.checkColor }} />
          </motion.div>
        ) : (
          <motion.span
            className="text-4xl font-bold tabular-nums"
            style={{ color: c.text }}
            key={percent}
            initial={{ scale: 1.05, opacity: 0.8 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.15 }}
          >
            {percent}%
          </motion.span>
        )}
      </div>

      {/* Gradient progress bar */}
      <div className="relative h-2.5 rounded-full overflow-hidden" style={{ backgroundColor: c.barBg }}>
        <div
          className="absolute inset-y-0 right-0 rounded-full"
          style={{
            width: `${Math.max(percent, 2)}%`,
            background: c.barGradient,
            transition: 'width 0.7s cubic-bezier(0.4, 0, 0.2, 1)',
          }}
        />
        {/* Glowing leading edge */}
        {percent > 0 && percent < 100 && (
          <div
            className="absolute top-1/2 -translate-y-1/2 h-5 w-5 rounded-full animate-pulse"
            style={{
              right: `calc(${percent}% - 10px)`,
              background: c.dotActive,
              opacity: 0.4,
              filter: 'blur(8px)',
              transition: 'right 0.7s cubic-bezier(0.4, 0, 0.2, 1)',
            }}
          />
        )}
      </div>

      {/* Step dots with labels */}
      <div className="flex justify-between px-0.5">
        {steps.map((step, i) => {
          const isCompleted = i < activeStepIdx;
          const isActive = i === activeStepIdx;

          return (
            <div key={i} className="flex flex-col items-center gap-1.5">
              <div
                className="rounded-full transition-all duration-500 flex items-center justify-center"
                style={{
                  height: isActive ? 14 : isCompleted ? 11 : 8,
                  width: isActive ? 14 : isCompleted ? 11 : 8,
                  backgroundColor: isCompleted ? c.dotCompleted : isActive ? c.dotActive : c.dotUpcoming,
                  boxShadow: isActive ? `0 0 0 4px ${c.glow}` : 'none',
                }}
              >
                {isCompleted && (
                  <svg width="7" height="7" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </div>
              <span
                className="text-[10px] font-medium text-center leading-tight transition-colors duration-300"
                style={{ color: isCompleted || isActive ? c.labelActive : c.labelUpcoming }}
              >
                {step.label}
              </span>
            </div>
          );
        })}
      </div>

      {/* Current phase label */}
      <div className="text-center space-y-1.5 pt-1">
        <div className="flex items-center justify-center gap-1.5">
          <Loader2 className="h-3.5 w-3.5 animate-spin" style={{ color: c.text }} />
          <p className="text-sm font-semibold" style={{ color: c.text }}>{phase}</p>
        </div>
        <p className="text-xs text-muted-foreground">يرجى الانتظار، لا تغادر الصفحة</p>
      </div>
    </div>
  );
}

// -------------------------------------------------------
// Props
// -------------------------------------------------------
interface SummaryViewProps {
  summaryId: string;
  onBack: () => void;
  onViewQuiz?: (quizId: string) => void;
  /** If true, show quiz creation with subject_id (teacher mode) */
  teacherMode?: boolean;
}

// -------------------------------------------------------
// Animation variants
// -------------------------------------------------------
const fadeInUp = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: 'easeOut' as const } },
};

const staggerContainer = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.1 } },
};

// -------------------------------------------------------
// Scroll to Top Button
// -------------------------------------------------------
function ScrollToTopButton() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > 300);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  if (!visible) return null;

  return (
    <motion.button
      onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
      className="fixed bottom-20 left-4 z-50 h-11 w-11 rounded-full bg-sky-600 text-white shadow-lg shadow-sky-600/30 flex items-center justify-center hover:bg-sky-700 active:scale-95 transition-all print:hidden sm:bottom-6 sm:left-6"
      initial={{ opacity: 0, scale: 0.5, y: 20 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.5, y: 20 }}
      transition={{ type: 'spring', stiffness: 400, damping: 25 }}
      aria-label="العودة للأعلى"
    >
      <ArrowUp className="h-5 w-5" />
    </motion.button>
  );
}

// -------------------------------------------------------
// Main Component
// -------------------------------------------------------
export default function SummaryView({ summaryId, onBack, onViewQuiz, teacherMode }: SummaryViewProps) {
  // ─── State ───
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ─── Detect transcribed content (original_content === summary_content means no AI summarization) ───
  const isTranscribed = !!(summary?.original_content && summary?.summary_content &&
    summary.original_content.trim() === summary.summary_content.trim());

  // ─── Detect source file type for display ───
  const sourceFileType = summary?.source_file_type || null;

  // ─── Action states ───
  const [regenerating, setRegenerating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [generatingQuiz, setGeneratingQuiz] = useState(false);
  const [regeneratingQuiz, setRegeneratingQuiz] = useState(false);
  const [copied, setCopied] = useState(false);
  const [refining, setRefining] = useState(false);

  // ─── AI Progress trackers ───
  const summaryProgress = useAiProgress(regenerating, AI_PHASES_SUMMARY, 60000);
  const refineProgress = useAiProgress(refining, AI_PHASES_REFINE, 60000);
  const quizProgress = useAiProgress(generatingQuiz || regeneratingQuiz, AI_PHASES_QUIZ, 60000);

  // ─── Quiz config states ───
  const [quizConfigTypes, setQuizConfigTypes] = useState({ mcq: 2, boolean: 2, completion: 2, matching: 2 });
  const [quizAnswerMode, setQuizAnswerMode] = useState<'during' | 'after'>('after');
  const [quizAllowRetake, setQuizAllowRetake] = useState(true);
  const [quizShuffleQuestions, setQuizShuffleQuestions] = useState(true);
  const [showQuizConfig, setShowQuizConfig] = useState(false);

  // ─── Related quiz ───
  const [relatedQuiz, setRelatedQuiz] = useState<Quiz | null>(null);

  // ─── Completed quizzes (scores) for this summary ───
  const [completedQuizzes, setCompletedQuizzes] = useState<Array<{
    quiz: Quiz;
    score: Score;
  }>>([]);
  const [expandedQuizId, setExpandedQuizId] = useState<string | null>(null);
  const [explainingIdx, setExplainingIdx] = useState<string | null>(null); // 'quizId-questionIndex'
  const [explanations, setExplanations] = useState<Record<string, string>>({}); // key: 'quizId-questionIndex'

  // -------------------------------------------------------
  // Fetch summary — with robust retry for mobile/PWA
  // -------------------------------------------------------
  // Track whether we already have valid data to avoid unnecessary loading resets on mobile
  const hasValidDataRef = useRef(false);

  const fetchSummary = useCallback(async () => {
    // Only show loading spinner if we don't already have data
    // This prevents the page from collapsing to a loading state on mobile
    // when the auth state change triggers a re-fetch after returning from background
    if (!hasValidDataRef.current) {
      setLoading(true);
    }
    setError(null);
    try {
      // Use waitForSession for reliable auth token on mobile PWA
      const { waitForSession } = await import('@/lib/client-auth');
      const token = await waitForSession(8000);
      if (!token) {
        console.warn('[fetchSummary] No token available after waiting');
        // If we already have data, don't show error — just keep existing data
        if (hasValidDataRef.current) return;
        setError('جاري تحميل الجلسة...');
        return;
      }

      // ─── Strategy 1: Fetch by ID using the new ?id= endpoint (efficient) ───
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(`/api/summaries?id=${encodeURIComponent(summaryId)}`, { headers });

      if (res.ok) {
        const { data } = await res.json();
        if (data) {
          setSummary(data as Summary);
          hasValidDataRef.current = true;
          return; // Success!
        }
      }

      // ─── Strategy 2: If 401, auth not ready yet ───
      if (res.status === 401) {
        console.warn('[fetchSummary] Auth not ready (401), will retry on auth state change');
        // If we already have data, don't overwrite with error
        if (!hasValidDataRef.current) {
          setError('جاري تحميل الجلسة...');
        }
        return;
      }

      // ─── Strategy 3: If 404, the summary might not be saved yet (still generating) ───
      if (res.status === 404) {
        console.warn('[fetchSummary] Summary not found in DB, might still be generating');
        setError('لم يتم العثور على الملخص');
        return;
      }

      // ─── Strategy 4: Fallback — fetch all summaries and filter (legacy compatibility) ───
      console.warn('[fetchSummary] Single-fetch failed, falling back to list endpoint...');
      const fallbackRes = await fetch('/api/summaries', { headers });
      if (fallbackRes.ok) {
        const { data } = await fallbackRes.json();
        const found = (data as Summary[])?.find((s) => s.id === summaryId);
        if (found) {
          setSummary(found);
          hasValidDataRef.current = true;
          return;
        }
      }

      // ─── Strategy 5: Last resort — direct Supabase query (subject to RLS) ───
      const { data, error: fetchError } = await supabase
        .from('summaries')
        .select('*')
        .eq('id', summaryId)
        .single();

      if (fetchError || !data) {
        // If we already have data, don't overwrite with error
        if (!hasValidDataRef.current) {
          setError('لم يتم العثور على الملخص');
        }
        return;
      }
      setSummary(data as Summary);
      hasValidDataRef.current = true;
    } catch {
      // If we already have data, don't overwrite with error
      if (!hasValidDataRef.current) {
        setError('حدث خطأ أثناء تحميل الملخص');
      }
    } finally {
      setLoading(false);
    }
  }, [summaryId]);

  // -------------------------------------------------------
  // Fetch related quiz
  // -------------------------------------------------------
  const fetchRelatedQuiz = useCallback(async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token || '';
      const res = await fetch(`/api/quizzes?summaryId=${summaryId}`, {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
      });
      if (res.ok) {
        const { data } = await res.json();
        const quizzes = data as Quiz[];
        if (quizzes && quizzes.length > 0) {
          setRelatedQuiz(quizzes[0]); // Most recent quiz for this summary
        } else {
          setRelatedQuiz(null);
        }
      }
    } catch {
      // Non-critical
    }
  }, [summaryId]);

  // -------------------------------------------------------
  // Fetch completed quizzes (scores) for this summary
  // Chain: summary.id → quizzes.summary_id → scores.quiz_id
  // -------------------------------------------------------
  const fetchCompletedQuizzes = useCallback(async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const userId = session?.user?.id;
      if (!userId) return;

      // 1. Get all quizzes linked to this summary
      const { data: quizzesData, error: qErr } = await supabase
        .from('quizzes')
        .select('*')
        .eq('summary_id', summaryId);
      if (qErr || !quizzesData?.length) return;

      const quizzesMap = new Map<string, Quiz>();
      (quizzesData as Quiz[]).forEach(q => quizzesMap.set(q.id, q));

      // 2. Get all scores for this student on these quizzes
      const quizIds = quizzesData.map(q => q.id);
      const { data: scoresData, error: sErr } = await supabase
        .from('scores')
        .select('*')
        .eq('student_id', userId)
        .in('quiz_id', quizIds);
      if (sErr || !scoresData?.length) return;

      // 3. Pair each score with its quiz
      const pairs: Array<{ quiz: Quiz; score: Score }> = [];
      for (const s of scoresData as Score[]) {
        const q = quizzesMap.get(s.quiz_id);
        if (q) pairs.push({ quiz: q, score: s });
      }
      // Sort by completion date (newest first)
      pairs.sort((a, b) => new Date(b.score.completed_at).getTime() - new Date(a.score.completed_at).getTime());
      setCompletedQuizzes(pairs);
    } catch {
      // Non-critical
    }
  }, [summaryId]);

  useEffect(() => {
    fetchSummary();
    fetchRelatedQuiz();
    fetchCompletedQuizzes();
  }, [fetchSummary, fetchRelatedQuiz, fetchCompletedQuizzes]);

  // ─── Loading timeout for mobile ───
  // IMPORTANT: Removed the aggressive 30s timeout that was killing the page
  // while AI was still working. The server handles its own timeouts, and the
  // client-side fetch calls have their own AbortController timeouts.
  // We only use a VERY long safety net (5 minutes) to prevent truly stuck states.
  useEffect(() => {
    if (!loading) return;
    const timer = setTimeout(() => {
      console.warn('[SummaryView] Loading timeout (5min safety net) — forcing error state');
      setLoading(false);
      // Only set error if we don't already have data
      setSummary((prev) => {
        if (!prev) {
          setError('انتهت مهلة تحميل الملخص. يرجى المحاولة مرة أخرى');
        }
        return prev;
      });
    }, 300000); // 5 minutes — just a safety net, not a real timeout
    return () => clearTimeout(timer);
  }, [loading]);

  // ─── Re-fetch summary when auth session becomes available (mobile fix) ───
  // This handles the case where the initial fetch fails because auth isn't ready yet.
  // CRITICAL: Only show loading state if we don't already have data.
  // On mobile, returning from background triggers INITIAL_SESSION, which previously
  // reset the page to loading — causing the "infinity loading" crash.
  useEffect(() => {
    let cancelled = false;
    const { data: authListener } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (cancelled) return;
      if ((event === 'INITIAL_SESSION' || event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') && session?.access_token) {
        console.log('[SummaryView] Session event:', event, ', hasValidData:', hasValidDataRef.current);
        // Only reset to loading if we don't have data yet
        if (!hasValidDataRef.current) {
          setError(null);
          setLoading(true);
        }
        // Always re-fetch in background to refresh data, but don't disrupt the UI if we already have data
        fetchSummary();
        fetchRelatedQuiz();
      }
    });
    return () => {
      cancelled = true;
      authListener?.subscription?.unsubscribe();
    };
  }, [fetchSummary, fetchRelatedQuiz]);

  // ─── Keep auth cache fresh ───
  useEffect(() => {
    initAuthCacheListener();
  }, []);

  // -------------------------------------------------------
  // Progress Persistence — Save/restore via sessionStorage
  // Prevents data loss when the page is refreshed during an
  // AI operation (refine, regenerate, quiz generation).
  // -------------------------------------------------------
  const STORAGE_KEY_OP = `attendo-op-${summaryId}`;
  const STORAGE_KEY_DATA = `attendo-data-${summaryId}`;

  const markOpPending = useCallback((op: string) => {
    try {
      sessionStorage.setItem(STORAGE_KEY_OP, JSON.stringify({
        operation: op,
        timestamp: Date.now(),
        previousContent: summary?.summary_content || '',
      }));
    } catch { /* sessionStorage may be unavailable in some environments */ }
  }, [STORAGE_KEY_OP, summary?.summary_content]);

  const markOpComplete = useCallback(() => {
    try {
      sessionStorage.removeItem(STORAGE_KEY_OP);
    } catch {}
  }, [STORAGE_KEY_OP]);

  // Save summary data to sessionStorage on beforeunload (page refresh/close)
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (summary) {
        try {
          sessionStorage.setItem(STORAGE_KEY_DATA, JSON.stringify(summary));
        } catch {}
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [summary, STORAGE_KEY_DATA]);

  // Auto-recover on mount: restore data + resume pending operations
  useEffect(() => {
    try {
      // 1. Restore summary data for instant display
      const savedData = sessionStorage.getItem(STORAGE_KEY_DATA);
      if (savedData && !hasValidDataRef.current) {
        const parsed = JSON.parse(savedData);
        if (parsed?.id === summaryId) {
          setSummary(parsed);
          hasValidDataRef.current = true;
          setLoading(false);
        }
      }

      // 2. Check for pending AI operations and try to recover results from DB
      const savedOp = sessionStorage.getItem(STORAGE_KEY_OP);
      if (!savedOp) return;
      const { operation, timestamp, previousContent } = JSON.parse(savedOp);
      // Only recover if operation was started within the last 5 minutes
      if (Date.now() - timestamp > 300000) {
        sessionStorage.removeItem(STORAGE_KEY_OP);
        return;
      }
      console.log('[SummaryView] Found pending operation:', operation, '— attempting recovery');

      if (operation === 'refine') {
        setRefining(true);
        recoverSummaryFromDB(summaryId, previousContent, 5).then(recovered => {
          if (recovered) {
            setSummary(recovered);
            hasValidDataRef.current = true;
            toast.success('تم استرداد نتيجة التنقيح بنجاح!');
          } else {
            toast.info('لم يتم العثور على نتيجة سابقة للتنقيح');
          }
          setRefining(false);
          sessionStorage.removeItem(STORAGE_KEY_OP);
        });
      } else if (operation === 'regenerate') {
        setRegenerating(true);
        recoverSummaryFromDB(summaryId, previousContent, 5).then(recovered => {
          if (recovered) {
            setSummary(recovered);
            hasValidDataRef.current = true;
            toast.success('تم استرداد نتيجة إعادة التلخيص بنجاح!');
          } else {
            toast.info('لم يتم العثور على نتيجة سابقة');
          }
          setRegenerating(false);
          sessionStorage.removeItem(STORAGE_KEY_OP);
        });
      } else if (operation === 'quiz') {
        setGeneratingQuiz(true);
        recoverQuizFromDB(summaryId, 5).then(recovered => {
          if (recovered) {
            setRelatedQuiz(recovered);
            toast.success('تم استرداد الاختبار بنجاح!');
          }
          setGeneratingQuiz(false);
          sessionStorage.removeItem(STORAGE_KEY_OP);
        });
      }
    } catch { /* sessionStorage unavailable */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summaryId]); // Only run once on mount

  // -------------------------------------------------------
  // Re-generate summary
  // -------------------------------------------------------
  const handleRegenerateSummary = async () => {
    setRegenerating(true);
    markOpPending('regenerate');
    const previousContent = summary?.summary_content || '';

    try {
      const res = await fetchWithRetry('/api/summaries', {
        method: 'PUT',
        headers: await getCachedAuthHeaders(),
        body: JSON.stringify({ summaryId }),
        timeoutMs: 300000,
      }, 3);
      const data = await res.json();
      if (res.ok && data.success) {
        summaryProgress.completeProgress();
        setSummary(data.data as Summary);
        hasValidDataRef.current = true;
        markOpComplete();
        toast.success('تم إعادة توليد الملخص بنجاح');
        setRegenerating(false);
        return; // ✅ Success — exit loading
      }
      // Server returned an error — try recovery before giving up
    } catch {
      // Network error or timeout — try recovery before giving up
    }

    // ─── RECOVERY: The fetch failed, but the server may have completed the operation ───
    // and saved to DB even though the HTTP response was lost (Vercel 60s timeout, etc.)
    console.log('[handleRegenerateSummary] Fetch failed, attempting DB recovery...');
    const recovered = await recoverSummaryFromDB(summaryId, previousContent);
    if (recovered) {
      summaryProgress.completeProgress();
      setSummary(recovered);
      hasValidDataRef.current = true;
      markOpComplete();
      toast.success('تم إعادة توليد الملخص بنجاح');
      setRegenerating(false);
      return; // ✅ Recovered — exit loading
    }

    // Truly failed — all recovery attempts exhausted
    markOpComplete();
    toast.error('حدث خطأ أثناء إعادة التلخيص. يرجى المحاولة مرة أخرى');
    setRegenerating(false);
  };

  // -------------------------------------------------------
  // Delete summary
  // -------------------------------------------------------
  const handleDeleteSummary = async () => {
    setDeleting(true);
    try {
      const res = await fetch('/api/summaries', {
        method: 'DELETE',
        headers: await getCachedAuthHeaders(),
        body: JSON.stringify({ summaryId }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        toast.success('تم حذف الملخص بنجاح');
        onBack();
      } else {
        toast.error(data.error || 'فشل حذف الملخص');
      }
    } catch {
      toast.error('حدث خطأ أثناء حذف الملخص');
    } finally {
      setDeleting(false);
      setDeleteConfirmOpen(false);
    }
  };

  // -------------------------------------------------------
  // Generate quiz from summary (with config)
  // -------------------------------------------------------
  const handleGenerateQuiz = async () => {
    setGeneratingQuiz(true);
    markOpPending('quiz');

    try {
      const content = summary?.summary_content || summary?.original_content || '';
      const quizRes = await fetchWithRetry('/api/gemini/quiz', {
        method: 'POST',
        headers: await getCachedAuthHeaders(),
        body: JSON.stringify({ content, questionTypes: quizConfigTypes }),
        timeoutMs: 300000,
      }, 3);
      const quizData = await quizRes.json();

      if (!quizRes.ok || !quizData.success) {
        // Try recovery — quiz might have been created but response lost
        const recoveredQuiz = await recoverQuizFromDB(summaryId);
        if (recoveredQuiz) {
          quizProgress.completeProgress();
          setRelatedQuiz({ ...recoveredQuiz, shuffle_questions: quizShuffleQuestions } as Quiz);
          toast.success('تم إنشاء الاختبار بنجاح');
          setShowQuizConfig(false);
          setGeneratingQuiz(false);
          return; // ✅ Recovered
        }
        toast.error(quizData.error || 'فشل إنشاء الاختبار');
        setGeneratingQuiz(false);
        return;
      }

      // Save the quiz
      const quizPayload: Record<string, unknown> = {
        title: `اختبار: ${summary?.title || 'ملخص'}`,
        questions: quizData.data.questions,
        summaryId,
        show_results: quizAnswerMode === 'after' ? false : true,
        allow_retake: quizAllowRetake,
      };

      if (teacherMode && summary?.subject_id) {
        quizPayload.subject_id = summary.subject_id;
      }

      const saveRes = await fetch('/api/quizzes', {
        method: 'POST',
        headers: await getCachedAuthHeaders(),
        body: JSON.stringify(quizPayload),
      });

      if (saveRes.ok) {
        const saveData = await saveRes.json();
        const savedQuiz = { ...saveData.data, shuffle_questions: quizShuffleQuestions } as Quiz;
        quizProgress.completeProgress();
        setRelatedQuiz(savedQuiz);
        toast.success('تم إنشاء الاختبار بنجاح');
        setShowQuizConfig(false);
        setGeneratingQuiz(false);
      } else {
        const saveErrData = await saveRes.json().catch(() => ({}));
        console.error('[SummaryView] Quiz save failed:', saveRes.status, saveErrData);
        toast.error(saveErrData.error || 'فشل حفظ الاختبار');
      }
    } catch {
      // Network error — try recovery
      const recoveredQuiz = await recoverQuizFromDB(summaryId);
      if (recoveredQuiz) {
        quizProgress.completeProgress();
        setRelatedQuiz({ ...recoveredQuiz, shuffle_questions: quizShuffleQuestions } as Quiz);
        toast.success('تم إنشاء الاختبار بنجاح');
        setShowQuizConfig(false);
        setGeneratingQuiz(false);
        return; // ✅ Recovered
      }
      toast.error('حدث خطأ أثناء إنشاء الاختبار');
    } finally {
      setGeneratingQuiz(false);
    }
  };

  // -------------------------------------------------------
  // Re-generate quiz
  // -------------------------------------------------------
  const handleRegenerateQuiz = async () => {
    if (!relatedQuiz) return;
    setRegeneratingQuiz(true);

    try {
      const res = await fetchWithRetry('/api/quizzes', {
        method: 'PUT',
        headers: await getCachedAuthHeaders(),
        body: JSON.stringify({ quizId: relatedQuiz.id }),
        timeoutMs: 300000,
      }, 3);
      const data = await res.json();
      if (res.ok && data.success) {
        setRelatedQuiz(data.data as Quiz);
        quizProgress.completeProgress();
        toast.success('تم إعادة إنشاء الاختبار بنجاح');
        setRegeneratingQuiz(false);
        return; // ✅ Success
      }
    } catch {
      // Network error — try recovery
    }

    // ─── RECOVERY ───
    const recoveredQuiz = await recoverQuizFromDB(summaryId);
    if (recoveredQuiz) {
      setRelatedQuiz(recoveredQuiz);
      quizProgress.completeProgress();
      toast.success('تم إعادة إنشاء الاختبار بنجاح');
      setRegeneratingQuiz(false);
      return; // ✅ Recovered
    }

    toast.error('حدث خطأ أثناء إعادة إنشاء الاختبار');
    setRegeneratingQuiz(false);
  };

  // -------------------------------------------------------
  // Refine/format transcribed text
  // -------------------------------------------------------
  const handleRefineText = async () => {
    if (!summary) return;
    setRefining(true);
    markOpPending('refine');
    const previousContent = summary?.summary_content || '';

    try {
      const res = await fetchWithRetry('/api/gemini/summary', {
        method: 'PUT',
        headers: await getCachedAuthHeaders(),
        body: JSON.stringify({ summaryId }),
        timeoutMs: 300000,
      }, 3);
      const data = await res.json();
      if (res.ok && data.success) {
        refineProgress.completeProgress();
        setSummary(data.data as Summary);
        hasValidDataRef.current = true;
        markOpComplete();
        toast.success('تم تنقيح وتنسيق النص بنجاح');
        setRefining(false);
        return; // ✅ Success — exit loading
      }
      // Server returned an error — try recovery before giving up
    } catch {
      // Network error or timeout — try recovery before giving up
    }

    // ─── RECOVERY: The fetch failed, but the server may have completed the operation ───
    console.log('[handleRefineText] Fetch failed, attempting DB recovery...');
    const recovered = await recoverSummaryFromDB(summaryId, previousContent);
    if (recovered) {
      refineProgress.completeProgress();
      setSummary(recovered);
      hasValidDataRef.current = true;
      markOpComplete();
      toast.success('تم تنقيح وتنسيق النص بنجاح');
      setRefining(false);
      return; // ✅ Recovered — exit loading
    }

    // Truly failed — all recovery attempts exhausted
    markOpComplete();
    toast.error('حدث خطأ أثناء تنقيح النص. يرجى المحاولة مرة أخرى');
    setRefining(false);
  };

  // -------------------------------------------------------
  // Copy content
  // -------------------------------------------------------
  const handleCopyContent = async () => {
    if (!summary?.summary_content) return;
    try {
      await navigator.clipboard.writeText(summary.summary_content);
      setCopied(true);
      toast.success('تم نسخ المحتوى');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for older browsers
      const textArea = document.createElement('textarea');
      textArea.value = summary.summary_content;
      textArea.style.position = 'fixed';
      textArea.style.left = '-9999px';
      document.body.appendChild(textArea);
      textArea.select();
      try {
        document.execCommand('copy');
        setCopied(true);
        toast.success('تم نسخ المحتوى');
        setTimeout(() => setCopied(false), 2000);
      } catch {
        toast.error('فشل نسخ المحتوى');
      }
      document.body.removeChild(textArea);
    }
  };

  // -------------------------------------------------------
  // Explain wrong answer (لماذا خطأ)
  // -------------------------------------------------------
  const handleExplainWrong = async (
    quizId: string,
    questionIdx: number,
    question: QuizQuestion,
    studentAnswer: string | Record<string, string>,
  ) => {
    const key = `${quizId}-${questionIdx}`;
    if (explainingIdx === key) return; // Already explaining this one
    if (explanations[key]) return; // Already explained

    setExplainingIdx(key);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token || '';

      // Build correctAnswer and studentAnswer strings
      let correctAnswer = question.correctAnswer || '';
      let studentAns = '';
      if (question.type === 'matching' && question.pairs) {
        correctAnswer = question.pairs.map(p => `${p.key} → ${p.value}`).join('، ');
        if (typeof studentAnswer === 'object') {
          studentAns = Object.entries(studentAnswer).map(([k, v]) => `${k} → ${v}`).join('، ');
        }
      } else {
        studentAns = typeof studentAnswer === 'string' ? studentAnswer : JSON.stringify(studentAnswer);
      }

      // Use fetchWithRetry for reliable delivery on mobile networks
      const res = await fetchWithRetry('/api/gemini/explain', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          question: question.question,
          correctAnswer,
          studentAnswer: studentAns,
          questionType: question.type,
        }),
        timeoutMs: 300000,
      }, 2);

      const data = await res.json();
      if (data.success && data.data?.explanation) {
        setExplanations(prev => ({ ...prev, [key]: data.data.explanation }));
      } else {
        toast.error(data.error || 'فشل الحصول على الشرح');
      }
    } catch {
      toast.error('حدث خطأ أثناء الحصول على الشرح');
    } finally {
      setExplainingIdx(null);
    }
  };

  // -------------------------------------------------------
  // Print handler
  // -------------------------------------------------------
  const handlePrint = () => {
    window.print();
  };

  // -------------------------------------------------------
  // Error state — with retry button (FIX: check error BEFORE loading
  // to prevent stuck loading when error is set but loading is also true)
  // -------------------------------------------------------
  if (error && !loading) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-4" dir="rtl">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-rose-100">
          <XCircle className="h-8 w-8 text-rose-600" />
        </div>
        <p className="text-lg font-semibold text-foreground">{error || 'حدث خطأ غير متوقع'}</p>
        <div className="flex gap-2">
          <Button
            onClick={() => fetchSummary()}
            variant="outline"
            className="gap-2 border-sky-300 text-sky-800 hover:bg-sky-50"
          >
            <RefreshCw className="h-4 w-4" />
            إعادة المحاولة
          </Button>
          <Button
            onClick={onBack}
            variant="outline"
            className="gap-2 border-sky-300 text-sky-800 hover:bg-sky-50"
          >
            <ChevronLeft className="h-4 w-4" />
            العودة
          </Button>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------
  // Error / not-found state — only when loading is done
  // -------------------------------------------------------
  if (!loading && !summary) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-4" dir="rtl">
        <p className="text-lg font-semibold text-foreground">لم يتم العثور على الملخص</p>
        <Button onClick={onBack} variant="outline" className="gap-2">
          <ChevronLeft className="h-4 w-4" />
          العودة
        </Button>
      </div>
    );
  }

  // -------------------------------------------------------
  // Main view
  // -------------------------------------------------------
  return (
    <motion.div
      initial="hidden"
      animate="visible"
      variants={staggerContainer}
      className="mx-auto max-w-3xl space-y-6 px-4 py-6 overflow-x-hidden"
      dir="rtl"
    >
      {/* Header */}
      <motion.div variants={fadeInUp} className="flex items-start gap-3">
        <button
          onClick={onBack}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-sky-200 text-sky-800 hover:bg-sky-50 transition-colors"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <div className="min-w-0 flex-1">
          {loading ? (
            <>
              <div className="h-6 w-48 animate-pulse rounded bg-sky-100" />
              <div className="mt-2 h-3 w-20 animate-pulse rounded bg-sky-50" />
            </>
          ) : (
            <>
              <h1 className="text-xl font-bold text-foreground leading-relaxed">{summary?.title}</h1>
              <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1.5">
                <BookOpen className="h-3 w-3" />
                ملخص دراسي
              </p>
            </>
          )}
        </div>
        <div className="flex shrink-0 gap-1.5">
          {/* Delete button — always visible on mobile */}
          <Button
            onClick={() => setDeleteConfirmOpen(true)}
            variant="outline"
            size="sm"
            className="gap-1.5 border-rose-300 text-rose-600 hover:bg-rose-50 print:hidden sm:hidden"
            title="حذف الملخص"
            disabled={deleting}
          >
            {deleting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4" />
            )}
          </Button>
          {/* Copy button */}
          <Button
            onClick={handleCopyContent}
            variant="outline"
            size="sm"
            className="gap-1.5 border-sky-300 text-sky-800 hover:bg-sky-50 print:hidden"
            title="نسخ المحتوى"
          >
            {copied ? (
              <CheckCircle2 className="h-4 w-4 text-sky-600" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
            <span className="hidden sm:inline">{copied ? 'تم النسخ' : 'نسخ'}</span>
          </Button>
          {/* Print button */}
          <Button
            onClick={handlePrint}
            variant="outline"
            size="sm"
            className="gap-1.5 border-sky-300 text-sky-800 hover:bg-sky-50 print:hidden"
          >
            <Printer className="h-4 w-4" />
            <span className="hidden sm:inline">طباعة</span>
          </Button>
        </div>
      </motion.div>

      {/* Summary content card */}
      <motion.div variants={fadeInUp}>
        <Card className={`${isTranscribed ? 'border-teal-200' : 'border-sky-200'} bg-white shadow-sm print:shadow-none print:border-none`}>
          <CardContent className="p-6 sm:p-8">
            {/* Decorative header */}
            <div className="flex items-center justify-between mb-6 pb-4 border-b border-sky-100 print:hidden">
              <div className="flex items-center gap-3">
                <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${isTranscribed ? 'bg-teal-100' : 'bg-sky-100'}`}>
                  {isTranscribed ? <BookOpen className="h-5 w-5 text-teal-600" /> : <Sparkles className="h-5 w-5 text-sky-700" />}
                </div>
                <div>
                  <h2 className={`text-sm font-bold ${isTranscribed ? 'text-teal-700' : 'text-sky-800'}`}>
                    {isTranscribed ? 'النص المفرّغ' : 'الملخص'}
                  </h2>
                  <p className={`text-xs ${isTranscribed ? 'text-teal-600/70' : 'text-sky-700/70'}`}>
                    {isTranscribed
                      ? sourceFileType === 'docx'
                        ? 'تم استخراج النص من ملف Word'
                        : sourceFileType === 'pdf'
                          ? 'تم استخراج النص من ملف PDF'
                          : 'تم استخراج النص من ملف'
                      : sourceFileType === 'docx'
                        ? 'تم إنشاؤه بواسطة الذكاء الاصطناعي من ملف Word'
                        : sourceFileType === 'pdf'
                          ? 'تم إنشاؤه بواسطة الذكاء الاصطناعي من ملف PDF'
                          : 'تم إنشاؤه بواسطة الذكاء الاصطناعي'
                    }
                  </p>
                </div>
              </div>
              {/* Source file download link */}
              {summary?.source_file_url && (
                <a
                  href={summary.source_file_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium text-sky-700 hover:bg-sky-50 hover:border-sky-300 transition-colors"
                >
                  <FileText className="h-3.5 w-3.5" />
                  تحميل الملف الأصلي
                </a>
              )}
              {/* Re-summarize button - only show for AI-generated summaries */}
              {!isTranscribed && (
                <Button
                  onClick={handleRegenerateSummary}
                  disabled={regenerating}
                  variant="ghost"
                  size="sm"
                  className="gap-1.5 text-sky-700 hover:text-sky-800 hover:bg-sky-50"
                title="إعادة التلخيص"
              >
                {regenerating ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
                <span className="hidden sm:inline">{regenerating ? 'جاري الإعادة...' : 'إعادة التلخيص'}</span>
              </Button>
              )}
              {/* Refine/format button - only show for transcribed content */}
              {isTranscribed && (
                <Button
                  onClick={handleRefineText}
                  disabled={refining}
                  variant="ghost"
                  size="sm"
                  className="gap-1.5 text-teal-600 hover:text-teal-700 hover:bg-teal-50"
                  title="تنقيح وتنسيق"
                >
                  {refining ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Wand2 className="h-4 w-4" />
                  )}
                  <span className="hidden sm:inline">{refining ? 'جاري التنقيح...' : 'تنقيح وتنسيق'}</span>
                </Button>
              )}
            </div>

            {/* Markdown content with RTL typography */}
            {regenerating ? (
              <div className="flex flex-col items-center justify-center py-12">
                <StepProgress
                  percent={summaryProgress.progress.percent}
                  phase={summaryProgress.progress.phase}
                  steps={AI_PHASES_SUMMARY}
                  color="sky"
                />
              </div>
            ) : refining ? (
              <div className="flex flex-col items-center justify-center py-12">
                <StepProgress
                  percent={refineProgress.progress.percent}
                  phase={refineProgress.progress.phase}
                  steps={AI_PHASES_REFINE}
                  color="teal"
                />
              </div>
            ) : loading ? (
              <div className="space-y-3 py-4">
                <div className="h-4 w-full animate-pulse rounded bg-sky-50" />
                <div className="h-4 w-5/6 animate-pulse rounded bg-sky-50" />
                <div className="h-4 w-4/6 animate-pulse rounded bg-sky-50" />
                <div className="h-4 w-full animate-pulse rounded bg-sky-50" />
                <div className="h-4 w-3/4 animate-pulse rounded bg-sky-50" />
                <div className="h-4 w-5/6 animate-pulse rounded bg-sky-50" />
              </div>
            ) : (
              <div className="prose-summary">
                <ReactMarkdown>{summary?.summary_content || ''}</ReactMarkdown>
              </div>
            )}
          </CardContent>
        </Card>
      </motion.div>

      {/* Quiz Section */}
      <motion.div variants={fadeInUp}>
        <Card className="border-teal-200 bg-white shadow-sm print:hidden">
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-100">
                  <ClipboardList className="h-5 w-5 text-teal-600" />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-teal-700">الاختبار</h2>
                  <p className="text-xs text-teal-600/70">
                    {relatedQuiz
                      ? `${relatedQuiz.questions?.length || 0} سؤال`
                      : 'أنشئ اختباراً من هذا الملخص'}
                  </p>
                </div>
              </div>
              {relatedQuiz && (
                <Button
                  onClick={handleRegenerateQuiz}
                  disabled={regeneratingQuiz}
                  variant="ghost"
                  size="sm"
                  className="gap-1.5 text-teal-600 hover:text-teal-700 hover:bg-teal-50"
                  title="إعادة إنشاء الاختبار"
                >
                  {regeneratingQuiz ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4" />
                  )}
                  <span className="hidden sm:inline">{regeneratingQuiz ? 'جاري الإعادة...' : 'إعادة إنشاء'}</span>
                </Button>
              )}
            </div>

            {relatedQuiz ? (
              <div className="space-y-3">
                {/* Quiz info */}
                <div className="flex flex-col gap-3 p-3 rounded-lg bg-teal-50/70 border border-teal-100">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-teal-800 break-words">{relatedQuiz.title}</p>
                    <div className="flex items-center gap-1.5 mt-1 flex-wrap text-xs text-teal-600">
                      <span>
                        {relatedQuiz.questions?.length || 0} سؤال
                      </span>
                      <span className="text-teal-400">•</span>
                      <span>
                        {relatedQuiz.questions?.filter(q => q.type === 'mcq').length || 0} اختيار من متعدد
                      </span>
                      <span className="text-teal-400">•</span>
                      <span>
                        {relatedQuiz.questions?.filter(q => q.type === 'boolean').length || 0} صح/خطأ
                      </span>
                      <span className="text-teal-400">•</span>
                      <span>
                        {relatedQuiz.questions?.filter(q => q.type === 'completion').length || 0} أكمل الفراغ
                      </span>
                      <span className="text-teal-400">•</span>
                      <span>
                        {relatedQuiz.questions?.filter(q => q.type === 'matching').length || 0} مطابقة
                      </span>
                    </div>
                  </div>
                  <Button
                    onClick={() => onViewQuiz?.(relatedQuiz.id)}
                    className="gap-1.5 bg-teal-600 hover:bg-teal-700 text-white shrink-0 w-full sm:w-auto self-start"
                    size="sm"
                  >
                    <Play className="h-4 w-4" />
                    ابدأ الاختبار
                  </Button>
                </div>
              </div>
            ) : generatingQuiz ? (
              <div className="flex flex-col items-center justify-center py-8">
                <StepProgress
                  percent={quizProgress.progress.percent}
                  phase={quizProgress.progress.phase}
                  steps={AI_PHASES_QUIZ}
                  color="teal"
                />
              </div>
            ) : showQuizConfig ? (
              <div className="space-y-4">
                {/* Question types */}
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">أنواع الأسئلة وعددها</label>
                  {([
                    { key: 'mcq' as const, label: 'اختيار من متعدد', icon: <ListChecks className="h-4 w-4" /> },
                    { key: 'boolean' as const, label: 'صح أو خطأ', icon: <CheckCircle2 className="h-4 w-4" /> },
                    { key: 'completion' as const, label: 'أكمل الجملة', icon: <Type className="h-4 w-4" /> },
                    { key: 'matching' as const, label: 'توصيل', icon: <Link2 className="h-4 w-4" /> },
                  ]).map((qt) => (
                    <div key={qt.key} className="flex items-center justify-between gap-3 rounded-lg border bg-card p-2.5">
                      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                        {qt.icon}
                        {qt.label}
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => setQuizConfigTypes(prev => ({ ...prev, [qt.key]: Math.max(0, prev[qt.key] - 1) }))}
                          className="flex h-6 w-6 items-center justify-center rounded border text-muted-foreground hover:bg-muted transition-colors text-xs"
                        >
                          -
                        </button>
                        <span className="w-6 text-center text-sm font-bold text-foreground">{quizConfigTypes[qt.key]}</span>
                        <button
                          onClick={() => setQuizConfigTypes(prev => ({ ...prev, [qt.key]: prev[qt.key] + 1 }))}
                          className="flex h-6 w-6 items-center justify-center rounded border text-muted-foreground hover:bg-muted transition-colors text-xs"
                        >
                          +
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Answer display mode */}
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">عرض الإجابات</label>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setQuizAnswerMode('after')}
                      className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-all ${
                        quizAnswerMode === 'after'
                          ? 'border-teal-500 bg-teal-50 text-teal-700'
                          : 'border-border text-muted-foreground hover:bg-muted/50'
                      }`}
                    >
                      بعد الاختبار
                    </button>
                    <button
                      onClick={() => setQuizAnswerMode('during')}
                      className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-all ${
                        quizAnswerMode === 'during'
                          ? 'border-teal-500 bg-teal-50 text-teal-700'
                          : 'border-border text-muted-foreground hover:bg-muted/50'
                      }`}
                    >
                      أثناء الاختبار
                    </button>
                  </div>
                </div>

                {/* Retake & Shuffle toggles */}
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">إعدادات إضافية</label>
                  <div className="flex items-center justify-between rounded-lg border bg-card p-2.5">
                    <span className="text-sm font-medium text-foreground">السماح بإعادة الاختبار</span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={quizAllowRetake}
                      onClick={() => setQuizAllowRetake(!quizAllowRetake)}
                      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2 ${
                        quizAllowRetake ? 'bg-teal-600' : 'bg-muted'
                      }`}
                    >
                      <span
                        className={`pointer-events-none block h-4 w-4 rounded-full bg-white shadow-lg ring-0 transition-transform ${
                          quizAllowRetake ? 'rtl:-translate-x-4 translate-x-4' : 'translate-x-0'
                        }`}
                      />
                    </button>
                  </div>
                  <div className="flex items-center justify-between rounded-lg border bg-card p-2.5">
                    <span className="text-sm font-medium text-foreground">ترتيب عشوائي للأسئلة</span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={quizShuffleQuestions}
                      onClick={() => setQuizShuffleQuestions(!quizShuffleQuestions)}
                      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2 ${
                        quizShuffleQuestions ? 'bg-teal-600' : 'bg-muted'
                      }`}
                    >
                      <span
                        className={`pointer-events-none block h-4 w-4 rounded-full bg-white shadow-lg ring-0 transition-transform ${
                          quizShuffleQuestions ? 'rtl:-translate-x-4 translate-x-4' : 'translate-x-0'
                        }`}
                      />
                    </button>
                  </div>
                </div>

                {/* Confirm / Cancel */}
                <div className="flex gap-2">
                  <Button
                    onClick={handleGenerateQuiz}
                    disabled={generatingQuiz || (quizConfigTypes.mcq + quizConfigTypes.boolean + quizConfigTypes.completion + quizConfigTypes.matching === 0)}
                    className="gap-1.5 bg-teal-600 hover:bg-teal-700 text-white"
                    size="sm"
                  >
                    <ClipboardList className="h-4 w-4" />
                    تأكيد الإنشاء
                  </Button>
                  <Button
                    onClick={() => setShowQuizConfig(false)}
                    variant="outline"
                    size="sm"
                    className="border-teal-300 text-teal-700 hover:bg-teal-50"
                  >
                    إلغاء
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-6 gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-teal-50">
                  <ClipboardList className="h-6 w-6 text-teal-400" />
                </div>
                <p className="text-sm text-muted-foreground">لم يتم إنشاء اختبار بعد</p>
                <Button
                  onClick={() => {
                    setQuizConfigTypes({ mcq: 2, boolean: 2, completion: 2, matching: 2 });
                    setQuizAnswerMode('after');
                    setQuizAllowRetake(true);
                    setQuizShuffleQuestions(true);
                    setShowQuizConfig(true);
                  }}
                  disabled={generatingQuiz}
                  className="gap-1.5 bg-teal-600 hover:bg-teal-700 text-white"
                  size="sm"
                >
                  <ClipboardList className="h-4 w-4" />
                  إنشاء اختبار
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </motion.div>

      {/* Completed Quizzes Section — shows all taken quizzes for this summary */}
      {completedQuizzes.length > 0 && (
        <motion.div variants={fadeInUp}>
          <Card className="border-violet-200 bg-white shadow-sm print:hidden">
            <CardContent className="p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-100">
                  <Trophy className="h-5 w-5 text-violet-600" />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-violet-700">الاختبارات المؤدّاة</h2>
                  <p className="text-xs text-violet-600/70">{completedQuizzes.length} اختبار مكتمل</p>
                </div>
              </div>

              <div className="space-y-3">
                {completedQuizzes.map(({ quiz: qz, score: sc }) => {
                  const pct = sc.total > 0 ? Math.round((sc.score / sc.total) * 100) : 0;
                  const isExpanded = expandedQuizId === sc.id;
                  const colorClass = pct >= 80
                    ? 'text-emerald-700 bg-emerald-100'
                    : pct >= 60
                      ? 'text-amber-700 bg-amber-100'
                      : 'text-rose-700 bg-rose-100';
                  const ringClass = pct >= 80
                    ? 'ring-emerald-200'
                    : pct >= 60
                      ? 'ring-amber-200'
                      : 'ring-rose-200';

                  return (
                    <div key={sc.id} className="rounded-xl border border-violet-100 overflow-hidden">
                      {/* Quiz header — clickable to expand */}
                      <button
                        onClick={() => setExpandedQuizId(isExpanded ? null : sc.id)}
                        className="w-full flex items-center justify-between gap-3 p-4 text-right hover:bg-violet-50/50 transition-colors"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${colorClass} ring-4 ${ringClass}`}>
                            <span className="text-sm font-bold">{pct}%</span>
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-foreground truncate">{qz.title}</p>
                            <p className="text-xs text-muted-foreground">
                              {sc.score} / {sc.total} صحيح — {new Date(sc.completed_at).toLocaleDateString('ar-EG')}
                            </p>
                          </div>
                        </div>
                        {isExpanded ? (
                          <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" />
                        ) : (
                          <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                        )}
                      </button>

                      {/* Expanded: answer review with لماذا خطأ */}
                      {isExpanded && qz.questions && (
                        <div className="border-t border-violet-100 p-4 space-y-3 bg-violet-50/20">
                          {qz.questions.map((qq, idx) => {
                            const ans = sc.user_answers?.find(a => a.questionIndex === idx);
                            const isWrong = ans && !ans.isCorrect;
                            const isUnanswered = !ans || (typeof ans.answer === 'string' && ans.answer.trim() === '');
                            const explainKey = `${qz.id}-${idx}`;
                            const explanation = explanations[explainKey];
                            const isExplaining = explainingIdx === explainKey;

                            return (
                              <div key={idx} className={`rounded-lg border p-3 text-sm ${
                                isWrong || isUnanswered
                                  ? 'border-rose-200 bg-rose-50/40'
                                  : 'border-emerald-200 bg-emerald-50/40'
                              }`}>
                                {/* Question text */}
                                <div className="flex items-start gap-2">
                                  <span className={`shrink-0 mt-0.5 ${isWrong || isUnanswered ? 'text-rose-500' : 'text-emerald-500'}`}>
                                    {isWrong || isUnanswered ? <XCircle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
                                  </span>
                                  <div className="min-w-0 flex-1">
                                    <p className="font-medium text-foreground leading-relaxed">{qq.question}</p>

                                    {/* Student answer */}
                                    {ans && !isUnanswered ? (
                                      <p className="mt-1 text-xs text-muted-foreground">
                                        <span className="font-medium">إجابتك:</span>{' '}
                                        {qq.type === 'matching' && typeof ans.answer === 'object'
                                          ? Object.entries(ans.answer as Record<string, string>).map(([k, v]) => `${k} → ${v}`).join(' | ')
                                          : String(ans.answer)}
                                      </p>
                                    ) : (
                                      <p className="mt-1 text-xs text-muted-foreground">لم تُجب على هذا السؤال</p>
                                    )}

                                    {/* Correct answer (shown for wrong answers) */}
                                    {(isWrong || isUnanswered) && qq.correctAnswer && (
                                      <p className="mt-1 text-xs text-emerald-700">
                                        <span className="font-medium">الإجابة الصحيحة:</span> {qq.correctAnswer}
                                      </p>
                                    )}

                                    {/* Matching: show all correct pairs */}
                                    {(isWrong || isUnanswered) && qq.type === 'matching' && qq.pairs && (
                                      <p className="mt-1 text-xs text-emerald-700">
                                        <span className="font-medium">الإجابة الصحيحة:</span>{' '}
                                        {qq.pairs.map(p => `${p.key} → ${p.value}`).join(' | ')}
                                      </p>
                                    )}

                                    {/* لماذا خطأ button */}
                                    {(isWrong || isUnanswered) && !isUnanswered && (
                                      <div className="mt-2">
                                        {explanation ? (
                                          <div className="rounded-lg bg-violet-50 border border-violet-200 p-3 text-xs text-violet-800 leading-relaxed">
                                            <div className="flex items-center gap-1.5 mb-1.5 font-bold">
                                              <Lightbulb className="h-3.5 w-3.5" />
                                              لماذا خطأ
                                            </div>
                                            <ReactMarkdown>{explanation}</ReactMarkdown>
                                          </div>
                                        ) : (
                                          <button
                                            onClick={() => handleExplainWrong(qz.id, idx, qq, ans?.answer || '')}
                                            disabled={isExplaining}
                                            className="inline-flex items-center gap-1.5 rounded-md bg-violet-100 px-2.5 py-1 text-xs font-medium text-violet-700 hover:bg-violet-200 transition-colors disabled:opacity-50"
                                          >
                                            {isExplaining ? (
                                              <Loader2 className="h-3 w-3 animate-spin" />
                                            ) : (
                                              <Lightbulb className="h-3 w-3" />
                                            )}
                                            {isExplaining ? 'جاري الشرح...' : 'لماذا خطأ؟'}
                                          </button>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </motion.div>
      )}

      {/* Delete Section */}
      <motion.div variants={fadeInUp} className="print:hidden">
        {!deleteConfirmOpen ? (
          <div className="flex items-center justify-between rounded-xl border border-rose-100 bg-rose-50/30 p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-rose-100">
                <Trash2 className="h-4 w-4 text-rose-600" />
              </div>
              <div>
                <p className="text-sm font-medium text-rose-700">حذف الملخص</p>
                <p className="text-xs text-rose-600/70">سيتم حذف الملخص والاختبار المرتبط به نهائياً</p>
              </div>
            </div>
            <Button
              onClick={() => setDeleteConfirmOpen(true)}
              variant="outline"
              size="sm"
              className="gap-1.5 border-rose-300 text-rose-600 hover:bg-rose-50"
            >
              <Trash2 className="h-4 w-4" />
              حذف
            </Button>
          </div>
        ) : (
          <div className="rounded-xl border border-rose-300 bg-rose-50 p-4">
            <div className="flex items-center gap-3 mb-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-rose-100">
                <AlertTriangle className="h-4 w-4 text-rose-600" />
              </div>
              <div>
                <p className="text-sm font-bold text-rose-700">تأكيد الحذف</p>
                <p className="text-xs text-rose-600/70">هل أنت متأكد من حذف ملخص "{summary?.title}"؟ لا يمكن التراجع عن هذا الإجراء.</p>
              </div>
            </div>
            <div className="flex items-center gap-2 ms-12">
              <Button
                onClick={handleDeleteSummary}
                disabled={deleting}
                size="sm"
                className="gap-1.5 bg-rose-600 hover:bg-rose-700 text-white"
              >
                {deleting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4" />
                )}
                {deleting ? 'جاري الحذف...' : 'نعم، احذف'}
              </Button>
              <Button
                onClick={() => setDeleteConfirmOpen(false)}
                variant="outline"
                size="sm"
                className="border-rose-200 text-rose-600 hover:bg-rose-50"
                disabled={deleting}
              >
                إلغاء
              </Button>
            </div>
          </div>
        )}
      </motion.div>

      {/* Scroll to Top Button */}
      <ScrollToTopButton />
    </motion.div>
  );
}
